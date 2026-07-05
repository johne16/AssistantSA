// Hook the portal calls into. Owns the gateway client, the off-screen scrape
// orchestration with a concurrency cap + queue, and the utility-view reads.
//
// Reaches the backend exclusively through the API gateway. Credentials are read
// from the keystore at scrape time and handed to the scrape-runner; they never
// reach the gateway.

import { useCallback, useMemo, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { app_config } from "@/app-config";
import { useResidentSession } from "@/m-res-auth";

import { delete_credentials, read_credentials } from "./keystore";
import { accounts_query_keys } from "./types";
import type { scrape_runner_handle } from "./scrape-runner";
import type {
  account_link_request,
  account_unlink_request,
  bill_push_request,
  bill_view,
  linked_account,
  provider_catalog_entry,
  profile_save_request,
  resident_profile,
  scrape_job,
  scrape_script_entry,
  site_script_request,
  sync_result,
  usage_view,
  utility_api_request,
  utility_data,
  utility_view_request,
} from "./types";

// Per-account sync progress callback the portal subscribes to.
export type sync_listener = (result: sync_result) => void;

// Stable empty fallback so an unresolved query keeps a constant reference (a new
// [] each render would make the linked mirror effect loop).
const EMPTY_LINKED: linked_account[] = [];
const EMPTY_CATALOG: provider_catalog_entry[] = [];

// AsyncStorage key for the site_id -> local date of the last successful scrape.
// A site that already scraped successfully today is skipped by every automatic
// trigger, so repeated triggers do not hammer the provider with logins.
const last_scrape_success_key = "m_res_accounts.last_scrape_success";

// Local calendar date (YYYY-MM-DD), so "once a day" follows the device's clock.
function local_date(): string {
  const d = new Date();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${month}-${day}`;
}

async function read_last_scrape_success(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(last_scrape_success_key);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}

async function write_last_scrape_success(site_id: string): Promise<void> {
  try {
    const dates = await read_last_scrape_success();
    dates[site_id] = local_date();
    await AsyncStorage.setItem(last_scrape_success_key, JSON.stringify(dates));
  } catch {
    // Best effort; a lost write only means an extra scrape on the next trigger.
  }
}

export interface use_accounts_value {
  // Read stored utility data for a portal screen.
  utility_view_request(req: utility_view_request): Promise<utility_data>;
  // Sync one linked account. Emits sync_result transitions via the listener.
  sync(site_id: string): Promise<sync_result>;
  // Sync every linked account, draining a queue at the concurrency cap.
  sync_all(site_ids: string[]): Promise<sync_result[]>;
  // Persist a linked-account record (non-secret) to the backend. Credentials are
  // captured separately by LinkAccountFields straight to the keystore.
  register_linked_account(account: linked_account): Promise<void>;
  // Remove a linked account: backend record + device credentials.
  unlink_account(site_id: string): Promise<void>;
  // The resident's linked accounts.
  linked: linked_account[];
  // True once linked has been fetched from the backend this session. Until
  // then linked may be the persisted offline cache, which must not initiate
  // scrapes: only server-side linked account records drive syncs.
  linked_fetched: boolean;
  // The providers a resident can link, served by the backend.
  catalog: provider_catalog_entry[];
  // Persist the resident profile to the backend.
  save_profile(profile: resident_profile): Promise<void>;
  // The resident profile. Null until first loaded/saved.
  profile: resident_profile | null;
  // Subscribe to per-account sync_result transitions. Returns an unsubscribe.
  on_sync_result(listener: sync_listener): () => void;
}

export function useAccounts(
  runner: React.RefObject<scrape_runner_handle | null>,
): use_accounts_value {
  const { tenant_context_token } = useResidentSession();

  const base = app_config.api_gateway_base_url;
  const max_concurrent =
    app_config.max_concurrent_syncs > 0 ? app_config.max_concurrent_syncs : 3;

  const listeners = useRef<Set<sync_listener>>(new Set());
  // Per-site in-flight syncs. A second sync of a site already syncing (e.g. a
  // manual sync overlapping sync_all) joins the running one instead of
  // double-scraping and pushing the same bills twice.
  const in_flight = useRef<Map<string, Promise<sync_result>>>(new Map());
  const client = useQueryClient();

  const emit = useCallback((result: sync_result) => {
    for (const l of listeners.current) l(result);
  }, []);

  const on_sync_result = useCallback<use_accounts_value["on_sync_result"]>(
    (listener) => {
      listeners.current.add(listener);
      return () => listeners.current.delete(listener);
    },
    [],
  );

  // --- gateway client (gateway-only) ---

  // Fetch the per-site scrape script. siteScript: { tenant_context_token, site_id }.
  const fetch_site_script = useCallback(
    async (site_id: string): Promise<scrape_script_entry> => {
      const body: site_script_request = { tenant_context_token, site_id };
      const res = await fetch(`${base}/utility/site-script`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`site-script ${res.status}`);
      return (await res.json()) as scrape_script_entry;
    },
    [base, tenant_context_token],
  );

  // Push scraped bills + usage for one site. billPush: { tenant_context_token, site_id, bills, usage }.
  const push_bills = useCallback(
    async (site_id: string, bills: bill_view[], usage: usage_view[]): Promise<void> => {
      const body: bill_push_request = { tenant_context_token, site_id, bills, usage };
      const res = await fetch(`${base}/utility/bill-push`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`bill-push ${res.status}`);
    },
    [base, tenant_context_token],
  );

  // Read stored utility data. utilityApiRequest: { tenant_context_token, operation, params }.
  const read_utility = useCallback(
    async (req: utility_view_request): Promise<utility_data> => {
      const body: utility_api_request = {
        tenant_context_token,
        operation: req.resource,
        params: req.params,
      };
      const res = await fetch(`${base}/utility/read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`utility-read ${res.status}`);
      const data = await res.json();
      if (req.resource === "bills") return { resource: "bills", bills: data as bill_view[] };
      if (req.resource === "usage") return { resource: "usage", usage: data as usage_view[] };
      return { resource: "outage", outage: data };
    },
    [base, tenant_context_token],
  );

  // --- public methods ---

  const utility_view_request = useCallback<
    use_accounts_value["utility_view_request"]
  >((req) => read_utility(req), [read_utility]);

  // --- gateway reads via React Query (persisted, offline-first) ---

  // The resident's linked accounts.
  const linked_query = useQuery({
    queryKey: accounts_query_keys.linked,
    queryFn: async (): Promise<linked_account[]> => {
      const res = await fetch(`${base}/utility/accounts/read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_context_token }),
      });
      if (!res.ok) throw new Error(`accounts-read ${res.status}`);
      return (await res.json()) as linked_account[];
    },
  });

  // The providers a resident can link.
  const catalog_query = useQuery({
    queryKey: accounts_query_keys.catalog,
    queryFn: async (): Promise<provider_catalog_entry[]> => {
      const res = await fetch(`${base}/utility/catalog`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_context_token }),
      });
      if (!res.ok) throw new Error(`catalog ${res.status}`);
      return (await res.json()) as provider_catalog_entry[];
    },
  });

  // The resident profile. Null until first saved.
  const profile_query = useQuery({
    queryKey: accounts_query_keys.profile,
    queryFn: async (): Promise<resident_profile | null> => {
      const res = await fetch(`${base}/utility/profile/read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_context_token }),
      });
      if (!res.ok) throw new Error(`profile-read ${res.status}`);
      return (await res.json()) as resident_profile | null;
    },
  });

  // --- gateway writes via React Query mutations ---

  const register_mutation = useMutation({
    mutationFn: async (account: linked_account): Promise<void> => {
      const body: account_link_request = { tenant_context_token, account };
      const res = await fetch(`${base}/utility/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`accounts-link ${res.status}`);
    },
    // Write the linked account into the query cache immediately, then refetch.
    // invalidateQueries restarts any in-flight fetch, so a refetch started
    // before the link cannot land afterward with the pre-link list.
    onSuccess: (_data, account) => {
      client.setQueryData<linked_account[]>(
        accounts_query_keys.linked,
        (prev = []) =>
          prev.some((a) => a.site_id === account.site_id)
            ? prev
            : [...prev, account],
      );
      void client.invalidateQueries({ queryKey: accounts_query_keys.linked });
    },
  });

  const unlink_mutation = useMutation({
    mutationFn: async (site_id: string): Promise<void> => {
      const body: account_unlink_request = { tenant_context_token, site_id };
      const res = await fetch(`${base}/utility/accounts/unlink`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`accounts-unlink ${res.status}`);
      await delete_credentials(site_id);
      // Clear the daily-scrape record so relinking the site later today scrapes
      // fresh instead of being skipped.
      const dates = await read_last_scrape_success();
      if (dates[site_id]) {
        delete dates[site_id];
        await AsyncStorage.setItem(last_scrape_success_key, JSON.stringify(dates));
      }
    },
    onSuccess: (_data, site_id) => {
      client.setQueryData<linked_account[]>(
        accounts_query_keys.linked,
        (prev = []) => prev.filter((a) => a.site_id !== site_id),
      );
      void client.invalidateQueries({ queryKey: accounts_query_keys.linked });
    },
  });

  const save_profile_mutation = useMutation({
    mutationFn: async (profile: resident_profile): Promise<void> => {
      const body: profile_save_request = { tenant_context_token, profile };
      const res = await fetch(`${base}/utility/profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`profile-save ${res.status}`);
    },
    onSuccess: (_data, profile) =>
      client.setQueryData(accounts_query_keys.profile, profile),
  });

  // Depend on the stable mutateAsync, not the mutation object (new each render),
  // so these callbacks stay stable.
  const register_async = register_mutation.mutateAsync;
  const unlink_async = unlink_mutation.mutateAsync;
  const save_profile_async = save_profile_mutation.mutateAsync;

  const register_linked_account = useCallback<
    use_accounts_value["register_linked_account"]
  >((account) => register_async(account).then(() => undefined), [register_async]);

  const unlink_account = useCallback<use_accounts_value["unlink_account"]>(
    (site_id) => unlink_async(site_id).then(() => undefined),
    [unlink_async],
  );

  const save_profile = useCallback<use_accounts_value["save_profile"]>(
    (profile) => save_profile_async(profile).then(() => undefined),
    [save_profile_async],
  );

  // Run a single site through the off-screen WebView. Reads creds at scrape
  // time, fetches the fresh script, drives the scrape, pushes results. A site
  // already in flight is joined, not scraped again, and a site that already
  // scraped successfully today is skipped without logging in.
  const run_site = useCallback(
    (site_id: string): Promise<sync_result> => {
      const existing = in_flight.current.get(site_id);
      if (existing) return existing;
      const promise = (async (): Promise<sync_result> => {
      const dates = await read_last_scrape_success();
      if (dates[site_id] === local_date()) {
        console.log(`[scrape ${site_id}] skipped: already synced today`);
        const result: sync_result = { site_id, sync_status: "done" };
        emit(result);
        return result;
      }
      emit({ site_id, sync_status: "syncing" });
      console.log(`[scrape ${site_id}] sync start`);
      try {
        const creds = await read_credentials(site_id);
        if (!creds) throw new Error("no linked credentials");
        if (!runner.current) throw new Error("scrape runner not mounted");

        const entry = await fetch_site_script(site_id);
        console.log(
          `[scrape ${site_id}] script fetched (${entry.script.length} chars), url=${entry.url}`,
        );
        const job: scrape_job = {
          site_id,
          url: entry.url,
          script: entry.script,
          credentials: creds,
        };
        const scraped = await runner.current.run(job);
        const bills = scraped.bills as unknown as bill_view[];
        const usage = scraped.usage as unknown as usage_view[];
        console.log(
          `[scrape ${site_id}] scrape done: ${bills.length} bills, ${usage.length} usage`,
        );
        await push_bills(site_id, bills, usage);
        await write_last_scrape_success(site_id);

        const result: sync_result = {
          site_id,
          sync_status: "done",
          data: { bills, usage },
        };
        emit(result);
        return result;
      } catch (e) {
        console.log(`[scrape ${site_id}] sync error: ${String(e)}`);
        const result: sync_result = {
          site_id,
          sync_status: "error",
          error: e instanceof Error ? e.message : String(e),
        };
        emit(result);
        return result;
      }
      })().finally(() => {
        in_flight.current.delete(site_id);
      });
      in_flight.current.set(site_id, promise);
      return promise;
    },
    [emit, fetch_site_script, push_bills, runner],
  );

  const sync = useCallback<use_accounts_value["sync"]>(
    (site_id) => run_site(site_id),
    [run_site],
  );

  // Drain a queue, keeping up to max_concurrent off-screen WebViews in flight.
  const sync_all = useCallback<use_accounts_value["sync_all"]>(
    async (site_ids) => {
      for (const site_id of site_ids) emit({ site_id, sync_status: "queued" });

      const queue = [...site_ids];
      const results: sync_result[] = [];

      async function worker(): Promise<void> {
        while (queue.length > 0) {
          const site_id = queue.shift();
          if (site_id === undefined) return;
          results.push(await run_site(site_id));
        }
      }

      const worker_count = Math.min(max_concurrent, site_ids.length);
      await Promise.all(Array.from({ length: worker_count }, () => worker()));
      return results;
    },
    [emit, max_concurrent, run_site],
  );

  // Startup and resume scrapes are driven by the portal, which owns the linked
  // site_ids and calls sync_all on app open.

  const linked = linked_query.data ?? EMPTY_LINKED;
  const linked_fetched = linked_query.isFetchedAfterMount;
  const catalog = catalog_query.data ?? EMPTY_CATALOG;
  const profile = profile_query.data ?? null;

  return useMemo<use_accounts_value>(
    () => ({
      utility_view_request,
      sync,
      sync_all,
      register_linked_account,
      unlink_account,
      linked,
      linked_fetched,
      catalog,
      save_profile,
      profile,
      on_sync_result,
    }),
    [
      utility_view_request,
      sync,
      sync_all,
      register_linked_account,
      unlink_account,
      linked,
      linked_fetched,
      catalog,
      save_profile,
      profile,
      on_sync_result,
    ],
  );
}
