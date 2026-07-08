// ap-notifications core logic. Operates only on injected ports; no SDK or
// driver imports live here.

import type {
  notification,
  notification_preferences,
  notification_registration_record,
  notification_type,
  notifications_store,
  pending_delivery,
  pending_notifications_store,
} from "./types.js";

// Maps each notification_type to the opt-in flag that gates its delivery. null
// means the type is always delivered (no opt-in): a reminder the resident set
// themselves cannot be turned off.
const opt_in_flag_by_type: Record<
  notification_type,
  keyof notification_preferences | null
> = {
  power_outage: "utility_alert_enabled",
  emergency_alert: "city_alert_enabled",
  bill_due: "bills_reminder_enabled",
  reminder: null,
};

export interface notifications_service {
  // Registers or refreshes the per-type opt-ins for a resident.
  reminderRegistration(
    city_tenant_id: string,
    sub: string,
    notification_preferences: notification_preferences,
  ): Promise<void>;
  // Filters by stored opt-in for the type and queues only if opted in.
  notifyRequest(
    city_tenant_id: string,
    sub: string,
    type: notification_type,
    notification: notification,
  ): Promise<void>;
  // Fans a city-wide notification out to every registered resident, applying the
  // same per-type opt-in gate per resident. For scheduled paths with no recipient.
  notifyCity(
    city_tenant_id: string,
    type: notification_type,
    notification: notification,
  ): Promise<void>;
  // Drains and returns the resident's pending notifications.
  pollPending(
    city_tenant_id: string,
    sub: string,
  ): Promise<pending_delivery[]>;
  // Returns the resident's stored opt-ins, or null if never registered.
  getPreferences(
    city_tenant_id: string,
    sub: string,
  ): Promise<notification_preferences | null>;
}

export interface notifications_service_deps {
  notifications_store: notifications_store;
  pending_notifications_store: pending_notifications_store;
}

export function create_notifications_service(
  deps: notifications_service_deps,
): notifications_service {
  const { notifications_store, pending_notifications_store } = deps;

  return {
    async reminderRegistration(
      city_tenant_id,
      sub,
      notification_preferences,
    ) {
      const record: notification_registration_record = {
        sub,
        notification_preferences,
      };
      await notifications_store.upsert_registration(city_tenant_id, record);
    },

    async notifyRequest(city_tenant_id, sub, type, notification) {
      const flag = opt_in_flag_by_type[type];
      // Gated types deliver only when the resident registered and opted in.
      // Always-on types (flag null, e.g. a reminder they set) deliver regardless.
      if (flag !== null) {
        const record = await notifications_store.get_registration(
          city_tenant_id,
          sub,
        );
        if (record === null || !record.notification_preferences[flag]) {
          return;
        }
      }
      await pending_notifications_store.enqueue(city_tenant_id, sub, {
        type,
        notification,
      });
    },

    async notifyCity(city_tenant_id, type, notification) {
      const records = await notifications_store.list_registrations(city_tenant_id);
      const flag = opt_in_flag_by_type[type];
      for (const record of records) {
        if (flag !== null && !record.notification_preferences[flag]) {
          continue;
        }
        await pending_notifications_store.enqueue(city_tenant_id, record.sub, {
          type,
          notification,
        });
      }
    },

    async pollPending(city_tenant_id, sub) {
      return pending_notifications_store.drain(city_tenant_id, sub);
    },

    async getPreferences(city_tenant_id, sub) {
      const record = await notifications_store.get_registration(
        city_tenant_id,
        sub,
      );
      return record === null ? null : record.notification_preferences;
    },
  };
}
