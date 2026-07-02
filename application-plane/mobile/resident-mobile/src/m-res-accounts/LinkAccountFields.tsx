// Credential capture component for the link-account screen. The portal hosts
// the screen but never reads or holds the values. On submit this writes the
// entry straight to the device keystore keyed by site_id; the values never
// leave the device.

import React, { useState } from "react";
import {
  Button,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { save_credentials } from "./keystore";
import type { credential_entry } from "./types";

export interface link_account_fields_props {
  site_id: string;
  // Fired after the entry is written to the keystore. No values are passed up.
  on_linked?: () => void;
}

export function LinkAccountFields(props: link_account_fields_props) {
  const { site_id, on_linked } = props;
  const [username, set_username] = useState("");
  const [password, set_password] = useState("");
  const [saving, set_saving] = useState(false);

  async function submit() {
    set_saving(true);
    try {
      const entry: credential_entry = { site_id, username, password };
      await save_credentials(entry);
      set_username("");
      set_password("");
      on_linked?.();
    } finally {
      set_saving(false);
    }
  }

  const can_submit = username.length > 0 && password.length > 0 && !saving;

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Username</Text>
      <TextInput
        style={styles.input}
        value={username}
        onChangeText={set_username}
        autoCapitalize="none"
        autoCorrect={false}
        textContentType="username"
      />
      <Text style={styles.label}>Password</Text>
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={set_password}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        textContentType="password"
      />
      <Button title="Link account" onPress={submit} disabled={!can_submit} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  label: { fontSize: 14, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
});
