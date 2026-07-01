// m-res-reminders owns every type in this module. Reminders are read and written
// through the gateway /reminders/* routes (ap-reminders); the Feed renders them
// on the Upcoming/Triggered spine.

// Lifecycle of a reminder. upcoming: scheduled, not yet due. fired: its time has
// passed and it sits in the Triggered feed. dismissed: cleared from the feed.
export type reminder_status = "upcoming" | "fired" | "dismissed";

// One reminder the resident set (via chat, or a future reminders surface).
export interface reminder_entry {
  id: string;
  title: string;
  body: string;
  // ISO 8601 instant the reminder is scheduled to fire.
  scheduled_at: string;
  // Short human label for the spine (e.g. "Thu · 7:30 AM"). Rendered as-is.
  when_display: string;
  status: reminder_status;
}

// Fields needed to create a reminder. id, when_display, and status are derived.
export interface new_reminder {
  title: string;
  body: string;
  scheduled_at: string;
  when_display: string;
}

// Surface the portal consumes from useReminders().
export interface reminders_client {
  // All reminders, newest scheduled first. Re-renders when the list changes.
  reminders: reminder_entry[];
  // Create an upcoming reminder. Returns the created entry.
  add(input: new_reminder): reminder_entry;
  // Re-read the reminder list from the backend. The portal calls this after the
  // assistant's set_reminder tool persists a reminder, so the new row (with its
  // server id) is pulled in without the portal writing anything.
  refresh(): Promise<void>;
  // Mark a reminder dismissed (cleared from the feed).
  dismiss(id: string): void;
  // Restore a dismissed reminder to its prior status (undo support).
  restore(id: string): void;
  // Subscribe to client-side fires: called once per reminder the instant it
  // flips upcoming -> fired on this device. Returns an unsubscribe. The portal
  // uses it to raise a local notification.
  on_fire(listener: (entry: reminder_entry) => void): () => void;
}

// --- React Query keys ---

// Namespaced query key for the reminder list read from the gateway.
export const reminders_query_keys = {
  list: ["reminders", "list"] as const,
};
