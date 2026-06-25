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

// A single rendered chat turn. text grows as SSE tokens or voice transcript
// fragments arrive. pending marks an assistant turn still streaming.
export interface chat_turn {
  id: string;
  role: turn_role;
  text: string;
  pending: boolean;
}

// assistantResponse SSE: the named events the assistant service emits. token
// carries an incremental text fragment; done closes the stream.
export type assistant_sse_event = "token" | "done";

// Parsed SSE token payload. The service sends the fragment as event data.
export interface assistant_token_payload {
  text: string;
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
}
