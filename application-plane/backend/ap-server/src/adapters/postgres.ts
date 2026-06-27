// Postgres store adapters over a single pg Pool. Per-city siloing is
// schema-per-namespace: city_tenant_id maps to a Postgres schema. Tables are
// created on first use (create-if-not-exists) so the PoC needs no migration
// step. SQL is kept minimal; everything stays behind the module store ports.
//
// Persistence approach: pg Pool, schema-qualified DDL/DML. If database_url is
// empty (no DB reachable in the PoC), create_pool returns null and the caller
// falls back to the in-memory stores in memory.ts. This adapter assumes a live
// pool; the fallback decision is made in index.ts.

import { Pool } from "pg";

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
  bill_push,
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
  reminder_status,
  reminders_store,
} from "ap-reminders";
import type {
  notification_preferences,
  notification_registration_record,
  notification_type,
  notifications_store,
  pending_delivery,
  pending_notifications_store,
} from "ap-notifications";

// Create the shared pool. Returns null when no database_url is configured.
export function create_pool(database_url: string): Pool | null {
  if (!database_url) return null;
  return new Pool({ connectionString: database_url });
}

// city_tenant_id -> schema name. Sanitized to a safe identifier.
function schema_for(city_tenant_id: string): string {
  const safe = city_tenant_id.toLowerCase().replace(/[^a-z0-9_]/g, "_");
  return `tenant_${safe || "default"}`;
}

// Per-schema table bootstrap, run lazily once per (pool, schema).
const bootstrapped = new Set<string>();

async function ensure_schema(pool: Pool, schema: string): Promise<void> {
  if (bootstrapped.has(schema)) return;
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
  // civic tables
  await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.civic_entry (
    source text NOT NULL,
    entry_id text NOT NULL,
    payload jsonb NOT NULL,
    address text,
    fetched_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (source, entry_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.civic_resolved (
    kind text NOT NULL,
    address text NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (kind, address)
  )`);
  // utility tables
  await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.utility_bill (
    sub text NOT NULL,
    statement_id text NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (sub, statement_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.utility_usage (
    sub text NOT NULL,
    account_ref text NOT NULL,
    period_start text NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (sub, account_ref, period_start)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.utility_outage (
    sub text NOT NULL,
    outage_id text NOT NULL,
    reported_at timestamptz NOT NULL,
    payload jsonb NOT NULL,
    PRIMARY KEY (sub, outage_id)
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.resident_profile (
    sub text PRIMARY KEY,
    street text NOT NULL DEFAULT '',
    zip text NOT NULL DEFAULT '',
    name text NOT NULL DEFAULT '',
    email text NOT NULL DEFAULT '',
    phone text NOT NULL DEFAULT '',
    lang text NOT NULL DEFAULT ''
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.linked_account (
    sub text NOT NULL,
    site_id text NOT NULL,
    provider text NOT NULL,
    sign_in_url text NOT NULL,
    PRIMARY KEY (sub, site_id)
  )`);
  // reminders table
  await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.reminders_reminder (
    sub text NOT NULL,
    reminder_id text NOT NULL,
    scheduled_at timestamptz NOT NULL,
    title text NOT NULL,
    body text NOT NULL,
    status text NOT NULL,
    delivered_at timestamptz,
    PRIMARY KEY (sub, reminder_id)
  )`);
  // notifications tables
  await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.notifications_registration (
    sub text PRIMARY KEY,
    notification_preferences jsonb NOT NULL
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS ${schema}.notifications_pending (
    id bigserial PRIMARY KEY,
    sub text NOT NULL,
    type text NOT NULL,
    notification jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  bootstrapped.add(schema);
}

async function scoped(pool: Pool, city_tenant_id: string): Promise<string> {
  const schema = schema_for(city_tenant_id);
  await ensure_schema(pool, schema);
  return schema;
}

// --- civic store ---

export function create_civic_store(pool: Pool): civic_store {
  return {
    async list_alerts(city_tenant_id) {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(
        `SELECT payload FROM ${s}.civic_entry WHERE source = 'city_alerts'`,
      );
      return r.rows.map((row) => row.payload as alert_entry);
    },
    async list_events(city_tenant_id) {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(
        `SELECT payload FROM ${s}.civic_entry WHERE source = 'city_events'`,
      );
      return r.rows.map((row) => row.payload as event_entry);
    },
    async get_collection_schedule(city_tenant_id, address) {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(
        `SELECT payload FROM ${s}.civic_resolved WHERE kind = 'collection_schedule' AND address = $1`,
        [address],
      );
      return r.rows[0]
        ? (r.rows[0].payload as collection_schedule_entry[])
        : [];
    },
    async list_resolved_addresses(city_tenant_id) {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(
        `SELECT DISTINCT address FROM ${s}.civic_resolved`,
      );
      return r.rows.map((row) => row.address as string);
    },
    async get_find_my_rep(city_tenant_id, address) {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(
        `SELECT payload FROM ${s}.civic_resolved WHERE kind = 'find_my_rep' AND address = $1`,
        [address],
      );
      return r.rows[0] ? (r.rows[0].payload as find_my_rep_entry) : null;
    },
    async get_my_area(city_tenant_id, address, kind: my_area_kind) {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(
        `SELECT payload FROM ${s}.civic_resolved WHERE kind = $1 AND address = $2`,
        [`my_area_${kind}`, address],
      );
      return r.rows[0] ? (r.rows[0].payload as my_area_entry) : null;
    },
    async existing_entry_ids(city_tenant_id, source: fetch_source) {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(
        `SELECT entry_id FROM ${s}.civic_entry WHERE source = $1`,
        [source],
      );
      return r.rows.map((row) => row.entry_id as string);
    },
    async insert_alerts(city_tenant_id, entries) {
      await insert_civic(pool, city_tenant_id, "city_alerts", entries, null);
    },
    async insert_events(city_tenant_id, entries) {
      await insert_civic(pool, city_tenant_id, "city_events", entries, null);
    },
    async upsert_collection_schedule(city_tenant_id, address, entries) {
      const s = await scoped(pool, city_tenant_id);
      await pool.query(
        `INSERT INTO ${s}.civic_resolved (kind, address, payload)
         VALUES ('collection_schedule', $1, $2)
         ON CONFLICT (kind, address) DO UPDATE SET payload = EXCLUDED.payload`,
        [address, JSON.stringify(entries)],
      );
    },
    async upsert_find_my_rep(city_tenant_id, entry) {
      const s = await scoped(pool, city_tenant_id);
      await pool.query(
        `INSERT INTO ${s}.civic_resolved (kind, address, payload)
         VALUES ('find_my_rep', $1, $2)
         ON CONFLICT (kind, address) DO UPDATE SET payload = EXCLUDED.payload`,
        [entry.address, entry],
      );
    },
    async upsert_my_area(city_tenant_id, entry) {
      const s = await scoped(pool, city_tenant_id);
      await pool.query(
        `INSERT INTO ${s}.civic_resolved (kind, address, payload)
         VALUES ($1, $2, $3)
         ON CONFLICT (kind, address) DO UPDATE SET payload = EXCLUDED.payload`,
        [`my_area_${entry.kind}`, entry.address, entry],
      );
    },
    async prune_older_than(city_tenant_id, source: fetch_source, cutoff_iso) {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(
        `DELETE FROM ${s}.civic_entry WHERE source = $1 AND fetched_at < $2`,
        [source, cutoff_iso],
      );
      return r.rowCount ?? 0;
    },
  };
}

async function insert_civic(
  pool: Pool,
  city_tenant_id: string,
  source: string,
  entries: Array<alert_entry | event_entry>,
  address: string | null,
): Promise<void> {
  const s = await scoped(pool, city_tenant_id);
  for (const e of entries) {
    await pool.query(
      `INSERT INTO ${s}.civic_entry (source, entry_id, payload, address, fetched_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (source, entry_id) DO NOTHING`,
      [source, e.entry_id, e, address, e.fetched_at],
    );
  }
}

// --- utility store ---

export function create_utility_store(pool: Pool): utility_store {
  return {
    async read_bills(city_tenant_id, sub, account_ref) {
      const s = await scoped(pool, city_tenant_id);
      const r = account_ref
        ? await pool.query(
            `SELECT payload FROM ${s}.utility_bill WHERE sub = $1 AND payload->>'account_ref' = $2`,
            [sub, account_ref],
          )
        : await pool.query(`SELECT payload FROM ${s}.utility_bill WHERE sub = $1`, [sub]);
      return r.rows.map((row) => row.payload as bill_view);
    },
    async read_usage(city_tenant_id, sub, account_ref) {
      const s = await scoped(pool, city_tenant_id);
      const r = account_ref
        ? await pool.query(
            `SELECT payload FROM ${s}.utility_usage WHERE sub = $1 AND account_ref = $2`,
            [sub, account_ref],
          )
        : await pool.query(`SELECT payload FROM ${s}.utility_usage WHERE sub = $1`, [sub]);
      return r.rows.map((row) => row.payload as usage_view);
    },
    async read_outages(city_tenant_id, sub) {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(`SELECT payload FROM ${s}.utility_outage WHERE sub = $1`, [sub]);
      return r.rows.map((row) => row.payload as outage_view);
    },
    async store_bill_push(city_tenant_id, sub, push: bill_push) {
      const s = await scoped(pool, city_tenant_id);
      for (const b of push.bills) {
        await pool.query(
          `INSERT INTO ${s}.utility_bill (sub, statement_id, payload)
           VALUES ($1, $2, $3)
           ON CONFLICT (sub, statement_id) DO UPDATE SET payload = EXCLUDED.payload`,
          [sub, b.statement_id, b],
        );
      }
      for (const u of push.usage) {
        await pool.query(
          `INSERT INTO ${s}.utility_usage (sub, account_ref, period_start, payload)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (sub, account_ref, period_start) DO UPDATE SET payload = EXCLUDED.payload`,
          [sub, u.account_ref, u.period_start, u],
        );
      }
    },
    async store_outages(city_tenant_id, sub, outages: outage_view[]) {
      const s = await scoped(pool, city_tenant_id);
      for (const o of outages) {
        await pool.query(
          `INSERT INTO ${s}.utility_outage (sub, outage_id, reported_at, payload)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (sub, outage_id) DO NOTHING`,
          [sub, o.outage_id, o.reported_at, o],
        );
      }
    },
    async prune_outages(city_tenant_id, sub, before) {
      const s = await scoped(pool, city_tenant_id);
      await pool.query(
        `DELETE FROM ${s}.utility_outage WHERE sub = $1 AND reported_at < $2`,
        [sub, before],
      );
    },
    async list_resident_addresses(city_tenant_id): Promise<resident_address[]> {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(
        `SELECT sub, street FROM ${s}.resident_profile WHERE street <> ''`,
      );
      return r.rows.map((row) => ({ sub: row.sub as string, address: row.street as string }));
    },
    async list_residents_with_bills(city_tenant_id) {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(`SELECT DISTINCT sub FROM ${s}.utility_bill`);
      return r.rows.map((row) => row.sub as string);
    },
    async list_tenants() {
      // Schemas already bootstrapped this process lifetime. PoC scope: the
      // scheduler tenant is the only one driven server-side.
      return [...bootstrapped].map((s) => s.replace(/^tenant_/, ""));
    },
    async save_profile(city_tenant_id, sub, profile: resident_profile) {
      const s = await scoped(pool, city_tenant_id);
      await pool.query(
        `INSERT INTO ${s}.resident_profile (sub, street, zip, name, email, phone, lang)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (sub) DO UPDATE SET
           street = EXCLUDED.street,
           zip = EXCLUDED.zip,
           name = EXCLUDED.name,
           email = EXCLUDED.email,
           phone = EXCLUDED.phone,
           lang = EXCLUDED.lang`,
        [sub, profile.street, profile.zip, profile.name, profile.email, profile.phone, profile.lang],
      );
    },
    async get_profile(city_tenant_id, sub): Promise<resident_profile | null> {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(
        `SELECT street, zip, name, email, phone, lang FROM ${s}.resident_profile WHERE sub = $1`,
        [sub],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        street: row.street as string,
        zip: row.zip as string,
        name: row.name as string,
        email: row.email as string,
        phone: row.phone as string,
        lang: row.lang as string,
      };
    },
    async save_linked_account(city_tenant_id, sub, account: linked_account) {
      const s = await scoped(pool, city_tenant_id);
      await pool.query(
        `INSERT INTO ${s}.linked_account (sub, site_id, provider, sign_in_url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (sub, site_id) DO UPDATE SET
           provider = EXCLUDED.provider,
           sign_in_url = EXCLUDED.sign_in_url`,
        [sub, account.site_id, account.provider, account.sign_in_url],
      );
    },
    async list_linked_accounts(city_tenant_id, sub): Promise<linked_account[]> {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(
        `SELECT site_id, provider, sign_in_url FROM ${s}.linked_account WHERE sub = $1`,
        [sub],
      );
      return r.rows.map((row) => ({
        site_id: row.site_id as string,
        provider: row.provider as string,
        sign_in_url: row.sign_in_url as string,
      }));
    },
    async delete_linked_account(city_tenant_id, sub, site_id) {
      const s = await scoped(pool, city_tenant_id);
      await pool.query(
        `DELETE FROM ${s}.linked_account WHERE sub = $1 AND site_id = $2`,
        [sub, site_id],
      );
    },
  };
}

// --- reminders store ---

// Map a reminders_reminder row to a reminder_entry. timestamptz columns come back
// as Date; normalize to ISO strings the module contract expects.
function reminder_from_row(row: {
  reminder_id: string;
  scheduled_at: Date;
  title: string;
  body: string;
  status: string;
  delivered_at: Date | null;
}): reminder_entry {
  return {
    reminder_id: row.reminder_id,
    scheduled_at: row.scheduled_at.toISOString(),
    title: row.title,
    body: row.body,
    status: row.status as reminder_status,
    delivered_at: row.delivered_at ? row.delivered_at.toISOString() : null,
  };
}

export function create_reminders_store(pool: Pool): reminders_store {
  return {
    async create_reminder(city_tenant_id, sub, entry: reminder_entry) {
      const s = await scoped(pool, city_tenant_id);
      await pool.query(
        `INSERT INTO ${s}.reminders_reminder
           (sub, reminder_id, scheduled_at, title, body, status, delivered_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (sub, reminder_id) DO UPDATE SET
           scheduled_at = EXCLUDED.scheduled_at,
           title = EXCLUDED.title,
           body = EXCLUDED.body,
           status = EXCLUDED.status,
           delivered_at = EXCLUDED.delivered_at`,
        [
          sub,
          entry.reminder_id,
          entry.scheduled_at,
          entry.title,
          entry.body,
          entry.status,
          entry.delivered_at,
        ],
      );
    },
    async list_reminders(city_tenant_id, sub): Promise<reminder_entry[]> {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(
        `SELECT reminder_id, scheduled_at, title, body, status, delivered_at
         FROM ${s}.reminders_reminder WHERE sub = $1 ORDER BY scheduled_at`,
        [sub],
      );
      return r.rows.map(reminder_from_row);
    },
    async set_status(city_tenant_id, sub, reminder_id, status, delivered_at) {
      const s = await scoped(pool, city_tenant_id);
      await pool.query(
        `UPDATE ${s}.reminders_reminder
         SET status = $3, delivered_at = $4
         WHERE sub = $1 AND reminder_id = $2`,
        [sub, reminder_id, status, delivered_at],
      );
    },
    async list_due(city_tenant_id, before_iso): Promise<reminder_due[]> {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(
        `SELECT sub, reminder_id, scheduled_at, title, body, status, delivered_at
         FROM ${s}.reminders_reminder
         WHERE status = 'upcoming' AND scheduled_at <= $1`,
        [before_iso],
      );
      return r.rows.map((row) => ({
        sub: row.sub as string,
        entry: reminder_from_row(row),
      }));
    },
    async list_tenants() {
      return [...bootstrapped].map((s) => s.replace(/^tenant_/, ""));
    },
  };
}

// --- notifications stores ---

export function create_notifications_store(pool: Pool): notifications_store {
  return {
    async upsert_registration(city_tenant_id, record: notification_registration_record) {
      const s = await scoped(pool, city_tenant_id);
      await pool.query(
        `INSERT INTO ${s}.notifications_registration (sub, notification_preferences)
         VALUES ($1, $2)
         ON CONFLICT (sub) DO UPDATE SET notification_preferences = EXCLUDED.notification_preferences`,
        [record.sub, JSON.stringify(record.notification_preferences)],
      );
    },
    async get_registration(city_tenant_id, sub): Promise<notification_registration_record | null> {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(
        `SELECT sub, notification_preferences FROM ${s}.notifications_registration WHERE sub = $1`,
        [sub],
      );
      const row = r.rows[0];
      if (!row) return null;
      return {
        sub: row.sub as string,
        notification_preferences: row.notification_preferences as notification_preferences,
      };
    },
    async list_registrations(city_tenant_id): Promise<notification_registration_record[]> {
      const s = await scoped(pool, city_tenant_id);
      const r = await pool.query(
        `SELECT sub, notification_preferences FROM ${s}.notifications_registration`,
      );
      return r.rows.map((row) => ({
        sub: row.sub as string,
        notification_preferences: row.notification_preferences as notification_preferences,
      }));
    },
  };
}

export function create_pending_notifications_store(pool: Pool): pending_notifications_store {
  return {
    async enqueue(city_tenant_id, sub, delivery: pending_delivery) {
      const s = await scoped(pool, city_tenant_id);
      await pool.query(
        `INSERT INTO ${s}.notifications_pending (sub, type, notification)
         VALUES ($1, $2, $3)`,
        [sub, delivery.type, JSON.stringify(delivery.notification)],
      );
    },
    async drain(city_tenant_id, sub): Promise<pending_delivery[]> {
      const s = await scoped(pool, city_tenant_id);
      // Delete-and-return so each queued notification is delivered once.
      const r = await pool.query(
        `DELETE FROM ${s}.notifications_pending WHERE sub = $1 RETURNING type, notification`,
        [sub],
      );
      return r.rows.map((row) => ({
        type: row.type as notification_type,
        notification: row.notification as pending_delivery["notification"],
      }));
    },
  };
}
