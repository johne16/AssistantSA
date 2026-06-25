// Navigation chrome: scrollable screen wrapper and the bottom tab bar.
// Styled from theme tokens.

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

// Bottom tab order mirrors the mockup: Home, City, Ask (center), Utility, Discover.
const TABS: tab_def[] = [
  { id: "home", label: "Home", glyph: "⌂" },
  { id: "city", label: "City", glyph: "▣" },
  { id: "ask", label: "Ask", glyph: "A", ask: true },
  { id: "utility", label: "Utility", glyph: "⚡" },
  { id: "discover", label: "Discover", glyph: "◎" },
];

export function TabBar(props: {
  active: tab_id;
  onSelect: (tab: tab_id) => void;
  onLayout?: (event: LayoutChangeEvent) => void;
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
        if (tab.ask) {
          return (
            <Pressable
              key={tab.id}
              onPress={() => props.onSelect(tab.id)}
              style={{ flex: 1, alignItems: "center" }}
            >
              <View
                style={{
                  width: 38,
                  height: 38,
                  borderRadius: t.radius.md,
                  backgroundColor: c.accent,
                  alignItems: "center",
                  justifyContent: "center",
                  marginTop: -10,
                }}
              >
                <Text
                  style={{
                    fontFamily: t.font.display,
                    fontSize: 19,
                    color: c.on_accent,
                  }}
                >
                  {tab.glyph}
                </Text>
              </View>
              <Text
                style={{
                  fontFamily: t.font.body,
                  fontSize: 11,
                  fontWeight: "600",
                  color: c.accent,
                  marginTop: 5,
                }}
              >
                {tr(tab.label)}
              </Text>
            </Pressable>
          );
        }
        return (
          <Pressable
            key={tab.id}
            onPress={() => props.onSelect(tab.id)}
            style={{ flex: 1, alignItems: "center", gap: 5, paddingVertical: 2 }}
          >
            <Text style={{ fontSize: 20, color: on ? c.primary : c.ink_subtle }}>
              {tab.glyph}
            </Text>
            <Text
              style={{
                fontFamily: t.font.body,
                fontSize: 11,
                fontWeight: on ? "600" : "500",
                color: on ? c.primary : c.ink_subtle,
              }}
            >
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
