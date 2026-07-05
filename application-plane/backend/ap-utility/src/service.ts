// ap-utility service: stored utility reads, push storage, script registry,
// scheduled outage fetch, and bill reminder evaluation.

import { provider_catalog } from "./provider_catalog.js";
import type {
  bill_push,
  bill_view,
  linked_account,
  notify_request,
  outage_view,
  provider_catalog_entry,
  resident_profile,
  scrape_script_entry,
  tenant_context_token,
  usage_view,
  utility_resource,
  utility_service_deps,
  utility_read_params,
} from "./types.js";

export type utility_read_result = bill_view[] | usage_view[] | outage_view[];

export interface utility_service {
  read(
    token: tenant_context_token,
    resource: utility_resource,
    params: utility_read_params,
  ): Promise<utility_read_result>;
  push(token: tenant_context_token, push: bill_push): Promise<void>;
  script(site_id: string): scrape_script_entry | undefined;
  catalog(): provider_catalog_entry[];
  save_profile(token: tenant_context_token, profile: resident_profile): Promise<void>;
  get_profile(token: tenant_context_token): Promise<resident_profile | null>;
  link_account(token: tenant_context_token, account: linked_account): Promise<void>;
  list_linked_accounts(token: tenant_context_token): Promise<linked_account[]>;
  unlink_account(token: tenant_context_token, site_id: string): Promise<void>;
  run_outage_fetch(): Promise<void>;
  run_reminder_evaluation(): Promise<void>;
}

export function create_utility_service(deps: utility_service_deps): utility_service {
  const { store, utility_systems, notifier, clock, config } = deps;

  // Calendar days between two dates in local time, target minus reference.
  function days_until(target_iso: string, ref: Date): number {
    const [y, m, d] = target_iso.slice(0, 10).split("-").map(Number) as [number, number, number];
    const target = new Date(y, m - 1, d);
    const ref_day = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
    return Math.round((target.getTime() - ref_day.getTime()) / 86_400_000);
  }

  async function read(
    token: tenant_context_token,
    resource: utility_resource,
    params: utility_read_params,
  ): Promise<utility_read_result> {
    const tid = token.city_tenant_id;
    const sub = token.sub;
    switch (resource) {
      case "bills":
        // Callers address a linked account by account_ref; bills are stored per
        // site_id and the two carry the same value (linked accounts are keyed by
        // site_id), so either param scopes the read.
        return store.read_bills(tid, sub, params.site_id ?? params.account_ref);
      case "usage":
        return store.read_usage(tid, sub, params.account_ref);
      case "outage":
        return store.read_outages(tid, sub);
    }
  }

  async function push(token: tenant_context_token, push_payload: bill_push): Promise<void> {
    // Only sites with a linked_account record may store data: a scrape driven
    // from a stale client-side linked list must not store bills for a site the
    // backend considers unlinked.
    const accounts = await store.list_linked_accounts(token.city_tenant_id, token.sub);
    if (!accounts.some((a) => a.site_id === push_payload.site_id)) {
      throw new Error(`site_not_linked: ${push_payload.site_id}`);
    }
    // No credential handling; store scraped bills + usage only. Stamp each record
    // with the store time so reads can report when the data was recorded, and
    // each bill with its site_id so reads can attribute it to an account.
    const recorded_at = clock.now().toISOString();
    const stamped: bill_push = {
      site_id: push_payload.site_id,
      bills: push_payload.bills.map((b) => ({
        ...b,
        site_id: push_payload.site_id,
        recorded_at,
      })),
      usage: push_payload.usage.map((u) => ({ ...u, recorded_at })),
    };
    await store.store_bill_push(token.city_tenant_id, token.sub, stamped);
  }

  function script(site_id: string): scrape_script_entry | undefined {
    return config.scrape_script_registry[site_id];
  }

  function catalog(): provider_catalog_entry[] {
    return provider_catalog;
  }

  // Fetch, dedupe, store, notify, and prune outages for one resident address.
  async function fetch_outages_for(
    tid: string,
    sub: string,
    address: string,
    now: Date,
  ): Promise<void> {
    const retain_before = new Date(
      now.getTime() - config.utility_retention_days * 86_400_000,
    ).toISOString();

    const fetched = await utility_systems.fetch_outages(
      config.power_outage_source_url,
      address,
    );
    const stored = await store.read_outages(tid, sub);
    const known = new Map(stored.map((o) => [o.outage_id, o]));

    // Dedupe: entries not already stored, or stored with a different status.
    const fresh: outage_view[] = fetched
      .filter((o) => known.get(o.outage_id)?.status !== o.status)
      .map((o) => ({
        address: o.address,
        status: o.status,
        reported_at: o.reported_at,
        outage_id: o.outage_id,
        recorded_at: now.toISOString(),
      }));

    if (fresh.length > 0) {
      await store.store_outages(tid, sub, fresh);
      // Notify only for newly stored outages.
      for (const o of fresh) {
        const token = synth_token(tid, sub, now);
        const request: notify_request = {
          type: "power_outage",
          notification: { ...o },
        };
        await notifier.notify(token, request);
      }
    }

    // Prune entries older than the retention window.
    await store.prune_outages(tid, sub, retain_before);
  }

  async function run_outage_fetch(): Promise<void> {
    const now = clock.now();
    // Outage fetch is not token-scoped; iterate every city tenant the store knows.
    // ap-server's store adapter resolves namespaces; here we drive per address.
    const tenants = await list_tenants();
    for (const tid of tenants) {
      const addresses = await store.list_resident_addresses(tid);
      for (const resident of addresses) {
        await fetch_outages_for(tid, resident.sub, resident.address, now);
      }
    }
  }

  async function save_profile(
    token: tenant_context_token,
    profile: resident_profile,
  ): Promise<void> {
    await store.save_profile(token.city_tenant_id, token.sub, profile);
    // Saving a service address un-gates outage scraping; fetch immediately so
    // Power Status populates without waiting for the scheduler.
    if (profile.street.trim().length > 0) {
      await fetch_outages_for(
        token.city_tenant_id,
        token.sub,
        profile.street,
        clock.now(),
      );
    }
  }

  async function get_profile(
    token: tenant_context_token,
  ): Promise<resident_profile | null> {
    return store.get_profile(token.city_tenant_id, token.sub);
  }

  async function link_account(
    token: tenant_context_token,
    account: linked_account,
  ): Promise<void> {
    await store.save_linked_account(token.city_tenant_id, token.sub, account);
  }

  async function list_linked_accounts(
    token: tenant_context_token,
  ): Promise<linked_account[]> {
    return store.list_linked_accounts(token.city_tenant_id, token.sub);
  }

  async function unlink_account(
    token: tenant_context_token,
    site_id: string,
  ): Promise<void> {
    await store.delete_linked_account(token.city_tenant_id, token.sub, site_id);
    // Stored data for the site goes with the link; an unlinked account must not
    // keep serving bills or usage.
    await store.delete_bills(token.city_tenant_id, token.sub, site_id);
    await store.delete_usage(token.city_tenant_id, token.sub, site_id);
  }

  async function run_reminder_evaluation(): Promise<void> {
    const now = clock.now();
    const tenants = await list_tenants();
    for (const tid of tenants) {
      const subs = await store.list_residents_with_bills(tid);
      for (const sub of subs) {
        const bills = await store.read_bills(tid, sub);
        for (const bill of bills) {
          const remaining = days_until(bill.due_date, now);
          if (remaining === config.bill_due_reminder_days) {
            const token = synth_token(tid, sub, now);
            const request: notify_request = {
              type: "bill_due",
              notification: { ...bill },
            };
            await notifier.notify(token, request);
          }
        }
      }
    }
  }

  // Scheduler paths have no incoming token; reconstruct claims for the notifier,
  // which requires a tenant_context_token shape. iat/exp are informational here.
  function synth_token(
    city_tenant_id: string,
    sub: string,
    now: Date,
  ): tenant_context_token {
    const iat = Math.floor(now.getTime() / 1000);
    return { sub, city_tenant_id, iat, exp: iat };
  }

  // Tenant enumeration for scheduler paths is provided by the store adapter
  // through list_resident_addresses keys; ap-server supplies the tenant set.
  async function list_tenants(): Promise<string[]> {
    return store.list_tenants();
  }

  return {
    read,
    push,
    script,
    catalog,
    save_profile,
    get_profile,
    link_account,
    list_linked_accounts,
    unlink_account,
    run_outage_fetch,
    run_reminder_evaluation,
  };
}
