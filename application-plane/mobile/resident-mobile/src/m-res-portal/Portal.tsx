// Portal: the resident app shell. Renders ALL resident screens and owns
// navigation. It NEVER reaches the API gateway and never holds credentials.
// Backend reads come from m-res-civic and m-res-accounts; the portal forwards
// requests to those hooks and renders the view data they return.
//
// Navigation is a self-contained in-memory panel switcher mirroring the
// mockup's select_panel pattern: one panel visible at a time, hub screens list
// sections, leaf screens carry a back link. A bottom tab bar selects the root
// panel of each tab.

import React, { useCallback, useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { app_config } from "@/app-config";
import { use_theme, use_lang } from "@/m-res-shell";
import { use_civic } from "@/m-res-civic";
import {
  ScrapeRunner,
  use_accounts,
  type scrape_runner_handle,
  type sync_result,
} from "@/m-res-accounts";
import { AssistantScreen } from "@/m-res-assistant";

import { TabBar } from "./components/chrome";
import {
  CityHubScreen,
  CivicAlertsScreen,
  CivicEventsScreen,
  CollectionScreen,
  FindRepScreen,
  MyAreaHubScreen,
  MyAreaLeafScreen,
} from "./screens/civic";
import {
  AgenciesScreen,
  DiscoveryScreen,
  ThreeOneOneScreen,
} from "./screens/static";
import { HomeScreen, PreferencesScreen, ProfileScreen } from "./screens/home";
import {
  AccountsScreen,
  BillsScreen,
  PowerStatusScreen,
  UsageScreen,
  UtilityHubScreen,
} from "./screens/utility";
import {
  panel_tab,
  tab_root,
  type linked_account,
  type notification_preferences,
  type panel_id,
  type resident_profile,
  type sync_ui_state,
  type tab_id,
} from "./types";

const EMPTY_PROFILE: resident_profile = {
  street: "",
  zip: "",
  name: "",
  email: "",
  phone: "",
  lang: "en",
};

const DEFAULT_PREFS: notification_preferences = {
  utility_alert_enabled: true,
  city_alert_enabled: true,
  bills_reminder_enabled: true,
  event_reminder_enabled: false,
};

export function Portal() {
  const t = use_theme();

  // --- client module hooks ---
  const civic = use_civic();
  const runner = useRef<scrape_runner_handle | null>(null);
  const accounts = use_accounts(runner);

  // --- navigation state ---
  const [panel, set_panel] = useState<panel_id>("home");
  const active_tab: tab_id = panel_tab[panel];

  const select_panel = useCallback((id: panel_id) => set_panel(id), []);
  const select_tab = useCallback(
    (tab: tab_id) => set_panel(tab_root[tab]),
    [],
  );

  // --- resident profile (entered in the profile screen; address scopes reads) ---
  const [profile, set_profile] = useState<resident_profile>(EMPTY_PROFILE);
  const address = profile.street;

  // Keep the app language in sync with the saved profile. Driven on load and on
  // every profile change, so the UI language follows the resident's preference.
  const { set_lang } = use_lang();
  useEffect(() => {
    set_lang(profile.lang === "es" ? "es" : "en");
  }, [profile.lang, set_lang]);

  // --- linked accounts + per-account sync UI state ---
  const [linked, set_linked] = useState<linked_account[]>([]);
  const [sync_state, set_sync_state] = useState<sync_ui_state>({
    syncing: false,
    last_synced_at: null,
    error: null,
  });
  // Site ids with a sync still in flight. Spinner runs while this set is
  // non-empty; bound to actual syncResult transitions, not a timer.
  const in_flight = useRef<Set<string>>(new Set());

  useEffect(() => {
    const off = accounts.on_sync_result((r: sync_result) => {
      if (r.sync_status === "queued" || r.sync_status === "syncing") {
        in_flight.current.add(r.site_id);
        set_sync_state((s) => ({ ...s, syncing: true }));
        return;
      }
      // done | error: settle this account.
      in_flight.current.delete(r.site_id);
      set_sync_state((s) => ({
        syncing: in_flight.current.size > 0,
        last_synced_at: Date.now(),
        error: r.sync_status === "error" ? r.error ?? "sync error" : s.error,
      }));
    });
    return off;
  }, [accounts]);

  // One syncRequest per linked account via sync_all.
  const on_sync_all = useCallback(() => {
    if (sync_state.syncing) return;
    set_sync_state((s) => ({ ...s, error: null }));
    void accounts.sync_all(linked.map((a) => a.site_id));
  }, [accounts, linked, sync_state.syncing]);

  // --- preference toggles (gate the home feed) ---
  const [prefs, set_prefs] = useState<notification_preferences>(DEFAULT_PREFS);
  // OS permission state is not surfaced in this build; default to granted. When
  // denied, the toggles render inert.
  const [permission_denied] = useState(false);

  const on_prefs_change = useCallback((next: notification_preferences) => {
    set_prefs(next);
  }, []);

  // ElevenLabs voice the resident picked in Preferences, sent on the next voice
  // session's open frame. Defaults to the configured default until changed.
  const [voice_id, set_voice_id] = useState<string>(app_config.default_voice_id);

  // Measured tab bar height. The assistant's input bar lifts above the keyboard
  // by this much so the keyboard doesn't cover it (the input sits above the tab
  // bar, not at the screen bottom).
  const [tab_bar_height, set_tab_bar_height] = useState(0);

  // --- account link / unlink (creds stay in keystore; record persists to backend) ---
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

  // Persist the resident profile to the backend and keep local state in sync.
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

  // Load persisted profile, linked accounts, and notification opt-ins on mount.
  const loaded = useRef(false);
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void accounts.load_profile().then((p) => {
      if (p) set_profile(p);
    });
    void accounts
      .list_accounts()
      .then(set_linked)
      .catch(() => {});
  }, [accounts]);

  // --- panel renderer ---
  const render_body = () => {
    switch (panel) {
      case "home":
        return (
          <HomeScreen
            civic={civic}
            accounts={accounts}
            address={address}
            prefs={prefs}
            select={select_panel}
          />
        );
      case "profile":
        return (
          <ProfileScreen
            profile={profile}
            on_change={set_profile}
            on_save={on_save_profile}
            onBack={() => set_panel("home")}
            select={select_panel}
          />
        );
      case "preferences":
        return (
          <PreferencesScreen
            prefs={prefs}
            on_change={on_prefs_change}
            permission_denied={permission_denied}
            profile={profile}
            on_save_profile={on_save_profile}
            voice_id={voice_id}
            on_voice_id_change={set_voice_id}
            onBack={() => set_panel("profile")}
          />
        );

      // --- city ---
      case "city_hub":
        return <CityHubScreen select={select_panel} />;
      case "civic_alerts":
        return (
          <CivicAlertsScreen
            civic={civic}
            address={address}
            onBack={() => set_panel("city_hub")}
          />
        );
      case "civic_events":
        return (
          <CivicEventsScreen
            civic={civic}
            address={address}
            onBack={() => set_panel("city_hub")}
          />
        );
      case "collection":
        return (
          <CollectionScreen
            civic={civic}
            address={address}
            onBack={() => set_panel("city_hub")}
          />
        );
      case "agencies":
        return <AgenciesScreen onBack={() => set_panel("city_hub")} />;
      case "my_area":
        return <MyAreaHubScreen address={address} select={select_panel} />;
      case "find_rep":
        return (
          <FindRepScreen
            civic={civic}
            address={address}
            onBack={() => set_panel("my_area")}
          />
        );
      case "area_school":
        return (
          <MyAreaLeafScreen
            civic={civic}
            address={address}
            kind="school"
            onBack={() => set_panel("my_area")}
          />
        );
      case "area_neighborhood":
        return (
          <MyAreaLeafScreen
            civic={civic}
            address={address}
            kind="neighborhood"
            onBack={() => set_panel("my_area")}
          />
        );
      case "three_one_one":
        return <ThreeOneOneScreen onBack={() => set_panel("city_hub")} />;

      // --- utility ---
      case "utility_hub":
        return <UtilityHubScreen select={select_panel} />;
      case "utility_bills":
        return (
          <BillsScreen
            accounts={accounts}
            sync_state={sync_state}
            on_sync_all={on_sync_all}
            onBack={() => set_panel("utility_hub")}
          />
        );
      case "utility_usage":
        return (
          <UsageScreen
            accounts={accounts}
            sync_state={sync_state}
            on_sync_all={on_sync_all}
            onBack={() => set_panel("utility_hub")}
          />
        );
      case "utility_accounts":
        return (
          <AccountsScreen
            linked={linked}
            on_linked={on_linked}
            on_unlink={on_unlink}
            onBack={() => set_panel("utility_hub")}
          />
        );
      case "power_status":
        return (
          <PowerStatusScreen
            accounts={accounts}
            address={address}
            onBack={() => set_panel("utility_hub")}
          />
        );

      // --- discover ---
      case "discovery":
        return <DiscoveryScreen />;

      // --- ask ---
      case "chat":
        return (
          <AssistantScreen
            voice_id={voice_id}
            keyboard_offset={tab_bar_height}
          />
        );
    }
  };

  return (
    <SafeAreaView
      edges={["top", "left", "right"]}
      style={{ flex: 1, backgroundColor: t.color.paper }}
    >
      <View style={{ flex: 1 }}>{render_body()}</View>
      <TabBar
        active={active_tab}
        onSelect={select_tab}
        onLayout={(e) => set_tab_bar_height(e.nativeEvent.layout.height)}
      />
      {/* Off-screen scrape host, mounted once. Drives on-device account syncs;
          the portal never reads credentials. */}
      <ScrapeRunner ref={runner} />
    </SafeAreaView>
  );
}
