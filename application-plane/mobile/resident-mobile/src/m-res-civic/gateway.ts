import { app_config } from "@/app-config";
import type {
  civic_api_request,
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
