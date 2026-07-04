// Settings. Consolidates the former Profile + Preferences into the mockup's one
// surface: address (scopes civic + utility reads), voice wake word, language,
// Bex's voice, notification opt-ins, and appearance (dark theme). Reuses the
// shared ui primitives; address persists through accounts.save_profile.

import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { app_config } from "@/app-config";
import { useTheme, useThemeMode, useLang, useT } from "@/m-res-shell";
import { Screen } from "../components/chrome";
import { Chip, Field, PrimaryButton, SwitchRow } from "../components/ui";
import type { notification_preferences, resident_profile } from "../types";

// Mono uppercase block label between settings groups (mockup .block-label).
function BlockLabel(props: { children: string }) {
  const t = useTheme();
  return (
    <Text
      style={{
        fontFamily: t.font.mono,
        fontSize: 11,
        letterSpacing: 1.5,
        textTransform: "uppercase",
        color: t.color.ink_subtle,
        marginTop: t.spacing.lg,
        marginBottom: t.spacing.sm,
      }}
    >
      {props.children}
    </Text>
  );
}

// Save button that confirms inline (idle -> saving -> saved -> idle, or error).
type save_status = "idle" | "saving" | "saved" | "error";

function SaveButton(props: { label: string; on_save: () => Promise<boolean> }) {
  const t = useTheme();
  const tr = useT();
  const [status, set_status] = useState<save_status>("idle");
  const reset_timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (reset_timer.current) clearTimeout(reset_timer.current);
    };
  }, []);

  async function press() {
    if (status === "saving") return;
    set_status("saving");
    const ok = await props.on_save();
    if (ok) {
      set_status("saved");
      reset_timer.current = setTimeout(() => set_status("idle"), 2000);
    } else {
      set_status("error");
    }
  }

  const title =
    status === "saving"
      ? tr("Saving…")
      : status === "saved"
        ? tr("Saved ✓")
        : status === "error"
          ? `${props.label} — ${tr("try again")}`
          : props.label;
  return (
    <View>
      <PrimaryButton title={title} onPress={press} disabled={status === "saving"} />
      {status === "error" ? (
        <Text
          style={{
            marginTop: t.spacing.sm,
            fontSize: 13,
            lineHeight: 19,
            color: t.color.signal,
          }}
        >
          {tr("Couldn't save. Check your connection and try again.")}
        </Text>
      ) : null}
    </View>
  );
}

export function SettingsScreen(props: {
  profile: resident_profile;
  on_change_profile: (profile: resident_profile) => void;
  on_save_profile: (profile: resident_profile) => Promise<boolean>;
  on_lang_change: (lang: "en" | "es") => Promise<void>;
  prefs: notification_preferences;
  on_prefs_change: (prefs: notification_preferences) => void;
  voice_id: string;
  on_voice_id_change: (voice_id: string) => void;
  wake_enabled: boolean;
  on_wake_toggle: () => void;
}) {
  const t = useTheme();
  const tr = useT();
  const c = t.color;
  const app_lang = useLang();
  const lang = app_lang.lang;
  const theme_mode = useThemeMode();

  const { profile, on_change_profile, prefs } = props;
  const voices = app_config.voice_ids[lang === "es" ? "es" : "en"];
  const voice_pool = [
    ...voices.male.map((id) => ({ id, gender: "male" as const })),
    ...voices.female.map((id) => ({ id, gender: "female" as const })),
  ];

  function set_field(key: keyof resident_profile, value: string) {
    on_change_profile({ ...profile, [key]: value });
  }
  function toggle_pref(key: keyof notification_preferences) {
    props.on_prefs_change({ ...prefs, [key]: !prefs[key] });
  }
  function set_lang(next: "en" | "es") {
    // Voice ids are disjoint per language. Carry the picked voice across by its
    // position in the pool so the same "Voice N" stays selected after switching.
    const next_voices = app_config.voice_ids[next];
    const next_pool = [...next_voices.male, ...next_voices.female];
    const idx = voice_pool.findIndex((v) => v.id === props.voice_id);
    if (idx >= 0 && next_pool[idx]) props.on_voice_id_change(next_pool[idx]);
    // The portal flips profile.lang optimistically (which drives the app
    // language), awaits the save, and reverts the language on failure.
    void props.on_lang_change(next);
  }

  const group = {
    backgroundColor: c.surface_raised,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: t.radius.md,
    paddingHorizontal: t.spacing.md,
  } as const;

  return (
    <Screen>
      <View style={{ marginBottom: t.spacing.lg }}>
        <Text
          style={{
            fontFamily: t.font.mono,
            fontSize: 11,
            letterSpacing: 2,
            textTransform: "uppercase",
            color: c.signal,
          }}
        >
          {tr("Preferences")}
        </Text>
        <Text
          style={{
            marginTop: 7,
            fontFamily: t.font.display,
            fontSize: 33,
            lineHeight: 34,
            color: c.ink,
          }}
        >
          {tr("Settings")}
        </Text>
        <Text style={{ marginTop: t.spacing.sm, fontSize: 14.5, color: c.ink_muted }}>
          {tr("Tune how Bex talks, listens, and notifies you.")}
        </Text>
      </View>

      {/* Address */}
      <BlockLabel>{tr("Address")}</BlockLabel>
      <View style={[group, { paddingBottom: t.spacing.md }]}>
        <Field
          label={tr("Street address")}
          value={profile.street}
          onChangeText={(v) => set_field("street", v)}
        />
        <Field
          label={tr("ZIP code")}
          value={profile.zip}
          onChangeText={(v) => set_field("zip", v)}
          keyboardType="number-pad"
        />
        <Text
          style={{
            marginTop: t.spacing.md,
            fontSize: 13,
            lineHeight: 19,
            color: c.ink_subtle,
          }}
        >
          {tr("City and utility alerts are scoped to this address.")}
        </Text>
        <SaveButton
          label={tr("Save address")}
          on_save={() => props.on_save_profile(profile)}
        />
      </View>

      {/* Voice */}
      <BlockLabel>{tr("Voice")}</BlockLabel>
      <View style={group}>
        <SwitchRow
          first
          label={tr("Wake word")}
          blurb={tr('Listen for "Hey Bex" on every screen.')}
          value={props.wake_enabled}
          onToggle={props.on_wake_toggle}
        />
      </View>

      {/* Language */}
      <BlockLabel>{tr("Language")}</BlockLabel>
      <View style={[group, { paddingVertical: t.spacing.md }]}>
        <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
          <Chip label={tr("English")} selected={lang === "en"} onPress={() => set_lang("en")} />
          <Chip label="Español" selected={lang === "es"} onPress={() => set_lang("es")} />
        </View>
      </View>

      {/* Bex's voice */}
      <BlockLabel>{tr("Bex's voice")}</BlockLabel>
      <View style={[group, { paddingVertical: t.spacing.md }]}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" }}>
          {voice_pool.map((v, i) => (
            <View key={v.id} style={{ width: "48%" }}>
              <Chip
                fill
                label={`${v.gender === "male" ? tr("Male") : tr("Female")} ${
                  (i % 2) + 1
                }`}
                selected={props.voice_id === v.id}
                onPress={() => props.on_voice_id_change(v.id)}
              />
            </View>
          ))}
        </View>
      </View>

      {/* Notifications */}
      <BlockLabel>{tr("Notifications")}</BlockLabel>
      <View style={group}>
        <SwitchRow
          first
          label={tr("Push notifications")}
          blurb={tr("Reminders and civic alerts when the app is closed.")}
          value={prefs.push_enabled}
          onToggle={() => toggle_pref("push_enabled")}
        />
        <SwitchRow
          label={tr("Utility alerts")}
          blurb={tr("Outages and utility service alerts at your address.")}
          value={prefs.utility_alert_enabled}
          onToggle={() => toggle_pref("utility_alert_enabled")}
        />
        <SwitchRow
          label={tr("City alerts")}
          blurb={tr("Civic alerts that affect your area.")}
          value={prefs.city_alert_enabled}
          onToggle={() => toggle_pref("city_alert_enabled")}
        />
        <SwitchRow
          label={tr("Event reminders")}
          blurb={tr("A reminder before local events.")}
          value={prefs.event_reminder_enabled}
          onToggle={() => toggle_pref("event_reminder_enabled")}
        />
        <SwitchRow
          label={tr("Bill due reminders")}
          blurb={tr("A reminder one day before a utility bill is due.")}
          value={prefs.bills_reminder_enabled}
          onToggle={() => toggle_pref("bills_reminder_enabled")}
        />
      </View>

      {/* Appearance */}
      <BlockLabel>{tr("Appearance")}</BlockLabel>
      <View style={[group, { marginBottom: t.spacing.lg }]}>
        <SwitchRow
          first
          label={tr("Dark theme")}
          blurb={tr("Use a darker color scheme.")}
          value={theme_mode.mode === "dark"}
          onToggle={() =>
            theme_mode.set_override(theme_mode.mode === "dark" ? "light" : "dark")
          }
        />
      </View>
    </Screen>
  );
}
