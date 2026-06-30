import { useCallback, useEffect, useRef, useState } from "react";
import { Asset } from "expo-asset";
import { InferenceSession, Tensor } from "onnxruntime-react-native";
import type { audio_io, wake_status } from "./types";

// On-device "Hey Bex" wake word, openWakeWord pipeline run through
// onnxruntime-react-native. Three ONNX models in sequence:
//
//   raw PCM (1280 samples) -> melspectrogram -> 32-bin mel frames
//   76 mel frames          -> embedding      -> 96-dim speech embedding
//   16 embeddings          -> classifier     -> wake score (0..1)
//
// The melspectrogram and embedding models are openWakeWord's shared/pretrained
// feature models, reused as-is; only the classifier (hey_bex.onnx) is custom.
// Audio is 16-bit 16kHz mono, matching the capture path; no resampling.
//
// Foreground only. The engine and the talk-mode voice session never hold the
// mic at once: the caller disables wake while a voice session is live.

// Streaming constants from the openWakeWord reference pipeline.
const SAMPLES_PER_STEP = 1280; // 80ms at 16kHz, one melspectrogram step
const MEL_BINS = 32;
const EMBEDDING_WINDOW = 76; // mel frames per embedding
const EMBEDDING_STEP = 8; // mel frames advanced per embedding
const CLASSIFIER_WINDOW = 16; // embeddings per classifier inference
const EMBEDDING_DIM = 96;

// Score at/above which the phrase counts as detected. Tune against the trained
// classifier; the openWakeWord default is a 0.5 sigmoid score.
const DETECT_THRESHOLD = 0.5;
// Frames to ignore after a detection so one utterance fires once. 25 steps ~2s.
const DEBOUNCE_STEPS = 25;

// Model assets. The classifier ships in this module; the two feature models are
// the shared openWakeWord exports and must sit beside it.
const MODEL_MODULES = {
  melspectrogram: require("./models/melspectrogram.onnx"),
  embedding: require("./models/embedding.onnx"),
  classifier: require("./models/hey_bex.onnx"),
};

interface wake_sessions {
  melspectrogram: InferenceSession;
  embedding: InferenceSession;
  classifier: InferenceSession;
}

// Resolve a bundled .onnx asset to a local file path the native runtime reads.
async function load_session(module_ref: number): Promise<InferenceSession> {
  const asset = Asset.fromModule(module_ref);
  await asset.downloadAsync();
  const path = asset.localUri ?? asset.uri;
  return InferenceSession.create(path.replace(/^file:\/\//, ""));
}

async function load_sessions(): Promise<wake_sessions> {
  const [melspectrogram, embedding, classifier] = await Promise.all([
    load_session(MODEL_MODULES.melspectrogram),
    load_session(MODEL_MODULES.embedding),
    load_session(MODEL_MODULES.classifier),
  ]);
  return { melspectrogram, embedding, classifier };
}

// Decode a base64 PCM chunk (16-bit little-endian mono) into Int16 samples.
const b64_chars =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function base64_to_int16(b64: string): Int16Array {
  const lookup = new Uint8Array(256);
  for (let i = 0; i < b64_chars.length; i += 1) lookup[b64_chars.charCodeAt(i)] = i;
  const clean = b64.replace(/=+$/, "");
  const bytes = new Uint8Array((clean.length * 3) >> 2);
  let p = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = lookup[clean.charCodeAt(i)] ?? 0;
    const c1 = lookup[clean.charCodeAt(i + 1)] ?? 0;
    const c2 = lookup[clean.charCodeAt(i + 2)] ?? 0;
    const c3 = lookup[clean.charCodeAt(i + 3)] ?? 0;
    bytes[p++] = (c0 << 2) | (c1 >> 4);
    if (i + 2 < clean.length) bytes[p++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (i + 3 < clean.length) bytes[p++] = ((c2 & 3) << 6) | c3;
  }
  // Reinterpret the byte pairs as little-endian Int16.
  return new Int16Array(bytes.buffer, 0, p >> 1);
}

// Stateful streaming detector. Holds the rolling mel and embedding buffers and
// runs the three models as enough audio accumulates. One instance per listening
// session; create_engine returns push() to feed frames and reset() to clear.
function create_engine(sessions: wake_sessions, on_detected: () => void) {
  // Raw int16 samples (as float32) awaiting the next melspectrogram step.
  let raw: number[] = [];
  // Accumulated 32-bin mel frames.
  let mel: number[][] = [];
  // Index of the next embedding window's first mel frame.
  let mel_window_start = 0;
  // Accumulated 96-dim embeddings.
  let embeddings: number[][] = [];
  // Steps remaining to ignore after a detection.
  let debounce = 0;
  // Serializes inference so frames never overlap on the JS thread.
  let running = false;

  const mel_in = sessions.melspectrogram.inputNames[0];
  const mel_out = sessions.melspectrogram.outputNames[0];
  const emb_in = sessions.embedding.inputNames[0];
  const emb_out = sessions.embedding.outputNames[0];
  const cls_in = sessions.classifier.inputNames[0];
  const cls_out = sessions.classifier.outputNames[0];

  // Run the melspectrogram model on one 1280-sample step, appending its mel
  // frames to the buffer. openWakeWord applies spec/10 + 2 to the raw output.
  async function step_melspectrogram(samples: number[]): Promise<void> {
    const input = new Tensor("float32", Float32Array.from(samples), [1, SAMPLES_PER_STEP]);
    const result = await sessions.melspectrogram.run({ [mel_in]: input });
    const out = result[mel_out];
    const data = out.data as Float32Array;
    const frames = data.length / MEL_BINS;
    for (let f = 0; f < frames; f += 1) {
      const frame: number[] = new Array(MEL_BINS);
      for (let b = 0; b < MEL_BINS; b += 1) {
        frame[b] = data[f * MEL_BINS + b] / 10 + 2;
      }
      mel.push(frame);
    }
  }

  // Run the embedding model on a 76-frame mel window, returning a 96-dim vector.
  async function run_embedding(start: number): Promise<number[]> {
    const flat = new Float32Array(EMBEDDING_WINDOW * MEL_BINS);
    for (let f = 0; f < EMBEDDING_WINDOW; f += 1) {
      const frame = mel[start + f];
      for (let b = 0; b < MEL_BINS; b += 1) flat[f * MEL_BINS + b] = frame[b];
    }
    const input = new Tensor("float32", flat, [1, EMBEDDING_WINDOW, MEL_BINS, 1]);
    const result = await sessions.embedding.run({ [emb_in]: input });
    return Array.from(result[emb_out].data as Float32Array).slice(0, EMBEDDING_DIM);
  }

  // Run the classifier on the last 16 embeddings, returning the wake score.
  async function run_classifier(): Promise<number> {
    const flat = new Float32Array(CLASSIFIER_WINDOW * EMBEDDING_DIM);
    const base = embeddings.length - CLASSIFIER_WINDOW;
    for (let i = 0; i < CLASSIFIER_WINDOW; i += 1) {
      const emb = embeddings[base + i];
      for (let d = 0; d < EMBEDDING_DIM; d += 1) flat[i * EMBEDDING_DIM + d] = emb[d];
    }
    const input = new Tensor("float32", flat, [1, CLASSIFIER_WINDOW, EMBEDDING_DIM]);
    const result = await sessions.classifier.run({ [cls_in]: input });
    return (result[cls_out].data as Float32Array)[0];
  }

  // Drain accumulated audio through the pipeline. Awaits each model so the
  // buffers stay consistent; the running guard prevents re-entrant drains.
  async function drain(): Promise<void> {
    if (running) return;
    running = true;
    try {
      while (raw.length >= SAMPLES_PER_STEP) {
        await step_melspectrogram(raw.splice(0, SAMPLES_PER_STEP));

        // Emit every embedding whose 76-frame window is now complete.
        while (mel.length - mel_window_start >= EMBEDDING_WINDOW) {
          embeddings.push(await run_embedding(mel_window_start));
          mel_window_start += EMBEDDING_STEP;

          if (embeddings.length >= CLASSIFIER_WINDOW) {
            if (debounce > 0) {
              debounce -= 1;
            } else if ((await run_classifier()) >= DETECT_THRESHOLD) {
              debounce = DEBOUNCE_STEPS;
              on_detected();
            }
          }
        }

        // Trim consumed mel frames so the buffer does not grow unbounded.
        if (mel_window_start > EMBEDDING_WINDOW) {
          const drop = mel_window_start - EMBEDDING_WINDOW;
          mel = mel.slice(drop);
          mel_window_start -= drop;
        }
        // Keep only the embeddings the classifier window needs.
        if (embeddings.length > CLASSIFIER_WINDOW) {
          embeddings = embeddings.slice(embeddings.length - CLASSIFIER_WINDOW);
        }
      }
    } finally {
      running = false;
    }
  }

  return {
    push(frame: Int16Array): void {
      for (let i = 0; i < frame.length; i += 1) raw.push(frame[i]);
      void drain();
    },
    reset(): void {
      raw = [];
      mel = [];
      mel_window_start = 0;
      embeddings = [];
      debounce = 0;
    },
  };
}

// Drives the wake engine off the mic. While enabled it loads the models once,
// captures mic frames through audio_io, and calls on_detected on a match. The
// caller disables it (enabled=false) while a voice session holds the mic.
export function use_wake_word(args: {
  audio: audio_io;
  enabled: boolean;
  on_detected: () => void;
}): wake_status {
  const { audio, enabled, on_detected } = args;
  const [status, set_status] = useState<wake_status>("idle");

  const sessions_ref = useRef<wake_sessions | null>(null);
  const loading_ref = useRef<Promise<wake_sessions> | null>(null);
  // Latest on_detected without re-running the subscribe effect on every render.
  const detected_ref = useRef(on_detected);
  detected_ref.current = on_detected;

  const ensure_sessions = useCallback(async (): Promise<wake_sessions> => {
    if (sessions_ref.current) return sessions_ref.current;
    if (!loading_ref.current) loading_ref.current = load_sessions();
    const loaded = await loading_ref.current;
    sessions_ref.current = loaded;
    return loaded;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    (async () => {
      try {
        set_status("loading");
        const sessions = await ensure_sessions();
        if (cancelled) return;
        const engine = create_engine(sessions, () => {
          set_status("detected");
          detected_ref.current();
        });
        // Capture is owned continuously by the assistant engine; the detector
        // only consumes frames. It never starts or stops the mic, so the wake-
        // to-talk transition keeps one unbroken capture and drops no audio.
        unsubscribe = audio.on_input_frame((pcm_base64) =>
          engine.push(base64_to_int16(pcm_base64)),
        );
        if (cancelled) {
          unsubscribe();
          return;
        }
        set_status("listening");
      } catch {
        if (!cancelled) set_status("error");
      }
    })();

    return () => {
      cancelled = true;
      unsubscribe?.();
      set_status("idle");
    };
  }, [enabled, audio, ensure_sessions]);

  return status;
}
