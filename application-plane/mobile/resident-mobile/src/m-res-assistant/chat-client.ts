import EventSource, { type EventSourceListener } from "react-native-sse";
import { app_config } from "@/app-config";
import type {
  assistant_query,
  assistant_reminder_payload,
  assistant_source_failure_payload,
  assistant_source_payload,
  assistant_sse_event,
  assistant_token_payload,
} from "./types";

// Chat transport. POSTs assistantQuery to the API gateway and consumes the
// assistantResponse SSE stream token-by-token via react-native-sse, which React
// Native lacks natively. Reaches the backend only through the gateway.

const assistant_path = "/assistant/query";

// Callbacks the screen supplies to render the stream as it arrives.
export interface assistant_query_handlers {
  on_token: (text: string) => void; // an incremental text fragment
  on_reminder: (reminder: assistant_reminder_payload) => void; // a set reminder
  on_source: (source: assistant_source_payload) => void; // provenance line
  on_source_failure: (failure: assistant_source_failure_payload) => void; // unreachable provider
  on_done: () => void; // stream finished cleanly
  on_error: (message: string) => void; // transport or server error
}

// Opens the SSE connection for one query. Returns a close function the caller
// invokes to abort the stream. The token is forwarded for the backend to
// verify; the message body carries an ordinary message (a confirmation reply is
// just another message, ap-assistant owns that flow).
export function send_assistant_query(
  tenant_context_token: string,
  message: string,
  handlers: assistant_query_handlers,
): () => void {
  const body: assistant_query = { tenant_context_token, message };

  const es = new EventSource<assistant_sse_event>(
    `${app_config.api_gateway_base_url}${assistant_path}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${tenant_context_token}`,
      },
      body: JSON.stringify(body),
      // Server closes the stream itself; no auto-reconnect on a one-shot query.
      pollingInterval: 0,
    },
  );

  const listener: EventSourceListener<assistant_sse_event> = (event) => {
    if (event.type === "token") {
      // event.data is the JSON token payload from the assistant service.
      if (!event.data) return;
      try {
        const payload = JSON.parse(event.data) as assistant_token_payload;
        handlers.on_token(payload.text);
      } catch {
        // Fall back to raw data if the service emits a bare text fragment.
        handlers.on_token(event.data);
      }
    } else if (event.type === "reminder") {
      if (!event.data) return;
      try {
        handlers.on_reminder(
          JSON.parse(event.data) as assistant_reminder_payload,
        );
      } catch {
        // Malformed reminder payload: ignore rather than crash the stream.
      }
    } else if (event.type === "source") {
      if (!event.data) return;
      try {
        handlers.on_source(JSON.parse(event.data) as assistant_source_payload);
      } catch {
        // Malformed source payload: ignore rather than crash the stream.
      }
    } else if (event.type === "source_failure") {
      if (!event.data) return;
      try {
        handlers.on_source_failure(
          JSON.parse(event.data) as assistant_source_failure_payload,
        );
      } catch {
        // Malformed failure payload: ignore rather than crash the stream.
      }
    } else if (event.type === "done") {
      handlers.on_done();
      es.removeAllEventListeners();
      es.close();
    } else if (event.type === "error") {
      // A server-sent error event carries its message in event.data as JSON
      // ({ message }); a transport-level error carries event.message.
      const { data } = event as { data?: string };
      let message: string | undefined;
      if (typeof data === "string" && data) {
        try {
          message = (JSON.parse(data) as { message?: string }).message;
        } catch {
          message = data;
        }
      }
      handlers.on_error(message ?? event.message ?? "connection error");
      es.removeAllEventListeners();
      es.close();
    } else if (event.type === "exception") {
      handlers.on_error(event.message ?? "stream exception");
      es.removeAllEventListeners();
      es.close();
    }
  };

  es.addEventListener("token", listener);
  es.addEventListener("reminder", listener);
  es.addEventListener("source", listener);
  es.addEventListener("source_failure", listener);
  es.addEventListener("done", listener);
  es.addEventListener("error", listener);

  return () => {
    es.removeAllEventListeners();
    es.close();
  };
}
