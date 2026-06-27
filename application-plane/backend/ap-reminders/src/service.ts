// ap-reminders service: stored reminder writes/reads and scheduled evaluation
// that fires due reminders through the notifier.

import type {
  notify_request,
  reminder_entry,
  reminders_service_deps,
  set_reminder_params,
  tenant_context_token,
} from "./types.js";

export interface reminders_service {
  set_reminder(
    token: tenant_context_token,
    params: set_reminder_params,
  ): Promise<reminder_entry>;
  list_reminders(token: tenant_context_token): Promise<reminder_entry[]>;
  dismiss_reminder(token: tenant_context_token, reminder_id: string): Promise<void>;
  run_reminder_evaluation(): Promise<void>;
}

export function create_reminders_service(
  deps: reminders_service_deps,
): reminders_service {
  const { store, notifier, clock, id_source } = deps;

  async function set_reminder(
    token: tenant_context_token,
    params: set_reminder_params,
  ): Promise<reminder_entry> {
    const entry: reminder_entry = {
      reminder_id: id_source.next(),
      scheduled_at: params.scheduled_at,
      title: params.title,
      body: params.body,
      status: "upcoming",
      delivered_at: null,
    };
    await store.create_reminder(token.city_tenant_id, token.sub, entry);
    return entry;
  }

  async function list_reminders(
    token: tenant_context_token,
  ): Promise<reminder_entry[]> {
    return store.list_reminders(token.city_tenant_id, token.sub);
  }

  async function dismiss_reminder(
    token: tenant_context_token,
    reminder_id: string,
  ): Promise<void> {
    await store.set_status(
      token.city_tenant_id,
      token.sub,
      reminder_id,
      "dismissed",
      null,
    );
  }

  // Scheduler path: flip every upcoming reminder whose scheduled_at has passed to
  // fired, stamp delivered_at, and deliver it through the notifier.
  async function run_reminder_evaluation(): Promise<void> {
    const now = clock.now();
    const now_iso = now.toISOString();
    const tenants = await store.list_tenants();
    for (const tid of tenants) {
      const due = await store.list_due(tid, now_iso);
      for (const { sub, entry } of due) {
        await store.set_status(tid, sub, entry.reminder_id, "fired", now_iso);
        const token = synth_token(tid, sub, now);
        const request: notify_request = {
          type: "reminder",
          notification: {
            title: entry.title,
            body: entry.body,
            reminder_id: entry.reminder_id,
            scheduled_at: entry.scheduled_at,
          },
        };
        await notifier.notify(token, request);
      }
    }
  }

  // Scheduler paths have no incoming token; reconstruct claims for the notifier,
  // which requires a tenant_context_token shape. iat/exp are informational here.
  function synth_token(
    city_tenant_id: string,
    sub: string,
    now: Date,
  ): tenant_context_token {
    const iat = Math.floor(now.getTime() / 1000);
    return { sub, city_tenant_id, iat, exp: iat };
  }

  return { set_reminder, list_reminders, dismiss_reminder, run_reminder_evaluation };
}
