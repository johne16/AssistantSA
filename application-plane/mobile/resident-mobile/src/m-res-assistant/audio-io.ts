import { useRef } from "react";
import {
  initialize,
  toggleRecording,
  playPCMData,
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
// Playback: the server emits pcm_16000 in small (~40ms) units. Because the
// engine exposes no mid-stream flush, the units are NOT handed straight to
// playPCMData. They are held in a JS-side queue this module owns and fed to the
// engine one unit at a time, paced to realtime, so the engine's own queue stays
// shallow (about lead_ms ahead). Barge-in then drops the JS queue and stops
// feeding; only what was already handed over (up to lead_ms plus the hardware
// buffer) plays out.
//
// Barge-in is detected locally: onInputVolumeLevelData crosses a threshold.
// Acoustic Echo Cancellation is what makes this reliable, since the input level
// reflects only the user's voice, not the assistant's playback.

// pcm_16000 mono s16 = 32000 bytes/sec, so 32 bytes per millisecond.
const pcm_bytes_per_ms = 32;
// How far ahead of realtime to keep the engine fed. Covers timer jitter so
// playback never underruns; also the upper bound on audio left after a barge-in.
const lead_ms = 120;
// Input level (0..1) above which the user is treated as speaking, triggering a
// barge-in flush of any in-flight playback.
const barge_in_level = 0.12;

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
  const vol_sub = useRef<{ remove: () => void } | null>(null);
  // Playback units this module owns, fed to the engine one at a time so its
  // native queue stays shallow and barge-in can drop the rest instantly.
  const play_queue = useRef<Uint8Array[]>([]);
  const feeding = useRef(false);
  const feed_timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Wall-clock playhead: the time the next unit is due to start playing. Units
  // are fed once that time is within lead_ms of now, keeping a fixed buffer.
  const feed_at = useRef(0);
  // Most recent input level, used to drop assistant audio that is still in
  // flight from an aborted turn while the user is mid-sentence.
  const last_input_level = useRef(0);

  // Hand the engine every unit whose start time is within lead_ms of now, then
  // reschedule for when the next one comes due. Keeps the engine ~lead_ms ahead
  // of realtime without dumping the whole queue into its unflushable buffer.
  const pump = (): void => {
    feed_timer.current = null;
    const now = Date.now();
    if (feed_at.current === 0) feed_at.current = now;
    while (play_queue.current.length > 0 && feed_at.current <= now + lead_ms) {
      const unit = play_queue.current.shift() as Uint8Array;
      try {
        playPCMData(unit);
      } catch {
        // Engine unavailable; drop this unit and keep draining.
      }
      feed_at.current += unit.length / pcm_bytes_per_ms;
    }
    if (play_queue.current.length > 0) {
      const wait = Math.max(0, feed_at.current - lead_ms - Date.now());
      feed_timer.current = setTimeout(pump, wait);
    } else {
      feeding.current = false;
    }
  };

  const start_feeding = (): void => {
    if (feeding.current) return;
    feeding.current = true;
    // Fresh playhead so a gap since the last unit does not dump the queue.
    feed_at.current = 0;
    pump();
  };

  // Drop everything not yet handed to the engine and stop feeding. The units
  // already in the engine (up to lead_ms) plus its hardware buffer play out.
  const flush_playback = (): void => {
    play_queue.current = [];
    if (feed_timer.current) {
      clearTimeout(feed_timer.current);
      feed_timer.current = null;
    }
    feeding.current = false;
    feed_at.current = 0;
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

  return {
    async start_capture(on_chunk: (pcm_base64: string) => void): Promise<void> {
      const permission = await requestMicrophonePermissionsAsync();
      if (!permission.granted) {
        throw new Error("microphone permission denied");
      }
      await ensure_initialized();
      // Drop any prior listener so a re-entrant start_capture cannot leak one.
      mic_sub.current?.remove();
      // Echo-cancelled PCM frames arrive here; hand them up as base64 for the
      // socket path.
      mic_sub.current = addExpoTwoWayAudioEventListener("onMicrophoneData", (event) => {
        on_chunk(bytes_to_base64(event.data));
      });
      // Local barge-in: when the (echo-cancelled) input level crosses the
      // threshold while audio is in flight, the user is speaking over the
      // assistant; drop the queued playback at once.
      vol_sub.current?.remove();
      vol_sub.current = addExpoTwoWayAudioEventListener("onInputVolumeLevelData", (event) => {
        last_input_level.current = event.data;
        if (
          event.data > barge_in_level &&
          (feeding.current || play_queue.current.length > 0)
        ) {
          flush_playback();
        }
      });
      // Unmute the mic to begin emitting onMicrophoneData events.
      toggleRecording(true);
    },
    async stop_capture(): Promise<void> {
      toggleRecording(false);
      mic_sub.current?.remove();
      mic_sub.current = null;
      vol_sub.current?.remove();
      vol_sub.current = null;
    },
    play_chunk(audio_base64: string): void {
      // Drop audio that is still arriving from an aborted turn while the user is
      // mid-sentence, so a barge-in does not get overrun by the in-flight tail.
      if (last_input_level.current > barge_in_level) return;
      // Hold the unit in the JS queue; the paced feeder hands it to the engine.
      play_queue.current.push(base64_to_bytes(audio_base64));
      void ensure_initialized()
        .then(start_feeding)
        .catch(() => {
          // Engine failed to initialize; capture surfaces it via on_error.
        });
    },
    stop_playback(): void {
      // Barge-in or close: drop the JS queue, then tear the engine down (no
      // mid-stream flush exists) and force a fresh initialize() next session.
      flush_playback();
      mic_sub.current?.remove();
      mic_sub.current = null;
      vol_sub.current?.remove();
      vol_sub.current = null;
      init.current = null;
      try {
        tearDown();
      } catch {
        // Engine already torn down.
      }
    },
  };
}
