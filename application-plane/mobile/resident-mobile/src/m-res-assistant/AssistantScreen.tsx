import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { use_resident_session } from "@/m-res-auth";
import { use_theme, use_t } from "@/m-res-shell";
import { send_assistant_query } from "./chat-client";
import { open_voice_stream } from "./voice-client";
import { use_audio_io } from "./audio-io";
import type {
  chat_turn,
  voice_status,
  voice_transcript_event,
} from "./types";
import type { voice_session } from "./voice-client";
import type { theme as shell_theme } from "@/m-res-shell";

// The "Ask AssistantSA" screen the portal mounts. Renders the chat thread, the
// composer, and a hands-free voice toggle. Confirmation is conversational: a
// confirmation request renders as a normal assistant turn and the user replies
// as an ordinary message. This screen only renders and sends; ap-assistant owns
// the confirmation flow. Reaches the backend only through the gateway.

let turn_counter = 0;
function next_turn_id(): string {
  turn_counter += 1;
  return `t${turn_counter}`;
}

export function AssistantScreen(props: {
  voice_id: string;
  keyboard_offset: number;
}) {
  "use no memo";
  const t = use_theme();
  const tr = use_t();
  const styles = build_styles(t);
  const { tenant_context_token } = use_resident_session();
  const audio = use_audio_io();

  const [turns, set_turns] = useState<chat_turn[]>([]);
  const [draft, set_draft] = useState("");
  const [sending, set_sending] = useState(false);
  const [voice_state, set_voice_state] = useState<voice_status>("idle");
  const voice_id = props.voice_id;

  const scroll_ref = useRef<ScrollView | null>(null);
  const close_chat_ref = useRef<(() => void) | null>(null);
  const voice_ref = useRef<voice_session | null>(null);
  // Tracks the in-progress voice turn per role so streamed fragments append to
  // the same bubble instead of creating one bubble per fragment.
  const voice_turn_ids = useRef<{ user: string | null; assistant: string | null }>({
    user: null,
    assistant: null,
  });

  const scroll_to_end = useCallback(() => {
    requestAnimationFrame(() => scroll_ref.current?.scrollToEnd({ animated: true }));
  }, []);

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
      scroll_to_end();
    },
    [scroll_to_end],
  );

  const submit = useCallback(() => {
    const message = draft.trim();
    if (!message || sending) return;

    const user_id = next_turn_id();
    const reply_id = next_turn_id();
    upsert_turn(user_id, "user", message, false, false);
    upsert_turn(reply_id, "assistant", "", true, false);
    set_draft("");
    set_sending(true);

    close_chat_ref.current = send_assistant_query(tenant_context_token, message, {
      on_token: (text) => upsert_turn(reply_id, "assistant", text, true, true),
      on_done: () => {
        upsert_turn(reply_id, "assistant", "", false, true);
        set_sending(false);
      },
      on_error: (msg) => {
        upsert_turn(reply_id, "assistant", `\n[${msg}]`, false, true);
        set_sending(false);
      },
    });
  }, [draft, sending, tenant_context_token, upsert_turn]);

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
    voice_ref.current?.stop();
    voice_ref.current = null;
    voice_turn_ids.current = { user: null, assistant: null };
    set_voice_state("idle");
  }, []);

  // Tear down a live voice session if the screen unmounts mid-call, so the
  // socket closes and the native audio engine (mic + AEC) is released instead of
  // staying hot in the background.
  useEffect(() => {
    return () => {
      voice_ref.current?.stop();
      voice_ref.current = null;
    };
  }, []);

  const toggle_voice = useCallback(() => {
    if (voice_ref.current) {
      stop_voice();
      return;
    }
    voice_ref.current = open_voice_stream(
      tenant_context_token,
      audio,
      voice_id,
      {
        on_transcript,
        on_status: set_voice_state,
        on_error: (message) => {
          console.log("[voice] error:", message);
          // Surface the failure as an assistant note in the thread.
          upsert_turn(next_turn_id(), "assistant", tr("[voice unavailable]"), false, false);
        },
      },
    );
  }, [audio, voice_id, on_transcript, stop_voice, tenant_context_token, upsert_turn, tr]);

  const voice_on = voice_state === "live" || voice_state === "connecting";

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.mark}>
            <Text style={styles.mark_letter}>A</Text>
          </View>
          <View>
            <Text style={styles.title}>AssistantSA</Text>
            <Text style={styles.sub}>{tr("Your city, handled.")}</Text>
          </View>
        </View>
        <View style={styles.header_actions}>
          <Pressable
            onPress={toggle_voice}
            style={[styles.voice_btn, voice_on && styles.voice_btn_on]}
            accessibilityRole="button"
            accessibilityLabel={voice_on ? tr("Stop hands-free voice") : tr("Start hands-free voice")}
          >
            {voice_state === "connecting" ? (
              <ActivityIndicator size="small" color={t.color.on_accent} />
            ) : (
              <Text style={[styles.voice_label, voice_on && styles.voice_label_on]}>
                {voice_on ? tr("Listening") : tr("Voice")}
              </Text>
            )}
          </Pressable>
        </View>
      </View>

      <ScrollView
        ref={scroll_ref}
        style={styles.transcript}
        contentContainerStyle={styles.transcript_content}
        keyboardShouldPersistTaps="handled"
      >
        {turns.map((turn) => (
          <View
            key={turn.id}
            style={[styles.turn, turn.role === "user" && styles.turn_user]}
          >
            {turn.role === "assistant" && (
              <View style={styles.turn_mark}>
                <Text style={styles.turn_mark_letter}>A</Text>
              </View>
            )}
            <View
              style={[
                styles.bubble,
                turn.role === "user" ? styles.bubble_user : styles.bubble_assistant,
              ]}
            >
              <Text
                style={turn.role === "user" ? styles.bubble_text_user : styles.bubble_text}
              >
                {turn.text}
                {turn.pending && turn.text.length === 0 ? "..." : ""}
              </Text>
            </View>
          </View>
        ))}
      </ScrollView>

      <KeyboardStickyView offset={{ closed: 0, opened: props.keyboard_offset }}>
        <View style={styles.dock}>
          <View style={styles.composer}>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={set_draft}
            placeholder={tr("Ask the assistant anything.")}
            placeholderTextColor={t.color.ink_subtle}
            multiline
            onSubmitEditing={submit}
            returnKeyType="send"
          />
          <Pressable
            onPress={submit}
            disabled={sending || draft.trim().length === 0}
            style={[
              styles.send,
              (sending || draft.trim().length === 0) && styles.send_disabled,
            ]}
            accessibilityRole="button"
            accessibilityLabel={tr("Send message")}
          >
            <Text style={styles.send_label}>{tr("Send")}</Text>
          </Pressable>
          </View>
        </View>
      </KeyboardStickyView>
    </View>
  );
}

// theme is re-exported from m-res-shell; the local alias keeps the styles typed.
function build_styles(t: shell_theme) {
  return StyleSheet.create({
    root: { flex: 1, backgroundColor: t.color.paper },
    header: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: t.spacing.lg,
      paddingVertical: t.spacing.sm,
    },
    brand: { flexDirection: "row", alignItems: "center", gap: t.spacing.sm },
    header_actions: { flexDirection: "row", alignItems: "center", gap: t.spacing.sm },
    mark: {
      width: 36,
      height: 36,
      borderRadius: t.radius.md,
      backgroundColor: t.color.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    mark_letter: {
      color: t.color.on_primary,
      fontFamily: t.font.display,
      fontSize: 20,
    },
    title: { fontFamily: t.font.display, fontSize: 20, color: t.color.ink },
    sub: { fontFamily: t.font.body, fontSize: 13, color: t.color.ink_muted },
    voice_btn: {
      paddingVertical: 6,
      paddingHorizontal: t.spacing.md,
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.color.border_strong,
      backgroundColor: t.color.surface,
      minWidth: 84,
      alignItems: "center",
    },
    voice_btn_on: {
      backgroundColor: t.color.accent,
      borderColor: t.color.accent,
    },
    voice_label: {
      fontFamily: t.font.body,
      fontSize: 13,
      color: t.color.ink_muted,
    },
    voice_label_on: { color: t.color.on_accent },
    transcript: { flex: 1 },
    transcript_content: {
      paddingHorizontal: t.spacing.lg,
      paddingVertical: t.spacing.md,
      gap: t.spacing.md,
    },
    turn: { flexDirection: "row", alignItems: "flex-end", gap: t.spacing.sm },
    turn_user: { justifyContent: "flex-end" },
    turn_mark: {
      width: 28,
      height: 28,
      borderRadius: t.radius.sm,
      backgroundColor: t.color.primary,
      alignItems: "center",
      justifyContent: "center",
    },
    turn_mark_letter: {
      color: t.color.on_primary,
      fontFamily: t.font.display,
      fontSize: 16,
    },
    bubble: {
      maxWidth: "82%",
      borderRadius: t.radius.lg,
      paddingVertical: 10,
      paddingHorizontal: t.spacing.md,
    },
    bubble_assistant: {
      backgroundColor: t.color.surface_raised,
      borderWidth: 1,
      borderColor: t.color.border,
      borderBottomLeftRadius: t.radius.sm,
    },
    bubble_user: {
      backgroundColor: t.color.primary,
      borderBottomRightRadius: t.radius.sm,
    },
    bubble_text: {
      fontFamily: t.font.body,
      fontSize: 15,
      lineHeight: 22,
      color: t.color.ink,
    },
    bubble_text_user: {
      fontFamily: t.font.body,
      fontSize: 15,
      lineHeight: 22,
      color: t.color.on_primary,
    },
    dock: {
      paddingHorizontal: t.spacing.lg,
      paddingTop: t.spacing.sm,
      paddingBottom: t.spacing.lg,
      borderTopWidth: 1,
      borderTopColor: t.color.border,
      backgroundColor: t.color.surface,
    },
    composer: { flexDirection: "row", alignItems: "flex-end", gap: t.spacing.sm },
    input: {
      flex: 1,
      minHeight: 46,
      maxHeight: 120,
      fontFamily: t.font.body,
      fontSize: 15,
      color: t.color.ink,
      backgroundColor: t.color.surface,
      borderWidth: 1,
      borderColor: t.color.border_strong,
      borderRadius: t.radius.lg,
      paddingHorizontal: t.spacing.md,
      paddingVertical: 12,
    },
    send: {
      borderRadius: t.radius.lg,
      backgroundColor: t.color.primary,
      paddingVertical: 12,
      paddingHorizontal: t.spacing.lg,
      alignItems: "center",
      justifyContent: "center",
    },
    send_disabled: { opacity: 0.5 },
    send_label: {
      fontFamily: t.font.body,
      fontSize: 15,
      color: t.color.on_primary,
    },
  });
}
