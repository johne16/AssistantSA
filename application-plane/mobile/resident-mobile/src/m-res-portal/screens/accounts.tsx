// Accounts surface. Lists linked utility providers and hosts the add-account
// form. The portal never holds credentials: LinkAccountFields captures them
// on-device and writes them to the keystore; this screen passes the site_id +
// sign-in URL only and never reads username/password.

import React, { useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme, useT } from "@/m-res-shell";
import { LinkAccountFields } from "@/m-res-accounts";
import { Screen } from "../components/chrome";
import { BackLink, Field, Note, SectionHeader } from "../components/ui";
import type { linked_account, panel_id } from "../types";

// First letter of the provider, for the row mark (mockup .acct-ico).
function provider_mark(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export function AccountsScreen(props: {
  linked: linked_account[];
  on_unlink: (site_id: string) => Promise<boolean>;
  select: (id: panel_id) => void;
}) {
  const t = useTheme();
  const tr = useT();
  const c = t.color;
  const [unlink_error, set_unlink_error] = useState<string | null>(null);

  async function unlink(site_id: string) {
    const ok = await props.on_unlink(site_id);
    set_unlink_error(ok ? null : site_id);
  }

  return (
    <Screen>
      <SectionHeader
        eyebrow={tr("Linked services")}
        title={tr("Accounts")}
        detail={tr("Link a utility and Bex can read bills, usage, and outages for you.")}
      />

      {props.linked.map((a) => (
        <View
          key={a.site_id}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: t.spacing.md,
            backgroundColor: c.surface_raised,
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: t.radius.md,
            padding: t.spacing.md,
            marginBottom: t.spacing.sm,
          }}
        >
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 13,
              backgroundColor: c.primary_soft,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                fontFamily: t.font.display,
                fontSize: 18,
                color: c.primary,
              }}
            >
              {provider_mark(a.provider)}
            </Text>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text
              style={{
                fontFamily: t.font.body,
                fontWeight: "700",
                fontSize: 16,
                color: c.ink,
              }}
            >
              {a.provider}
            </Text>
            <Text
              style={{
                marginTop: 2,
                fontFamily: t.font.mono,
                fontSize: 11,
                color: c.ink_subtle,
              }}
            >
              {a.site_id}
            </Text>
          </View>
          <Pressable
            onPress={() => unlink(a.site_id)}
            hitSlop={8}
            style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
          >
            <View
              style={{
                width: 7,
                height: 7,
                borderRadius: 4,
                backgroundColor: c.primary,
              }}
            />
            <Text
              style={{
                fontFamily: t.font.mono,
                fontSize: 10.5,
                letterSpacing: 0.5,
                textTransform: "uppercase",
                color: c.primary,
              }}
            >
              {tr("Linked")}
            </Text>
          </Pressable>
        </View>
      ))}
      {unlink_error ? (
        <Text
          style={{
            marginTop: t.spacing.xs,
            fontSize: 13,
            lineHeight: 19,
            color: c.signal,
          }}
        >
          {tr("Couldn't unlink. Check your connection and try again.")}
        </Text>
      ) : null}

      {/* Add an account (dashed row) */}
      <Pressable
        onPress={() => props.select("add_account")}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: t.spacing.md,
          borderWidth: 1.5,
          borderStyle: "dashed",
          borderColor: c.border_strong,
          borderRadius: t.radius.md,
          padding: t.spacing.md,
          marginTop: t.spacing.xs,
        }}
      >
        <View
          style={{
            width: 42,
            height: 42,
            borderRadius: 13,
            backgroundColor: c.primary,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 22, color: c.on_primary }}>+</Text>
        </View>
        <Text
          style={{
            fontFamily: t.font.body,
            fontWeight: "700",
            fontSize: 16,
            color: c.ink_muted,
          }}
        >
          {tr("Add an account")}
        </Text>
      </Pressable>

      <Note>{tr("Bex only reads what you link. Nothing is shared.")}</Note>
    </Screen>
  );
}

export function AddAccountScreen(props: {
  on_linked: (account: linked_account) => Promise<boolean>;
  onBack: () => void;
}) {
  const t = useTheme();
  const tr = useT();
  const c = t.color;
  const [provider, set_provider] = useState("");
  const [sign_in_url, set_sign_in_url] = useState("");
  const [link_error, set_link_error] = useState(false);

  // The site_id for a new link, derived once the resident names a provider.
  const new_site_id = useMemo(
    () => provider.trim().toLowerCase().replace(/\s+/g, "-"),
    [provider],
  );
  const can_capture = new_site_id.length > 0 && sign_in_url.trim().length > 0;

  return (
    <Screen>
      <BackLink label={tr("Accounts")} onPress={props.onBack} />
      <SectionHeader
        eyebrow={tr("New account")}
        title={tr("Add account")}
        detail={tr("Enter your provider login. Bex uses it to fetch your data.")}
      />

      <Field
        label={tr("Provider")}
        placeholder="CPS Energy"
        autoCapitalize="words"
        value={provider}
        onChangeText={set_provider}
      />
      <Field
        label={tr("Provider sign-in URL")}
        placeholder="https://my.provider.com/login"
        autoCapitalize="none"
        keyboardType="url"
        value={sign_in_url}
        onChangeText={set_sign_in_url}
      />

      {/* Credential fields are captured on-device by m-res-accounts. The portal
          passes the site_id + url only and never reads username/password. */}
      {can_capture ? (
        <View style={{ marginTop: t.spacing.md }}>
          <LinkAccountFields
            site_id={new_site_id}
            sign_in_url={sign_in_url.trim()}
            on_linked={async () => {
              const ok = await props.on_linked({
                site_id: new_site_id,
                provider: provider.trim(),
                sign_in_url: sign_in_url.trim(),
              });
              if (ok) {
                set_link_error(false);
                props.onBack();
              } else {
                set_link_error(true);
              }
            }}
          />
          {link_error ? (
            <Text
              style={{
                marginTop: t.spacing.sm,
                fontSize: 13,
                lineHeight: 19,
                color: c.signal,
              }}
            >
              {tr("Couldn't link the account. Check your connection and try again.")}
            </Text>
          ) : null}
        </View>
      ) : null}

      <Note>{tr("Credentials are stored encrypted on your device.")}</Note>
    </Screen>
  );
}
