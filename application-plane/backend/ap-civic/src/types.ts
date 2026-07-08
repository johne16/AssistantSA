// ap-civic module types. Owns ALL type definitions for this module:
// stored civic-data shapes, public-source fetch request/response shapes,
// and the injected port interfaces.

// Mirror of the m-res-auth tenant_context_token. Source of truth lives in
// m-res-auth; duplicated here verbatim, zero deviation.
export interface tenant_context_token {
  sub: string;
  city_tenant_id: string;
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// Enums / discriminators (snake_case values, matching the spec contract).
// ---------------------------------------------------------------------------

export type civic_resource =
  | "alerts"
  | "events"
  | "collection_schedule"
  | "find_my_rep"
  | "my_area";

export type notify_request_type = "emergency_alert";

export type my_area_kind = "school" | "neighborhood";

export type fetch_source = "collection_schedule" | "city_alerts" | "city_events";

// Server-assigned severity tier for an alert, driving the client's Feed tiering.
// critical: life-safety; important: act-soon; routine: informational.
export type alert_tier = "critical" | "important" | "routine";

// ---------------------------------------------------------------------------
// Stored civic-data shapes.
// ---------------------------------------------------------------------------

// An active city/weather alert.
export interface alert_entry {
  entry_id: string; // stable id used for dedupe
  title: string;
  body: string;
  source: string; // e.g. "ahas" | "nws"
  tier: alert_tier; // severity tier mapped at fetch time
  effective_at: string; // ISO 8601
  expires_at: string | null; // ISO 8601 or null
  fetched_at: string; // ISO 8601, time first stored
}

// A city event.
export interface event_entry {
  entry_id: string;
  title: string;
  description: string;
  location: string;
  starts_at: string; // ISO 8601, canonical instant used for sorting
  when_display: string; // human-readable date from the source listing
  ends_at: string | null;
  url: string | null;
  fetched_at: string;
}

// A waste-collection schedule for an address.
export interface collection_schedule_entry {
  entry_id: string;
  address: string;
  collection_day: string; // weekday for weekly services, "" for brush/bulky
  service_type: string; // "garbage" | "recycling" | "organics" | "brush" | "bulky"
  next_collection_date: string; // "Week of MM/DD/YYYY" for brush/bulky, "" for weekly
  holiday_bump: boolean; // shifted by a holiday rule
  fetched_at: string;
}

// A resolved find-my-rep record, stored on first resolution, updated in place.
// A council office staff member listed on the district staff directory.
export interface council_staff_member {
  name: string;
  title: string;
  phone: string; // "" when not listed
  email: string; // contact-form URL the page links to, "" when not listed
}

export interface find_my_rep_entry {
  address: string;
  council_district: string; // district number resolved from the address
  representative_name: string; // council member for that district
  staff: council_staff_member[];
  boundary_layer: string; // GIS layer the result was resolved against
  resolved_at: string; // ISO 8601, last (re-)resolution time
}

// One resolved attribute shown on a my-area card: a display label and its value.
export interface my_area_detail {
  label: string;
  value: string;
}

// A resolved my-area record (school district or neighborhood association).
// Resolved, stored, and refreshed like find_my_rep. details holds every
// resident-facing attribute pulled from the source layer, in display order.
export interface my_area_entry {
  address: string;
  kind: my_area_kind;
  name: string;
  details: my_area_detail[];
  boundary_layer: string;
  resolved_at: string;
}

// ---------------------------------------------------------------------------
// Read request / response shapes (gateway + assistant paths).
// ---------------------------------------------------------------------------

export interface civic_read_params {
  kind?: my_area_kind; // required for my_area
}

export interface civic_read_request {
  resource: civic_resource;
  params: civic_read_params;
  claims: tenant_context_token;
}

// Per-resident alert dismissal. Alerts are shared per city_tenant_id, so a
// dismissal hides one alert for one resident; it never deletes the shared row.
// "restore" undoes a dismissal (the Feed's undo toast).
export type alert_dismiss_action = "dismiss" | "restore";

export interface civic_dismiss_request {
  action: alert_dismiss_action;
  entry_id: string;
  claims: tenant_context_token;
}

// agentRequest payload from ap-assistant. operation maps to a civic_resource.
export interface agent_request {
  tenant_context_token: string; // signed JWT, verified before trust
  operation: civic_resource;
  params: civic_read_params;
}

export interface civic_read_response {
  resource: civic_resource;
  data:
    | alert_entry[]
    | event_entry[]
    | collection_schedule_entry[]
    | find_my_rep_entry
    | my_area_entry
    | null;
}

// ---------------------------------------------------------------------------
// Public-source fetch request / response shapes.
// ---------------------------------------------------------------------------

// GIS point-in-polygon query against a FeatureServer / REST endpoint.
export interface gis_query_request {
  url: string;
  address: string;
  layer?: string;
}

export interface gis_query_response {
  layer: string;
  attributes: Record<string, unknown>;
}

// Page fetch via the page_fetcher port (ap-server backs it with crawl4ai).
export interface page_fetch_request {
  url: string;
}

export interface page_fetch_response {
  url: string;
  markdown: string;
  fetched_at: string;
}

// HTTP GET response from the gis_reader port (GIS / NWS structured reads).
export interface http_get_response {
  url: string;
  status: number;
  body: string;
}

// ---------------------------------------------------------------------------
// Notification request shape sent to ap-notifications via the notifier port.
// ---------------------------------------------------------------------------

export interface notify_request {
  city_tenant_id: string;
  type: notify_request_type;
  notification: {
    title: string;
    body: string;
    entry_id: string;
  };
}

// ---------------------------------------------------------------------------
// Config keys (names match the spec contract verbatim).
// ---------------------------------------------------------------------------

export interface civic_config {
  token_verification_public_key: string;
  find_my_rep_gis_url: string;
  my_area_neighborhood_url: string;
  my_area_school_url: string;
  council_staff_source_url: string;
  collection_schedule_source_url: string;
  city_alerts_source_url: string;
  nws_alerts_api_url: string;
  city_events_source_url: string;
  alerts_retention_days: number; // default 30
  events_retention_days: number; // default 30
}

// ---------------------------------------------------------------------------
// Injected port interfaces. ap-server provides concrete adapters.
// ---------------------------------------------------------------------------

// Per-city siloed Postgres store. All reads/writes are scoped by city_tenant_id.
export interface civic_store {
  list_alerts(city_tenant_id: string): Promise<alert_entry[]>;
  list_events(city_tenant_id: string): Promise<event_entry[]>;
  get_collection_schedule(
    city_tenant_id: string,
    address: string,
  ): Promise<collection_schedule_entry[]>;

  // Distinct addresses ever resolved for this city, used to pre-warm
  // address-derived schedules ahead of a request.
  list_resolved_addresses(city_tenant_id: string): Promise<string[]>;

  get_find_my_rep(
    city_tenant_id: string,
    address: string,
  ): Promise<find_my_rep_entry | null>;
  get_my_area(
    city_tenant_id: string,
    address: string,
    kind: my_area_kind,
  ): Promise<my_area_entry | null>;

  // Existing dedupe keys for a source, so only new entries are written.
  existing_entry_ids(
    city_tenant_id: string,
    source: fetch_source,
  ): Promise<string[]>;

  insert_alerts(city_tenant_id: string, entries: alert_entry[]): Promise<void>;
  insert_events(city_tenant_id: string, entries: event_entry[]): Promise<void>;

  // Per-resident alert dismissals (sub-scoped within the city silo). Used to
  // hide shared alerts for one resident without touching the shared rows.
  list_alert_dismissals(city_tenant_id: string, sub: string): Promise<string[]>;
  insert_alert_dismissal(
    city_tenant_id: string,
    sub: string,
    entry_id: string,
    dismissed_at: string,
  ): Promise<void>;
  delete_alert_dismissal(
    city_tenant_id: string,
    sub: string,
    entry_id: string,
  ): Promise<void>;

  // Upsert (update in place) for resolved address-derived records.
  upsert_collection_schedule(
    city_tenant_id: string,
    address: string,
    entries: collection_schedule_entry[],
  ): Promise<void>;
  upsert_find_my_rep(
    city_tenant_id: string,
    entry: find_my_rep_entry,
  ): Promise<void>;
  upsert_my_area(city_tenant_id: string, entry: my_area_entry): Promise<void>;

  // Prune entries older than the cutoff for a source. Returns pruned count.
  prune_older_than(
    city_tenant_id: string,
    source: fetch_source,
    cutoff_iso: string,
  ): Promise<number>;
}

// Page fetch + HTML-to-markdown extraction (ap-server backs with crawl4ai).
export interface page_fetcher {
  fetch_markdown(request: page_fetch_request): Promise<page_fetch_response>;
}

// Structured HTTP GET reads for GIS application APIs and the NWS alerts API.
export interface gis_reader {
  get(url: string): Promise<http_get_response>;
  // application/x-www-form-urlencoded POST, used for ASP.NET postback pagination.
  post(url: string, form: Record<string, string>): Promise<http_get_response>;
  query_point_in_polygon(
    request: gis_query_request,
  ): Promise<gis_query_response>;
}

// Notification request port backed by ap-notifications.
export interface notifier {
  notify(request: notify_request): Promise<void>;
}

// RS256 verification of the tenant_context_token against the configured public
// key. ap-server backs this with a jose adapter.
export interface token_verifier {
  verify(token: string): Promise<tenant_context_token>;
}

// Injected clock, so retention/refresh math is testable and deterministic.
export interface clock {
  now(): Date;
}

// Read-only window onto data this module does not own, served by the host's
// data-access layer (the API layer between modules and the DB). Civic owns no
// resident profile, so it reads saved service addresses through here; write
// access stays with the owning module (ap-utility).
export interface resident_address_ref {
  sub: string;
  address: string;
}
export interface data_reader {
  // Every resident's saved service address in the city, for pre-warming
  // address-derived civic records.
  list_resident_addresses(city_tenant_id: string): Promise<resident_address_ref[]>;
  // One resident's saved service address, or null if none is saved.
  get_resident_address(city_tenant_id: string, sub: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Dependency bundle injected into the service and handler factories.
// ---------------------------------------------------------------------------

export interface civic_deps {
  config: civic_config;
  store: civic_store;
  data_reader: data_reader;
  page_fetcher: page_fetcher;
  gis_reader: gis_reader;
  notifier: notifier;
  token_verifier: token_verifier;
  clock: clock;
}

// Service surface consumed by the handler.
export interface civic_service {
  read(request: civic_read_request): Promise<civic_read_response>;
  dismiss(request: civic_dismiss_request): Promise<void>;
  // App-open refresh of all address-derived records for the resident's address.
  refresh_address_data(claims: tenant_context_token): Promise<void>;
  run_scheduled_fetch(source: fetch_source): Promise<void>;
}

// Handler surface wired by ap-server.
export interface civic_handler {
  civic_read(
    resource: civic_resource,
    params: civic_read_params,
    claims: tenant_context_token,
  ): Promise<civic_read_response>;
  agent_request(request: agent_request): Promise<civic_read_response>;
  civic_dismiss(
    action: alert_dismiss_action,
    entry_id: string,
    claims: tenant_context_token,
  ): Promise<void>;
  civic_refresh(claims: tenant_context_token): Promise<void>;
  run_scheduled_fetch(source: fetch_source): Promise<void>;
}
