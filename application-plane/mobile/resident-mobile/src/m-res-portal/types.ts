// m-res-portal owns its own view and navigation types. Backend data shapes are
// owned by the client modules (m-res-civic, m-res-accounts, m-res-reminders) and
// consumed through their hooks; the portal does not redefine them.
//
// The app is the four-surface "Bex" concept: Chat, Feed, Accounts, Settings.

// Bottom tab identities. One tab owns a set of panels.
export type tab_id = "chat" | "feed" | "accounts" | "settings";

// Every routable panel. Accounts owns the add-account form as a leaf; the other
// surfaces are single panels.
export type panel_id =
  | "chat"
  | "feed"
  | "accounts"
  | "add_account"
  | "settings";

// The owning tab for a panel, used to light the correct tab on navigation.
export const panel_tab: Record<panel_id, tab_id> = {
  chat: "chat",
  feed: "feed",
  accounts: "accounts",
  add_account: "accounts",
  settings: "settings",
};

// The default panel each tab opens to.
export const tab_root: Record<tab_id, panel_id> = {
  chat: "chat",
  feed: "feed",
  accounts: "accounts",
  settings: "settings",
};

// A bottom tab entry: identity and label. The icon is drawn from the tab id
// (see TAB_ICONS in chrome.tsx), mirroring the mockup's line icons.
export interface tab_def {
  id: tab_id;
  label: string;
}

// Linked utility account, tracked in portal state. site_id keys the keystore + sync.
export interface linked_account {
  site_id: string;
  provider: string;
  sign_in_url: string;
}

// Resident profile entered in Settings, owned by the portal. Empty strings until
// the resident fills them in; no values are seeded.
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

// Per-account sync display state the accounts/feed screens bind to. Held from
// sync start until a sync_result lands, then settled to last_synced.
export interface sync_ui_state {
  syncing: boolean;
  last_synced_at: number | null; // epoch ms of last settled sync, null if never
  error: string | null;
}

// Severity tiers for the Feed time spine (per CAP severity). critical: pinned,
// acknowledged, life-safety (city/AHAS emergency, boil-water, gas). important:
// utility outages, bill due, usage spikes. routine: service-schedule shifts.
// upcoming: a scheduled reminder that has not fired.
export type feed_tier = "critical" | "important" | "routine" | "upcoming";

// Which lane of the feed an item sits in.
export type feed_lane = "triggered" | "upcoming";

// One rendered row on the Feed spine, merged from civic alerts and reminders.
export interface feed_item {
  id: string;
  lane: feed_lane;
  tier: feed_tier;
  kind_label: string; // e.g. "Alert · SAWS", "Reminder · you asked"
  when_display: string;
  title: string;
  body: string;
  // critical items are acknowledged, never swiped or bulk-cleared.
  dismissible: boolean;
}

// Per-type opt-in toggles surfaced by Settings. Owned by the portal; the
// notifications module is disconnected in this build.
export interface notification_preferences {
  push_enabled: boolean;
  utility_alert_enabled: boolean;
  city_alert_enabled: boolean;
  event_reminder_enabled: boolean;
  bills_reminder_enabled: boolean;
}
