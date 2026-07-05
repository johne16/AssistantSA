// In-memory fallback store adapters, used when no database_url is configured so
// the PoC runs without a reachable Postgres. Same module store ports as the
// postgres adapters; per-city siloing is a Map keyed by city_tenant_id. Volatile.

import type {
  alert_entry,
  collection_schedule_entry,
  event_entry,
  fetch_source,
  find_my_rep_entry,
  my_area_entry,
  my_area_kind,
  civic_store,
} from "ap-civic";
import type {
  bill_view,
  linked_account,
  outage_view,
  resident_address,
  resident_profile,
  usage_view,
  utility_store,
} from "ap-utility";
import type {
  reminder_due,
  reminder_entry,
  reminders_store,
} from "ap-reminders";
import type {
  notification_registration_record,
  notifications_store,
  pending_delivery,
  pending_notifications_store,
} from "ap-notifications";

function tenant_map<V>(): Map<string, V> {
  return new Map<string, V>();
}

export function create_memory_civic_store(): civic_store {
  // city -> source -> entries
  const entries = new Map<string, Map<fetch_source, Map<string, alert_entry | event_entry>>>();
  // city -> "kind|address" -> resolved
  const resolved = new Map<string, Map<string, find_my_rep_entry | my_area_entry | collection_schedule_entry[]>>();
  // city -> sub -> dismissed alert entry_ids
  const dismissals = new Map<string, Map<string, Set<string>>>();

  function src(city: string, source: fetch_source) {
    let byCity = entries.get(city);
    if (!byCity) entries.set(city, (byCity = new Map()));
    let bySrc = byCity.get(source);
    if (!bySrc) byCity.set(source, (bySrc = new Map()));
    return bySrc;
  }
  function res(city: string) {
    let m = resolved.get(city);
    if (!m) resolved.set(city, (m = tenant_map()));
    return m;
  }
  function dis(city: string, sub: string) {
    let byCity = dismissals.get(city);
    if (!byCity) dismissals.set(city, (byCity = new Map()));
    let set = byCity.get(sub);
    if (!set) byCity.set(sub, (set = new Set()));
    return set;
  }

  return {
    async list_alerts(city) {
      return [...src(city, "city_alerts").values()] as alert_entry[];
    },
    async list_events(city) {
      return [...src(city, "city_events").values()] as event_entry[];
    },
    async get_collection_schedule(city, address) {
      return (res(city).get(`collection_schedule|${address}`) as collection_schedule_entry[]) ?? [];
    },
    async list_resolved_addresses(city) {
      const out = new Set<string>();
      for (const key of res(city).keys()) {
        const address = key.slice(key.indexOf("|") + 1);
        if (address) out.add(address);
      }
      return [...out];
    },
    async get_find_my_rep(city, address) {
      return (res(city).get(`find_my_rep|${address}`) as find_my_rep_entry) ?? null;
    },
    async get_my_area(city, address, kind: my_area_kind) {
      return (res(city).get(`my_area_${kind}|${address}`) as my_area_entry) ?? null;
    },
    async existing_entry_ids(city, source: fetch_source) {
      return [...src(city, source).keys()];
    },
    async insert_alerts(city, list) {
      for (const e of list) src(city, "city_alerts").set(e.entry_id, e);
    },
    async insert_events(city, list) {
      for (const e of list) src(city, "city_events").set(e.entry_id, e);
    },
    async list_alert_dismissals(city, sub) {
      return [...dis(city, sub)];
    },
    async insert_alert_dismissal(city, sub, entry_id) {
      dis(city, sub).add(entry_id);
    },
    async delete_alert_dismissal(city, sub, entry_id) {
      dis(city, sub).delete(entry_id);
    },
    async upsert_collection_schedule(city, address, entries) {
      res(city).set(`collection_schedule|${address}`, entries);
    },
    async upsert_find_my_rep(city, entry) {
      res(city).set(`find_my_rep|${entry.address}`, entry);
    },
    async upsert_my_area(city, entry) {
      res(city).set(`my_area_${entry.kind}|${entry.address}`, entry);
    },
    async prune_older_than(city, source: fetch_source, cutoff_iso) {
      const m = src(city, source);
      let pruned = 0;
      for (const [id, e] of m) {
        if ((e as { fetched_at: string }).fetched_at < cutoff_iso) {
          m.delete(id);
          pruned += 1;
        }
      }
      return pruned;
    },
  };
}

export function create_memory_utility_store(): utility_store {
  const bills = new Map<string, bill_view[]>(); // key city|sub|site_id
  const usage = new Map<string, usage_view[]>(); // key city|sub|site_id
  const outages = new Map<string, outage_view[]>();
  const profiles = new Map<string, resident_profile>(); // key city|sub
  const linked_accounts = new Map<string, linked_account[]>(); // key city|sub
  const tenants = new Set<string>();
  const k = (city: string, sub: string) => `${city}|${sub}`;
  const ks = (city: string, sub: string, site_id: string) => `${city}|${sub}|${site_id}`;

  return {
    async read_bills(city, sub, site_id) {
      tenants.add(city);
      if (site_id) return bills.get(ks(city, sub, site_id)) ?? [];
      const prefix = `${city}|${sub}|`;
      const out: bill_view[] = [];
      for (const [key, list] of bills) if (key.startsWith(prefix)) out.push(...list);
      return out;
    },
    async read_usage(city, sub, account_ref) {
      const prefix = `${city}|${sub}|`;
      const list: usage_view[] = [];
      for (const [key, l] of usage) if (key.startsWith(prefix)) list.push(...l);
      return account_ref ? list.filter((u) => u.account_ref === account_ref) : list;
    },
    async read_outages(city, sub) {
      return outages.get(k(city, sub)) ?? [];
    },
    async store_bill_push(city, sub, push) {
      tenants.add(city);
      bills.set(ks(city, sub, push.site_id), push.bills);
      usage.set(ks(city, sub, push.site_id), push.usage);
    },
    async delete_bills(city, sub, site_id) {
      bills.delete(ks(city, sub, site_id));
    },
    async delete_usage(city, sub, site_id) {
      usage.delete(ks(city, sub, site_id));
    },
    async store_outages(city, sub, list) {
      const existing = outages.get(k(city, sub)) ?? [];
      const incoming = new Set(list.map((o) => o.outage_id));
      outages.set(k(city, sub), [
        ...existing.filter((o) => !incoming.has(o.outage_id)),
        ...list,
      ]);
    },
    async prune_outages(city, sub, before) {
      const list = outages.get(k(city, sub)) ?? [];
      outages.set(k(city, sub), list.filter((o) => o.reported_at >= before));
    },
    async list_resident_addresses(city): Promise<resident_address[]> {
      const out: resident_address[] = [];
      for (const [key, profile] of profiles) {
        const [c, sub] = key.split("|");
        if (c === city && sub && profile.street !== "") {
          out.push({ sub, address: profile.street });
        }
      }
      return out;
    },
    async list_residents_with_bills(city) {
      const subs = new Set<string>();
      for (const key of bills.keys()) {
        const [c, sub] = key.split("|");
        if (c === city && sub) subs.add(sub);
      }
      return [...subs];
    },
    async list_tenants() {
      return [...tenants];
    },
    async save_profile(city, sub, profile) {
      tenants.add(city);
      profiles.set(k(city, sub), profile);
    },
    async get_profile(city, sub) {
      return profiles.get(k(city, sub)) ?? null;
    },
    async save_linked_account(city, sub, account) {
      const key = k(city, sub);
      const list = linked_accounts.get(key) ?? [];
      const next = list.filter((a) => a.site_id !== account.site_id);
      next.push(account);
      linked_accounts.set(key, next);
    },
    async list_linked_accounts(city, sub) {
      return linked_accounts.get(k(city, sub)) ?? [];
    },
    async delete_linked_account(city, sub, site_id) {
      const key = k(city, sub);
      const list = linked_accounts.get(key) ?? [];
      linked_accounts.set(key, list.filter((a) => a.site_id !== site_id));
    },
  };
}

export function create_memory_reminders_store(): reminders_store {
  const reminders = new Map<string, reminder_entry[]>(); // key city|sub
  const tenants = new Set<string>();
  const k = (city: string, sub: string) => `${city}|${sub}`;

  return {
    async create_reminder(city, sub, entry: reminder_entry) {
      tenants.add(city);
      const key = k(city, sub);
      const list = reminders.get(key) ?? [];
      const next = list.filter((r) => r.reminder_id !== entry.reminder_id);
      next.push(entry);
      reminders.set(key, next);
    },
    async list_reminders(city, sub): Promise<reminder_entry[]> {
      return [...(reminders.get(k(city, sub)) ?? [])].sort(
        (a, b) =>
          new Date(a.scheduled_at).getTime() - new Date(b.scheduled_at).getTime(),
      );
    },
    async set_status(city, sub, reminder_id, status, delivered_at) {
      const key = k(city, sub);
      const list = reminders.get(key) ?? [];
      reminders.set(
        key,
        list.map((r) =>
          r.reminder_id === reminder_id ? { ...r, status, delivered_at } : r,
        ),
      );
    },
    async delete_reminder(city, sub, reminder_id) {
      const key = k(city, sub);
      const list = reminders.get(key) ?? [];
      reminders.set(
        key,
        list.filter((r) => r.reminder_id !== reminder_id),
      );
    },
    async list_due(city, before_iso): Promise<reminder_due[]> {
      // Compare as instants, not strings: scheduled_at may carry a UTC offset
      // while before_iso is a Z timestamp, so a lexical compare is wrong.
      const cutoff = new Date(before_iso).getTime();
      const out: reminder_due[] = [];
      for (const [key, list] of reminders) {
        const [c, sub] = key.split("|");
        if (c !== city || !sub) continue;
        for (const entry of list) {
          if (
            entry.status === "upcoming" &&
            new Date(entry.scheduled_at).getTime() <= cutoff
          ) {
            out.push({ sub, entry });
          }
        }
      }
      return out;
    },
    async list_tenants() {
      return [...tenants];
    },
  };
}

export function create_memory_notifications_store(): notifications_store {
  const registrations = new Map<string, notification_registration_record>(); // key city|sub
  const k = (city: string, sub: string) => `${city}|${sub}`;
  return {
    async upsert_registration(city, record) {
      registrations.set(k(city, record.sub), record);
    },
    async get_registration(city, sub) {
      return registrations.get(k(city, sub)) ?? null;
    },
    async list_registrations(city) {
      const out: notification_registration_record[] = [];
      for (const [key, record] of registrations) {
        if (key.startsWith(`${city}|`)) out.push(record);
      }
      return out;
    },
  };
}

export function create_memory_pending_notifications_store(): pending_notifications_store {
  const pending = new Map<string, pending_delivery[]>(); // key city|sub
  const k = (city: string, sub: string) => `${city}|${sub}`;
  return {
    async enqueue(city, sub, delivery) {
      const key = k(city, sub);
      const list = pending.get(key) ?? [];
      list.push(delivery);
      pending.set(key, list);
    },
    async drain(city, sub) {
      const key = k(city, sub);
      const list = pending.get(key) ?? [];
      pending.set(key, []);
      return list;
    },
  };
}
