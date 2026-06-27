// Feed: the time spine. One stream split by a Triggered / Upcoming toggle.
// Triggered merges fired civic alerts (tiered by severity) and reminders that
// have gone off; Upcoming lists scheduled reminders. Items are dismissible with
// an undo toast, except critical (life-safety) items, which carry an explicit
// acknowledgement and are never swept by Clear all.
//
// Alerts and their dismissal state are owned by the Portal (so the tab badge and
// the list stay in sync from one fetch). Reminders come from m-res-reminders and
// own their own dismissal. Alert dismissal is local to the session (no per-alert
// backend dismiss endpoint yet).

import React, { useCallback, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { use_theme, use_t } from "@/m-res-shell";
import type { alert_entry } from "@/m-res-civic";
import type { reminders_client } from "@/m-res-reminders";
import { Screen } from "../components/chrome";
import { SectionHeader } from "../components/ui";
import type { feed_item, feed_lane, feed_tier } from "../types";

function relative_when(iso: string): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// The feed_item id for a civic alert. Kept in one place so the Portal badge and
// this screen agree on the dismissal key.
export function alert_feed_id(entry_id: string): string {
  return `a_${entry_id}`;
}

export function FeedScreen(props: {
  alerts: alert_entry[];
  dismissed_alerts: Set<string>;
  on_dismiss_alerts: (ids: string[]) => void;
  on_restore_alerts: (ids: string[]) => void;
  reminders: reminders_client;
}) {
  const t = use_theme();
  const tr = use_t();
  const c = t.color;

  const [view, set_view] = useState<feed_lane>("triggered");

  // Undo: remember the last dismissal batch so it can be restored.
  const [undo_label, set_undo_label] = useState<string | null>(null);
  const undo_batch = useRef<{ alerts: string[]; reminders: string[] }>({
    alerts: [],
    reminders: [],
  });
  const undo_timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { alerts, dismissed_alerts, reminders } = props;

  React.useEffect(() => {
    return () => {
      if (undo_timer.current) clearTimeout(undo_timer.current);
    };
  }, []);

  // Build the two lanes from alerts + reminders.
  const triggered: feed_item[] = useMemo(() => {
    const items: feed_item[] = [];
    for (const a of alerts) {
      const aid = alert_feed_id(a.entry_id);
      if (dismissed_alerts.has(aid)) continue;
      const tier = a.tier;
      items.push({
        id: aid,
        lane: "triggered",
        tier,
        kind_label: `${tr("Alert")} · ${a.source.toUpperCase()}`,
        when_display: relative_when(a.effective_at),
        title: a.title,
        body: a.body,
        dismissible: tier !== "critical",
      });
    }
    for (const r of reminders.reminders) {
      if (r.status !== "fired") continue;
      items.push({
        id: r.id,
        lane: "triggered",
        tier: "routine",
        kind_label: tr("Reminder · you asked"),
        when_display: r.when_display,
        title: r.title,
        body: r.body,
        dismissible: true,
      });
    }
    return items;
  }, [alerts, dismissed_alerts, reminders.reminders, tr]);

  const upcoming: feed_item[] = useMemo(() => {
    return reminders.reminders
      .filter((r) => r.status === "upcoming")
      .map((r) => ({
        id: r.id,
        lane: "upcoming" as const,
        tier: "upcoming" as feed_tier,
        kind_label: tr("Reminder · you asked"),
        when_display: r.when_display,
        title: r.title,
        body: r.body,
        dismissible: true,
      }));
  }, [reminders.reminders, tr]);

  const list = view === "triggered" ? triggered : upcoming;

  const is_reminder = useCallback(
    (id: string) => reminders.reminders.some((r) => r.id === id),
    [reminders.reminders],
  );

  const show_undo = useCallback((label: string) => {
    set_undo_label(label);
    if (undo_timer.current) clearTimeout(undo_timer.current);
    undo_timer.current = setTimeout(() => set_undo_label(null), 5000);
  }, []);

  const dismiss_item = useCallback(
    (item: feed_item) => {
      undo_batch.current = { alerts: [], reminders: [] };
      if (is_reminder(item.id)) {
        reminders.dismiss(item.id);
        undo_batch.current.reminders.push(item.id);
      } else {
        props.on_dismiss_alerts([item.id]);
        undo_batch.current.alerts.push(item.id);
      }
      show_undo(tr("Dismissed"));
    },
    [is_reminder, reminders, props, show_undo, tr],
  );

  const clear_all = useCallback(() => {
    // Clear all never touches critical items.
    const cleared = list.filter((i) => i.dismissible);
    if (cleared.length === 0) return;
    undo_batch.current = { alerts: [], reminders: [] };
    const alert_ids: string[] = [];
    for (const item of cleared) {
      if (is_reminder(item.id)) {
        reminders.dismiss(item.id);
        undo_batch.current.reminders.push(item.id);
      } else {
        alert_ids.push(item.id);
        undo_batch.current.alerts.push(item.id);
      }
    }
    if (alert_ids.length > 0) props.on_dismiss_alerts(alert_ids);
    show_undo(
      cleared.length === 1
        ? tr("Dismissed 1 item")
        : `${tr("Dismissed")} ${cleared.length} ${tr("items")}`,
    );
  }, [list, is_reminder, reminders, props, show_undo, tr]);

  const undo = useCallback(() => {
    const batch = undo_batch.current;
    if (batch.alerts.length > 0) props.on_restore_alerts(batch.alerts);
    for (const id of batch.reminders) reminders.restore(id);
    undo_batch.current = { alerts: [], reminders: [] };
    set_undo_label(null);
    if (undo_timer.current) clearTimeout(undo_timer.current);
  }, [props, reminders]);

  const count = list.length;
  const count_noun =
    view === "upcoming"
      ? tr("scheduled")
      : count === 1
        ? tr("item")
        : tr("items");

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        <SectionHeader
          eyebrow={tr("Reminders & alerts")}
          title={tr("Feed")}
          detail={tr("Delivered alerts and reminders, plus what's scheduled ahead.")}
        />

        {/* Triggered / Upcoming segmented toggle */}
        <View
          style={{
            flexDirection: "row",
            gap: t.spacing.xs,
            backgroundColor: c.surface,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: t.radius.pill,
            padding: 4,
            marginBottom: t.spacing.md,
          }}
        >
          {(["triggered", "upcoming"] as feed_lane[]).map((lane) => {
            const on = view === lane;
            return (
              <Pressable
                key={lane}
                onPress={() => set_view(lane)}
                style={{
                  flex: 1,
                  paddingVertical: 9,
                  borderRadius: t.radius.pill,
                  alignItems: "center",
                  backgroundColor: on ? c.primary : "transparent",
                }}
              >
                <Text
                  style={{
                    fontFamily: t.font.body,
                    fontSize: 13.5,
                    fontWeight: "600",
                    color: on ? c.on_primary : c.ink_muted,
                  }}
                >
                  {lane === "triggered" ? tr("Triggered") : tr("Upcoming")}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* count + clear all */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "baseline",
            justifyContent: "space-between",
            marginBottom: t.spacing.lg,
          }}
        >
          <Text
            style={{ fontFamily: t.font.mono, fontSize: 11, color: c.ink_subtle }}
          >
            {`${count} ${count_noun}`}
          </Text>
          <Pressable onPress={clear_all} hitSlop={8}>
            <Text
              style={{
                fontFamily: t.font.body,
                fontSize: 13,
                fontWeight: "600",
                color: c.ink_subtle,
              }}
            >
              {tr("Clear all")}
            </Text>
          </Pressable>
        </View>

        {count === 0 ? (
          <View style={{ paddingVertical: t.spacing.xxl, alignItems: "center" }}>
            <Text
              style={{
                fontFamily: t.font.display,
                fontSize: 22,
                color: c.ink_muted,
              }}
            >
              {view === "upcoming"
                ? tr("Nothing scheduled")
                : tr("You're all caught up")}
            </Text>
            <Text
              style={{
                marginTop: t.spacing.xs,
                fontSize: 14,
                color: c.ink_subtle,
              }}
            >
              {view === "upcoming"
                ? tr("Ask Bex to remind you about anything.")
                : tr("New reminders and alerts land here.")}
            </Text>
          </View>
        ) : (
          // the spine: a single vertical line with a dot per moment
          <View style={{ position: "relative", paddingLeft: 30 }}>
            <View
              style={{
                position: "absolute",
                left: 8,
                top: 4,
                bottom: 4,
                width: 2,
                borderRadius: 2,
                backgroundColor: c.border_strong,
              }}
            />
            {list.map((item) => (
              <FeedRow key={item.id} item={item} onDismiss={dismiss_item} />
            ))}
          </View>
        )}
      </Screen>

      {/* undo toast */}
      {undo_label ? (
        <View
          style={{
            position: "absolute",
            left: t.spacing.lg,
            right: t.spacing.lg,
            bottom: t.spacing.md,
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: c.ink,
            borderRadius: t.radius.pill,
            paddingVertical: 10,
            paddingLeft: t.spacing.md,
            paddingRight: t.spacing.sm,
          }}
        >
          <Text style={{ fontFamily: t.font.body, fontSize: 13, color: c.paper }}>
            {undo_label}
          </Text>
          <Pressable onPress={undo} hitSlop={8} style={{ paddingHorizontal: 10 }}>
            <Text
              style={{
                fontFamily: t.font.body,
                fontWeight: "700",
                fontSize: 13,
                color: c.signal,
              }}
            >
              {tr("Undo")}
            </Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

// One item on the spine. Tier drives the dot color, left rule, and (for critical)
// the severity badge + acknowledge button.
function FeedRow(props: {
  item: feed_item;
  onDismiss: (item: feed_item) => void;
}) {
  const t = use_theme();
  const tr = use_t();
  const c = t.color;
  const { item } = props;

  const dot_color =
    item.tier === "critical"
      ? c.danger
      : item.tier === "important"
        ? c.signal
        : item.tier === "upcoming"
          ? c.primary
          : c.ink_subtle;

  const card_bg =
    item.tier === "critical"
      ? c.danger_soft
      : item.tier === "routine"
        ? c.surface
        : c.surface_raised;

  const kind_color =
    item.tier === "critical"
      ? c.danger
      : item.tier === "important"
        ? c.signal
        : item.tier === "upcoming"
          ? c.primary
          : c.ink_subtle;

  return (
    <View
      style={{
        position: "relative",
        backgroundColor: card_bg,
        borderWidth: item.tier === "critical" ? 1.5 : 1,
        borderColor: item.tier === "critical" ? c.danger : c.border,
        borderRadius: t.radius.md,
        padding: t.spacing.md,
        marginBottom: t.spacing.sm,
        borderLeftWidth:
          item.tier === "important" || item.tier === "critical" ? 4 : 1,
        borderLeftColor:
          item.tier === "important"
            ? c.signal
            : item.tier === "critical"
              ? c.danger
              : c.border,
      }}
    >
      {/* spine dot */}
      <View
        style={{
          position: "absolute",
          left: -22,
          top: 18,
          width: 11,
          height: 11,
          borderRadius: 6,
          backgroundColor: dot_color,
          borderWidth: 2,
          borderColor: dot_color,
        }}
      />

      {item.tier === "critical" ? (
        <View
          style={{
            alignSelf: "flex-start",
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            backgroundColor: c.danger,
            borderRadius: t.radius.pill,
            paddingVertical: 4,
            paddingHorizontal: 9,
            marginBottom: t.spacing.sm,
          }}
        >
          <Text
            style={{
              fontFamily: t.font.mono,
              fontSize: 9.5,
              letterSpacing: 1.5,
              textTransform: "uppercase",
              color: c.on_danger,
            }}
          >
            {tr("Health & safety")}
          </Text>
        </View>
      ) : null}

      <View style={{ flexDirection: "row", alignItems: "center", gap: t.spacing.sm }}>
        <Text
          style={{
            fontFamily: t.font.mono,
            fontSize: 10,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            color: kind_color,
          }}
        >
          {item.kind_label}
        </Text>
        <Text
          style={{
            marginLeft: "auto",
            fontFamily: t.font.mono,
            fontSize: 10.5,
            color: c.ink_subtle,
          }}
        >
          {item.when_display}
        </Text>
        {item.dismissible ? (
          <Pressable onPress={() => props.onDismiss(item)} hitSlop={8}>
            <Text style={{ fontSize: 17, color: c.ink_subtle, lineHeight: 18 }}>
              ×
            </Text>
          </Pressable>
        ) : null}
      </View>

      <Text
        style={{
          fontFamily: t.font.body,
          fontWeight: item.tier === "routine" ? "600" : "700",
          fontSize: 16,
          color: item.tier === "routine" ? c.ink_muted : c.ink,
          marginTop: t.spacing.sm,
        }}
      >
        {item.title}
      </Text>
      {item.body ? (
        <Text
          style={{
            marginTop: 3,
            fontSize: 13.5,
            lineHeight: 19,
            color: c.ink_muted,
          }}
        >
          {item.body}
        </Text>
      ) : null}

      {item.tier === "critical" ? (
        <Pressable
          onPress={() => props.onDismiss(item)}
          style={{
            marginTop: t.spacing.md,
            backgroundColor: c.danger,
            borderRadius: t.radius.sm,
            paddingVertical: 11,
            alignItems: "center",
          }}
        >
          <Text
            style={{
              fontFamily: t.font.body,
              fontWeight: "600",
              fontSize: 13.5,
              color: c.on_danger,
            }}
          >
            {tr("I've read this")}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}
