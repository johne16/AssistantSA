// tool_request_ports for ap-assistant. Each port maps the assistant's
// tool_request { tenant_context_token, operation, params } onto the downstream
// module's agent_request, translating the seed-tool operation name to the
// module's resource enum and the tool input to the module params.

import type { tool_request, tool_request_port, tool_response, tool_request_ports } from "ap-assistant";
import type { civic_handler, civic_resource, my_area_kind } from "ap-civic";
import type { utility_handler } from "ap-utility";
import type { utility_resource } from "ap-utility";

// Seed-tool operation -> civic_resource.
const civic_op_to_resource: Record<string, civic_resource> = {
  check_collection_schedule: "collection_schedule",
  check_city_alerts: "alerts",
  check_city_events: "events",
  find_my_area: "my_area",
};

// Seed-tool operation -> utility_resource.
const utility_op_to_resource: Record<string, utility_resource> = {
  check_power_status: "outage",
  read_utility_bill: "bills",
};

function as_string(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export function create_civic_tool_port(handler: civic_handler): tool_request_port {
  return {
    async send(request: tool_request): Promise<tool_response> {
      const resource = civic_op_to_resource[request.operation];
      if (!resource) {
        return { operation: request.operation, result: { error: "unknown_operation" } };
      }
      const address = as_string(request.params["address"]);
      const kind = as_string(request.params["kind"]) as my_area_kind | undefined;
      const params = {
        ...(address !== undefined ? { address } : {}),
        ...(kind !== undefined ? { kind } : {}),
      };
      const response = await handler.agent_request({
        tenant_context_token: request.tenant_context_token,
        operation: resource,
        params,
      });
      return { operation: request.operation, result: response };
    },
  };
}

export function create_utility_tool_port(handler: utility_handler): tool_request_port {
  return {
    async send(request: tool_request): Promise<tool_response> {
      const resource = utility_op_to_resource[request.operation];
      if (!resource) {
        return { operation: request.operation, result: { error: "unknown_operation" } };
      }
      const account_ref =
        as_string(request.params["account_id"]) ?? as_string(request.params["account_ref"]);
      const response = await handler.agent_request({
        tenant_context_token: request.tenant_context_token,
        operation: resource,
        params: account_ref !== undefined ? { account_ref } : {},
      });
      return { operation: request.operation, result: response };
    },
  };
}

export function create_tool_request_ports(
  civic: civic_handler,
  utility: utility_handler,
): tool_request_ports {
  return {
    "ap-civic": create_civic_tool_port(civic),
    "ap-utility": create_utility_tool_port(utility),
  };
}
