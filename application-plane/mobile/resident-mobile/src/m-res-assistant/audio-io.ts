import { useRef } from "react";
import {
  initialize,
  toggleRecording,
  playPCMData,
  flush,
  tearDown,
  requestMicrophonePermissionsAsync,
  addExpoTwoWayAudioEventListener,
} from "@speechmatics/expo-two-way-audio";
import type { audio_io } from "./types";

// Real audio_io, backed by expo-two-way-audio.
//
// The module runs a single full-duplex voice engine: capture and playback share
// one native audio session with Acoustic Echo Cancellation applied, so the mic
// no longer picks up the assistant's own speaker output. Both directions are
// locked to PCM 16-bit mono at 16000 Hz.
//
// Capture: toggleRecording(true) unmutes the mic; onMicrophoneData fires with
// echo-cancelled PCM frames (Uint8Array). The frames are 16000/linear16/mono,
// matching the server Deepgram uplink; change the server uplink and the TTS
// output rate together.
//
// Playback: the server emits pcm_16000 units handed straight to playPCMData. The
// patched library exposes flush(), which clears both its sample queue and the
// AudioTrack buffer, so barge-in cuts in-flight speech instantly; no JS-side
// pacing layer is needed.
//
// Barge-in is detected locally: onInputVolumeLevelData crosses a threshold while
// the assistant is playing (tracked via onOutputVolumeLevelData). On barge-in
// the engine is flushed and the backend is signaled to stop generating.

// Input level (0..1) above which the user is treated as speaking, triggering a
// barge-in flush of any in-flight playback.
const barge_in_level = 0.28;
// Output level (0..1) above which the assistant is treated as audibly playing.
const playing_level = 0.01;

// base64 -> bytes for the downstream PCM units fed to playPCMData.
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

// bytes -> base64 for the captured mic frames, kept at the module boundary so
// voice-client's wire path (base64 -> bytes -> binary frame) is unchanged.
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

export function use_audio_io(): audio_io {
  // The native engine is a process-wide singleton; initialize() must resolve
  // once before any capture/playback call, and is re-run after a tearDown.
  const init = useRef<Promise<void> | null>(null);
  const mic_sub = useRef<{ remove: () => void } | null>(null);
  const in_vol_sub = useRef<{ remove: () => void } | null>(null);
  const out_vol_sub = useRef<{ remove: () => void } | null>(null);
  // Dedupes start_capture: held while capture is running (or starting) so the
  // wake listener and a voice session can both call start_capture without ever
  // restarting the engine. Cleared by stop_capture.
  const capture_promise = useRef<Promise<void> | null>(null);
  // Fan-out registries. One native mic/level listener feeds every consumer, so
  // capture is shared continuously instead of one consumer owning the mic.
  const frame_listeners = useRef<Set<(pcm_base64: string) => void>>(new Set());
  const barge_listeners = useRef<Set<() => void>>(new Set());
  const output_listeners = useRef<Set<(level: number) => void>>(new Set());
  // Whether the assistant is currently audibly playing, driven by the engine's
  // output level. This is what makes a user level crossing a real barge-in.
  const assistant_playing = useRef(false);
  // True from a barge-in until the backend signals a fresh response
  // (begin_response). While set, incoming audio is dropped: it is the tail of
  // the barged-out turn the server already sent before it stopped. Released by
  // response_start, so the next reply's opening is never dropped.
  const suppressing = useRef(false);

  // Drop all in-flight playback: flush the native engine (sample queue plus the
  // AudioTrack buffer) and stop accepting more audio until the next response.
  // The capture engine stays up, so continuous wake listening is unaffected.
  const flush_playback = (): void => {
    try {
      flush();
    } catch {
      // Engine unavailable; nothing to flush.
    }
    assistant_playing.current = false;
    suppressing.current = true;
  };

  const ensure_initialized = (): Promise<void> => {
    if (!init.current) {
      // initialize() resolves false (never rejects) when the native engine
      // fails to start; turn that into a rejection so start_capture surfaces it
      // through on_error instead of silently running with no audio. A failed
      // attempt is not cached, so the next session can retry.
      init.current = initialize().then((ok) => {
        if (!ok) {
          init.current = null;
          throw new Error("audio engine failed to initialize");
        }
      });
    }
    return init.current;
  };

  // Build the audio_io object once and keep its identity stable across renders.
  // All state lives in the refs above, so a single instance stays correct. A
  // stable identity matters because consumers (use_wake_word, the idle overlay)
  // key effects on it; a fresh object each render would restart mic capture and
  // re-subscribe the output level on every parent re-render.
  const api = useRef<audio_io | null>(null);
  if (api.current) return api.current;

  api.current = {
    start_capture(): Promise<void> {
      // Idempotent: a single continuous capture is shared by every consumer, so
      // a second caller (e.g. a voice session while the wake listener is up)
      // reuses the running engine instead of restarting the mic.
      if (capture_promise.current) return capture_promise.current;
      capture_promise.current = (async () => {
        // Clear the cached promise on any failure so the next call retries
        // instead of returning a permanently rejected promise (which would wedge
        // capture after a transient permission or init failure).
        try {
          const permission = await requestMicrophonePermissionsAsync();
          if (!permission.granted) {
            throw new Error("microphone permission denied");
          }
          await ensure_initialized();
          // Echo-cancelled PCM frames arrive here; encode once and fan out to
          // every registered consumer (wake detector, pre-roll buffer, session).
          mic_sub.current?.remove();
          mic_sub.current = addExpoTwoWayAudioEventListener("onMicrophoneData", (event) => {
            const pcm_base64 = bytes_to_base64(event.data);
            frame_listeners.current.forEach((handler) => handler(pcm_base64));
          });
          // Track whether the assistant is audibly playing from the engine's
          // output level (gating barge-in), and fan the level out to subscribers.
          out_vol_sub.current?.remove();
          out_vol_sub.current = addExpoTwoWayAudioEventListener("onOutputVolumeLevelData", (event) => {
            assistant_playing.current = event.data > playing_level;
            output_listeners.current.forEach((handler) => handler(event.data));
          });
          // Local barge-in: when the (echo-cancelled) input level crosses the
          // threshold while the assistant is playing, the user is speaking over
          // it; flush local playback and notify subscribers (the session tells
          // the backend to stop generating).
          in_vol_sub.current?.remove();
          in_vol_sub.current = addExpoTwoWayAudioEventListener("onInputVolumeLevelData", (event) => {
            if (event.data > barge_in_level && assistant_playing.current) {
              console.log("[voice] barge-in detected, flushing + signaling backend");
              flush_playback();
              barge_listeners.current.forEach((handler) => handler());
            }
          });
          // Unmute the mic to begin emitting onMicrophoneData events.
          toggleRecording(true);
        } catch (err) {
          capture_promise.current = null;
          throw err;
        }
      })();
      return capture_promise.current;
    },
    async stop_capture(): Promise<void> {
      capture_promise.current = null;
      toggleRecording(false);
      mic_sub.current?.remove();
      mic_sub.current = null;
      in_vol_sub.current?.remove();
      in_vol_sub.current = null;
      out_vol_sub.current?.remove();
      out_vol_sub.current = null;
      // Release the native engine; a fresh initialize() runs on the next start.
      init.current = null;
      try {
        tearDown();
      } catch {
        // Engine already torn down.
      }
    },
    on_input_frame(handler: (pcm_base64: string) => void): () => void {
      frame_listeners.current.add(handler);
      return () => {
        frame_listeners.current.delete(handler);
      };
    },
    on_barge_in(handler: () => void): () => void {
      barge_listeners.current.add(handler);
      return () => {
        barge_listeners.current.delete(handler);
      };
    },
    play_chunk(audio_base64: string): void {
      // Drop the barged-out turn's tail until the backend signals the next
      // response; a fresh reply's opening is never dropped.
      if (suppressing.current) return;
      const unit = base64_to_bytes(audio_base64);
      void ensure_initialized()
        .then(() => {
          // Re-check: a barge-in may have landed while init was resolving.
          if (!suppressing.current) playPCMData(unit);
        })
        .catch(() => {
          // Engine failed to initialize; capture surfaces it via on_error.
        });
    },
    begin_response(): void {
      // Fresh response turn: stop dropping audio so it plays from the top.
      suppressing.current = false;
    },
    flush_playback(): void {
      // Barge-in or session close: drop in-flight playback only. The capture
      // engine stays up so continuous wake listening survives; the engine is
      // torn down separately by stop_capture when no longer needed.
      flush_playback();
    },
    on_output_level(handler: (level: number) => void): () => void {
      // Fan the engine's output level out to the idle waveform from the single
      // native level listener set up in start_capture. Events only fire while
      // the playback engine is audibly playing, so the waveform stays flat
      // unless the assistant is speaking.
      output_listeners.current.add(handler);
      return () => {
        output_listeners.current.delete(handler);
      };
    },
  };
  return api.current;
}
