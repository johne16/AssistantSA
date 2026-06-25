// Hook the portal calls into. Owns the gateway client, the off-screen scrape
// orchestration with a concurrency cap + queue, and the utility-view reads.
//
// Reaches the backend exclusively through the API gateway. Credentials are read
// from the keystore at scrape time and handed to the scrape-runner; they never
// reach the gateway.

import { useCallback, useEffect, useRef } from "react";

import { app_config } from "@/app-config";
import { use_resident_session } from "@/m-res-auth";

import { delete_credentials, read_credentials } from "./keystore";
import type { scrape_runner_handle } from "./scrape-runner";
import type {
  account_link_request,
  account_unlink_request,
  bill_push_request,
  bill_view,
  linked_account,
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
  // Load the resident's linked accounts from the backend.
  list_accounts(): Promise<linked_account[]>;
  // Persist the resident profile to the backend.
  save_profile(profile: resident_profile): Promise<void>;
  // Load the resident profile from the backend. Null if never saved.
  load_profile(): Promise<resident_profile | null>;
  // Subscribe to per-account sync_result transitions. Returns an unsubscribe.
  on_sync_result(listener: sync_listener): () => void;
}

export function use_accounts(
  runner: React.RefObject<scrape_runner_handle | null>,
): use_accounts_value {
  const { tenant_context_token } = use_resident_session();

  const base = app_config.api_gateway_base_url;
  const max_concurrent =
    app_config.max_concurrent_syncs > 0 ? app_config.max_concurrent_syncs : 3;

  const listeners = useRef<Set<sync_listener>>(new Set());

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

  // Push scraped bills + usage. billPush: { tenant_context_token, bills, usage }.
  const push_bills = useCallback(
    async (bills: bill_view[], usage: usage_view[]): Promise<void> => {
      const body: bill_push_request = { tenant_context_token, bills, usage };
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

  const register_linked_account = useCallback<
    use_accounts_value["register_linked_account"]
  >(
    async (account) => {
      const body: account_link_request = { tenant_context_token, account };
      const res = await fetch(`${base}/utility/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`accounts-link ${res.status}`);
    },
    [base, tenant_context_token],
  );

  const unlink_account = useCallback<use_accounts_value["unlink_account"]>(
    async (site_id) => {
      const body: account_unlink_request = { tenant_context_token, site_id };
      const res = await fetch(`${base}/utility/accounts/unlink`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`accounts-unlink ${res.status}`);
      await delete_credentials(site_id);
    },
    [base, tenant_context_token],
  );

  const list_accounts = useCallback<use_accounts_value["list_accounts"]>(
    async () => {
      const res = await fetch(`${base}/utility/accounts/read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_context_token }),
      });
      if (!res.ok) throw new Error(`accounts-read ${res.status}`);
      return (await res.json()) as linked_account[];
    },
    [base, tenant_context_token],
  );

  const save_profile = useCallback<use_accounts_value["save_profile"]>(
    async (profile) => {
      const body: profile_save_request = { tenant_context_token, profile };
      const res = await fetch(`${base}/utility/profile`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`profile-save ${res.status}`);
    },
    [base, tenant_context_token],
  );

  const load_profile = useCallback<use_accounts_value["load_profile"]>(
    async () => {
      const res = await fetch(`${base}/utility/profile/read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenant_context_token }),
      });
      if (!res.ok) throw new Error(`profile-read ${res.status}`);
      return (await res.json()) as resident_profile | null;
    },
    [base, tenant_context_token],
  );

  // Run a single site through the off-screen WebView. Reads creds at scrape
  // time, fetches the fresh script, drives the scrape, pushes results.
  const run_site = useCallback(
    async (site_id: string): Promise<sync_result> => {
      emit({ site_id, sync_status: "syncing" });
      try {
        const creds = await read_credentials(site_id);
        if (!creds) throw new Error("no linked credentials");
        if (!runner.current) throw new Error("scrape runner not mounted");

        const entry = await fetch_site_script(site_id);
        const job: scrape_job = {
          site_id,
          url: entry.url,
          script: entry.script,
          credentials: creds,
        };
        const scraped = await runner.current.run(job);
        const bills = scraped.bills as unknown as bill_view[];
        const usage = scraped.usage as unknown as usage_view[];
        await push_bills(bills, usage);

        const result: sync_result = {
          site_id,
          sync_status: "done",
          data: { bills, usage },
        };
        emit(result);
        return result;
      } catch (e) {
        const result: sync_result = {
          site_id,
          sync_status: "error",
          error: e instanceof Error ? e.message : String(e),
        };
        emit(result);
        return result;
      }
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

  // Self-initiated startup scrape of all linked accounts, once on mount.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // Startup site list is not yet known here; the portal supplies linked
    // site_ids and calls sync_all. Left as a no-op hook anchor.
  }, []);

  return {
    utility_view_request,
    sync,
    sync_all,
    register_linked_account,
    unlink_account,
    list_accounts,
    save_profile,
    load_profile,
    on_sync_result,
  };
}
