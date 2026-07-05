// m-res-accounts module types. Owns all types for this module, including the
// ap-utility view mirrors and the tenant_context_token mirror block.

// tenant_context_token mirror block. Owning module: m-res-auth. Decoded claim
// set; on the wire the token travels as the encoded JWT string.
export interface tenant_context_token {
  sub: string;
  city_tenant_id: string;
  iat: number;
  exp: number;
}

// --- ap-utility view mirrors ---

// Utility resource selector.
export type utility_resource = "bills" | "usage" | "outage";

// Stored bill record served in bills views. site_id is stamped by ap-utility at
// store (absent on the outbound scrape push).
export interface bill_view {
  due_date: string; // ISO date
  total: number; // amount due
  site_id?: string; // linked site the bill belongs to
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

// Per-site scrape script registry entry, served by ap-utility.
export interface scrape_script_entry {
  url: string;
  script: string;
}

// --- Credential capture ---

// Credentials the resident submits on the link-account screen. Written to the
// device keystore keyed by site_id; never leave the device.
export interface credential_entry {
  site_id: string;
  username: string;
  password: string;
}

// Stored credential record (keystore value, keyed by site_id).
export interface stored_credentials {
  username: string;
  password: string;
}

// --- Profile + linked-account persistence ---

// Resident profile mirror (owner: ap-utility). Saved to / loaded from backend.
export interface resident_profile {
  street: string;
  zip: string;
  name: string;
  email: string;
  phone: string;
  lang: string;
}

// Linked utility account record (non-secret). Credentials stay in the keystore.
export interface linked_account {
  site_id: string;
  provider: string;
}

// A supported provider, served by ap-utility (mirror). Drives the add-account
// dropdown; site_id matches a backend scrape script file.
export interface provider_catalog_entry {
  site_id: string;
  provider: string;
  service_kind: string;
}

// profile save request body.
export interface profile_save_request {
  tenant_context_token: string;
  profile: resident_profile;
}

// linked-account link request body.
export interface account_link_request {
  tenant_context_token: string;
  account: linked_account;
}

// linked-account unlink request body.
export interface account_unlink_request {
  tenant_context_token: string;
  site_id: string;
}

// --- Gateway request payloads ---

// siteScript request: fetch per-site scrape script from ap-utility.
export interface site_script_request {
  tenant_context_token: string;
  site_id: string;
}

// billPush request: scraped bills + usage for one linked site pushed to ap-utility.
export interface bill_push_request {
  tenant_context_token: string;
  site_id: string;
  bills: bill_view[];
  usage: usage_view[];
}

// utilityApiRequest: read stored utility data from ap-utility.
export interface utility_api_request {
  tenant_context_token: string;
  operation: utility_resource;
  params: { account_ref?: string };
}

// --- Portal-facing request/response shapes ---

// utilityViewRequest forwarded by the portal.
export interface utility_view_request {
  resource: utility_resource;
  params: { account_ref?: string };
}

// utilityData returned to the portal. One field is populated per resource.
export interface utility_data {
  resource: utility_resource;
  bills?: bill_view[];
  usage?: usage_view[];
  outage?: outage_view[];
}

// Per-account sync status reported to the portal.
export type sync_status = "queued" | "syncing" | "done" | "error";

// syncResult emitted per account so the portal can bind its spinner to actual
// in-progress state until a result lands.
export interface sync_result {
  site_id: string;
  sync_status: sync_status;
  data?: { bills: bill_view[]; usage: usage_view[] };
  error?: string;
}

// --- Internal scrape-runner messaging ---

// Result posted back from the injected script via postMessage. A message with
// log set is a progress line for the console, not a result.
export interface scrape_message {
  ok: boolean;
  bills?: bill_view[];
  usage?: usage_view[];
  error?: string;
  log?: string;
}

// A scrape job handed to the off-screen WebView host.
export interface scrape_job {
  site_id: string;
  url: string;
  script: string;
  credentials: stored_credentials;
}

// --- React Query keys ---

export const accounts_query_keys = {
  profile: ["accounts", "profile"] as const,
  linked: ["accounts", "linked"] as const,
  catalog: ["accounts", "catalog"] as const,
};
