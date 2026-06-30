// ap-assistant: all module type definitions live here. No types outside this file.

// Mirror block: owned by m-res-auth. Duplicated here verbatim, zero deviation.
export interface tenant_context_token {
  sub: string;
  city_tenant_id: string;
  iat: number;
  exp: number;
}

// ---- config ----

export interface assistant_config {
  claude_api_key: string;
  token_verification_public_key: string;
  redis_url: string;
}

// ---- downstream service identifiers ----

export type downstream_service = "ap-civic" | "ap-utility" | "ap-reminders";

// ---- tool-request ports (this module owns these interfaces; ap-server injects adapters) ----

export interface tool_request {
  tenant_context_token: string;
  operation: string;
  params: Record<string, unknown>;
}

export interface tool_response {
  operation: string;
  result: unknown;
}

// A downstream port (civic or utility). The handler reaches a service only through this.
export interface tool_request_port {
  send(request: tool_request): Promise<tool_response>;
}

// Both downstream ports, injected by ap-server.
export interface tool_request_ports {
  "ap-civic": tool_request_port;
  "ap-utility": tool_request_port;
  "ap-reminders": tool_request_port;
}

// ---- llm port (this module owns it; ap-server injects an Anthropic adapter) ----

export type llm_role = "user" | "assistant";

export interface llm_text_block {
  type: "text";
  text: string;
  cache_control?: { type: "ephemeral" };
}

export interface llm_tool_definition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface llm_message {
  role: llm_role;
  content: string;
}

// Which path the turn is on; selects model and max_tokens.
export type llm_path = "chat" | "voice";

export interface llm_request {
  path: llm_path;
  system: llm_text_block[];
  tools: llm_tool_definition[];
  messages: llm_message[];
}

// A streamed text chunk or a final tool selection from Claude.
export interface llm_stream_text {
  type: "text";
  text: string;
}

export interface llm_tool_use {
  type: "tool_use";
  tool_name: string;
  input: Record<string, unknown>;
}

export type llm_stream_event = llm_stream_text | llm_tool_use;

// The injected llm port. Yields text chunks token-by-token; ends with an optional tool_use.
export interface llm_port {
  stream(request: llm_request): AsyncIterable<llm_stream_event>;
}

// ---- session store port (this module owns it; ap-server injects an ioredis adapter) ----

export interface session_store {
  load(session_id: string): Promise<llm_message[]>;
  save(session_id: string, history: llm_message[]): Promise<void>;
}

// ---- token verifier port (this module owns it; ap-server injects a jose adapter) ----

export interface token_verifier {
  verify(token: string): Promise<tenant_context_token>;
}

// ---- tool registry ----

export interface task_tool {
  tool_definition: llm_tool_definition;
  downstream: downstream_service;
  // The downstream operation the handler invokes.
  operation: string;
  // Form-submitting tools confirm before acting. All seed tools are false.
  requires_confirmation: boolean;
  // Optional task-specific instructions for the handler's own LLM step.
  task_prompt?: string;
  // Provenance label shown on the answer's source line. Omitted for tools with
  // no external source (e.g. set_reminder).
  source_label?: string;
}

export interface tool_registry {
  list(): task_tool[];
  get(tool_name: string): task_tool | undefined;
  register(tool: task_tool): void;
  deregister(tool_name: string): void;
  tool_definitions(): llm_tool_definition[];
}

// ---- handler I/O ----

export interface assistant_query_input {
  tenant_context_token: string;
  message: string;
  // Optional explicit session id; defaults to the token subject.
  session_id?: string;
}

export interface voice_query_input {
  tenant_context_token: string;
  transcript: string;
}

// Streamed text fragment emitted back to the caller (SSE or ws).
export interface text_chunk {
  type: "text";
  text: string;
}

// Emitted once after the assistant sets a reminder, so the caller can record it
// and render a confirmation chip. when is the human display label; scheduled_at
// is the ISO instant the reminder fires.
export interface reminder_chunk {
  type: "reminder";
  title: string;
  body: string;
  when: string;
  scheduled_at: string;
}

// Emitted when a reply is grounded in live data from a source module, so the
// caller can render a provenance line ("<source> · synced <time>") under it.
export interface source_chunk {
  type: "source";
  source: string; // human source label, e.g. "Utility account"
  synced_at: string; // human sync-time label, e.g. "9:12 AM"
}

// Emitted when a data source could not be reached for a reply, so the caller can
// render a failure bubble naming the source with a retry/re-link action.
export interface source_failure_chunk {
  type: "source_failure";
  source: string; // the source that failed, e.g. "Utility account"
  reason: string; // short failure reason
  action: "retry" | "relink"; // suggested recovery the client offers
}

// Streamed chunk emitted back to the caller (SSE or ws).
export type response_chunk =
  | text_chunk
  | reminder_chunk
  | source_chunk
  | source_failure_chunk;

// ---- pending confirmation state ----

export interface pending_confirmation {
  tool_name: string;
  input: Record<string, unknown>;
}

// ---- core ----

export interface assistant_core {
  // Runs one turn. Streams response chunks token-by-token.
  run_turn(input: {
    session_id: string;
    tenant_context_token: string;
    message: string;
    path: llm_path;
  }): AsyncIterable<response_chunk>;
}

// ---- handler ----

export interface assistant_handler {
  // HTTP/SSE chat path.
  assistant_query(input: assistant_query_input): AsyncIterable<response_chunk>;
  // Invocation from ap-voice over the localhost ws.
  voice_query(input: voice_query_input): AsyncIterable<response_chunk>;
  // Attach the voice ws server to an existing ws.Server-like object.
  handle_voice_connection(socket: voice_socket): void;
}

// Minimal ws socket surface the handler depends on (avoids importing ws types into the contract).
export interface voice_socket {
  on(event: "message", listener: (data: unknown) => void): void;
  on(event: "close", listener: () => void): void;
  on(event: "error", listener: (err: Error) => void): void;
  send(data: string): void;
  close(): void;
}

// ---- reliability ----

export interface retry_options {
  max_retries: number;
  base_delay_ms: number;
  max_delay_ms: number;
}

export interface circuit_breaker_options {
  failure_threshold: number;
  recovery_window_ms: number;
}

export type circuit_state = "closed" | "open" | "half_open";
