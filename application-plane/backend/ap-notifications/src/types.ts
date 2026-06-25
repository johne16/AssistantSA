// ap-notifications owns all of its type definitions here.

// tenant_context_token: mirrors the canonical shape owned by m-res-auth
// (m-res-auth/types.ts) exactly, with zero deviation. Duplicated per the
// one-owner / mirror-everywhere convention; not imported across module
// boundaries.
export interface tenant_context_token {
  sub: string;
  city_tenant_id: string;
  iat: number;
  exp: number;
}

// The per-type opt-in toggles sent with each registration and used to gate
// delivery. Mirrors the toggle set surfaced by the resident preferences screen.
export interface notification_preferences {
  utility_alert_enabled: boolean;
  city_alert_enabled: boolean;
  bills_reminder_enabled: boolean;
  event_reminder_enabled: boolean;
}

// The four notification types a source module may request.
export type notification_type =
  | "power_outage"
  | "emergency_alert"
  | "bill_due"
  | "event_reminder";

// Notification content a source module has already composed. ap-notifications
// does not generate or evaluate content; it queues this for the client to poll.
export interface notification {
  title: string;
  body: string;
  data?: Record<string, unknown>; // deep-link payload routed by the client on tap
}

// A queued notification awaiting the resident's next poll. Carries the type so
// the client can deep-link on tap.
export interface pending_delivery {
  type: notification_type;
  notification: notification;
}

// Stored registration record, one per resident, in the per-city namespace.
// Holds only the opt-in preferences; delivery routes by resident (sub), not a
// device push token.
export interface notification_registration_record {
  sub: string; // resident id (from the token)
  notification_preferences: notification_preferences;
}

// reminderRegistration input: client registers or refreshes the opt-ins.
// tenant_context_token is the encoded JWT string.
export interface registration_request {
  tenant_context_token: string;
  notification_preferences: notification_preferences;
}

// notifyRequest input from a source module (ap-utility, ap-civic).
export interface notify_request {
  tenant_context_token: string;
  type: notification_type;
  notification: notification;
}

// poll input: client drains its pending notifications. Token validated at the
// gateway edge; claims decoded here for sub + city_tenant_id.
export interface poll_request {
  tenant_context_token: string;
}

// --- injected ports ---

// Verifies the RS256 signature of an encoded token on the source-module
// invocation path and returns the decoded claims.
export interface token_verifier {
  verify(encoded_token: string): Promise<tenant_context_token>;
}

// Decodes claims from an already-validated token without re-checking the
// signature. Used on the gateway registration path, where the gateway edge
// has already validated the token.
export interface claims_decoder {
  decode(encoded_token: string): tenant_context_token;
}

// Per-city siloed store for registration opt-ins, resolved by city_tenant_id to
// the Postgres schema namespace.
export interface notifications_store {
  upsert_registration(
    city_tenant_id: string,
    record: notification_registration_record,
  ): Promise<void>;
  get_registration(
    city_tenant_id: string,
    sub: string,
  ): Promise<notification_registration_record | null>;
  // Every registration in the city, for server-side fan-out (scheduled city-wide
  // notifications that target no single resident).
  list_registrations(
    city_tenant_id: string,
  ): Promise<notification_registration_record[]>;
}

// Per-resident pending-notification queue. Notifications are queued on notify and
// drained on the resident's next poll. TTL/expiry is internal to the adapter.
export interface pending_notifications_store {
  enqueue(
    city_tenant_id: string,
    sub: string,
    delivery: pending_delivery,
  ): Promise<void>;
  drain(city_tenant_id: string, sub: string): Promise<pending_delivery[]>;
}

export interface notifications_config {
  token_verification_public_key: string;
}
