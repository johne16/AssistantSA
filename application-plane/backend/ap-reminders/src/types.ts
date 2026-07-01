// ap-reminders module types. Owns all types for this module.

// tenant_context_token mirror block. Owning module: m-res-auth.
export interface tenant_context_token {
  sub: string;
  city_tenant_id: string;
  iat: number;
  exp: number;
}

// Lifecycle of a reminder. Mirrors the client's m-res-reminders/types.ts:
//   upcoming  -> scheduled, not yet due
//   fired     -> scheduled_at has passed; delivered through the notifier
//   dismissed -> resident dismissed it
export type reminder_status = "upcoming" | "fired" | "dismissed";

// Notification request type for the reminders feature.
export type notify_request_type = "reminder";

// A stored reminder record served to the client Feed.
export interface reminder_entry {
  reminder_id: string;
  scheduled_at: string; // ISO timestamp the reminder fires at
  title: string;
  body: string;
  status: reminder_status;
  delivered_at: string | null; // ISO timestamp it fired, or null
}

// set_reminder input fields (assistant or client supplied).
export interface set_reminder_params {
  title: string;
  body: string;
  scheduled_at: string; // ISO timestamp
}

// agent_request invocation payload (assistant path).
export interface agent_request {
  tenant_context_token: string;
  operation: "set_reminder";
  params: set_reminder_params;
}

// agent list-reminders invocation payload (assistant path).
export interface agent_list_request {
  tenant_context_token: string;
  operation: "list_reminders";
}

// Resolved tenant claims passed by ap-server after gateway validation.
export interface tenant_claims {
  sub: string;
  city_tenant_id: string;
}

// One due reminder paired with its owning resident, for the scheduler path.
export interface reminder_due {
  sub: string;
  entry: reminder_entry;
}

// Notification request handed to the notifier port.
export interface notify_request {
  type: notify_request_type;
  notification: Record<string, unknown>;
}

// Module config.
export interface reminders_config {
  token_verification_public_key: string;
}

// --- Ports (injected by ap-server) ---

// Persistence port. Scoped per city_tenant_id by the adapter.
export interface reminders_store {
  create_reminder(city_tenant_id: string, sub: string, entry: reminder_entry): Promise<void>;
  list_reminders(city_tenant_id: string, sub: string): Promise<reminder_entry[]>;
  set_status(
    city_tenant_id: string,
    sub: string,
    reminder_id: string,
    status: reminder_status,
    delivered_at: string | null,
  ): Promise<void>;
  // Remove a reminder row outright (used when the resident dismisses it).
  delete_reminder(city_tenant_id: string, sub: string, reminder_id: string): Promise<void>;
  // Upcoming reminders across the city whose scheduled_at is at or before the cutoff.
  list_due(city_tenant_id: string, before_iso: string): Promise<reminder_due[]>;
  list_tenants(): Promise<string[]>;
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

// Generates reminder ids. Injected so id generation stays testable.
export interface id_source {
  next(): string;
}

// Service dependencies.
export interface reminders_service_deps {
  store: reminders_store;
  notifier: notifier;
  clock: clock;
  id_source: id_source;
  config: reminders_config;
}

// Handler dependencies.
export interface reminders_handler_deps extends reminders_service_deps {
  token_verifier: token_verifier;
}
