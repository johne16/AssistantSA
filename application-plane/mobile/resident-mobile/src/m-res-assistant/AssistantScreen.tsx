import { useEffect, useRef } from "react";
import {
  ActivityIndicator,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { KeyboardStickyView } from "react-native-keyboard-controller";
import { useTheme, useT } from "@/m-res-shell";
import type { assistant_engine } from "./types";
import type { theme as shell_theme } from "@/m-res-shell";

// The "Ask AssistantSA" screen the portal mounts. Renders the chat thread, the
// composer, and a hands-free voice toggle from the assistant engine the portal
// owns. Confirmation is conversational: a confirmation request renders as a
// normal assistant turn and the user replies as an ordinary message. This
// screen only renders; the engine owns the backend and audio flow.

export function AssistantScreen(props: {
  // The portal-owned assistant engine (audio, chat thread, voice controls).
  engine: assistant_engine;
  keyboard_offset: number;
}) {
  "use no memo";
  const t = useTheme();
  const tr = useT();
  const styles = build_styles(t);
  const {
    turns,
    draft,
    set_draft,
    sending,
    voice_state,
    voice_on,
    submit,
    toggle_voice,
    on_failure_action,
  } = props.engine;

  const scroll_ref = useRef<ScrollView | null>(null);

  // Hide the keyboard when a message is sent so it doesn't cover the thread
  // while the assistant responds.
  const send = () => {
    Keyboard.dismiss();
    submit();
  };

  // Keep the thread pinned to the newest turn as tokens and transcripts arrive.
  useEffect(() => {
    requestAnimationFrame(() => scroll_ref.current?.scrollToEnd({ animated: true }));
  }, [turns]);

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.brand}>
          <View style={styles.mark}>
            <Text style={styles.mark_letter}>B</Text>
          </View>
          <View>
            <Text style={styles.title}>Bex</Text>
            <Text style={styles.sub}>{tr("Ask anything. Set reminders.")}</Text>
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
                {voice_on ? tr("Voice on") : tr("Voice off")}
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
                <Text style={styles.turn_mark_letter}>B</Text>
              </View>
            )}
            <View
              style={[
                styles.bubble,
                turn.role === "user" ? styles.bubble_user : styles.bubble_assistant,
                turn.error && styles.bubble_error,
              ]}
            >
              {turn.error ? (
                <Text style={styles.err_head}>
                  {turn.failure
                    ? `${tr("Couldn't reach")} ${turn.failure.source}`
                    : tr("Can't do that")}
                </Text>
              ) : null}
              <Text
                style={turn.role === "user" ? styles.bubble_text_user : styles.bubble_text}
              >
                {turn.text}
                {turn.pending && turn.text.length === 0 ? "..." : ""}
              </Text>
              {turn.failure ? (
                <Pressable
                  onPress={() => on_failure_action(turn)}
                  style={styles.retry_btn}
                  accessibilityRole="button"
                >
                  <Text style={styles.retry_label}>
                    {turn.failure.action === "relink"
                      ? tr("Update login")
                      : tr("Retry")}
                  </Text>
                </Pressable>
              ) : null}
              {turn.source ? (
                <Text style={styles.msg_src}>{turn.source}</Text>
              ) : null}
              {turn.reminder ? (
                <View style={styles.rem_chip}>
                  <Text style={styles.rem_title}>{turn.reminder.title}</Text>
                  <Text style={styles.rem_when}>{turn.reminder.when}</Text>
                </View>
              ) : null}
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
          />
          <Pressable
            onPress={send}
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
    bubble_error: {
      borderColor: t.color.danger,
      backgroundColor: t.color.danger_soft,
    },
    err_head: {
      fontFamily: t.font.mono,
      fontSize: 10,
      letterSpacing: 1,
      textTransform: "uppercase",
      color: t.color.danger,
      marginBottom: 5,
    },
    retry_btn: {
      marginTop: t.spacing.sm,
      alignSelf: "flex-start",
      borderRadius: t.radius.pill,
      borderWidth: 1,
      borderColor: t.color.danger,
      paddingVertical: 6,
      paddingHorizontal: t.spacing.md,
    },
    retry_label: {
      fontFamily: t.font.body,
      fontSize: 13,
      color: t.color.danger,
    },
    msg_src: {
      marginTop: 7,
      paddingTop: 7,
      borderTopWidth: 1,
      borderTopColor: t.color.border,
      fontFamily: t.font.mono,
      fontSize: 10,
      color: t.color.ink_subtle,
    },
    rem_chip: {
      marginTop: t.spacing.sm,
      borderWidth: 1,
      borderColor: t.color.border_strong,
      borderRadius: t.radius.sm,
      backgroundColor: t.color.surface,
      paddingVertical: 10,
      paddingHorizontal: t.spacing.md,
    },
    rem_title: {
      fontFamily: t.font.body,
      fontWeight: "700",
      fontSize: 13.5,
      color: t.color.ink,
    },
    rem_when: {
      marginTop: 1,
      fontFamily: t.font.mono,
      fontSize: 11,
      color: t.color.primary,
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
