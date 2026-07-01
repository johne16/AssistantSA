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
import { Canvas, Group, Path, Skia } from "@shopify/react-native-skia";
import { useTheme, useT } from "@/m-res-shell";
import type { tab_def, tab_id } from "../types";

// Scroll column inside a panel, mirroring the mockup's .view.
export function Screen(props: { children: React.ReactNode }) {
  const t = useTheme();
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
  { id: "chat", label: "Chat" },
  { id: "feed", label: "Feed" },
  { id: "accounts", label: "Accounts" },
  { id: "settings", label: "Settings" },
];

// Tab icons, as the mockup's SVG path data (24x24 viewBox, stroked line icons).
// Each tab is one or more subpaths drawn as strokes; rendered with Skia so no
// extra icon dependency is needed.
const TAB_ICON_SIZE = 23;
const TAB_ICON_VIEWBOX = 24;
const TAB_ICONS: Record<tab_id, string[]> = {
  chat: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  feed: [
    "M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9",
    "M13.7 21a2 2 0 0 1-3.4 0",
  ],
  accounts: [
    "M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z",
    "M2 10h20",
  ],
  settings: [
    "M9 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0z",
    "M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z",
  ],
};

// One tab icon: the mockup's stroked line icon, scaled from the 24px viewBox to
// the rendered size and tinted by the active/inactive color.
function TabIcon(props: { tab: tab_id; color: string }) {
  const scale = TAB_ICON_SIZE / TAB_ICON_VIEWBOX;
  return (
    <Canvas style={{ width: TAB_ICON_SIZE, height: TAB_ICON_SIZE }}>
      <Group transform={[{ scale }]}>
        {TAB_ICONS[props.tab].map((d, i) => {
          const path = Skia.Path.MakeFromSVGString(d);
          if (!path) return null;
          return (
            <Path
              key={i}
              path={path}
              style="stroke"
              strokeWidth={2}
              strokeJoin="round"
              strokeCap="round"
              color={props.color}
            />
          );
        })}
      </Group>
    </Canvas>
  );
}

// Green shown on the wake-bar dot while a wake-word detection's voice session is
// live. Sits on the surface in both themes; not a theme token because it is the
// only wake-trigger accent in the app.
const WAKE_TRIGGERED_GREEN = "#2e9e5b";

// Portal-level wake bar (mockup .wake): live dot, wake-word line, mute toggle.
// triggered turns the dot green while the wake word has opened a voice session.
export function WakeBar(props: {
  muted: boolean;
  triggered?: boolean;
  onToggle: () => void;
}) {
  const t = useTheme();
  const tr = useT();
  const c = t.color;
  // Muted: subtle. Triggered (wake fired): green. Listening: the amber signal.
  const dot_color = props.muted
    ? c.ink_subtle
    : props.triggered
      ? WAKE_TRIGGERED_GREEN
      : c.signal;
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
          backgroundColor: dot_color,
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
  const t = useTheme();
  const tr = useT();
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
              <TabIcon tab={tab.id} color={on ? c.primary : c.ink_subtle} />
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
