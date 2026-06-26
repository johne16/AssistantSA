// Anthropic adapter implementing ap-assistant's llm_port. Streams text tokens
// token-by-token and surfaces a final tool_use selection. Model and max_tokens
// are picked by llm_request.path from the injected config. cache_control on
// system blocks is passed through unchanged.

import Anthropic from "@anthropic-ai/sdk";

import type {
  llm_path,
  llm_port,
  llm_request,
  llm_stream_event,
} from "ap-assistant";

import type { anthropic_llm_config } from "../types.js";

// Path -> model + max_tokens, from config. Voice favors the low-latency model.
function model_for(
  path: llm_path,
  config: anthropic_llm_config,
): { model: string; max_tokens: number } {
  return path === "voice"
    ? { model: config.claude_voice_model, max_tokens: config.claude_voice_max_tokens }
    : { model: config.claude_chat_model, max_tokens: config.claude_chat_max_tokens };
}

export function create_anthropic_llm(
  api_key: string,
  config: anthropic_llm_config,
): llm_port {
  const client = new Anthropic({ apiKey: api_key });

  return {
    async *stream(request: llm_request): AsyncIterable<llm_stream_event> {
      const { model, max_tokens } = model_for(request.path, config);

      const stream = client.messages.stream({
        model,
        max_tokens,
        // system blocks carry cache_control ephemeral markers verbatim.
        system: request.system.map((b) => ({
          type: "text" as const,
          text: b.text,
          ...(b.cache_control ? { cache_control: b.cache_control } : {}),
        })),
        tools: request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          input_schema: t.input_schema as Anthropic.Tool.InputSchema,
        })),
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      });

      // Track tool_use blocks assembled across input_json deltas.
      const tool_blocks = new Map<number, { name: string; json: string }>();

      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          tool_blocks.set(event.index, { name: event.content_block.name, json: "" });
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            yield { type: "text", text: event.delta.text };
          } else if (event.delta.type === "input_json_delta") {
            const tb = tool_blocks.get(event.index);
            if (tb) tb.json += event.delta.partial_json;
          }
        }
      }

      // Emit the first assembled tool_use, if any, after the text stream ends.
      for (const tb of tool_blocks.values()) {
        let input: Record<string, unknown> = {};
        try {
          input = tb.json ? (JSON.parse(tb.json) as Record<string, unknown>) : {};
        } catch (err) {
          console.error(`[ap-server] anthropic tool_use input JSON parse failed for ${tb.name}:`, err);
          input = {};
        }
        yield { type: "tool_use", tool_name: tb.name, input };
        return;
      }
    },
  };
}
