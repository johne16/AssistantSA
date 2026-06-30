// m-res-civic module types. Owns ALL type definitions for this module:
// the tenant_context_token mirror, the gateway request shape, the view request
// the portal sends, and the civic data shapes mirrored from ap-civic (own
// copies, not cross-plane imports).

// Mirror of the m-res-auth tenant_context_token. Source of truth lives in
// m-res-auth; duplicated here verbatim, zero deviation.
export interface tenant_context_token {
  sub: string;
  city_tenant_id: string;
  iat: number;
  exp: number;
}

// ---------------------------------------------------------------------------
// Enums / discriminators. Mirror of ap-civic.
// ---------------------------------------------------------------------------

export type civic_resource =
  | "alerts"
  | "events"
  | "collection_schedule"
  | "find_my_rep"
  | "my_area";

export type my_area_kind = "school" | "neighborhood";

// Server-assigned severity tier for an alert, mirroring ap-civic. Drives the
// Feed's critical/important/routine tiering.
export type alert_tier = "critical" | "important" | "routine";

// ---------------------------------------------------------------------------
// Civic data shapes. Mirror of ap-civic stored shapes.
// ---------------------------------------------------------------------------

export interface alert_entry {
  entry_id: string;
  title: string;
  body: string;
  source: string;
  tier: alert_tier;
  effective_at: string;
  expires_at: string | null;
  fetched_at: string;
}

export interface event_entry {
  entry_id: string;
  title: string;
  description: string;
  location: string;
  starts_at: string;
  when_display: string;
  ends_at: string | null;
  url: string | null;
  fetched_at: string;
}

export interface collection_schedule_entry {
  entry_id: string;
  address: string;
  collection_day: string;
  service_type: string;
  next_collection_date: string;
  holiday_bump: boolean;
  fetched_at: string;
}

export interface council_staff_member {
  name: string;
  title: string;
  phone: string;
  email: string;
}

export interface find_my_rep_entry {
  address: string;
  council_district: string;
  representative_name: string;
  staff: council_staff_member[];
  boundary_layer: string;
  resolved_at: string;
}

export interface my_area_detail {
  label: string;
  value: string;
}

export interface my_area_entry {
  address: string;
  kind: my_area_kind;
  name: string;
  details: my_area_detail[];
  boundary_layer: string;
  resolved_at: string;
}

// ---------------------------------------------------------------------------
// Gateway request / response shapes. Mirror of ap-civic gateway path.
// ---------------------------------------------------------------------------

export interface civic_read_params {
  kind?: my_area_kind; // required for my_area
}

// POST body to the API gateway. operation maps to a civic_resource.
export interface civic_api_request {
  tenant_context_token: string; // signed JWT, forwarded never as bare claims
  operation: civic_resource;
  params: civic_read_params;
}

// data is the resource union; stale_refreshed signals a background
// re-resolution returned changed find_my_rep / my_area data.
export type civic_data =
  | alert_entry[]
  | event_entry[]
  | collection_schedule_entry[]
  | find_my_rep_entry
  | my_area_entry
  | null;

export interface civic_read_response {
  resource: civic_resource;
  data: civic_data;
  stale_refreshed?: boolean;
}

// ---------------------------------------------------------------------------
// Portal-facing request. m-res-portal forwards a screen open or user action.
// ---------------------------------------------------------------------------

export interface civic_view_request {
  resource: civic_resource;
  params: civic_read_params;
}

// Callback the portal registers to receive a background-refreshed find_my_rep
// result when ap-civic surfaces changed rep data.
export type civic_rep_update_listener = (response: civic_read_response) => void;

// POST body to the alert dismiss endpoint. Per-resident dismiss/restore of a
// shared alert; identified by the alert's entry_id.
export type alert_dismiss_action = "dismiss" | "restore";

export interface civic_dismiss_api_request {
  tenant_context_token: string;
  action: alert_dismiss_action;
  entry_id: string;
}

// Surface the portal consumes from use_civic().
export interface civic_client {
  civic_view_request(req: civic_view_request): Promise<civic_read_response>;
  on_rep_update(listener: civic_rep_update_listener): () => void;
  // Per-resident alert dismissal, persisted server-side. dismiss_alert hides the
  // alert for this resident; restore_alert undoes it (Feed undo toast).
  dismiss_alert(entry_id: string): Promise<void>;
  restore_alert(entry_id: string): Promise<void>;
}
