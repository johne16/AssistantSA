import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Notifications from "expo-notifications";
import { useResidentSession } from "@/m-res-auth";
import { app_config } from "@/app-config";
import { notifications_query_keys } from "./types";
import type {
  local_notification,
  notification as notification_shape,
  notification_preferences,
  notification_type,
  poll_response,
  registration_request,
  use_notifications_args,
  use_notifications_result,
} from "./types";

// Foreground presentation. Without a handler, expo-notifications delivers
// notifications silently while the app is open, so a fired reminder (or any
// on-device notification) shows nothing. Set once at import so it is registered
// before the first notification fires.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Default opt-ins applied on the very first registration, before the portal
// has supplied stored preferences. ap-notifications is the store of record and
// reconciles against these.
const default_preferences: notification_preferences = {
  utility_alert_enabled: true,
  city_alert_enabled: true,
  bills_reminder_enabled: true,
};

const valid_types: ReadonlySet<notification_type> = new Set([
  "power_outage",
  "emergency_alert",
  "bill_due",
  "reminder",
  "utility_sync_failed",
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

// Drains pending notifications and raises one local notification per item.
// Returns the number raised. Backs the /pending poll query.
async function drain_pending(
  base_url: string,
  tenant_context_token: string,
  signal: AbortSignal,
): Promise<number> {
  const pending = await poll_pending(base_url, tenant_context_token, signal);
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
  return pending.length;
}

// Permission, registration, and listener lifecycle for the resident's device.
// Returns set_preferences for the portal's toggle screen. The portal renders;
// this hook never draws UI.
export function useNotifications({
  on_notification_event,
  on_notification_navigation,
}: use_notifications_args): use_notifications_result {
  const { tenant_context_token } = useResidentSession();
  const base_url = (app_config as { api_gateway_base_url: string }).api_gateway_base_url;
  // Poll cadence for the /pending drain (React Query refetchInterval).
  const poll_interval_ms = 15000;

  // OS notification permission. Gates the pending poll.
  const [granted, set_granted] = useState(false);

  // Latest known preferences, so a re-register keeps current opt-ins.
  const preferences_ref = useRef<notification_preferences>(default_preferences);
  // Stable callbacks for use inside listeners.
  const event_cb_ref = useRef(on_notification_event);
  const nav_cb_ref = useRef(on_notification_navigation);
  event_cb_ref.current = on_notification_event;
  nav_cb_ref.current = on_notification_navigation;

  // Tracks the in-flight registration so a new one can abort the prior retry loop.
  const registration_abort_ref = useRef<AbortController | null>(null);

  // Stored opt-ins. Seeds preferences_ref so a re-register keeps them.
  const prefs_query = useQuery({
    queryKey: notifications_query_keys.prefs,
    queryFn: async (): Promise<notification_preferences | null> => {
      const res = await fetch(`${base_url}/notifications/registrations/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_context_token }),
      });
      if (!res.ok) throw new Error(`registrations-read ${res.status}`);
      return (await res.json()) as notification_preferences | null;
    },
  });
  useEffect(() => {
    if (prefs_query.data) preferences_ref.current = prefs_query.data;
  }, [prefs_query.data]);

  // Pending-notification poll. meta.persist:false keeps it out of the cache.
  useQuery({
    queryKey: notifications_query_keys.pending,
    queryFn: ({ signal }) => drain_pending(base_url, tenant_context_token, signal),
    enabled: granted,
    refetchInterval: poll_interval_ms,
    meta: { persist: false },
  });

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

    // Request OS permission, register opt-ins. The /pending drain is driven by
    // React Query, gated on the granted flag set here.
    (async () => {
      const { status } = await Notifications.getPermissionsAsync();
      let is_granted = status === "granted";
      if (!is_granted) {
        const request = await Notifications.requestPermissionsAsync();
        is_granted = request.status === "granted";
      }
      // Denied: skip registration and polling. Portal toggles stay inert.
      if (!is_granted || cancelled) return;

      register();
      set_granted(true);
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
      registration_abort_ref.current?.abort();
      received_sub.remove();
      response_sub.remove();
    };
    // Lifecycle runs once per session; the session token is stable for the PoC.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Raise a local notification for a client-origin event (e.g. a failed sync).
  const raise_local = useCallback((item: local_notification): void => {
    void Notifications.scheduleNotificationAsync({
      content: {
        title: item.title,
        body: item.body,
        // Carry the type in data so a tap can deep-link via resolve_type.
        data: { ...item.data, type: item.type },
      },
      trigger: null, // fire immediately
    });
  }, []);

  // Portal toggle handler: persist the new opt-ins to the backend immediately.
  const set_preferences = useCallback((prefs: notification_preferences): void => {
    preferences_ref.current = prefs;
    register();
    // register reads only refs and the stable base_url/token.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const preferences = prefs_query.data ?? null;

  return useMemo<use_notifications_result>(
    () => ({ set_preferences, preferences, raise_local }),
    [set_preferences, preferences, raise_local],
  );
}
