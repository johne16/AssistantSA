// ap-utility module types. Owns all types for this module.

// tenant_context_token mirror block. Owning module: m-res-auth.
export interface tenant_context_token {
  sub: string;
  city_tenant_id: string;
  iat: number;
  exp: number;
}

// Utility resource selector.
export type utility_resource = "bills" | "usage" | "outage";

// Notification request type.
export type notify_request_type = "bill_due" | "power_outage";

// Stored bill record served in bills views.
export interface bill_view {
  account_ref: string;
  due_date: string; // ISO date
  statement_id: string;
}

// Stored usage record served in usage views.
export interface usage_view {
  account_ref: string;
  period_start: string; // ISO date
  period_end: string; // ISO date
  amount: number;
  unit: string;
}

// Stored power outage record served in outage views.
export interface outage_view {
  address: string;
  status: string;
  reported_at: string; // ISO timestamp
  outage_id: string;
}

// Client push payload: bills + usage scraped on device.
export interface bill_push {
  bills: bill_view[];
  usage: usage_view[];
}

// Per-site scrape script registry entry.
export interface scrape_script_entry {
  url: string;
  script: string;
}

// site_id -> entry mapping. Loaded in memory; script holds the script code.
export type scrape_script_registry = Record<string, scrape_script_entry>;

// On-disk manifest entry in the module's scrape_scripts/registry.json.
// script_file names a file in the scrape_scripts folder whose contents become
// scrape_script_entry.script once loaded.
export interface scrape_script_manifest_entry {
  url: string;
  script_file: string;
}

// site_id -> manifest entry mapping, as stored in registry.json.
export type scrape_script_manifest = Record<string, scrape_script_manifest_entry>;

// Notification request handed to the notifier port.
export interface notify_request {
  type: notify_request_type;
  notification: Record<string, unknown>;
}

// agentRequest invocation payload.
export interface agent_request {
  tenant_context_token: string;
  operation: utility_resource;
  params: { account_ref?: string };
}

// utilityRead params.
export interface utility_read_params {
  account_ref?: string;
}

// Raw outage entry returned by utility_systems source.
export interface outage_source_entry {
  address: string;
  status: string;
  reported_at: string;
  outage_id: string;
}

// Resolved tenant claims passed by ap-server after gateway validation.
export interface tenant_claims {
  sub: string;
  city_tenant_id: string;
}

// Resident address record used to drive outage fetches.
export interface resident_address {
  sub: string;
  address: string;
}

// Resident profile: service address, contact, and language. One row per sub.
export interface resident_profile {
  street: string;
  zip: string;
  name: string;
  email: string;
  phone: string;
  lang: string;
}

// Linked utility account record. Non-secret; credentials stay on device.
export interface linked_account {
  site_id: string;
  provider: string;
  sign_in_url: string;
}

// Module config.
export interface utility_config {
  token_verification_public_key: string;
  utility_retention_days: number;
  power_outage_source_url: string;
  bill_due_reminder_days: number;
  scrape_script_registry: scrape_script_registry;
}

// --- Ports (injected by ap-server) ---

// Persistence port. Scoped per city_tenant_id by the adapter.
export interface utility_store {
  read_bills(city_tenant_id: string, sub: string, account_ref?: string): Promise<bill_view[]>;
  read_usage(city_tenant_id: string, sub: string, account_ref?: string): Promise<usage_view[]>;
  read_outages(city_tenant_id: string, sub: string): Promise<outage_view[]>;
  store_bill_push(city_tenant_id: string, sub: string, push: bill_push): Promise<void>;
  store_outages(city_tenant_id: string, sub: string, outages: outage_view[]): Promise<void>;
  prune_outages(city_tenant_id: string, sub: string, before: string): Promise<void>;
  list_resident_addresses(city_tenant_id: string): Promise<resident_address[]>;
  list_residents_with_bills(city_tenant_id: string): Promise<string[]>;
  list_tenants(): Promise<string[]>;
  save_profile(city_tenant_id: string, sub: string, profile: resident_profile): Promise<void>;
  get_profile(city_tenant_id: string, sub: string): Promise<resident_profile | null>;
  save_linked_account(city_tenant_id: string, sub: string, account: linked_account): Promise<void>;
  list_linked_accounts(city_tenant_id: string, sub: string): Promise<linked_account[]>;
  delete_linked_account(city_tenant_id: string, sub: string, site_id: string): Promise<void>;
}

// Reads outage status from external utility provider sources.
export interface utility_systems_reader {
  fetch_outages(source_url: string, address: string): Promise<outage_source_entry[]>;
}

// Requests delivery from ap-notifications.
export interface notifier {
  notify(token: tenant_context_token, request: notify_request): Promise<void>;
}

// Verifies the tenant_context_token RS256 signature.
export interface token_verifier {
  verify(token: string): Promise<tenant_context_token>;
}

// Time source.
export interface clock {
  now(): Date;
}

// Service dependencies.
export interface utility_service_deps {
  store: utility_store;
  utility_systems: utility_systems_reader;
  notifier: notifier;
  clock: clock;
  config: utility_config;
}

// Handler dependencies.
export interface utility_handler_deps extends utility_service_deps {
  token_verifier: token_verifier;
}
