import { app_config } from "@/app-config";
import type {
  assistant_reminder_payload,
  audio_io,
  voice_status,
  voice_stream_open,
  voice_transcript_event,
} from "./types";

// Voice transport. Opens one duplex WebSocket to the API gateway: hands-free
// audio chunks stream up while MP3 chunks and transcript text stream down the
// same connection. Capture keeps flowing up during playback to enable barge-in.
// No audio is persisted; only transcript text reaches the screen.

const voice_path = "/voice/stream";

// Callbacks the screen supplies to render transcript turns and status.
export interface voice_handlers {
  on_transcript: (event: voice_transcript_event) => void;
  on_reminder: (reminder: assistant_reminder_payload) => void;
  on_status: (status: voice_status) => void;
  on_error: (message: string) => void;
  // Arms/resets the caller's silence timeout. Fired when the stream goes live
  // (awaiting first words) and on every assistant-side event (audio chunk,
  // response_start, assistant_transcript, reminder). When it elapses with no
  // further activity, nothing is happening and the session can close.
  on_activity?: () => void;
  // The user finished an utterance. Cancels the silence timeout: a response is
  // now incoming, so the gap until the assistant's first token must not close
  // the stream. The next assistant-side event re-arms it.
  on_user_speech?: () => void;
}

// A live voice session the screen can stop.
export interface voice_session {
  stop: () => void;
}

// http(s) base -> ws(s) socket URL for the gateway voice endpoint.
function to_ws_url(base_url: string): string {
  const ws_base = base_url.replace(/^http/i, "ws");
  return `${ws_base}${voice_path}`;
}

// base64 <-> bytes. ap-voice's wire protocol is binary audio frames; capture and
// playback carry base64, so convert at the socket boundary. Implemented here to
// avoid a Buffer/atob polyfill dependency in the RN runtime.
const b64_chars =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64_to_bytes(b64: string): Uint8Array {
  const lookup = new Uint8Array(256);
  for (let i = 0; i < b64_chars.length; i += 1) lookup[b64_chars.charCodeAt(i)] = i;
  const clean = b64.replace(/=+$/, "");
  const out = new Uint8Array((clean.length * 3) >> 2);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = lookup[clean.charCodeAt(i)] ?? 0;
    const c1 = lookup[clean.charCodeAt(i + 1)] ?? 0;
    const c2 = lookup[clean.charCodeAt(i + 2)] ?? 0;
    const c3 = lookup[clean.charCodeAt(i + 3)] ?? 0;
    out[p++] = (c0 << 2) | (c1 >> 4);
    if (i + 2 < clean.length) out[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (i + 3 < clean.length) out[p++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}

function bytes_to_base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i] ?? 0;
    const b1 = bytes[i + 1] ?? 0;
    const b2 = bytes[i + 2] ?? 0;
    out += b64_chars[b0 >> 2];
    out += b64_chars[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? b64_chars[((b1 & 15) << 2) | (b2 >> 6)] : "=";
    out += i + 2 < bytes.length ? b64_chars[b2 & 63] : "=";
  }
  return out;
}

// Opens the duplex voice stream. audio is the capture/playback implementation.
// The token and selected voice are sent once on the open frame, then binary
// audio chunks follow. Downstream audio is always pcm_16000.
export function open_voice_stream(
  tenant_context_token: string,
  audio: audio_io,
  voice_id: string,
  handlers: voice_handlers,
): voice_session {
  handlers.on_status("connecting");

  const socket = new WebSocket(to_ws_url(app_config.api_gateway_base_url));
  socket.binaryType = "arraybuffer";
  let closed = false;

  // Send a captured PCM chunk up as a binary frame if the socket is open, per
  // ap-voice's protocol (binary = audio, text = handshake). Capture hands base64
  // PCM; decode to bytes at the boundary. Keeps running during playback so the
  // user can barge in over the assistant.
  const send_chunk = (pcm_base64: string) => {
    if (socket.readyState === WebSocket.OPEN) {
      const bytes = base64_to_bytes(pcm_base64);
      socket.send(bytes.buffer as ArrayBuffer);
    }
  };

  const teardown = () => {
    if (closed) return;
    closed = true;
    void audio.stop_capture();
    audio.stop_playback();
    if (
      socket.readyState === WebSocket.OPEN ||
      socket.readyState === WebSocket.CONNECTING
    ) {
      socket.close();
    }
  };

  // Local barge-in: tell the backend to stop generating the current turn. The
  // client has already flushed its own playback queue.
  const send_barge_in = () => {
    console.log("[voice] send_barge_in, socket state", socket.readyState);
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "barge_in" }));
    }
  };

  socket.onopen = () => {
    // First frame authorizes the stream with the token.
    const open_frame: voice_stream_open = { tenant_context_token, voice_id };
    socket.send(JSON.stringify(open_frame));
    handlers.on_status("live");
    // Arm the silence timeout from the moment the stream is live, awaiting the
    // first words.
    handlers.on_activity?.();
    // Begin capture; chunks stream up as they are encoded.
    audio.start_capture(send_chunk, send_barge_in).catch((err: unknown) => {
      handlers.on_error(err instanceof Error ? err.message : "capture failed");
      teardown();
    });
  };

  socket.onmessage = (message) => {
    // Binary frame = one audio unit (one sentence) in the session's format.
    // Play it gaplessly; nothing is stored.
    if (typeof message.data !== "string") {
      handlers.on_activity?.();
      const bytes = new Uint8Array(message.data as ArrayBuffer);
      audio.play_chunk(bytes_to_base64(bytes));
      return;
    }
    // Text frame = a control, transcript, or reminder event keyed by type.
    let frame: {
      type?: string;
      text?: string;
      title?: string;
      body?: string;
      when?: string;
      scheduled_at?: string;
    };
    try {
      frame = JSON.parse(message.data) as typeof frame;
    } catch {
      return;
    }
    if (frame.type === "reminder") {
      handlers.on_activity?.();
      handlers.on_reminder({
        title: frame.title ?? "",
        body: frame.body ?? "",
        when: frame.when ?? "",
        scheduled_at: frame.scheduled_at ?? "",
      });
      return;
    }
    if (frame.type === "response_start") {
      // A fresh response turn is starting: let playback resume from the top.
      handlers.on_activity?.();
      console.log("[voice] response_start received");
      audio.begin_response();
      return;
    }
    if (frame.type === "user_transcript" || frame.type === "assistant_transcript") {
      if (frame.type === "user_transcript") {
        handlers.on_user_speech?.();
      } else {
        handlers.on_activity?.();
      }
      const event: voice_transcript_event = {
        kind: "transcript",
        role: frame.type === "user_transcript" ? "user" : "assistant",
        text: frame.text ?? "",
        final: true,
      };
      handlers.on_transcript(event);
    }
  };

  socket.onerror = () => {
    handlers.on_status("error");
    handlers.on_error("voice socket error");
    teardown();
  };

  socket.onclose = () => {
    if (!closed) {
      handlers.on_status("idle");
    }
    teardown();
  };

  return { stop: teardown };
}
