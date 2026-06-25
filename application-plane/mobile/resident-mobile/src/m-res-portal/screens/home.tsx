// Home, profile, and preferences screens.
//
// Home renders the localized front door, the alerts feed (from m-res-civic), and
// a jump grid. Preferences hosts the language and notification-preference
// toggles; the toggles gate which sources the home feed aggregates. When OS
// permission is denied the toggles stay visible but inert with a prompt to
// enable in OS settings.

import React, { useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { app_config } from "@/app-config";
import { use_theme, use_lang, use_t } from "@/m-res-shell";
import type { alert_entry, civic_client, event_entry } from "@/m-res-civic";
import type { use_accounts_value } from "@/m-res-accounts";
import { Screen } from "../components/chrome";
import {
  BackLink,
  Card,
  Chip,
  Field,
  PrimaryButton,
  Row,
  SectionHeader,
  SwitchRow,
} from "../components/ui";
import type {
  feed_item,
  notification_preferences,
  panel_id,
  resident_profile,
} from "../types";

export function HomeScreen(props: {
  civic: civic_client;
  accounts: use_accounts_value;
  address: string;
  prefs: notification_preferences;
  select: (id: panel_id) => void;
}) {
  const t = use_theme();
  const tr = use_t();
  const c = t.color;
  const [feed, set_feed] = useState<feed_item[]>([]);

  // Aggregate the alert feed from every source whose preference toggle is on.
  // Each fetch is independent; a failing source drops out without blocking the
  // rest. The feed renders titles only.
  const { civic, accounts, address, prefs } = props;
  useEffect(() => {
    let live = true;
    const items: feed_item[] = [];
    const tasks: Promise<void>[] = [];

    if (prefs.city_alert_enabled) {
      tasks.push(
        civic
          .civic_view_request({ resource: "alerts", params: { address } })
          .then((res) => {
            for (const a of (res.data as alert_entry[]) ?? []) {
              items.push({ id: a.entry_id, title: a.title });
            }
          })
          .catch(() => {}),
      );
    }
    if (prefs.event_reminder_enabled) {
      tasks.push(
        civic
          .civic_view_request({ resource: "events", params: { address } })
          .then((res) => {
            for (const e of (res.data as event_entry[]) ?? []) {
              items.push({ id: e.entry_id, title: e.title });
            }
          })
          .catch(() => {}),
      );
    }
    if (prefs.utility_alert_enabled) {
      tasks.push(
        accounts
          .utility_view_request({ resource: "outage", params: {} })
          .then((d) => {
            for (const o of d.outage ?? []) {
              items.push({ id: o.outage_id, title: `Power outage: ${o.status}` });
            }
          })
          .catch(() => {}),
      );
    }
    if (prefs.bills_reminder_enabled) {
      tasks.push(
        accounts
          .utility_view_request({ resource: "bills", params: {} })
          .then((d) => {
            for (const b of d.bills ?? []) {
              items.push({ id: b.statement_id, title: `Bill due ${b.due_date}` });
            }
          })
          .catch(() => {}),
      );
    }

    void Promise.all(tasks).then(() => {
      if (live) set_feed(items);
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    civic,
    accounts,
    address,
    prefs.city_alert_enabled,
    prefs.event_reminder_enabled,
    prefs.utility_alert_enabled,
    prefs.bills_reminder_enabled,
  ]);

  return (
    <Screen>
      <View style={{ marginBottom: t.spacing.lg }}>
        <Text
          style={{
            fontFamily: t.font.mono,
            fontSize: 12,
            letterSpacing: 0.5,
            color: c.ink_muted,
          }}
        >
          {props.address ? `◆ San Antonio · ${props.address}` : "◆ San Antonio"}
        </Text>
        <Text
          style={{
            marginTop: t.spacing.sm,
            fontFamily: t.font.display,
            fontSize: 40,
            lineHeight: 42,
            color: c.ink,
          }}
        >
          AssistantSA
        </Text>
        <Text style={{ marginTop: t.spacing.xs, fontSize: 16, color: c.ink_muted }}>
          {tr("All of San Antonio, in one place.")}
        </Text>
        <View
          style={{
            height: 3,
            width: 52,
            marginTop: t.spacing.md,
            borderRadius: t.radius.pill,
            backgroundColor: c.accent,
          }}
        />
      </View>

      <Card title={tr("Alerts near you")}>
        {feed.slice(0, 3).map((item) => (
          <View key={item.id} style={{ marginTop: t.spacing.sm }}>
            <Text
              style={{
                fontFamily: t.font.body,
                fontSize: 15,
                fontWeight: "600",
                color: c.ink,
              }}
            >
              {item.title}
            </Text>
          </View>
        ))}
      </Card>

      <Text
        style={{
          fontFamily: t.font.mono,
          fontSize: 12,
          letterSpacing: 1,
          textTransform: "uppercase",
          color: c.ink_subtle,
          marginBottom: t.spacing.sm,
        }}
      >
        {tr("Jump to")}
      </Text>
      <Row label={tr("Power status")} blurb={tr("Utility")} onPress={() => props.select("power_status")} />
      <Row label={tr("Report a problem")} blurb={tr("City · 311")} onPress={() => props.select("three_one_one")} />
      <Row label={tr("Bills & usage")} blurb={tr("Utility")} onPress={() => props.select("utility_hub")} />
      <Row label={tr("Local businesses")} blurb={tr("Discover")} onPress={() => props.select("discovery")} />
      <Row label={tr("My area")} blurb={tr("City")} onPress={() => props.select("my_area")} />
      <Row label={tr("Profile & settings")} blurb={tr("You")} onPress={() => props.select("profile")} />
    </Screen>
  );
}

// Save button that confirms inline: idle label -> "Saving…" (disabled) ->
// "Saved ✓" for a beat -> back to idle. On failure it shows a retry label and
// an error line beneath, and stays tappable so the resident can try again.
// on_save resolves true on a persisted save, false if it failed.
type save_status = "idle" | "saving" | "saved" | "error";

function SaveButton(props: { label: string; on_save: () => Promise<boolean> }) {
  const t = use_theme();
  const tr = use_t();
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
            color: t.color.accent,
          }}
        >
          {tr("Couldn't save. Check your connection and try again.")}
        </Text>
      ) : null}
    </View>
  );
}

export function ProfileScreen(props: {
  profile: resident_profile;
  on_change: (profile: resident_profile) => void;
  on_save: (profile: resident_profile) => Promise<boolean>;
  onBack: () => void;
  select: (id: panel_id) => void;
}) {
  const tr = use_t();
  const { profile, on_change } = props;
  function set_field(key: keyof resident_profile, value: string) {
    on_change({ ...profile, [key]: value });
  }
  return (
    <Screen>
      <BackLink label={tr("Home")} onPress={props.onBack} />
      <SectionHeader
        title={tr("Profile")}
        detail={tr("Your address determines which city services, schedules, and alerts AssistantSA shows you.")}
      />
      <Card title={tr("Service address")}>
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
        <SaveButton label={tr("Save address")} on_save={() => props.on_save(profile)} />
      </Card>
      <Card title={tr("Contact")}>
        <Field
          label={tr("Name")}
          value={profile.name}
          onChangeText={(v) => set_field("name", v)}
        />
        <Field
          label={tr("Email")}
          value={profile.email}
          onChangeText={(v) => set_field("email", v)}
          keyboardType="email-address"
          autoCapitalize="none"
        />
        <Field
          label={tr("Phone")}
          value={profile.phone}
          onChangeText={(v) => set_field("phone", v)}
          keyboardType="phone-pad"
        />
        <SaveButton label={tr("Save contact")} on_save={() => props.on_save(profile)} />
      </Card>
      <Row
        label={tr("Preferences")}
        blurb={tr("Language and notifications")}
        onPress={() => props.select("preferences")}
      />
    </Screen>
  );
}

export function PreferencesScreen(props: {
  prefs: notification_preferences;
  on_change: (prefs: notification_preferences) => void;
  permission_denied: boolean;
  profile: resident_profile;
  on_save_profile: (profile: resident_profile) => void;
  voice_id: string;
  on_voice_id_change: (voice_id: string) => void;
  onBack: () => void;
}) {
  const t = use_theme();
  const tr = use_t();
  const app_lang = use_lang();
  const lang = app_lang.lang;
  // Voices offered for the resident's language, grouped by gender. Two per
  // gender per the configured pool.
  const voices = app_config.voice_ids[lang === "es" ? "es" : "en"];

  function toggle(key: keyof notification_preferences) {
    props.on_change({ ...props.prefs, [key]: !props.prefs[key] });
  }

  function set_lang(next: string) {
    // Switch the app language immediately, then persist the profile in the
    // background. The UI must not wait on the backend write to change language.
    app_lang.set_lang(next === "es" ? "es" : "en");
    props.on_save_profile({ ...props.profile, lang: next });
  }

  return (
    <Screen>
      <BackLink label={tr("Profile")} onPress={props.onBack} />
      <SectionHeader
        title={tr("Preferences")}
        detail={tr("Set your language and which notifications you receive.")}
      />
      <Card title={tr("Language")}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", marginTop: t.spacing.sm }}>
          <Chip label={tr("English")} selected={lang === "en"} onPress={() => set_lang("en")} />
          <Chip label="Español" selected={lang === "es"} onPress={() => set_lang("es")} />
        </View>
      </Card>
      <Card title={tr("Notifications")}>
        {props.permission_denied ? (
          <Text
            style={{
              marginTop: t.spacing.sm,
              fontSize: 13,
              lineHeight: 19,
              color: t.color.accent,
            }}
          >
            {tr("Notifications are turned off for AssistantSA. Enable them in your device Settings to receive alerts.")}
          </Text>
        ) : null}
        <SwitchRow
          first
          label={tr("Utility alerts")}
          blurb={tr("Outages and utility service alerts at your address.")}
          value={props.prefs.utility_alert_enabled}
          disabled={props.permission_denied}
          onToggle={() => toggle("utility_alert_enabled")}
        />
        <SwitchRow
          label={tr("City alerts")}
          blurb={tr("Civic alerts that affect your area.")}
          value={props.prefs.city_alert_enabled}
          disabled={props.permission_denied}
          onToggle={() => toggle("city_alert_enabled")}
        />
        <SwitchRow
          label={tr("Event reminders")}
          blurb={tr("A reminder before local events.")}
          value={props.prefs.event_reminder_enabled}
          disabled={props.permission_denied}
          onToggle={() => toggle("event_reminder_enabled")}
        />
        <SwitchRow
          label={tr("Bill due reminders")}
          blurb={tr("A reminder before a utility bill is due.")}
          value={props.prefs.bills_reminder_enabled}
          disabled={props.permission_denied}
          onToggle={() => toggle("bills_reminder_enabled")}
        />
      </Card>
      <Card title={tr("Voice")}>
        <Text
          style={{
            marginTop: t.spacing.sm,
            fontSize: 13,
            lineHeight: 19,
            color: t.color.ink_muted,
          }}
        >
          {tr("Choose the assistant's voice.")}
        </Text>
        <View
          style={{
            flexDirection: "row",
            flexWrap: "wrap",
            justifyContent: "space-between",
            marginTop: t.spacing.sm,
          }}
        >
          {[
            ...voices.male.map((id, i) => ({
              id,
              gender: tr("Male"),
              num: i + 1,
            })),
            ...voices.female.map((id, i) => ({
              id,
              gender: tr("Female"),
              num: i + 1,
            })),
          ].map(({ id, gender, num }) => {
            const selected = props.voice_id === id;
            return (
              <Pressable
                key={id}
                onPress={() => props.on_voice_id_change(id)}
                style={{
                  width: "48%",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 1,
                  backgroundColor: selected ? t.color.accent : t.color.surface_raised,
                  borderWidth: 1,
                  borderColor: selected ? "transparent" : t.color.border,
                  borderRadius: t.radius.pill,
                  paddingVertical: 8,
                  paddingHorizontal: t.spacing.md,
                  marginBottom: t.spacing.sm,
                }}
              >
                <Text
                  style={{
                    fontFamily: t.font.body,
                    fontSize: 15,
                    color: selected ? t.color.on_accent : t.color.ink_muted,
                  }}
                >
                  {gender}
                </Text>
                <Text
                  style={{
                    fontFamily: t.font.mono,
                    fontSize: 12,
                    opacity: 0.8,
                    color: selected ? t.color.on_accent : t.color.ink_muted,
                  }}
                >
                  {num}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Card>
    </Screen>
  );
}
