import type {
  task_tool,
  tool_registry,
  tool_request_ports,
  tool_response,
} from "./types.js";

// Result of a dispatch attempt.
export type dispatch_result =
  // Confirmation required: do not run the handler. The string is streamed as a normal message.
  | { kind: "confirmation_required"; message: string; tool_name: string; input: Record<string, unknown> }
  // Handler ran; grounding result to feed back into the LLM turn.
  | { kind: "tool_response"; response: tool_response }
  // Unknown tool name from the LLM.
  | { kind: "unknown_tool"; tool_name: string };

// Executes the handler for the selected tool and enforces requires_confirmation.
export class dispatcher {
  constructor(
    private registry: tool_registry,
    private ports: tool_request_ports,
  ) {}

  async dispatch(input: {
    tool_name: string;
    input: Record<string, unknown>;
    tenant_context_token: string;
    // When true, a confirmation-gated tool is allowed to run (resident already confirmed).
    confirmed: boolean;
  }): Promise<dispatch_result> {
    const tool = this.registry.get(input.tool_name);
    if (!tool) return { kind: "unknown_tool", tool_name: input.tool_name };

    if (tool.requires_confirmation && !input.confirmed) {
      return {
        kind: "confirmation_required",
        tool_name: tool.tool_definition.name,
        input: input.input,
        message: "This agent action requires explicit confirmation to continue.",
      };
    }

    const response = await this.run_handler(tool, input.input, input.tenant_context_token);
    return { kind: "tool_response", response };
  }

  // The handler: invokes the downstream application service via its injected port.
  // A downstream failure (missing/invalid input, unreachable data) is returned as
  // an error result so the model can recover in-turn, rather than thrown to crash
  // the whole turn.
  private async run_handler(
    tool: task_tool,
    params: Record<string, unknown>,
    tenant_context_token: string,
  ): Promise<tool_response> {
    const port = this.ports[tool.downstream];
    try {
      return await port.send({
        tenant_context_token,
        operation: tool.operation,
        params,
      });
    } catch (err) {
      console.error(`[ap-assistant] tool ${tool.operation} (${tool.downstream}) failed:`, err);
      return {
        operation: tool.operation,
        result: { error: err instanceof Error ? err.message : "tool_failed" },
      };
    }
  }
}
