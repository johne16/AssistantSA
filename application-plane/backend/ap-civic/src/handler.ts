// ap-civic handler. Thin surface ap-server wires to its transports:
// the api_gateway path (gateway-validated token), the ap-assistant invocation
// path (this module RS256-verifies the token), and the scheduler trigger.

import { create_civic_service } from "./service.js";
import type {
  agent_request,
  civic_deps,
  civic_handler,
  civic_read_params,
  civic_read_response,
  civic_resource,
  civic_service,
  fetch_source,
  tenant_context_token,
} from "./types.js";

export function create_civic_handler(deps: civic_deps): civic_handler {
  const service: civic_service = create_civic_service(deps);

  // Log any error to the console with the module tag, then rethrow so callers
  // still see it.
  function with_logging<T>(op: string, fn: () => Promise<T>): Promise<T> {
    return fn().catch((err) => {
      console.error(`[ap-civic] ${op} failed:`, err);
      throw err;
    });
  }

  // Gateway path. The API gateway has already validated the token, so claims
  // are trusted here.
  async function civic_read(
    resource: civic_resource,
    params: civic_read_params,
    claims: tenant_context_token,
  ): Promise<civic_read_response> {
    return with_logging("civic_read", () => service.read({ resource, params, claims }));
  }

  // ap-assistant invocation path. The signed token is forwarded, never bare
  // claims; verify the RS256 signature before trusting it.
  async function agent_request(
    request: agent_request,
  ): Promise<civic_read_response> {
    return with_logging("agent_request", async () => {
      const claims = await deps.token_verifier.verify(request.tenant_context_token);
      return service.read({
        resource: request.operation,
        params: request.params,
        claims,
      });
    });
  }

  async function run_scheduled_fetch(source: fetch_source): Promise<void> {
    return with_logging("run_scheduled_fetch", () =>
      service.run_scheduled_fetch(source),
    );
  }

  return { civic_read, agent_request, run_scheduled_fetch };
}
