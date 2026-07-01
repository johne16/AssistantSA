// Offline indicator pill, shown only while the device is offline. Non-blocking.

import React from "react";
import { Text, View } from "react-native";
import { useTheme } from "./theme";
import { useT } from "./i18n";
import { useOnline } from "./query";

export function OfflineBanner() {
  const t = useTheme();
  const tr = useT();
  const c = t.color;
  const online = useOnline();
  if (online) return null;

  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 9,
        paddingVertical: t.spacing.sm,
        paddingHorizontal: t.spacing.lg,
        backgroundColor: c.surface_raised,
        borderTopWidth: 1,
        borderTopColor: c.border,
      }}
    >
      <View
        style={{
          width: 8,
          height: 8,
          borderRadius: 4,
          backgroundColor: c.ink_subtle,
        }}
      />
      <Text
        style={{
          fontFamily: t.font.mono,
          fontSize: 11,
          color: c.ink_muted,
        }}
      >
        {tr("Offline — showing saved data")}
      </Text>
    </View>
  );
}
