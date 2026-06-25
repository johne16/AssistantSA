// m-res-notifications owns all type definitions for the notifications module.
// The tenant_context_token shape mirrors m-res-auth's canonical definition
// exactly, with zero deviation.

// Mirror of the canonical tenant_context_token claim set (owned by m-res-auth).
export interface tenant_context_token {
  sub: string; // resident/subject id
  city_tenant_id: string; // per-city namespace key
  iat: number; // issued-at, seconds since epoch
  exp: number; // expiry, seconds since epoch
}

// Per-type opt-in toggles surfaced by the portal preferences screen.
export interface notification_preferences {
  utility_alert_enabled: boolean;
  city_alert_enabled: boolean;
  bills_reminder_enabled: boolean;
  event_reminder_enabled: boolean;
}

// Notification type discriminant carried on deep-link navigation.
export type notification_type =
  | "power_outage"
  | "emergency_alert"
  | "bill_due"
  | "event_reminder";

// A received notification routed to the portal. Mirrors the shape the push
// service delivers; content/data are passed through untouched.
export interface notification {
  request: {
    content: {
      title: string | null;
      body: string | null;
      data: Record<string, unknown>;
    };
  };
}

// Foreground push routed to the portal for the dismissible homepage banner.
export interface notification_event {
  notification: notification;
}

// Emitted on a notification tap so the portal deep-links the related screen.
export interface notification_navigation {
  type: notification_type;
  notification: notification;
}

// HTTP body sent to the API gateway to register or refresh the current opt-in
// toggles. Delivery routes by resident (sub from the token); no device token.
export interface registration_request {
  tenant_context_token: string; // encoded RS256 JWT
  notification_preferences: notification_preferences;
}

// One queued notification returned by the /notifications/pending poll. The
// hook raises a local notification per item.
export interface pending_notification {
  type: notification_type;
  title: string;
  body: string;
  data: Record<string, unknown>;
}

// /notifications/pending response body.
export interface poll_response {
  notifications: pending_notification[];
}

// Callbacks the portal supplies to the hook.
export interface use_notifications_args {
  on_notification_event: (event: notification_event) => void;
  on_notification_navigation: (nav: notification_navigation) => void;
}

// Return surface of the hook for the portal's toggle screen.
export interface use_notifications_result {
  set_preferences: (prefs: notification_preferences) => void;
  // Load the resident's stored opt-ins from the backend. Null if never saved.
  get_preferences: () => Promise<notification_preferences | null>;
}

// Config injected from app_config.
export interface notifications_config {
  api_gateway_base_url: string;
  notification_poll_interval_ms: number;
}
