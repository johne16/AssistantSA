// m-res-portal owns its own view and navigation types. Backend data shapes are
// owned by the client modules (m-res-civic, m-res-accounts) and consumed through
// their hooks; the portal does not redefine them.

// Bottom tab identities. One tab owns a set of panels.
export type tab_id = "home" | "city" | "utility" | "ask" | "discover";

// Every routable panel in the app. Hub panels list sections; leaf panels are
// individual screens reached from a hub with a back link. This list is not
// exhaustive of the product; add panels here as screens are added.
export type panel_id =
  | "home"
  | "profile"
  | "preferences"
  // city
  | "city_hub"
  | "civic_alerts"
  | "civic_events"
  | "collection"
  | "agencies"
  | "my_area"
  | "find_rep"
  | "area_police"
  | "area_fire"
  | "area_school"
  | "area_neighborhood"
  | "three_one_one"
  // utility
  | "utility_hub"
  | "utility_bills"
  | "utility_usage"
  | "utility_accounts"
  | "power_status"
  // discover
  | "discovery"
  // ask
  | "chat";

// The owning tab for a panel, used to light the correct tab on navigation.
export const panel_tab: Record<panel_id, tab_id> = {
  home: "home",
  profile: "home",
  preferences: "home",
  city_hub: "city",
  civic_alerts: "city",
  civic_events: "city",
  collection: "city",
  agencies: "city",
  my_area: "city",
  find_rep: "city",
  area_police: "city",
  area_fire: "city",
  area_school: "city",
  area_neighborhood: "city",
  three_one_one: "city",
  utility_hub: "utility",
  utility_bills: "utility",
  utility_usage: "utility",
  utility_accounts: "utility",
  power_status: "utility",
  discovery: "discover",
  chat: "ask",
};

// The default panel each tab opens to.
export const tab_root: Record<tab_id, panel_id> = {
  home: "home",
  city: "city_hub",
  utility: "utility_hub",
  ask: "chat",
  discover: "discovery",
};

// A bottom tab entry: identity, label, glyph, and whether it is the center ask tab.
export interface tab_def {
  id: tab_id;
  label: string;
  glyph: string;
  ask?: boolean;
}

// Linked utility account, tracked in portal state. site_id keys the keystore + sync.
export interface linked_account {
  site_id: string;
  provider: string;
  sign_in_url: string;
}

// Resident profile entered in the profile screen, owned by the portal. Empty
// strings until the resident fills them in; no values are seeded.
export interface resident_profile {
  street: string;
  zip: string;
  name: string;
  email: string;
  phone: string;
  lang: string;
}

// Navigation surface provided to screens so they can switch panels.
export interface portal_nav {
  current: panel_id;
  select_panel: (id: panel_id) => void;
}

// Per-account sync display state the utility screens bind their refresh icon to.
// Held from sync start until a sync_result lands, then settled to last_synced.
export interface sync_ui_state {
  syncing: boolean;
  last_synced_at: number | null; // epoch ms of last settled sync, null if never
  error: string | null;
}

// One row in the home-screen alert feed. The feed aggregates city alerts,
// utility outages, events, and bill-due items, each included only when its
// preference toggle is on. The feed renders titles only.
export interface feed_item {
  id: string;
  title: string;
}

// Per-type opt-in toggles surfaced by the preferences screen. They gate which
// sources the home feed aggregates. Owned by the portal; the notifications
// module is disconnected in this build.
export interface notification_preferences {
  utility_alert_enabled: boolean;
  city_alert_enabled: boolean;
  bills_reminder_enabled: boolean;
  event_reminder_enabled: boolean;
}
