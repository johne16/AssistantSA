// Portal: the resident app shell. Renders the four "Bex" surfaces (Chat, Feed,
// Accounts, Settings) and owns navigation. It NEVER reaches the API gateway and
// never holds credentials. Backend reads come from m-res-civic, m-res-accounts,
// and m-res-reminders (reminders are stored in ap-reminders via the gateway). A
// portal-level wake bar ("Hey Bex") sits above the tab bar on every screen.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import { app_config } from "@/app-config";
import { use_theme, use_lang } from "@/m-res-shell";
import { use_civic, type alert_entry } from "@/m-res-civic";
import {
  ScrapeRunner,
  use_accounts,
  type scrape_runner_handle,
  type sync_result,
} from "@/m-res-accounts";
import { use_reminders } from "@/m-res-reminders";
import {
  use_notifications,
  type notification_preferences as push_preferences,
} from "@/m-res-notifications";
import { AssistantScreen, IdleOverlay, use_assistant_engine } from "@/m-res-assistant";

import { TabBar, WakeBar } from "./components/chrome";
import { FeedScreen, alert_feed_id } from "./screens/feed";
import { AccountsScreen, AddAccountScreen } from "./screens/accounts";
import { SettingsScreen } from "./screens/settings";
import {
  panel_tab,
  tab_root,
  type linked_account,
  type notification_preferences,
  type panel_id,
  type resident_profile,
  type tab_id,
} from "./types";

// Idle threshold: after this long with no interaction, the full-screen ambient
// idle overlay appears (and holds the screen awake). Set below the common 30s
// phone screen-off so the idle screen takes over before the phone would sleep.
const IDLE_AFTER_MS = 20000;

// Keep-awake tag held while the idle overlay is shown.
const IDLE_KEEP_AWAKE_TAG = "m-res-portal-idle";

const EMPTY_PROFILE: resident_profile = {
  street: "",
  zip: "",
  name: "",
  email: "",
  phone: "",
  lang: "en",
};

const DEFAULT_PREFS: notification_preferences = {
  push_enabled: true,
  utility_alert_enabled: true,
  city_alert_enabled: true,
  event_reminder_enabled: false,
  bills_reminder_enabled: true,
};

// Map the portal's five-toggle preferences to the notifications module's
// four-type opt-ins. push_enabled is the master switch: when off, every type is
// silenced so nothing is delivered.
function to_push_prefs(p: notification_preferences): push_preferences {
  if (!p.push_enabled) {
    return {
      utility_alert_enabled: false,
      city_alert_enabled: false,
      bills_reminder_enabled: false,
      event_reminder_enabled: false,
    };
  }
  return {
    utility_alert_enabled: p.utility_alert_enabled,
    city_alert_enabled: p.city_alert_enabled,
    bills_reminder_enabled: p.bills_reminder_enabled,
    event_reminder_enabled: p.event_reminder_enabled,
  };
}

export function Portal() {
  const t = use_theme();

  // --- client module hooks ---
  const civic = use_civic();
  const runner = useRef<scrape_runner_handle | null>(null);
  const accounts = use_accounts(runner);
  const reminders = use_reminders();
  // Push notifications: a tap on any type opens the Feed (the single surface that
  // replaced the per-topic screens); a notification arriving in the foreground is
  // silent (its data already shows in the Feed).
  const notifications = use_notifications({
    on_notification_event: () => {},
    // A sync-failure tap opens Accounts (to re-link); every other type opens Feed.
    on_notification_navigation: (nav) =>
      set_panel(nav.type === "utility_sync_failed" ? "accounts" : "feed"),
  });

  // --- navigation state ---
  const [panel, set_panel] = useState<panel_id>("chat");
  const active_tab: tab_id = panel_tab[panel];

  const select_panel = useCallback((id: panel_id) => set_panel(id), []);
  const select_tab = useCallback((tab: tab_id) => set_panel(tab_root[tab]), []);

  // --- resident profile (entered in Settings; address scopes reads) ---
  const [profile, set_profile] = useState<resident_profile>(EMPTY_PROFILE);

  // Keep the app language in sync with the saved profile.
  const { set_lang } = use_lang();
  useEffect(() => {
    set_lang(profile.lang === "es" ? "es" : "en");
  }, [profile.lang, set_lang]);

  // --- linked accounts + per-account sync UI state ---
  const [linked, set_linked] = useState<linked_account[]>([]);
  const in_flight = useRef<Set<string>>(new Set());

  // --- preference toggles ---
  const [prefs, set_prefs] = useState<notification_preferences>(DEFAULT_PREFS);
  const on_prefs_change = useCallback(
    (next: notification_preferences) => {
      set_prefs(next);
      // Re-register the opt-ins with the push backend on every change.
      notifications.set_preferences(to_push_prefs(next));
    },
    [notifications],
  );

  useEffect(() => {
    const off = accounts.on_sync_result((r: sync_result) => {
      if (r.sync_status === "queued" || r.sync_status === "syncing") {
        in_flight.current.add(r.site_id);
        return;
      }
      in_flight.current.delete(r.site_id);
      // A failed sync means stale data and (usually) a broken login. Alert the
      // resident so they can re-link, unless the push master switch is off.
      if (r.sync_status === "error" && prefs.push_enabled) {
        const provider =
          linked.find((a) => a.site_id === r.site_id)?.provider ?? "your utility account";
        notifications.raise_local({
          type: "utility_sync_failed",
          title: "Account sync failed",
          body: `Couldn't sync ${provider}. Tap to update your login.`,
          data: { site_id: r.site_id },
        });
      }
    });
    return off;
  }, [accounts, notifications, prefs.push_enabled, linked]);

  // Re-scrape linked accounts when the app returns to the foreground (a warm
  // "open"), in addition to the cold-start sync below. Skipped if a sync is
  // already in flight so resumes don't stack scrapes.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state !== "active" || linked.length === 0 || in_flight.current.size > 0) {
        return;
      }
      void accounts.sync_all(linked.map((a) => a.site_id));
    });
    return () => sub.remove();
  }, [accounts, linked]);

  // ElevenLabs voice the resident picked in Settings, sent on the next voice
  // session's open frame.
  const [voice_id, set_voice_id] = useState<string>(app_config.default_voice_id);

  // Wake-word listening state (portal-level "Hey Bex"). The wake bar and the
  // Settings wake-word switch drive the same flag.
  const [wake_enabled, set_wake_enabled] = useState(false);
  const toggle_wake = useCallback(() => set_wake_enabled((w) => !w), []);

  // Store a reminder the assistant set (text or voice). Kept here so
  // m-res-assistant stays decoupled from m-res-reminders.
  const on_set_reminder = useCallback(
    (r: { title: string; body: string; when: string; scheduled_at: string }) =>
      reminders.add({
        title: r.title,
        body: r.body,
        scheduled_at: r.scheduled_at,
        when_display: r.when,
      }),
    [reminders],
  );

  // Assistant engine, mounted once here so the "Hey Bex" wake listener and the
  // mic engine run on every screen (the wake toggle is portal-level), not only
  // while the Chat tab is mounted. AssistantScreen renders its chat state; the
  // idle overlay reads its audio output level.
  const engine = use_assistant_engine({
    voice_id,
    wake_enabled,
    on_set_reminder,
    on_relink_account: () => set_panel("accounts"),
  });

  // --- ambient idle overlay (full-screen) driven by inactivity ---
  const [idle_visible, set_idle_visible] = useState(false);
  const idle_timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Restart the inactivity countdown and hide the overlay. Called on every touch
  // (capture phase) and whenever the app returns to the foreground.
  const reset_idle = useCallback(() => {
    set_idle_visible(false);
    if (idle_timer.current) clearTimeout(idle_timer.current);
    // Only arm the timer while the wake word is on and no voice session is live:
    // the idle screen is the ambient listening surface, so a muted wake word or
    // an active conversation shows no overlay.
    if (!wake_enabled || engine.voice_on) return;
    idle_timer.current = setTimeout(() => set_idle_visible(true), IDLE_AFTER_MS);
  }, [wake_enabled, engine.voice_on]);
  // Arm/disarm the timer when the wake word toggles; clear on unmount.
  useEffect(() => {
    reset_idle();
    return () => {
      if (idle_timer.current) clearTimeout(idle_timer.current);
    };
  }, [reset_idle]);
  // Hold the screen awake while the idle overlay is shown so the phone does not
  // sleep; release it when the overlay is dismissed.
  useEffect(() => {
    if (!idle_visible) return;
    void activateKeepAwakeAsync(IDLE_KEEP_AWAKE_TAG);
    return () => {
      void deactivateKeepAwake(IDLE_KEEP_AWAKE_TAG);
    };
  }, [idle_visible]);

  // Measured tab bar + wake bar height, so the chat input lifts above them.
  const [chrome_height, set_chrome_height] = useState(0);

  // --- feed source: one alerts fetch, owned here so the tab badge and the Feed
  // list derive from the same data and the same dismissal state ---
  const [alerts, set_alerts] = useState<alert_entry[]>([]);
  const [dismissed_alerts, set_dismissed_alerts] = useState<Set<string>>(
    new Set(),
  );
  useEffect(() => {
    if (!prefs.city_alert_enabled) {
      set_alerts([]);
      return;
    }
    let live = true;
    civic
      .civic_view_request({ resource: "alerts", params: {} })
      .then((res) => {
        if (live) set_alerts((res.data as alert_entry[]) ?? []);
      })
      .catch(() => {
        if (live) set_alerts([]);
      });
    return () => {
      live = false;
    };
  }, [civic, prefs.city_alert_enabled]);

  const on_dismiss_alerts = useCallback((ids: string[]) => {
    set_dismissed_alerts((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.add(id);
      return next;
    });
  }, []);
  const on_restore_alerts = useCallback((ids: string[]) => {
    set_dismissed_alerts((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  // Tab badge: non-dismissed alerts + fired reminders (the Triggered count).
  const live_alert_count = alerts.filter(
    (a) => !dismissed_alerts.has(alert_feed_id(a.entry_id)),
  ).length;
  const fired_count = reminders.reminders.filter((r) => r.status === "fired").length;
  const feed_badge = live_alert_count + fired_count;

  // --- account link / unlink ---
  const on_linked = useCallback(
    async (account: linked_account) => {
      try {
        await accounts.register_linked_account(account);
      } catch {
        return false;
      }
      set_linked((prev) =>
        prev.some((a) => a.site_id === account.site_id)
          ? prev
          : [...prev, account],
      );
      return true;
    },
    [accounts],
  );
  const on_unlink = useCallback(
    async (site_id: string) => {
      try {
        await accounts.unlink_account(site_id);
      } catch {
        return false;
      }
      set_linked((prev) => prev.filter((a) => a.site_id !== site_id));
      return true;
    },
    [accounts],
  );

  // Persist the resident profile and keep local state in sync.
  const on_save_profile = useCallback(
    async (next: resident_profile) => {
      try {
        await accounts.save_profile(next);
      } catch {
        return false;
      }
      set_profile(next);
      return true;
    },
    [accounts],
  );

  // Load persisted profile + linked accounts on mount.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void accounts.load_profile().then((p) => {
      if (p) set_profile(p);
    });
    void accounts
      .list_accounts()
      .then((accts) => {
        set_linked(accts);
        // Startup scrape: sync every linked account on app open. Failures raise a
        // local notification via the on_sync_result subscription above.
        if (accts.length > 0) {
          void accounts.sync_all(accts.map((a) => a.site_id));
        }
      })
      .catch(() => {});
    // Seed the notification toggles from the resident's stored opt-ins. push_enabled
    // (the master switch) has no backend field, so it stays at its default.
    void notifications.get_preferences().then((stored) => {
      if (stored) set_prefs((prev) => ({ ...prev, ...stored }));
    });
  }, [accounts, notifications]);

  // --- panel renderer ---
  const render_body = () => {
    switch (panel) {
      case "chat":
        return <AssistantScreen engine={engine} keyboard_offset={chrome_height} />;
      case "feed":
        return (
          <FeedScreen
            alerts={alerts}
            dismissed_alerts={dismissed_alerts}
            on_dismiss_alerts={on_dismiss_alerts}
            on_restore_alerts={on_restore_alerts}
            reminders={reminders}
          />
        );
      case "accounts":
        return (
          <AccountsScreen
            linked={linked}
            on_unlink={on_unlink}
            select={select_panel}
          />
        );
      case "add_account":
        return (
          <AddAccountScreen
            on_linked={on_linked}
            onBack={() => set_panel("accounts")}
          />
        );
      case "settings":
        return (
          <SettingsScreen
            profile={profile}
            on_change_profile={set_profile}
            on_save_profile={on_save_profile}
            prefs={prefs}
            on_prefs_change={on_prefs_change}
            voice_id={voice_id}
            on_voice_id_change={set_voice_id}
            wake_enabled={wake_enabled}
            on_wake_toggle={toggle_wake}
          />
        );
    }
  };

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: t.color.paper }}
      // Any touch anywhere resets the inactivity countdown. Capture phase so it
      // fires regardless of which child handles the touch; returns false so the
      // child still receives it.
      onStartShouldSetResponderCapture={() => {
        reset_idle();
        return false;
      }}
    >
      <View style={{ flex: 1 }}>{render_body()}</View>
      <View onLayout={(e) => set_chrome_height(e.nativeEvent.layout.height)}>
        <WakeBar muted={!wake_enabled} onToggle={toggle_wake} />
        <TabBar active={active_tab} onSelect={select_tab} feed_badge={feed_badge} />
      </View>
      {/* Off-screen scrape host, mounted once. Drives on-device account syncs;
          the portal never reads credentials. */}
      <ScrapeRunner ref={runner} />
      {/* Full-screen ambient idle overlay, shown after inactivity and dismissed
          on first touch. Above the tab bar so it covers the entire screen. */}
      <IdleOverlay audio={engine.audio} visible={idle_visible} />
    </SafeAreaView>
  );
}
