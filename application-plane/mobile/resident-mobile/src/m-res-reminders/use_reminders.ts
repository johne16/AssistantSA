import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { use_resident_session } from "@/m-res-auth";
import { app_config } from "@/app-config";

import type { new_reminder, reminder_entry, reminders_client } from "./types";

// Gateway-backed reminder store. Reminders live in ap-reminders and are read and
// written through the /reminders/* routes, so they survive an app reinstall and
// match what the backend holds. The Feed reads upcoming and fired reminders from
// here and merges them with civic alerts on the time spine.

const set_path = "/reminders/set";
const list_path = "/reminders/list";
const dismiss_path = "/reminders/dismiss";

// The reminder shape ap-reminders returns. Mapped to the client reminder_entry
// (which carries a derived when_display label the backend does not store).
interface gateway_reminder {
  reminder_id: string;
  scheduled_at: string;
  title: string;
  body: string;
  status: reminder_entry["status"];
  delivered_at: string | null;
}

const month_abbr = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Human label for a scheduled instant, e.g. "Jul 7 · 9:00 AM". Read from the ISO
// string's own wall-clock fields so the label matches what was scheduled
// regardless of the device timezone. Mirrors the backend's reminder_when_display.
function when_display(scheduled_at: string): string {
  const m = scheduled_at.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return "";
  const month = month_abbr[Number(m[2]) - 1] ?? m[2];
  const day = Number(m[3]);
  let hour = Number(m[4]);
  const meridiem = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${month} ${day} · ${hour}:${m[5]} ${meridiem}`;
}

function to_client(e: gateway_reminder): reminder_entry {
  return {
    id: e.reminder_id,
    title: e.title,
    body: e.body,
    scheduled_at: e.scheduled_at,
    when_display: when_display(e.scheduled_at),
    status: e.status,
  };
}

// Local id for an optimistic entry, replaced by the server reminder_id once the
// set call returns.
let local_counter = 0;
function next_local_id(): string {
  local_counter += 1;
  return `local_${local_counter}`;
}

export function use_reminders(): reminders_client {
  const { tenant_context_token } = use_resident_session();
  const base_url = (app_config as { api_gateway_base_url: string }).api_gateway_base_url;

  const [reminders, set_reminders] = useState<reminder_entry[]>([]);
  // Remembers the status a reminder held before dismissal, so restore() returns
  // it to its prior status rather than guessing.
  const prior_status = useRef<Map<string, reminder_entry["status"]>>(new Map());
  const loaded = useRef(false);
  // Listeners notified when a reminder fires on-device (portal -> local banner).
  const fire_listeners = useRef<Set<(entry: reminder_entry) => void>>(new Set());

  // Re-read the resident's reminders from the gateway. This module is the only
  // client writer of reminders; the assistant's set_reminder tool persists the
  // row server-side, so after it fires the portal calls refresh to pull the new
  // row (with its server id) rather than writing a duplicate.
  const refresh = useCallback(async (): Promise<void> => {
    try {
      const res = await fetch(`${base_url}${list_path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_context_token }),
      });
      if (!res.ok) return;
      const list = (await res.json()) as gateway_reminder[];
      set_reminders(list.map(to_client));
    } catch {
      // Network unavailable: leave the current list in place.
    }
  }, [base_url, tenant_context_token]);

  // Load once on mount.
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void refresh();
  }, [refresh]);

  // Client-side firing. Reminders fire on the device, not from the backend: the
  // backend only stores them so they sync to the user's other clients. Arm a
  // single timer for the earliest upcoming deadline and sleep until then, the way
  // an OS timer does, rather than polling. The effect re-arms whenever the list
  // changes (add, dismiss, restore, or a fire that flips a status).
  const [reschedule_tick, set_reschedule_tick] = useState(0);
  useEffect(() => {
    const now = Date.now();
    let next: number | null = null;
    for (const r of reminders) {
      if (r.status !== "upcoming") continue;
      const at = Date.parse(r.scheduled_at);
      if (next === null || at < next) next = at;
    }
    if (next === null) return;

    // setTimeout delays are a signed 32-bit int; clamp longer deadlines and
    // re-arm when the capped timer elapses.
    const max_delay = 2 ** 31 - 1;
    const delay = Math.min(max_delay, Math.max(0, next - now));
    const handle = setTimeout(() => {
      if (delay === max_delay) {
        set_reschedule_tick((n) => n + 1);
        return;
      }
      const fired_at = Date.now();
      const due_ids = new Set(
        reminders
          .filter(
            (r) =>
              r.status === "upcoming" && Date.parse(r.scheduled_at) <= fired_at,
          )
          .map((r) => r.id),
      );
      if (due_ids.size === 0) {
        set_reschedule_tick((n) => n + 1);
        return;
      }
      set_reminders((prev) =>
        prev.map((r) =>
          due_ids.has(r.id) ? { ...r, status: "fired" as const } : r,
        ),
      );
      for (const r of reminders) {
        if (!due_ids.has(r.id)) continue;
        const fired = { ...r, status: "fired" as const };
        for (const listener of fire_listeners.current) listener(fired);
      }
    }, delay);
    return () => clearTimeout(handle);
  }, [reminders, reschedule_tick]);

  const add = useCallback(
    (input: new_reminder): reminder_entry => {
      // Optimistic local entry returned synchronously; reconciled with the server
      // id once /reminders/set resolves.
      const local_id = next_local_id();
      const entry: reminder_entry = {
        id: local_id,
        title: input.title,
        body: input.body,
        scheduled_at: input.scheduled_at,
        when_display: input.when_display || when_display(input.scheduled_at),
        status: "upcoming",
      };
      set_reminders((prev) => [entry, ...prev]);

      void (async () => {
        try {
          const res = await fetch(`${base_url}${set_path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tenant_context_token,
              title: input.title,
              body: input.body,
              scheduled_at: input.scheduled_at,
            }),
          });
          if (!res.ok) return;
          const saved = (await res.json()) as gateway_reminder;
          set_reminders((prev) =>
            prev.map((r) => (r.id === local_id ? to_client(saved) : r)),
          );
        } catch {
          // Keep the optimistic entry; it will not persist across a reload.
        }
      })();

      return entry;
    },
    [base_url, tenant_context_token],
  );

  const dismiss = useCallback(
    (id: string) => {
      set_reminders((prev) => {
        const target = prev.find((r) => r.id === id);
        if (target && target.status !== "dismissed") {
          prior_status.current.set(id, target.status);
        }
        return prev.map((r) =>
          r.id === id ? { ...r, status: "dismissed" as const } : r,
        );
      });
      void fetch(`${base_url}${dismiss_path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tenant_context_token, reminder_id: id }),
      }).catch(() => {});
    },
    [base_url, tenant_context_token],
  );

  const restore = useCallback(
    (id: string) => {
      const back = prior_status.current.get(id) ?? "upcoming";
      prior_status.current.delete(id);
      // No un-dismiss route exists; re-create the reminder so the undo persists.
      // The local entry is updated immediately and reconciled with the new id.
      let target: reminder_entry | undefined;
      set_reminders((prev) => {
        target = prev.find((r) => r.id === id);
        return prev.map((r) => (r.id === id ? { ...r, status: back } : r));
      });
      if (!target) return;
      const restored = target;
      void (async () => {
        try {
          const res = await fetch(`${base_url}${set_path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              tenant_context_token,
              title: restored.title,
              body: restored.body,
              scheduled_at: restored.scheduled_at,
            }),
          });
          if (!res.ok) return;
          const saved = (await res.json()) as gateway_reminder;
          set_reminders((prev) =>
            prev.map((r) => (r.id === id ? to_client(saved) : r)),
          );
        } catch {
          // Keep the locally restored entry; it will not persist across a reload.
        }
      })();
    },
    [base_url, tenant_context_token],
  );

  const on_fire = useCallback(
    (listener: (entry: reminder_entry) => void): (() => void) => {
      fire_listeners.current.add(listener);
      return () => {
        fire_listeners.current.delete(listener);
      };
    },
    [],
  );

  return useMemo<reminders_client>(
    () => ({ reminders, add, refresh, dismiss, restore, on_fire }),
    [reminders, add, refresh, dismiss, restore, on_fire],
  );
}
