import type {
  assistant_core,
  assistant_handler,
  assistant_query_input,
  response_chunk,
  token_verifier,
  voice_query_input,
  voice_socket,
} from "./types.js";

export interface handler_deps {
  core: assistant_core;
  token_verifier: token_verifier;
}

class handler_impl implements assistant_handler {
  constructor(private deps: handler_deps) {}

  // HTTP/SSE chat path. Verifies the token, then streams the reply token-by-token.
  async *assistant_query(input: assistant_query_input): AsyncIterable<response_chunk> {
    try {
      const claims = await this.deps.token_verifier.verify(input.tenant_context_token);
      const session_id = input.session_id ?? claims.sub;
      yield* this.deps.core.run_turn({
        session_id,
        tenant_context_token: input.tenant_context_token,
        message: input.message,
        path: "chat",
      });
    } catch (err) {
      console.error("[ap-assistant] assistant_query failed:", err);
      throw err;
    }
  }

  // Invocation from ap-voice. RS256-verifies the token before trusting it; low-latency path.
  async *voice_query(input: voice_query_input): AsyncIterable<response_chunk> {
    try {
      const claims = await this.deps.token_verifier.verify(input.tenant_context_token);
      yield* this.deps.core.run_turn({
        session_id: claims.sub,
        tenant_context_token: input.tenant_context_token,
        message: input.transcript,
        path: "voice",
      });
    } catch (err) {
      console.error("[ap-assistant] voice_query failed:", err);
      throw err;
    }
  }

  // Thin ws wiring: ap-voice connects, sends { tenant_context_token, transcript },
  // ap-assistant streams text chunks back over the same socket.
  handle_voice_connection(socket: voice_socket): void {
    socket.on("error", () => {});
    socket.on("message", (data: unknown) => {
      void this.handle_voice_message(socket, data);
    });
  }

  private async handle_voice_message(socket: voice_socket, data: unknown): Promise<void> {
    let input: voice_query_input;
    try {
      const raw = typeof data === "string" ? data : (data as { toString(): string }).toString();
      const parsed = JSON.parse(raw) as Partial<voice_query_input>;
      if (typeof parsed.tenant_context_token !== "string" || typeof parsed.transcript !== "string") {
        throw new Error("invalid_voice_query");
      }
      input = { tenant_context_token: parsed.tenant_context_token, transcript: parsed.transcript };
    } catch (err) {
      console.error("[ap-assistant] voice message parse failed:", err);
      socket.send(JSON.stringify({ type: "error", error: "invalid_request" }));
      return;
    }

    try {
      for await (const chunk of this.voice_query(input)) {
        socket.send(JSON.stringify(chunk));
      }
      socket.send(JSON.stringify({ type: "done" }));
    } catch (err) {
      // Token verification failure or stream error: log server-side, but do not
      // leak detail to the client.
      console.error("[ap-assistant] voice stream failed:", err);
      socket.send(JSON.stringify({ type: "error", error: "unauthorized" }));
    }
  }
}

export function create_assistant_handler(deps: handler_deps): assistant_handler {
  return new handler_impl(deps);
}
