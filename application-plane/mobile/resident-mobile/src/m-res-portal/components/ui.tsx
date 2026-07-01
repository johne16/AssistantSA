// Shared RN primitives mirroring the mockup's component looks (card, row, kv,
// section header, back link, notice, sync bar, switch, chips, buttons). All
// styling pulls from the m-res-shell theme tokens. No hard-coded colors.

import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useTheme } from "@/m-res-shell";

// --- Section header: display title + muted description, optional eyebrow ---

export function SectionHeader(props: {
  title: string;
  detail?: string;
  eyebrow?: string;
}) {
  const t = useTheme();
  const c = t.color;
  return (
    <View style={{ marginBottom: t.spacing.md }}>
      {props.eyebrow ? (
        <Text
          style={{
            fontFamily: t.font.mono,
            fontSize: 12,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: c.accent,
            marginBottom: t.spacing.xs,
          }}
        >
          {props.eyebrow}
        </Text>
      ) : null}
      <Text
        style={{
          fontFamily: t.font.display,
          fontSize: 26,
          lineHeight: 32,
          color: c.ink,
        }}
      >
        {props.title}
      </Text>
      {props.detail ? (
        <Text
          style={{
            marginTop: t.spacing.xs,
            fontSize: 15,
            lineHeight: 21,
            color: c.ink_muted,
          }}
        >
          {props.detail}
        </Text>
      ) : null}
    </View>
  );
}

// --- Back link ---

export function BackLink(props: { label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={props.onPress}
      hitSlop={8}
      style={{ marginBottom: t.spacing.md, alignSelf: "flex-start" }}
    >
      <Text
        style={{
          fontFamily: t.font.body,
          fontSize: 14,
          color: t.color.ink_muted,
        }}
      >
        {"‹ " + props.label}
      </Text>
    </Pressable>
  );
}

// --- Card: warm raised fill, soft border, signature radius ---

export function Card(props: {
  children?: React.ReactNode;
  eyebrow?: string;
  title?: string;
  hint?: string;
}) {
  const t = useTheme();
  const c = t.color;
  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderWidth: 1,
        borderColor: c.border,
        borderRadius: t.radius.md,
        padding: t.spacing.lg,
        marginBottom: t.spacing.md,
      }}
    >
      {props.eyebrow ? (
        <Text
          style={{
            fontFamily: t.font.mono,
            fontSize: 12,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: c.accent,
            marginBottom: t.spacing.xs,
          }}
        >
          {props.eyebrow}
        </Text>
      ) : null}
      {props.title ? (
        <Text
          style={{
            fontFamily: t.font.display,
            fontSize: 20,
            lineHeight: 26,
            color: c.ink,
          }}
        >
          {props.title}
        </Text>
      ) : null}
      {props.hint ? (
        <Text
          style={{
            marginTop: t.spacing.xs,
            fontSize: 14,
            lineHeight: 20,
            color: c.ink_muted,
          }}
        >
          {props.hint}
        </Text>
      ) : null}
      {props.children}
    </View>
  );
}

// --- Key/value pair grid inside a card ---

export function KeyValue(props: { pairs: { k: string; v: string }[] }) {
  const t = useTheme();
  const c = t.color;
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        marginTop: t.spacing.md,
      }}
    >
      {props.pairs.map((p, i) => (
        <View
          key={i}
          style={{ marginRight: t.spacing.lg, marginBottom: t.spacing.sm }}
        >
          <Text
            style={{
              fontFamily: t.font.mono,
              fontSize: 11,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: c.ink_subtle,
            }}
          >
            {p.k}
          </Text>
          <Text style={{ marginTop: 2, fontSize: 14, color: c.ink }}>
            {p.v}
          </Text>
        </View>
      ))}
    </View>
  );
}

// --- Hub list row: tappable item with label, blurb, trailing chevron / tag.
// Static rows (directory entries) drop the chevron and the press affordance. ---

export function Row(props: {
  label: string;
  blurb?: string;
  onPress?: () => void;
  tag?: string;
  staticRow?: boolean;
}) {
  const t = useTheme();
  const c = t.color;
  const inner = (
    <>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: t.font.body,
            fontSize: 16,
            fontWeight: "600",
            color: c.ink,
          }}
        >
          {props.label}
        </Text>
        {props.blurb ? (
          <Text
            style={{
              marginTop: 2,
              fontSize: 13,
              lineHeight: 18,
              color: c.ink_muted,
            }}
          >
            {props.blurb}
          </Text>
        ) : null}
      </View>
      {props.tag ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: c.border,
            backgroundColor: c.surface_raised,
            borderRadius: t.radius.pill,
            paddingVertical: 3,
            paddingHorizontal: 9,
          }}
        >
          <Text
            style={{
              fontFamily: t.font.mono,
              fontSize: 10,
              letterSpacing: 1,
              textTransform: "uppercase",
              color: c.accent,
            }}
          >
            {props.tag}
          </Text>
        </View>
      ) : props.onPress && !props.staticRow ? (
        <Text style={{ fontSize: 20, color: c.ink_subtle }}>{"›"}</Text>
      ) : null}
    </>
  );

  const box = {
    flexDirection: "row" as const,
    alignItems: props.staticRow ? ("flex-start" as const) : ("center" as const),
    gap: t.spacing.md,
    backgroundColor: c.surface,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: t.radius.md,
    paddingVertical: t.spacing.md,
    paddingHorizontal: t.spacing.lg,
    marginBottom: t.spacing.sm,
  };

  if (props.onPress && !props.staticRow) {
    return (
      <Pressable onPress={props.onPress} style={box}>
        {inner}
      </Pressable>
    );
  }
  return <View style={box}>{inner}</View>;
}

// --- Blocked-feature notice (dashed border, accent pill) ---

export function BlockedNotice(props: { title: string; body: string }) {
  const t = useTheme();
  const c = t.color;
  return (
    <View
      style={{
        backgroundColor: c.surface,
        borderWidth: 1,
        borderStyle: "dashed",
        borderColor: c.border_strong,
        borderRadius: t.radius.md,
        padding: t.spacing.lg,
      }}
    >
      <View
        style={{
          alignSelf: "flex-start",
          backgroundColor: c.accent,
          borderRadius: t.radius.pill,
          paddingVertical: 4,
          paddingHorizontal: 11,
          marginBottom: t.spacing.md,
        }}
      >
        <Text
          style={{
            fontFamily: t.font.mono,
            fontSize: 11,
            letterSpacing: 1,
            textTransform: "uppercase",
            color: c.on_accent,
          }}
        >
          Unavailable
        </Text>
      </View>
      <Text
        style={{
          fontFamily: t.font.display,
          fontSize: 22,
          lineHeight: 28,
          color: c.ink,
        }}
      >
        {props.title}
      </Text>
      <Text
        style={{
          marginTop: t.spacing.sm,
          fontSize: 14.5,
          lineHeight: 21,
          color: c.ink_muted,
        }}
      >
        {props.body}
      </Text>
    </View>
  );
}

// --- Sync bar: spinning refresh icon bound to actual sync state ---

export function SyncBar(props: {
  syncing: boolean;
  meta: string;
  onPress: () => void;
}) {
  const t = useTheme();
  const c = t.color;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.syncing}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: t.spacing.md,
        marginBottom: t.spacing.lg,
        paddingVertical: 12,
        paddingHorizontal: t.spacing.md,
        backgroundColor: c.surface_raised,
        borderWidth: 1,
        borderColor: c.border_strong,
        borderRadius: t.radius.lg,
      }}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: t.radius.pill,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: c.accent,
        }}
      >
        {props.syncing ? (
          <ActivityIndicator size="small" color={c.on_accent} />
        ) : (
          <Text style={{ color: c.on_accent, fontSize: 18 }}>{"↻"}</Text>
        )}
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: t.font.body,
            fontSize: 15,
            fontWeight: "600",
            color: c.ink,
          }}
        >
          Sync all accounts
        </Text>
        <Text
          style={{
            fontFamily: t.font.mono,
            fontSize: 11,
            letterSpacing: 0.5,
            textTransform: "uppercase",
            color: c.ink_subtle,
            marginTop: 2,
          }}
        >
          {props.meta}
        </Text>
      </View>
    </Pressable>
  );
}

// --- Toggle switch ---

export function Switch(props: {
  value: boolean;
  onToggle: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const c = t.color;
  return (
    <Pressable
      onPress={props.disabled ? undefined : props.onToggle}
      style={{
        width: 46,
        height: 26,
        padding: 3,
        borderRadius: t.radius.pill,
        backgroundColor: props.value ? c.primary : c.border_strong,
        opacity: props.disabled ? 0.5 : 1,
        alignItems: props.value ? "flex-end" : "flex-start",
        justifyContent: "center",
      }}
    >
      <View
        style={{
          width: 20,
          height: 20,
          borderRadius: 10,
          backgroundColor: c.surface,
        }}
      />
    </Pressable>
  );
}

// --- Switch row: label + blurb + trailing switch ---

export function SwitchRow(props: {
  label: string;
  blurb?: string;
  value: boolean;
  onToggle: () => void;
  disabled?: boolean;
  first?: boolean;
}) {
  const t = useTheme();
  const c = t.color;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: t.spacing.md,
        paddingVertical: t.spacing.md,
        borderTopWidth: props.first ? 0 : 1,
        borderTopColor: c.border,
      }}
    >
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text
          style={{
            fontFamily: t.font.body,
            fontSize: 15,
            fontWeight: "600",
            color: c.ink,
          }}
        >
          {props.label}
        </Text>
        {props.blurb ? (
          <Text
            style={{
              marginTop: 2,
              fontSize: 13,
              lineHeight: 18,
              color: c.ink_muted,
            }}
          >
            {props.blurb}
          </Text>
        ) : null}
      </View>
      <Switch
        value={props.value}
        onToggle={props.onToggle}
        disabled={props.disabled}
      />
    </View>
  );
}

// --- Chip (single-select group member) ---

export function Chip(props: {
  label: string;
  selected: boolean;
  onPress: () => void;
  // Stretch to the parent-allotted width and center the label. Used for grid
  // layouts (e.g. the settings voice 2x2) instead of content-sized pills.
  fill?: boolean;
}) {
  const t = useTheme();
  const c = t.color;
  return (
    <Pressable
      onPress={props.onPress}
      style={{
        backgroundColor: props.selected ? c.accent : c.surface_raised,
        borderWidth: 1,
        borderColor: props.selected ? "transparent" : c.border,
        borderRadius: t.radius.pill,
        paddingVertical: 8,
        paddingHorizontal: t.spacing.md,
        marginRight: props.fill ? 0 : t.spacing.sm,
        marginBottom: t.spacing.sm,
        alignSelf: props.fill ? "stretch" : "auto",
        alignItems: props.fill ? "center" : "flex-start",
      }}
    >
      <Text
        style={{
          fontFamily: t.font.body,
          fontSize: 15,
          color: props.selected ? c.on_accent : c.ink_muted,
        }}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

// --- Primary / outline buttons ---

export function PrimaryButton(props: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const t = useTheme();
  const c = t.color;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={props.disabled}
      style={{
        marginTop: t.spacing.md,
        borderRadius: t.radius.lg,
        padding: t.spacing.md,
        backgroundColor: c.primary,
        alignItems: "center",
        opacity: props.disabled ? 0.6 : 1,
      }}
    >
      <Text
        style={{
          fontFamily: t.font.body,
          fontSize: 16,
          fontWeight: "600",
          color: c.on_primary,
        }}
      >
        {props.title}
      </Text>
    </Pressable>
  );
}

export function OutlineButton(props: { title: string; onPress: () => void }) {
  const t = useTheme();
  const c = t.color;
  return (
    <Pressable
      onPress={props.onPress}
      style={{
        marginTop: t.spacing.sm,
        borderRadius: t.radius.lg,
        padding: t.spacing.md,
        borderWidth: 1,
        borderColor: c.border_strong,
        alignItems: "center",
      }}
    >
      <Text
        style={{
          fontFamily: t.font.body,
          fontSize: 15,
          fontWeight: "600",
          color: c.ink_muted,
        }}
      >
        {props.title}
      </Text>
    </Pressable>
  );
}

// --- Labeled text field ---

export function Field(
  props: { label: string } & TextInputProps,
) {
  const t = useTheme();
  const c = t.color;
  const { label, style, ...rest } = props;
  return (
    <View style={{ marginTop: t.spacing.md }}>
      <Text
        style={{
          fontFamily: t.font.body,
          fontSize: 13,
          color: c.ink_muted,
          marginBottom: t.spacing.xs,
        }}
      >
        {label}
      </Text>
      <TextInput
        placeholderTextColor={c.ink_subtle}
        style={[
          {
            borderWidth: 1,
            borderColor: c.border_strong,
            borderRadius: t.radius.sm,
            backgroundColor: c.surface_raised,
            paddingHorizontal: t.spacing.md,
            paddingVertical: 10,
            fontFamily: t.font.body,
            fontSize: 16,
            color: c.ink,
          },
          style,
        ]}
        {...rest}
      />
    </View>
  );
}

// --- Small muted note text ---

export function Note(props: { children: React.ReactNode }) {
  const t = useTheme();
  return (
    <Text
      style={{
        marginTop: t.spacing.md,
        fontFamily: t.font.body,
        fontSize: 13,
        lineHeight: 19,
        color: t.color.ink_subtle,
      }}
    >
      {props.children}
    </Text>
  );
}

export const screen_styles = StyleSheet.create({
  view: { flexGrow: 1 },
});
