// tool_request_ports for ap-assistant. Each port maps the assistant's
// tool_request { tenant_context_token, operation, params } onto the downstream
// module's agent_request, translating the seed-tool operation name to the
// module's resource enum and the tool input to the module params.

import type { tool_request, tool_request_port, tool_response, tool_request_ports } from "ap-assistant";
import type { civic_handler, civic_resource, my_area_kind } from "ap-civic";
import type { utility_handler } from "ap-utility";
import type { utility_resource } from "ap-utility";
import type { reminders_handler } from "ap-reminders";

// Seed-tool operation -> civic_resource.
const civic_op_to_resource: Record<string, civic_resource> = {
  check_collection_schedule: "collection_schedule",
  check_city_alerts: "alerts",
  check_city_events: "events",
  my_area: "my_area",
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
      const kind = as_string(request.params["kind"]) as my_area_kind | undefined;
      const params = {
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
      const site_id = as_string(request.params["site_id"]);
      const response = await handler.agent_request({
        tenant_context_token: request.tenant_context_token,
        operation: resource,
        params: site_id !== undefined ? { site_id } : {},
      });
      return { operation: request.operation, result: response };
    },
  };
}

// The assistant reminders tools map onto ap-reminders' agent paths: set_reminder
// writes a reminder, list_reminders returns the resident's upcoming reminders.
export function create_reminders_tool_port(handler: reminders_handler): tool_request_port {
  return {
    async send(request: tool_request): Promise<tool_response> {
      if (request.operation === "list_reminders") {
        const entries = await handler.agent_list_reminders({
          tenant_context_token: request.tenant_context_token,
          operation: "list_reminders",
        });
        // Only upcoming reminders, soonest first, so the assistant reports what
        // is still ahead rather than fired or dismissed ones.
        const upcoming = entries
          .filter((e) => e.status === "upcoming")
          .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at));
        return { operation: request.operation, result: upcoming };
      }
      const title = as_string(request.params["title"]) ?? "";
      const body = as_string(request.params["body"]) ?? "";
      const scheduled_at = as_string(request.params["scheduled_at"]);
      if (!scheduled_at) {
        return { operation: request.operation, result: { error: "missing_scheduled_at" } };
      }
      const entry = await handler.agent_request({
        tenant_context_token: request.tenant_context_token,
        operation: "set_reminder",
        params: { title, body, scheduled_at },
      });
      return { operation: request.operation, result: entry };
    },
  };
}

export function create_tool_request_ports(
  civic: civic_handler,
  utility: utility_handler,
  reminders: reminders_handler,
): tool_request_ports {
  return {
    "ap-civic": create_civic_tool_port(civic),
    "ap-utility": create_utility_tool_port(utility),
    "ap-reminders": create_reminders_tool_port(reminders),
  };
}
