import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { use_resident_session } from "@/m-res-auth";
import { app_config } from "@/app-config";
import type {
  notification as notification_shape,
  notification_preferences,
  notification_type,
  poll_response,
  registration_request,
  use_notifications_args,
  use_notifications_result,
} from "./types";

// Default opt-ins applied on the very first registration, before the portal
// has supplied stored preferences. ap-notifications is the store of record and
// reconciles against these.
const default_preferences: notification_preferences = {
  utility_alert_enabled: true,
  city_alert_enabled: true,
  bills_reminder_enabled: true,
  event_reminder_enabled: true,
};

const valid_types: ReadonlySet<notification_type> = new Set([
  "power_outage",
  "emergency_alert",
  "bill_due",
  "event_reminder",
]);

// Resolves the navigation type from the notification's data payload. The
// backend stamps the type; anything outside the contract is dropped.
function resolve_type(notification: notification_shape): notification_type | null {
  const candidate = notification.request.content.data?.type;
  return typeof candidate === "string" && valid_types.has(candidate as notification_type)
    ? (candidate as notification_type)
    : null;
}

// POSTs the registration request to the API gateway with capped exponential
// backoff. Resolves once accepted; rejects only when aborted.
async function post_registration(
  base_url: string,
  body: registration_request,
  signal: AbortSignal,
): Promise<void> {
  let delay_ms = 1000;
  const max_delay_ms = 30000;
  while (!signal.aborted) {
    try {
      const res = await fetch(`${base_url}/notifications/registrations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal,
      });
      if (res.ok) return;
    } catch {
      // Network unavailable or transient failure; fall through to backoff.
    }
    if (signal.aborted) return;
    await new Promise((resolve) => setTimeout(resolve, delay_ms));
    delay_ms = Math.min(delay_ms * 2, max_delay_ms);
  }
}

// Drains the resident's queued notifications from the gateway. Returns [] on any
// failure so the caller just waits for the next poll.
async function poll_pending(
  base_url: string,
  tenant_context_token: string,
  signal: AbortSignal,
): Promise<poll_response["notifications"]> {
  try {
    const res = await fetch(`${base_url}/notifications/pending`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tenant_context_token }),
      signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as poll_response;
    return body.notifications ?? [];
  } catch {
    return [];
  }
}

// Permission, registration, and listener lifecycle for the resident's device.
// Returns set_preferences for the portal's toggle screen. The portal renders;
// this hook never draws UI.
export function use_notifications({
  on_notification_event,
  on_notification_navigation,
}: use_notifications_args): use_notifications_result {
  const { tenant_context_token } = use_resident_session();
  const base_url = (app_config as { api_gateway_base_url: string }).api_gateway_base_url;
  // Module is disconnected in this build; the poll cadence is no longer injected
  // from app_config. Local default kept so the dead code still type-checks.
  const poll_interval_ms = 15000;

  // Latest known preferences, so a re-register keeps current opt-ins.
  const preferences_ref = useRef<notification_preferences>(default_preferences);
  // Stable callbacks for use inside listeners.
  const event_cb_ref = useRef(on_notification_event);
  const nav_cb_ref = useRef(on_notification_navigation);
  event_cb_ref.current = on_notification_event;
  nav_cb_ref.current = on_notification_navigation;

  // Tracks the in-flight registration so a new one can abort the prior retry loop.
  const registration_abort_ref = useRef<AbortController | null>(null);

  // Fires a (re-)registration of the current opt-in preferences. Delivery routes
  // by resident (sub from the token); no device token is involved.
  function register(): void {
    registration_abort_ref.current?.abort();
    const controller = new AbortController();
    registration_abort_ref.current = controller;
    const body: registration_request = {
      tenant_context_token,
      notification_preferences: preferences_ref.current,
    };
    void post_registration(base_url, body, controller.signal);
  }

  // Relays a tapped notification to the portal for deep-linking.
  function emit_navigation(notification: notification_shape): void {
    const type = resolve_type(notification);
    if (type) nav_cb_ref.current({ type, notification });
  }

  useEffect(() => {
    let cancelled = false;
    const poll_abort = new AbortController();
    let poll_timer: ReturnType<typeof setInterval> | null = null;

    // Drains pending notifications and raises one local notification per item.
    // The local notification fires the received/response listeners below, so the
    // portal banner and deep-link flow are unchanged from the push design.
    async function drain_once(): Promise<void> {
      const pending = await poll_pending(base_url, tenant_context_token, poll_abort.signal);
      if (cancelled) return;
      for (const p of pending) {
        await Notifications.scheduleNotificationAsync({
          content: {
            title: p.title,
            body: p.body,
            // Carry the type in data so a tap can deep-link via resolve_type.
            data: { ...p.data, type: p.type },
          },
          trigger: null, // fire immediately
        });
      }
    }

    // Request OS permission, register opt-ins, then start polling. Local
    // notifications still require notification permission.
    (async () => {
      const { status } = await Notifications.getPermissionsAsync();
      let granted = status === "granted";
      if (!granted) {
        const request = await Notifications.requestPermissionsAsync();
        granted = request.status === "granted";
      }
      // Denied: skip registration and polling. Portal toggles stay inert.
      if (!granted || cancelled) return;

      register();
      void drain_once();
      poll_timer = setInterval(() => void drain_once(), poll_interval_ms);
    })();

    // Foreground notification: route to the portal banner.
    const received_sub = Notifications.addNotificationReceivedListener((notification) => {
      event_cb_ref.current({ notification: notification as notification_shape });
    });

    // Tap while running: deep-link via the portal.
    const response_sub = Notifications.addNotificationResponseReceivedListener((response) => {
      emit_navigation(response.notification as notification_shape);
    });

    // Tap from background/killed on app open: replay the last response once.
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (!cancelled && response?.notification) {
        emit_navigation(response.notification as notification_shape);
      }
    });

    return () => {
      cancelled = true;
      poll_abort.abort();
      if (poll_timer) clearInterval(poll_timer);
      registration_abort_ref.current?.abort();
      received_sub.remove();
      response_sub.remove();
    };
    // Lifecycle runs once per session; the session token is stable for the PoC.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Portal toggle handler: persist the new opt-ins to the backend immediately.
  function set_preferences(prefs: notification_preferences): void {
    preferences_ref.current = prefs;
    register();
  }

  // Loads the resident's stored opt-ins from the backend. Null if never saved.
  // Seeds preferences_ref so a later re-register keeps the stored opt-ins.
  async function get_preferences(): Promise<notification_preferences | null> {
    try {
      const res = await fetch(`${base_url}/notifications/registrations/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_context_token }),
      });
      if (!res.ok) return null;
      const prefs = (await res.json()) as notification_preferences | null;
      if (prefs) preferences_ref.current = prefs;
      return prefs;
    } catch {
      return null;
    }
  }

  return { set_preferences, get_preferences };
}
