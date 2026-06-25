// ap-notifications request handler. Resolves claims from the token, then
// delegates to the service. The verifier and decoder are injected; no jose
// import lives here.

import type {
  claims_decoder,
  notification,
  notification_preferences,
  notification_type,
  notify_request,
  pending_delivery,
  poll_request,
  registration_request,
  token_verifier,
} from "./types.js";
import {
  create_notifications_service,
  type notifications_service_deps,
} from "./service.js";

export interface notifications_handler {
  // Gateway registration path. Token validated at the gateway edge; claims are
  // decoded here to obtain sub + city_tenant_id.
  register(request: registration_request): Promise<void>;
  // Source-module invocation path. The RS256 signature is verified before the
  // claims are trusted.
  notify(request: notify_request): Promise<void>;
  // Scheduled (server-side) invocation paths. No incoming request token; the
  // recipient scope is supplied directly. notify_scheduled targets one resident;
  // notify_city fans out to every registered resident in the city.
  notify_scheduled(
    city_tenant_id: string,
    sub: string,
    type: notification_type,
    notification: notification,
  ): Promise<void>;
  notify_city(
    city_tenant_id: string,
    type: notification_type,
    notification: notification,
  ): Promise<void>;
  // Gateway poll path. Token validated at the gateway edge; claims are decoded
  // here. Returns and clears the resident's pending notifications.
  poll(request: poll_request): Promise<pending_delivery[]>;
  // Gateway read path. Returns the resident's stored opt-ins, or null.
  get_preferences(request: poll_request): Promise<notification_preferences | null>;
}

export interface notifications_handler_deps extends notifications_service_deps {
  token_verifier: token_verifier;
  claims_decoder: claims_decoder;
}

export function create_notifications_handler(
  deps: notifications_handler_deps,
): notifications_handler {
  const { token_verifier, claims_decoder } = deps;
  const service = create_notifications_service(deps);

  // Log any error to the console with the module tag, then rethrow so callers
  // still see it.
  function with_logging<T>(op: string, fn: () => Promise<T>): Promise<T> {
    return fn().catch((err) => {
      console.error(`[ap-notifications] ${op} failed:`, err);
      throw err;
    });
  }

  return {
    async register(request) {
      await with_logging("register", async () => {
        const { sub, city_tenant_id } = claims_decoder.decode(
          request.tenant_context_token,
        );
        await service.reminderRegistration(
          city_tenant_id,
          sub,
          request.notification_preferences,
        );
      });
    },

    async notify(request) {
      await with_logging("notify", async () => {
        const { sub, city_tenant_id } = await token_verifier.verify(
          request.tenant_context_token,
        );
        await service.notifyRequest(
          city_tenant_id,
          sub,
          request.type,
          request.notification,
        );
      });
    },

    async notify_scheduled(city_tenant_id, sub, type, notification) {
      await with_logging("notify_scheduled", async () => {
        await service.notifyRequest(city_tenant_id, sub, type, notification);
      });
    },

    async notify_city(city_tenant_id, type, notification) {
      await with_logging("notify_city", async () => {
        await service.notifyCity(city_tenant_id, type, notification);
      });
    },

    async poll(request) {
      return with_logging("poll", async () => {
        const { sub, city_tenant_id } = claims_decoder.decode(
          request.tenant_context_token,
        );
        return service.pollPending(city_tenant_id, sub);
      });
    },

    async get_preferences(request) {
      return with_logging("get_preferences", async () => {
        const { sub, city_tenant_id } = claims_decoder.decode(
          request.tenant_context_token,
        );
        return service.getPreferences(city_tenant_id, sub);
      });
    },
  };
}
