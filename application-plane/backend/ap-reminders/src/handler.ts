// ap-reminders handler: maps gateway, assistant, and scheduler inputs to the service.

import { create_reminders_service } from "./service.js";
import type {
  agent_request,
  reminder_entry,
  reminders_handler_deps,
  set_reminder_params,
  tenant_claims,
  tenant_context_token,
} from "./types.js";

export interface reminders_handler {
  // Gateway: token already validated by the gateway; claims supplied by ap-server.
  set_reminder(
    params: set_reminder_params,
    claims: tenant_claims,
  ): Promise<reminder_entry>;
  list_reminders(claims: tenant_claims): Promise<reminder_entry[]>;
  dismiss_reminder(reminder_id: string, claims: tenant_claims): Promise<void>;
  // Assistant: RS256-verify the forwarded token, never bare claims.
  agent_request(request: agent_request): Promise<reminder_entry>;
  // Scheduler.
  run_reminder_evaluation(): Promise<void>;
}

export function create_reminders_handler(
  deps: reminders_handler_deps,
): reminders_handler {
  const service = create_reminders_service(deps);
  const { token_verifier } = deps;

  // Log any error to the console with the module tag, then rethrow so callers
  // still see it.
  function with_logging<T>(op: string, fn: () => Promise<T>): Promise<T> {
    return fn().catch((err) => {
      console.error(`[ap-reminders] ${op} failed:`, err);
      throw err;
    });
  }

  // Build a token shape from gateway-validated claims for service scoping.
  function token_from_claims(claims: tenant_claims): tenant_context_token {
    return { sub: claims.sub, city_tenant_id: claims.city_tenant_id, iat: 0, exp: 0 };
  }

  async function set_reminder(
    params: set_reminder_params,
    claims: tenant_claims,
  ): Promise<reminder_entry> {
    return with_logging("set_reminder", () =>
      service.set_reminder(token_from_claims(claims), params),
    );
  }

  async function list_reminders(claims: tenant_claims): Promise<reminder_entry[]> {
    return with_logging("list_reminders", () =>
      service.list_reminders(token_from_claims(claims)),
    );
  }

  async function dismiss_reminder(
    reminder_id: string,
    claims: tenant_claims,
  ): Promise<void> {
    await with_logging("dismiss_reminder", () =>
      service.dismiss_reminder(token_from_claims(claims), reminder_id),
    );
  }

  async function agent_request(request: agent_request): Promise<reminder_entry> {
    return with_logging("agent_request", async () => {
      // Local RS256 signature verification; rejects on bad signature or expiry.
      const token = await token_verifier.verify(request.tenant_context_token);
      return service.set_reminder(token, request.params);
    });
  }

  async function run_reminder_evaluation(): Promise<void> {
    await with_logging("run_reminder_evaluation", () =>
      service.run_reminder_evaluation(),
    );
  }

  return {
    set_reminder,
    list_reminders,
    dismiss_reminder,
    agent_request,
    run_reminder_evaluation,
  };
}
