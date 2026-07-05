// Credential capture component for the link-account screen. The portal hosts
// the screen but never reads or holds the values. On submit this writes the
// entry straight to the device keystore keyed by site_id; the values never
// leave the device.

import React, { useState } from "react";
import {
  Button,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useTheme } from "@/m-res-shell";

import { save_credentials } from "./keystore";
import type { credential_entry } from "./types";

export interface link_account_fields_props {
  site_id: string;
  // Fired after the entry is written to the keystore. No values are passed up.
  on_linked?: () => void;
  // Submit button title. Defaults to "Link account"; the accounts screen passes
  // "Save" when re-entering credentials for an already-linked account.
  submit_label?: string;
}

export function LinkAccountFields(props: link_account_fields_props) {
  const { site_id, on_linked, submit_label } = props;
  const t = useTheme();
  const c = t.color;
  const [username, set_username] = useState("");
  const [password, set_password] = useState("");
  const [saving, set_saving] = useState(false);
  const [show_password, set_show_password] = useState(false);
  const [error, set_error] = useState<string | null>(null);

  async function submit() {
    set_saving(true);
    set_error(null);
    try {
      const entry: credential_entry = { site_id, username, password };
      await save_credentials(entry);
      set_username("");
      set_password("");
      on_linked?.();
    } catch (e) {
      // Keystore write failed; surface it instead of silently keeping the
      // account unlinked.
      set_error(e instanceof Error ? e.message : String(e));
    } finally {
      set_saving(false);
    }
  }

  const can_submit = username.length > 0 && password.length > 0 && !saving;

  const input_style = [
    styles.input,
    { borderColor: c.border_strong, color: c.ink, backgroundColor: c.surface },
  ];

  return (
    <View style={styles.container}>
      <Text style={[styles.label, { color: c.ink }]}>Username</Text>
      <TextInput
        style={input_style}
        value={username}
        onChangeText={set_username}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="username"
      />
      <Text style={[styles.label, { color: c.ink }]}>Password</Text>
      <View style={styles.password_row}>
        <TextInput
          style={[...input_style, styles.password_input]}
          value={password}
          onChangeText={set_password}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry={!show_password}
          textContentType="password"
        />
        <Pressable
          onPress={() => set_show_password((v) => !v)}
          hitSlop={8}
          style={styles.password_toggle}
        >
          <Text style={[styles.password_toggle_text, { color: c.ink_muted }]}>
            {show_password ? "Hide" : "Show"}
          </Text>
        </Pressable>
      </View>
      {error ? (
        <Text style={[styles.error, { color: c.danger }]}>{error}</Text>
      ) : null}
      <Button
        title={submit_label ?? "Link account"}
        onPress={submit}
        disabled={!can_submit}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  label: { fontSize: 14, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  password_row: { flexDirection: "row", alignItems: "center", gap: 8 },
  password_input: { flex: 1 },
  password_toggle: { paddingHorizontal: 4, paddingVertical: 8 },
  password_toggle_text: { fontSize: 13, fontWeight: "600" },
  error: { fontSize: 13 },
});
