import { app_config } from "@/app-config";
import type {
  alert_dismiss_action,
  civic_api_request,
  civic_dismiss_api_request,
  civic_read_response,
  civic_view_request,
} from "./types";

// Gateway client. The module reaches the backend exclusively here: it maps a
// portal civic_view_request onto the ap-civic gateway request and POSTs it to
// the API gateway. The signed tenant_context_token is forwarded, never bare
// claims.

// Map the portal request and session token onto the gateway request body.
function to_civic_api_request(
  tenant_context_token: string,
  req: civic_view_request,
): civic_api_request {
  return {
    tenant_context_token,
    operation: req.resource,
    params: req.params,
  };
}

// POST the civic read to the gateway and return the typed response.
export async function civic_api_request(
  tenant_context_token: string,
  req: civic_view_request,
): Promise<civic_read_response> {
  const body = to_civic_api_request(tenant_context_token, req);
  const res = await fetch(`${app_config.api_gateway_base_url}/civic`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`civic gateway request failed: ${res.status}`);
  }
  return (await res.json()) as civic_read_response;
}

// POST a per-resident alert dismiss/restore to the gateway. Returns once the
// dismissal is persisted (204 No Content); throws on a non-ok status.
export async function civic_dismiss_request(
  tenant_context_token: string,
  action: alert_dismiss_action,
  entry_id: string,
): Promise<void> {
  const body: civic_dismiss_api_request = {
    tenant_context_token,
    action,
    entry_id,
  };
  const res = await fetch(`${app_config.api_gateway_base_url}/civic/dismiss`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`civic dismiss request failed: ${res.status}`);
  }
}
