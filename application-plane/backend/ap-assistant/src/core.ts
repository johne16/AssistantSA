import { dispatcher } from "./dispatcher.js";
import { persona_text } from "./persona.js";
import type {
  assistant_core,
  circuit_breaker_options,
  circuit_state,
  llm_message,
  llm_path,
  llm_port,
  llm_request,
  llm_stream_event,
  llm_text_block,
  pending_confirmation,
  response_chunk,
  retry_options,
  session_store,
  tool_registry,
  tool_request_ports,
} from "./types.js";

// Affirmative replies that confirm a pending tool.
const affirmatives = new Set([
  "ok",
  "okay",
  "yes",
  "yep",
  "yeah",
  "sure",
  "affirmative",
  "go ahead",
  "do it",
  "confirm",
  "please do",
]);

// Filler utterances suppressed without a model call.
const filler = new Set(["okay", "ok", "um", "uh", "hmm", "mhm", "uh huh"]);

// FAQ/knowledge canned answers, keyed by a normalized question.
const faq: Record<string, string> = {
  "what can you do":
    "I can check collection schedules, power status, city alerts and events, your utility bill, and your service area.",
  "who are you": "I'm the AssistantSA city services assistant.",
  hello: "Hi. How can I help with city services?",
  hi: "Hi. How can I help with city services?",
  help: "Ask me about trash pickup, power status, city alerts or events, your bill, or your service area.",
};

function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/[.!?,]+$/g, "").replace(/\s+/g, " ");
}

// Reliability: which errors are transient and worth retrying.
function is_transient(err: unknown): boolean {
  const status = (err as { status?: number })?.status;
  if (status === 429) return true;
  if (typeof status === "number" && status >= 500) return true;
  const type = (err as { type?: string })?.type;
  return type === "rate_limit_error" || type === "overloaded_error" || type === "api_error";
}

class circuit_breaker {
  private state: circuit_state = "closed";
  private consecutive_failures = 0;
  private opened_at = 0;

  constructor(private opts: circuit_breaker_options) {}

  allow(): boolean {
    if (this.state === "open") {
      if (Date.now() - this.opened_at >= this.opts.recovery_window_ms) {
        this.state = "half_open";
        return true; // single probe
      }
      return false;
    }
    return true;
  }

  on_success(): void {
    this.state = "closed";
    this.consecutive_failures = 0;
  }

  on_failure(): void {
    this.consecutive_failures += 1;
    if (this.state === "half_open" || this.consecutive_failures >= this.opts.failure_threshold) {
      this.state = "open";
      this.opened_at = Date.now();
    }
  }

  is_open(): boolean {
    return this.state === "open" && Date.now() - this.opened_at < this.opts.recovery_window_ms;
  }
}

export interface core_deps {
  llm: llm_port;
  store: session_store;
  registry: tool_registry;
  ports: tool_request_ports;
  // Absent api key forces graceful degradation (non-LLM heuristic responses).
  has_api_key: boolean;
  // Max messages retained per session; older ones are dropped so history (and
  // the context sent to the LLM each turn) stays bounded.
  max_message_history?: number;
  retry?: retry_options;
  circuit?: circuit_breaker_options;
}

const default_max_message_history = 30;
const default_retry: retry_options = { max_retries: 3, base_delay_ms: 200, max_delay_ms: 4000 };
const default_circuit: circuit_breaker_options = { failure_threshold: 5, recovery_window_ms: 30000 };

class core_impl implements assistant_core {
  private dispatch: dispatcher;
  private breaker: circuit_breaker;
  private retry: retry_options;
  // Per-session pending confirmation (in process; PoC single-user).
  private pending = new Map<string, pending_confirmation>();

  constructor(private deps: core_deps) {
    this.dispatch = new dispatcher(deps.registry, deps.ports);
    this.breaker = new circuit_breaker(deps.circuit ?? default_circuit);
    this.retry = deps.retry ?? default_retry;
  }

  async *run_turn(input: {
    session_id: string;
    tenant_context_token: string;
    message: string;
    path: llm_path;
  }): AsyncIterable<response_chunk> {
    const norm = normalize(input.message);

    // Resolve a pending confirmation before anything else.
    const pending = this.pending.get(input.session_id);
    if (pending) {
      this.pending.delete(input.session_id);
      if (affirmatives.has(norm)) {
        yield* this.run_confirmed_tool(input, pending);
        return;
      }
      // Non-affirmative: drop the pending action and continue with this turn normally.
    }

    // Fast-path: suppress filler with no response and no model call.
    if (filler.has(norm)) return;

    // Fast-path: canned FAQ/knowledge.
    const canned = faq[norm];
    if (canned) {
      yield { type: "text", text: canned };
      await this.append_history(input.session_id, input.message, canned);
      return;
    }

    // Graceful degradation when the LLM is unavailable.
    if (!this.deps.has_api_key || this.breaker.is_open()) {
      const text = this.degraded_response();
      yield { type: "text", text };
      await this.append_history(input.session_id, input.message, text);
      return;
    }

    yield* this.run_llm_turn(input);
  }

  // Runs a turn through Claude, handling an optional tool selection mid-stream.
  private async *run_llm_turn(input: {
    session_id: string;
    tenant_context_token: string;
    message: string;
    path: llm_path;
  }): AsyncIterable<response_chunk> {
    const history = await this.deps.store.load(input.session_id);
    const messages: llm_message[] = [...history, { role: "user", content: input.message }];

    let assistant_text = "";
    let tool_use: { tool_name: string; input: Record<string, unknown> } | undefined;

    try {
      for await (const event of this.stream_with_reliability({
        path: input.path,
        system: this.system_blocks(),
        tools: this.deps.registry.tool_definitions(),
        messages,
      })) {
        if (event.type === "text") {
          assistant_text += event.text;
          yield { type: "text", text: event.text };
        } else {
          tool_use = { tool_name: event.tool_name, input: event.input };
        }
      }
    } catch (err) {
      if (is_transient(err)) this.breaker.on_failure();
      const text = this.degraded_response();
      yield { type: "text", text };
      await this.append_history(input.session_id, input.message, text);
      return;
    }
    this.breaker.on_success();

    if (!tool_use) {
      await this.append_history(input.session_id, input.message, assistant_text);
      return;
    }

    // Claude selected a tool. Dispatch it (enforces confirmation).
    const result = await this.dispatch.dispatch({
      tool_name: tool_use.tool_name,
      input: tool_use.input,
      tenant_context_token: input.tenant_context_token,
      confirmed: false,
    });

    if (result.kind === "confirmation_required") {
      this.pending.set(input.session_id, { tool_name: result.tool_name, input: result.input });
      yield { type: "text", text: result.message };
      await this.append_history(input.session_id, input.message, result.message);
      return;
    }

    if (result.kind === "unknown_tool") {
      const text = "I couldn't complete that request.";
      yield { type: "text", text };
      await this.append_history(input.session_id, input.message, text);
      return;
    }

    // Feed the tool result back into a grounded follow-up turn.
    yield* this.grounded_followup(input, messages, tool_use.tool_name, result.response.result);
  }

  // Second Claude turn that composes the reply from the live tool result.
  private async *grounded_followup(
    input: { session_id: string; tenant_context_token: string; message: string; path: llm_path },
    messages: llm_message[],
    tool_name: string,
    result: unknown,
  ): AsyncIterable<response_chunk> {
    // Volatile per-turn grounding goes after the cached prefix, in messages.
    const grounding: llm_message = {
      role: "user",
      content: `Tool ${tool_name} returned: ${JSON.stringify(result)}. Answer the resident from this data.`,
    };

    let text = "";
    try {
      for await (const event of this.stream_with_reliability({
        path: input.path,
        system: this.system_blocks(),
        tools: this.deps.registry.tool_definitions(),
        messages: [...messages, grounding],
      })) {
        if (event.type === "text") {
          text += event.text;
          yield { type: "text", text: event.text };
        }
      }
      this.breaker.on_success();
    } catch (err) {
      if (is_transient(err)) this.breaker.on_failure();
      text = this.degraded_response();
      yield { type: "text", text };
    }
    await this.append_history(input.session_id, input.message, text);
  }

  // Runs a confirmed pending tool directly (no second confirmation).
  private async *run_confirmed_tool(
    input: { session_id: string; tenant_context_token: string; message: string; path: llm_path },
    pending: pending_confirmation,
  ): AsyncIterable<response_chunk> {
    const result = await this.dispatch.dispatch({
      tool_name: pending.tool_name,
      input: pending.input,
      tenant_context_token: input.tenant_context_token,
      confirmed: true,
    });

    if (result.kind !== "tool_response") {
      const text = "I couldn't complete that request.";
      yield { type: "text", text };
      await this.append_history(input.session_id, input.message, text);
      return;
    }

    const history = await this.deps.store.load(input.session_id);
    yield* this.grounded_followup(
      input,
      [...history, { role: "user", content: input.message }],
      pending.tool_name,
      result.response.result,
    );
  }

  // Stable system prefix (persona + tool defs implicitly via request.tools) marked cacheable.
  private system_blocks(): llm_text_block[] {
    return [{ type: "text", text: persona_text, cache_control: { type: "ephemeral" } }];
  }

  // Retry-with-backoff + jitter for transient errors only, behind the circuit breaker.
  private async *stream_with_reliability(request: llm_request): AsyncIterable<llm_stream_event> {
    if (!this.breaker.allow()) throw { type: "circuit_open" };

    let attempt = 0;
    for (;;) {
      try {
        // Stream is consumed lazily; the first token settles success/failure for retry purposes.
        yield* this.deps.llm.stream(request);
        return;
      } catch (err) {
        if (!is_transient(err) || attempt >= this.retry.max_retries) throw err;
        const delay = Math.min(
          this.retry.max_delay_ms,
          this.retry.base_delay_ms * 2 ** attempt,
        );
        const jitter = Math.random() * delay;
        await new Promise((r) => setTimeout(r, delay / 2 + jitter / 2));
        attempt += 1;
      }
    }
  }

  private degraded_response(): string {
    return "I'm having trouble reaching the assistant right now. Please try again in a moment.";
  }

  private async append_history(session_id: string, user_message: string, assistant_text: string): Promise<void> {
    const history = await this.deps.store.load(session_id);
    history.push({ role: "user", content: user_message });
    if (assistant_text) history.push({ role: "assistant", content: assistant_text });
    // Keep only the most recent N messages so stored history and per-turn LLM
    // context stay bounded over a long-running conversation.
    const max = this.deps.max_message_history ?? default_max_message_history;
    const trimmed = history.length > max ? history.slice(history.length - max) : history;
    await this.deps.store.save(session_id, trimmed);
  }
}

export function create_assistant_core(deps: core_deps): assistant_core {
  return new core_impl(deps);
}
