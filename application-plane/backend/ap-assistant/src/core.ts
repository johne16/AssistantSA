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
  reminder_chunk,
  response_chunk,
  source_chunk,
  source_failure_chunk,
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

const month_abbr = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Human label for a reminder's scheduled instant, e.g. "Jul 7 · 9:00 AM".
// Read from the ISO string's own wall-clock fields so the displayed time matches
// what was scheduled regardless of the server's timezone (offset-agnostic).
function reminder_when_display(scheduled_at: string): string {
  const m = scheduled_at.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return scheduled_at;
  const month = month_abbr[Number(m[2]) - 1] ?? m[2];
  const day = Number(m[3]);
  let hour = Number(m[4]);
  const meridiem = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${month} ${day} · ${hour}:${m[5]} ${meridiem}`;
}

// Date + time label, e.g. "Jul 5 · 9:12 AM", read from an ISO string's own
// fields so the resident can judge staleness themselves.
function record_display(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return "";
  const month = month_abbr[Number(m[2]) - 1] ?? m[2];
  const day = Number(m[3]);
  let hour = Number(m[4]);
  const meridiem = hour >= 12 ? "PM" : "AM";
  hour = hour % 12 || 12;
  return `${month} ${day} · ${hour}:${m[5]} ${meridiem}`;
}

// The record timestamp on one result item: when it was stored (recorded_at),
// fetched (fetched_at, civic lists), or resolved (resolved_at, my_area/rep).
function record_timestamp_of(item: unknown): string {
  const o = item as {
    recorded_at?: unknown;
    fetched_at?: unknown;
    resolved_at?: unknown;
  };
  const v = o.recorded_at ?? o.fetched_at ?? o.resolved_at;
  return typeof v === "string" ? v : "";
}

// Record-time label for a data tool result: the freshest record timestamp among
// the returned records (which may be an array or a single object). Empty when no
// timestamp is present; the caller then omits the synced label.
function synced_at_display(result: unknown): string {
  const items = Array.isArray(result)
    ? result
    : result && typeof result === "object"
      ? [result]
      : [];
  let best = "";
  for (const item of items) {
    const ts = record_timestamp_of(item);
    if (ts && ts > best) best = ts;
  }
  return best ? record_display(best) : "";
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
  private probe_in_flight = false;

  constructor(private opts: circuit_breaker_options) {}

  allow(): boolean {
    if (this.state === "open") {
      if (Date.now() - this.opened_at >= this.opts.recovery_window_ms) {
        this.state = "half_open";
        this.probe_in_flight = true;
        return true; // single probe
      }
      return false;
    }
    if (this.state === "half_open") {
      if (this.probe_in_flight) return false;
      this.probe_in_flight = true;
      return true;
    }
    return true;
  }

  on_success(): void {
    this.state = "closed";
    this.consecutive_failures = 0;
    this.probe_in_flight = false;
  }

  on_failure(): void {
    this.consecutive_failures += 1;
    this.probe_in_flight = false;
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
// Max chained tool-selection follow-up turns within one resident turn.
const max_tool_hops = 3;

// Joins pieces of assistant output shown to the resident within one turn.
function join_shown(...pieces: string[]): string {
  return pieces.filter(Boolean).join("\n");
}

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
      if (affirmatives.has(norm)) {
        this.pending.delete(input.session_id);
        yield* this.run_confirmed_tool(input, pending);
        return;
      }
      // Filler while a confirmation is pending: keep it pending for the real answer.
      if (filler.has(norm)) return;
      // Non-affirmative: drop the pending action and continue with this turn normally.
      this.pending.delete(input.session_id);
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
    const tool_uses: { tool_name: string; input: Record<string, unknown> }[] = [];

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
          tool_uses.push({ tool_name: event.tool_name, input: event.input });
        }
      }
    } catch (err) {
      if (is_transient(err)) this.breaker.on_failure();
      const degraded = this.degraded_response();
      yield { type: "text", text: degraded };
      // History records what the resident actually saw: any partial text plus
      // the degraded message.
      await this.append_history(
        input.session_id,
        input.message,
        assistant_text ? `${assistant_text}\n${degraded}` : degraded,
      );
      return;
    }
    this.breaker.on_success();

    if (tool_uses.length === 0) {
      await this.append_history(input.session_id, input.message, assistant_text);
      return;
    }

    // Claude selected one or more tools. Dispatch each (enforces confirmation).
    const results = yield* this.dispatch_tools(input, tool_uses);
    if (!results) return;

    // Feed the tool results back into a grounded follow-up turn.
    yield* this.grounded_followup(input, messages, results, 0, assistant_text);
  }

  // Dispatches each selected tool in order, emitting confirmation, reminder, and
  // provenance chunks. Returns the tool results to ground the follow-up on, or
  // undefined when the turn ended here (confirmation pending or unknown tool).
  private async *dispatch_tools(
    input: { session_id: string; tenant_context_token: string; message: string; path: llm_path },
    tool_uses: { tool_name: string; input: Record<string, unknown> }[],
  ): AsyncGenerator<response_chunk, { tool_name: string; result: unknown }[] | undefined> {
    const results: { tool_name: string; result: unknown }[] = [];
    for (const tool_use of tool_uses) {
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
        return undefined;
      }

      if (result.kind === "unknown_tool") {
        const text = "I couldn't complete that request.";
        yield { type: "text", text };
        await this.append_history(input.session_id, input.message, text);
        return undefined;
      }

      // A set-reminder tool emits a structured reminder chunk so the caller can
      // record the reminder and render a confirmation chip, ahead of the spoken
      // confirmation text.
      const reminder = this.reminder_chunk_of(tool_use.tool_name, result.response.result);
      if (reminder) yield reminder;

      // Provenance: a data-source tool emits either a source line (success) or a
      // source-failure signal (the source could not be reached), so the caller can
      // attribute the reply or render a retry/re-link bubble.
      const provenance = this.provenance_of(tool_use.tool_name, result.response.result);
      if (provenance) yield provenance;

      results.push({ tool_name: tool_use.tool_name, result: result.response.result });
    }
    return results;
  }

  // Build a provenance signal from a data-source tool result. Returns a source
  // line on success, a source-failure signal when the result carries an error,
  // or undefined for non-data tools (e.g. reminders).
  private provenance_of(
    tool_name: string,
    result: unknown,
  ): source_chunk | source_failure_chunk | undefined {
    const tool = this.deps.registry.get(tool_name);
    if (!tool) return undefined;
    const source = tool.source_label;
    if (!source) return undefined;
    const r = result as { error?: unknown } | null;
    if (r && typeof r.error === "string") {
      return {
        type: "source_failure",
        source,
        reason: r.error,
        action: tool.downstream === "ap-utility" ? "relink" : "retry",
      };
    }
    return { type: "source", source, synced_at: synced_at_display(result) };
  }

  // Build a reminder chunk from a set-reminder tool result, or undefined when the
  // tool was not a reminders tool or the result is not a reminder shape.
  private reminder_chunk_of(
    tool_name: string,
    result: unknown,
  ): reminder_chunk | undefined {
    const tool = this.deps.registry.get(tool_name);
    if (!tool || tool.downstream !== "ap-reminders") return undefined;
    const r = result as {
      title?: unknown;
      body?: unknown;
      scheduled_at?: unknown;
    } | null;
    if (!r || typeof r.scheduled_at !== "string") return undefined;
    return {
      type: "reminder",
      title: typeof r.title === "string" ? r.title : "",
      body: typeof r.body === "string" ? r.body : "",
      when: reminder_when_display(r.scheduled_at),
      scheduled_at: r.scheduled_at,
    };
  }

  // Second Claude turn that composes the reply from the live tool results.
  // Claude may select further tools instead of answering; those are dispatched
  // and chained into another follow-up, bounded by max_tool_hops. shown_text
  // carries text already streamed to the resident earlier in the turn so the
  // stored history matches what was shown.
  private async *grounded_followup(
    input: { session_id: string; tenant_context_token: string; message: string; path: llm_path },
    messages: llm_message[],
    results: { tool_name: string; result: unknown }[],
    hops: number,
    shown_text: string,
  ): AsyncIterable<response_chunk> {
    // Volatile per-turn grounding goes after the cached prefix, in messages.
    const grounding: llm_message = {
      role: "user",
      content:
        results
          .map((r) => `Tool ${r.tool_name} returned: ${JSON.stringify(r.result)}.`)
          .join(" ") + " Answer the resident from this data.",
    };
    const followup_messages = [...messages, grounding];

    let text = "";
    const tool_uses: { tool_name: string; input: Record<string, unknown> }[] = [];
    try {
      for await (const event of this.stream_with_reliability({
        path: input.path,
        system: this.system_blocks(),
        tools: this.deps.registry.tool_definitions(),
        messages: followup_messages,
      })) {
        if (event.type === "text") {
          text += event.text;
          yield { type: "text", text: event.text };
        } else {
          tool_uses.push({ tool_name: event.tool_name, input: event.input });
        }
      }
      this.breaker.on_success();
    } catch (err) {
      if (is_transient(err)) this.breaker.on_failure();
      const degraded = this.degraded_response();
      yield { type: "text", text: degraded };
      await this.append_history(input.session_id, input.message, join_shown(shown_text, text, degraded));
      return;
    }

    if (tool_uses.length > 0 && hops + 1 < max_tool_hops) {
      const next = yield* this.dispatch_tools(input, tool_uses);
      if (!next) return;
      yield* this.grounded_followup(input, followup_messages, next, hops + 1, join_shown(shown_text, text));
      return;
    }

    if (!text && tool_uses.length > 0) {
      // Hop budget exhausted with no answer text.
      text = "I couldn't complete that request.";
      yield { type: "text", text };
    }
    await this.append_history(input.session_id, input.message, join_shown(shown_text, text));
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
      [{ tool_name: pending.tool_name, result: result.response.result }],
      0,
      "",
    );
  }

  // Stable system prefix (persona + tool defs implicitly via request.tools) marked
  // cacheable, followed by the current date and time. The datetime block sits
  // after the persona's cache_control breakpoint so it stays outside the cached
  // prefix and is re-sent each turn; the persona stays cached. Without it the
  // model has no notion of "now" and fabricates instants for relative references
  // like "tomorrow" or "in two hours"; the time and zone are needed to resolve
  // reminder scheduled_at instants correctly.
  private system_blocks(): llm_text_block[] {
    const now = new Date().toLocaleString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
    return [
      { type: "text", text: persona_text, cache_control: { type: "ephemeral" } },
      { type: "text", text: `The current date and time is ${now}.` },
    ];
  }

  // Retry-with-backoff + jitter for transient errors only, behind the circuit breaker.
  private async *stream_with_reliability(request: llm_request): AsyncIterable<llm_stream_event> {
    if (!this.breaker.allow()) throw { type: "circuit_open" };

    let attempt = 0;
    for (;;) {
      // Only retry when nothing has been yielded yet; retrying after output
      // reached the caller would replay it from the beginning.
      let yielded = false;
      try {
        for await (const event of this.deps.llm.stream(request)) {
          yielded = true;
          yield event;
        }
        return;
      } catch (err) {
        if (yielded || !is_transient(err) || attempt >= this.retry.max_retries) throw err;
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
    // A turn is stored only as a complete user/assistant pair; a lone user
    // message would break role alternation on later LLM calls.
    if (!assistant_text) return;
    const history = await this.deps.store.load(session_id);
    history.push({ role: "user", content: user_message });
    history.push({ role: "assistant", content: assistant_text });
    // Keep only the most recent N messages so stored history and per-turn LLM
    // context stay bounded over a long-running conversation.
    const max = this.deps.max_message_history ?? default_max_message_history;
    let trimmed = history.length > max ? history.slice(history.length - max) : history;
    // Never trim mid-pair: history must start on a user message.
    while (trimmed[0]?.role === "assistant") trimmed = trimmed.slice(1);
    await this.deps.store.save(session_id, trimmed);
  }
}

export function create_assistant_core(deps: core_deps): assistant_core {
  return new core_impl(deps);
}
