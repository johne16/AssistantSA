// m-res-assistant owns every type in this module. No type definitions live
// outside this file.

// Mirror of m-res-auth's canonical tenant_context_token claim set. Held here
// with zero deviation per the shared-type rule. On the wire the token travels
// as the encoded RS256 JWT string; this interface is the decoded claim set.
export interface tenant_context_token {
  sub: string; // resident/subject id
  city_tenant_id: string; // per-city namespace key
  iat: number; // issued-at, seconds since epoch
  exp: number; // expiry, seconds since epoch
}

// assistantQuery output: chat query sent to the assistant service over HTTP.
// A confirmation reply is an ordinary message, not a separate field.
export interface assistant_query {
  tenant_context_token: string; // encoded JWT
  message: string;
}

// voiceStream output: audio chunks streamed up the duplex WebSocket. The token
// is sent once on the open frame; chunks follow as binary frames. Downstream
// audio is always pcm_16000 to match the client playback engine.
export interface voice_stream_open {
  tenant_context_token: string; // encoded JWT
  voice_id: string; // ElevenLabs voice the resident selected
}

// Who authored a chat turn.
export type turn_role = "user" | "assistant";

// Structured reminder confirmation rendered as a chip beneath an assistant turn
// (mockup .rem-chip), instead of prose. Set when the assistant confirms a
// set_reminder tool call.
export interface chat_reminder_chip {
  title: string;
  when: string;
}

// A single rendered chat turn. text grows as SSE tokens or voice transcript
// fragments arrive. pending marks an assistant turn still streaming. The
// optional fields carry the mockup's richer assistant states: a provenance line
// (source + sync time), a reminder confirmation chip, and an error/can't-do
// bubble. They are populated when the backend marks a reply accordingly; today
// only error is set locally on a failed send.
// A source-failure rendered as an error bubble naming the failed provider, with
// a retry or re-link action. Set from the assistant's source_failure event.
export interface chat_failure {
  source: string;
  reason: string;
  action: "retry" | "relink";
}

export interface chat_turn {
  id: string;
  role: turn_role;
  text: string;
  pending: boolean;
  error?: boolean;
  source?: string;
  reminder?: chat_reminder_chip;
  failure?: chat_failure;
  // The user message that produced this reply, so a failed turn can be retried.
  retry_message?: string;
}

// assistantResponse SSE: the named events the assistant service emits. token
// carries an incremental text fragment; reminder confirms a set_reminder tool
// call so the client records it and renders a chip; source marks a reply grounded
// in live data; source_failure reports an unreachable provider; done closes the
// stream.
export type assistant_sse_event =
  | "token"
  | "reminder"
  | "source"
  | "source_failure"
  | "done"
  | "error";

// Parsed SSE source payload (provenance line under a data-grounded reply).
export interface assistant_source_payload {
  source: string;
  synced_at: string;
}

// Parsed SSE source_failure payload (provider unreachable for a reply).
export interface assistant_source_failure_payload {
  source: string;
  reason: string;
  action: "retry" | "relink";
}

// Parsed SSE token payload. The service sends the fragment as event data.
export interface assistant_token_payload {
  text: string;
}

// Parsed SSE reminder payload, emitted when the assistant sets a reminder. when
// is the human display label; scheduled_at is the ISO instant it fires.
export interface assistant_reminder_payload {
  title: string;
  body: string;
  when: string;
  scheduled_at: string;
}

// voiceResponse: the message kinds the voice service streams down the socket.
// transcript carries text for a turn; audio carries an MP3 chunk; end closes
// the current response turn.
export type voice_response_kind = "transcript" | "audio" | "end";

// A transcript event from the voice socket. role distinguishes the spoken user
// turn from the assistant reply. final marks the turn complete.
export interface voice_transcript_event {
  kind: "transcript";
  role: turn_role;
  text: string;
  final: boolean;
}

// An MP3 audio chunk from the voice socket, base64-encoded in the JSON frame.
export interface voice_audio_event {
  kind: "audio";
  mp3_base64: string;
}

// Marks the end of the current voice response turn.
export interface voice_end_event {
  kind: "end";
}

export type voice_response_event =
  | voice_transcript_event
  | voice_audio_event
  | voice_end_event;

// Hands-free voice connection lifecycle, surfaced to the screen.
export type voice_status = "idle" | "connecting" | "live" | "error";

// Capture/playback abstraction. The WebSocket logic is real; this interface
// hides the native audio module so a placeholder can stand in when expo-audio
// is not installed. No audio is persisted; only transcript text is kept.
export interface audio_io {
  // Begin microphone capture. on_chunk fires per base64 PCM chunk to send up.
  // PCM (linear16) matches the server-side Deepgram uplink encoding. on_barge_in
  // fires when the resident speaks over the assistant; the caller forwards it to
  // the backend so it stops generating.
  start_capture(
    on_chunk: (pcm_base64: string) => void,
    on_barge_in: () => void,
  ): Promise<void>;
  // Stop microphone capture.
  stop_capture(): Promise<void>;
  // Enqueue one downstream audio unit (one sentence) for playback. Units are
  // raw PCM 16-bit mono at 16000 Hz, fed straight to the playback engine.
  play_chunk(audio_base64: string): void;
  // Signal that a fresh response turn is starting, so playback stops suppressing
  // the barged-out turn's tail and plays this one from the beginning.
  begin_response(): void;
  // Stop and clear playback (e.g. on barge-in or close).
  stop_playback(): void;
  // Subscribe to the assistant output level (0..1) emitted by the playback
  // engine. The idle waveform drives its amplitude from this; it reacts to the
  // assistant's voice only, never the user's input. Returns an unsubscribe fn.
  on_output_level(handler: (level: number) => void): () => void;
}

// Return shape of use_assistant_engine: the assistant's audio engine, chat
// thread, and voice controls, owned at portal level and consumed by
// AssistantScreen (rendering) and the idle overlay (audio output level).
export interface assistant_engine {
  audio: audio_io;
  turns: chat_turn[];
  draft: string;
  set_draft: (text: string) => void;
  sending: boolean;
  voice_state: voice_status;
  voice_on: boolean;
  submit: () => void;
  toggle_voice: () => void;
  on_failure_action: (turn: chat_turn) => void;
}

// Wake-word listening lifecycle, surfaced to the assistant surface. "loading"
// covers the one-time ONNX session creation; "listening" means the engine is
// consuming mic frames; "detected" is a transient state on a positive match
// before the voice session takes the mic.
export type wake_status = "idle" | "loading" | "listening" | "detected" | "error";

// One captured PCM frame handed to the wake engine: 16-bit mono samples at
// 16000 Hz, frame length a multiple of 80ms (1280 samples). Matches the capture
// path; no resampling.
export type wake_pcm_frame = Int16Array;
