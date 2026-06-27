// Navigation chrome: scrollable screen wrapper, the portal-level wake bar, and
// the bottom tab bar. Styled from theme tokens. Mirrors the mockup's four
// surfaces (Chat, Feed, Accounts, Settings) with the "Hey Bex" wake bar pinned
// above the tabs on every screen.

import React from "react";
import {
  Pressable,
  ScrollView,
  Text,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { use_theme, use_t } from "@/m-res-shell";
import type { tab_def, tab_id } from "../types";

// Scroll column inside a panel, mirroring the mockup's .view.
export function Screen(props: { children: React.ReactNode }) {
  const t = use_theme();
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.color.paper }}
      contentContainerStyle={{
        paddingHorizontal: t.spacing.lg,
        paddingTop: t.spacing.md,
        paddingBottom: t.spacing.lg,
      }}
      showsVerticalScrollIndicator={false}
    >
      {props.children}
    </ScrollView>
  );
}

// Bottom tab order mirrors the mockup: Chat, Feed, Accounts, Settings.
const TABS: tab_def[] = [
  { id: "chat", label: "Chat", glyph: "💬" },
  { id: "feed", label: "Feed", glyph: "🔔" },
  { id: "accounts", label: "Accounts", glyph: "💳" },
  { id: "settings", label: "Settings", glyph: "⚙️" },
];

// Portal-level wake bar (mockup .wake): live dot, wake-word line, mute toggle.
export function WakeBar(props: { muted: boolean; onToggle: () => void }) {
  const t = use_theme();
  const tr = use_t();
  const c = t.color;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingVertical: t.spacing.sm,
        paddingHorizontal: t.spacing.lg,
        backgroundColor: c.surface,
        borderTopWidth: 1,
        borderTopColor: c.border,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: props.muted ? c.ink_subtle : c.signal,
        }}
      />
      <Text
        style={{
          fontFamily: t.font.mono,
          fontSize: 11,
          color: props.muted ? c.ink_subtle : c.ink_muted,
        }}
      >
        {props.muted ? tr("Wake word muted · ") : tr("Bex is listening · ")}
        <Text style={{ color: props.muted ? c.ink_subtle : c.ink }}>
          {props.muted ? tr("tap to resume") : '"Hey Bex"'}
        </Text>
      </Text>
      <Pressable onPress={props.onToggle} hitSlop={8} style={{ marginLeft: "auto" }}>
        <Text
          style={{
            fontFamily: t.font.mono,
            fontSize: 10.5,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: c.ink_subtle,
          }}
        >
          {props.muted ? tr("Unmute") : tr("Mute")}
        </Text>
      </Pressable>
    </View>
  );
}

export function TabBar(props: {
  active: tab_id;
  onSelect: (tab: tab_id) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
  // Count shown on the Feed tab badge (triggered items). 0 hides it.
  feed_badge?: number;
}) {
  const t = use_theme();
  const tr = use_t();
  const c = t.color;
  return (
    <View
      onLayout={props.onLayout}
      style={{
        flexDirection: "row",
        paddingTop: t.spacing.sm,
        paddingHorizontal: t.spacing.xs,
        paddingBottom: t.spacing.md + 4,
        backgroundColor: c.surface,
        borderTopWidth: 1,
        borderTopColor: c.border,
      }}
    >
      {TABS.map((tab) => {
        const on = props.active === tab.id;
        const badge =
          tab.id === "feed" && props.feed_badge && props.feed_badge > 0
            ? props.feed_badge
            : 0;
        return (
          <Pressable
            key={tab.id}
            onPress={() => props.onSelect(tab.id)}
            style={{ flex: 1, alignItems: "center", gap: 5, paddingVertical: 2 }}
          >
            <View>
              <Text style={{ fontSize: 20, color: on ? c.primary : c.ink_subtle }}>
                {tab.glyph}
              </Text>
              {badge > 0 ? (
                <View
                  style={{
                    position: "absolute",
                    top: -5,
                    right: -11,
                    minWidth: 16,
                    height: 16,
                    paddingHorizontal: 4,
                    borderRadius: t.radius.pill,
                    backgroundColor: c.signal,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      fontFamily: t.font.mono,
                      fontSize: 10,
                      color: c.on_signal,
                    }}
                  >
                    {badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text
              style={{
                fontFamily: t.font.body,
                fontSize: 11,
                fontWeight: on ? "600" : "500",
                color: on ? c.primary : c.ink_subtle,
              }}
            >
              {tr(tab.label)}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
