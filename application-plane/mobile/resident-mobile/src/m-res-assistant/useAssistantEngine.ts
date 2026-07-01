import { useCallback, useEffect, useRef, useState } from "react";
import { useResidentSession } from "@/m-res-auth";
import { useT } from "@/m-res-shell";
import { send_assistant_query } from "./chat-client";
import { open_voice_stream } from "./voice-client";
import { useAudioIo } from "./audio-io";
import { useWakeWord } from "./wake-word";
import type {
  assistant_engine,
  assistant_reminder_payload,
  chat_turn,
  voice_status,
  voice_transcript_event,
} from "./types";
import type { voice_session } from "./voice-client";

// How long the voice session waits with no inbound activity (no user speech and
// the assistant idle) before it closes the stream. Reset on every inbound event,
// so it also covers the gap after the assistant responds.
const voice_silence_timeout_ms = 8000;

// Output level (0..1) at/above which the assistant is treated as audibly
// playing, mirroring audio-io's playing_level. The silence countdown is held
// while the assistant is speaking.
const assistant_playing_level = 0.01;
// Output-level events fire only while audibly playing; once they stop arriving
// for this long, the assistant is treated as finished speaking and the silence
// countdown is armed.
const playback_settle_ms = 800;

// Capture sample rate (16kHz mono linear16), used to size the pre-roll buffer.
const capture_sample_rate = 16000;
// How much speech the rolling pre-roll buffer holds: the audio captured just
// after the wake word plus the socket-connect window, replayed to the backend
// once the voice socket opens so the opening of the prompt is never lost.
const preroll_seconds = 2;
const preroll_max_samples = capture_sample_rate * preroll_seconds;

// Owns the assistant's audio engine, chat thread, voice session, and wake-word
// listener. Mounted once at portal level so the "Hey Bex" listener and the mic
// engine run on every screen (the wake toggle is portal-level), not only while
// the Chat tab is mounted. AssistantScreen renders the returned state; the idle
// overlay reads the same audio output level. Reaches the backend only through
// the gateway.

let turn_counter = 0;
function next_turn_id(): string {
  turn_counter += 1;
  return `t${turn_counter}`;
}

export function useAssistantEngine(props: {
  voice_id: string;
  // Portal-level "Hey Bex" toggle. Gates the wake listener; the engine runs the
  // listener whenever this is on and no voice session holds the mic.
  wake_enabled: boolean;
  // Called when the assistant sets a reminder (text or voice). The portal owns
  // where it is stored; this module stays decoupled from m-res-reminders.
  on_set_reminder: (reminder: assistant_reminder_payload) => void;
  // Navigate to the accounts screen so the resident can re-link a provider whose
  // sync failed. Optional; when absent, a re-link action falls back to a retry.
  on_relink_account?: () => void;
}): assistant_engine {
  "use no memo";
  const tr = useT();
  const { tenant_context_token } = useResidentSession();
  const audio = useAudioIo();

  const [turns, set_turns] = useState<chat_turn[]>([]);
  const [draft, set_draft] = useState("");
  const [sending, set_sending] = useState(false);
  const [voice_state, set_voice_state] = useState<voice_status>("idle");
  // True from a wake-word detection until that voice session ends; drives the
  // portal's wake-trigger indicators. A manual voice toggle leaves it false.
  const [wake_triggered, set_wake_triggered] = useState(false);
  const voice_id = props.voice_id;

  // Rolling pre-roll buffer of the most recent captured frames (base64) with a
  // running sample count, trimmed to preroll_max_samples. Snapshotted on wake
  // detection and handed to the voice session so the opening words survive the
  // socket-connect delay.
  const preroll_ring = useRef<{ pcm_base64: string; samples: number }[]>([]);
  const preroll_samples = useRef(0);

  const close_chat_ref = useRef<(() => void) | null>(null);
  const voice_ref = useRef<voice_session | null>(null);
  const silence_timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Holds the silence countdown until the assistant's output level events stop
  // (playback finished). Unsubscribes the level listener on session teardown.
  const playback_watchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const output_level_unsub = useRef<(() => void) | null>(null);
  // Whether the live session arms the silence timeout. Wake-word sessions do;
  // a manual voice toggle stays open until toggled off.
  const silence_enabled = useRef(false);
  // Tracks the in-progress voice turn per role so streamed fragments append to
  // the same bubble instead of creating one bubble per fragment.
  const voice_turn_ids = useRef<{ user: string | null; assistant: string | null }>({
    user: null,
    assistant: null,
  });

  // Append text to an existing turn, or create it if absent.
  const upsert_turn = useCallback(
    (id: string, role: chat_turn["role"], text: string, pending: boolean, append: boolean) => {
      set_turns((prev) => {
        const idx = prev.findIndex((turn) => turn.id === id);
        if (idx === -1) {
          return [...prev, { id, role, text, pending }];
        }
        const updated = [...prev];
        const existing = updated[idx];
        updated[idx] = {
          ...existing,
          text: append ? existing.text + text : text,
          pending,
        };
        return updated;
      });
    },
    [],
  );

  // Open the SSE stream for one query and route its events onto an existing
  // assistant reply turn. Shared by a fresh submit and a retry of a failed turn.
  const open_stream = useCallback(
    (reply_id: string, message: string) => {
      set_sending(true);
      close_chat_ref.current = send_assistant_query(tenant_context_token, message, {
        on_token: (text) => upsert_turn(reply_id, "assistant", text, true, true),
        on_reminder: (r) => {
          // Hand the reminder to the portal (it stores it; Feed reads it) and
          // attach a chip to the assistant reply instead of leaving it as prose.
          props.on_set_reminder(r);
          set_turns((prev) =>
            prev.map((turn) =>
              turn.id === reply_id
                ? { ...turn, reminder: { title: r.title, when: r.when } }
                : turn,
            ),
          );
        },
        on_source: (s) => {
          // synced_at is the time the data was recorded to the DB; omit the
          // "synced" tail when the source carries no such timestamp.
          const label = s.synced_at ? `${s.source} · synced ${s.synced_at}` : s.source;
          set_turns((prev) =>
            prev.map((turn) =>
              turn.id === reply_id ? { ...turn, source: label } : turn,
            ),
          );
        },
        on_source_failure: (f) => {
          set_turns((prev) =>
            prev.map((turn) =>
              turn.id === reply_id
                ? { ...turn, pending: false, error: true, failure: f }
                : turn,
            ),
          );
        },
        on_done: () => {
          upsert_turn(reply_id, "assistant", "", false, true);
          set_sending(false);
        },
        on_error: (msg) => {
          set_turns((prev) =>
            prev.map((turn) =>
              turn.id === reply_id
                ? {
                    ...turn,
                    pending: false,
                    error: true,
                    text: turn.text.length > 0 ? turn.text : msg,
                  }
                : turn,
            ),
          );
          set_sending(false);
        },
      });
    },
    [tenant_context_token, upsert_turn, props.on_set_reminder],
  );

  const submit = useCallback(() => {
    const message = draft.trim();
    if (!message || sending) return;

    const user_id = next_turn_id();
    const reply_id = next_turn_id();
    upsert_turn(user_id, "user", message, false, false);
    upsert_turn(reply_id, "assistant", "", true, false);
    // Remember the prompt on the reply so a failed turn can be retried.
    set_turns((prev) =>
      prev.map((turn) =>
        turn.id === reply_id ? { ...turn, retry_message: message } : turn,
      ),
    );
    set_draft("");
    open_stream(reply_id, message);
  }, [draft, sending, upsert_turn, open_stream]);

  // Retry a failed turn in place: clear its error state and reopen the stream
  // with the stored prompt, without adding a duplicate user message.
  const retry_turn = useCallback(
    (turn: chat_turn) => {
      if (!turn.retry_message || sending) return;
      const message = turn.retry_message;
      set_turns((prev) =>
        prev.map((t) => {
          if (t.id !== turn.id) return t;
          const { failure, ...rest } = t;
          return { ...rest, error: false, text: "", pending: true };
        }),
      );
      open_stream(turn.id, message);
    },
    [sending, open_stream],
  );

  // A failed turn's action button: re-link the provider when offered, else retry.
  const on_failure_action = useCallback(
    (turn: chat_turn) => {
      if (turn.failure?.action === "relink" && props.on_relink_account) {
        props.on_relink_account();
        return;
      }
      retry_turn(turn);
    },
    [retry_turn, props.on_relink_account],
  );

  // Route a transcript event into the matching streaming bubble.
  const on_transcript = useCallback(
    (event: voice_transcript_event) => {
      const ids = voice_turn_ids.current;
      let id = ids[event.role];
      if (!id) {
        id = next_turn_id();
        ids[event.role] = id;
      }
      upsert_turn(id, event.role, event.text, !event.final, true);
      if (event.final) ids[event.role] = null;
    },
    [upsert_turn],
  );

  const stop_voice = useCallback(() => {
    if (silence_timer.current) {
      clearTimeout(silence_timer.current);
      silence_timer.current = null;
    }
    if (playback_watchdog.current) {
      clearTimeout(playback_watchdog.current);
      playback_watchdog.current = null;
    }
    output_level_unsub.current?.();
    output_level_unsub.current = null;
    voice_ref.current?.stop();
    voice_ref.current = null;
    voice_turn_ids.current = { user: null, assistant: null };
    set_voice_state("idle");
  }, []);

  // Restart the silence countdown. Called when the stream goes live and on each
  // assistant-side event; if it elapses with no further activity the session is
  // closed.
  const bump_silence = useCallback(() => {
    if (!silence_enabled.current) return;
    if (silence_timer.current) clearTimeout(silence_timer.current);
    silence_timer.current = setTimeout(() => {
      silence_timer.current = null;
      stop_voice();
    }, voice_silence_timeout_ms);
  }, [stop_voice]);

  // The user spoke: cancel the countdown while the response is generated. The
  // next assistant-side event re-arms it.
  const hold_silence = useCallback(() => {
    if (silence_timer.current) {
      clearTimeout(silence_timer.current);
      silence_timer.current = null;
    }
  }, []);

  // Tear down a live voice session if the engine unmounts mid-call, so the
  // socket closes and the native audio engine (mic + AEC) is released instead of
  // staying hot in the background.
  useEffect(() => {
    return () => {
      if (silence_timer.current) clearTimeout(silence_timer.current);
      if (playback_watchdog.current) clearTimeout(playback_watchdog.current);
      output_level_unsub.current?.();
      output_level_unsub.current = null;
      voice_ref.current?.stop();
      voice_ref.current = null;
    };
  }, []);

  // Start the voice session if one is not already live. Shared by the manual
  // voice toggle and a wake-word detection, so both take the mic the same way.
  // Wake-word sessions arm the silence timeout; a manual toggle (silence_timeout
  // false) stays open until toggled off.
  const start_voice = useCallback((preroll: string[] = [], silence_timeout = true) => {
    if (voice_ref.current) return;
    silence_enabled.current = silence_timeout;
    // Hold the silence countdown until the assistant is fully finished speaking.
    // Output-level events fire only while audibly playing: while they arrive the
    // countdown stays cancelled, and once they stop for playback_settle_ms the
    // assistant is treated as done speaking and the countdown is armed. Inter-
    // sentence gaps shorter than playback_settle_ms do not arm it.
    output_level_unsub.current?.();
    output_level_unsub.current = audio.on_output_level((level) => {
      if (level < assistant_playing_level) return;
      hold_silence();
      if (playback_watchdog.current) clearTimeout(playback_watchdog.current);
      playback_watchdog.current = setTimeout(() => {
        playback_watchdog.current = null;
        bump_silence();
      }, playback_settle_ms);
    });
    voice_ref.current = open_voice_stream(
      tenant_context_token,
      audio,
      voice_id,
      {
        on_transcript,
        on_reminder: (r) => {
          props.on_set_reminder(r);
          // Attach the chip to the live assistant turn, or a fresh one if none.
          const aid = voice_turn_ids.current.assistant;
          if (aid) {
            set_turns((prev) =>
              prev.map((turn) =>
                turn.id === aid
                  ? { ...turn, reminder: { title: r.title, when: r.when } }
                  : turn,
              ),
            );
          } else {
            set_turns((prev) => [
              ...prev,
              {
                id: next_turn_id(),
                role: "assistant",
                text: "",
                pending: false,
                reminder: { title: r.title, when: r.when },
              },
            ]);
          }
        },
        on_status: set_voice_state,
        on_activity: bump_silence,
        on_user_speech: hold_silence,
        on_error: (message) => {
          console.log("[voice] error:", message);
          // Surface the failure as an assistant note in the thread.
          upsert_turn(next_turn_id(), "assistant", tr("[voice unavailable]"), false, false);
        },
      },
      preroll,
    );
  }, [audio, voice_id, on_transcript, tenant_context_token, upsert_turn, tr, bump_silence, hold_silence, props.on_set_reminder]);

  // Wake-word detection: snapshot the pre-roll buffer and open the same voice
  // session as the manual toggle, seeded with the buffered opening words and
  // arming the silence timeout. Flags the wake-trigger indicators.
  const handle_wake_detected = useCallback(() => {
    const preroll = preroll_ring.current.map((frame) => frame.pcm_base64);
    set_wake_triggered(true);
    start_voice(preroll, true);
  }, [start_voice]);

  const toggle_voice = useCallback(() => {
    if (voice_ref.current) {
      stop_voice();
      return;
    }
    start_voice([], false);
  }, [stop_voice, start_voice]);

  const voice_on = voice_state === "live" || voice_state === "connecting";

  // Continuous mic capture: keep one engine running whenever the wake word is on
  // or a voice session is active, so the mic never stops across the wake-to-talk
  // transition and no opening audio is dropped. Released only when neither needs
  // it. Owning capture here (not in the wake listener or the voice client) is
  // what makes the single shared engine possible.
  const capture_needed = props.wake_enabled || voice_state !== "idle";
  useEffect(() => {
    if (!capture_needed) return;
    audio.start_capture().catch((err: unknown) => {
      console.log("[capture] start failed:", err);
    });
    return () => {
      void audio.stop_capture();
    };
  }, [capture_needed, audio]);

  // Feed the rolling pre-roll buffer from the continuous capture while the wake
  // word is on, trimming to the most recent preroll_max_samples. Approximates
  // sample count from the base64 length (linear16: 2 bytes/sample) to avoid
  // decoding every frame.
  useEffect(() => {
    if (!props.wake_enabled) return;
    const unsubscribe = audio.on_input_frame((pcm_base64) => {
      const bytes = Math.floor((pcm_base64.length * 3) / 4);
      const samples = bytes >> 1;
      preroll_ring.current.push({ pcm_base64, samples });
      preroll_samples.current += samples;
      while (
        preroll_samples.current > preroll_max_samples &&
        preroll_ring.current.length > 0
      ) {
        const dropped = preroll_ring.current.shift();
        if (dropped) preroll_samples.current -= dropped.samples;
      }
    });
    return () => {
      unsubscribe();
      preroll_ring.current = [];
      preroll_samples.current = 0;
    };
  }, [props.wake_enabled, audio]);

  // Clear the wake-trigger indicators once the session that a detection opened
  // has fully closed (silence timeout, barge-out end, or socket close).
  useEffect(() => {
    if (voice_state === "idle") set_wake_triggered(false);
  }, [voice_state]);

  // Run the wake detector while the wake word is on and no voice session is
  // active: it does not hold the mic (capture is continuous above), it only
  // consumes frames, so disabling it during a session just stops detection.
  const wake_active = props.wake_enabled && voice_state === "idle";
  useWakeWord({ audio, enabled: wake_active, on_detected: handle_wake_detected });

  return {
    audio,
    turns,
    draft,
    set_draft,
    sending,
    voice_state,
    voice_on,
    wake_triggered,
    submit,
    toggle_voice,
    on_failure_action,
  };
}
