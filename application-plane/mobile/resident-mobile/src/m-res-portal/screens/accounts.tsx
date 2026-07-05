// Accounts surface. Lists linked utility providers and hosts the add-account
// form. The portal never holds credentials: LinkAccountFields captures them
// on-device and writes them to the keystore; this screen passes the site_id
// only and never reads username/password.

import React, { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useTheme, useT } from "@/m-res-shell";
import {
  LinkAccountFields,
  has_credentials,
  type provider_catalog_entry,
} from "@/m-res-accounts";
import { Screen } from "../components/chrome";
import { BackLink, Note, SectionHeader } from "../components/ui";
import type { linked_account, panel_id } from "../types";

// First letter of the provider, for the row mark (mockup .acct-ico).
function provider_mark(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

export function AccountsScreen(props: {
  linked: linked_account[];
  on_unlink: (site_id: string) => Promise<boolean>;
  on_credentials_saved: (site_id: string) => void;
  select: (id: panel_id) => void;
}) {
  const t = useTheme();
  const tr = useT();
  const c = t.color;
  const [unlink_error, set_unlink_error] = useState<string | null>(null);
  // site_id whose credential form is open, if any.
  const [editing_site_id, set_editing_site_id] = useState<string | null>(null);
  // Linked sites with no credentials on this device (e.g. linked from another
  // phone). Prompts the resident to enter them without unlinking.
  const [missing_creds, set_missing_creds] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const missing = new Set<string>();
      for (const a of props.linked) {
        if (!(await has_credentials(a.site_id))) missing.add(a.site_id);
      }
      if (!cancelled) set_missing_creds(missing);
    })();
    return () => {
      cancelled = true;
    };
  }, [props.linked]);

  async function unlink(site_id: string) {
    const ok = await props.on_unlink(site_id);
    set_unlink_error(ok ? null : site_id);
  }

  function on_saved(site_id: string) {
    set_editing_site_id(null);
    set_missing_creds((prev) => {
      const next = new Set(prev);
      next.delete(site_id);
      return next;
    });
    props.on_credentials_saved(site_id);
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
              flexDirection: "row",
              alignItems: "center",
              gap: t.spacing.md,
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
              onPress={() =>
                set_editing_site_id((prev) =>
                  prev === a.site_id ? null : a.site_id,
                )
              }
              hitSlop={8}
              style={{
                borderWidth: 1,
                borderColor: c.border_strong,
                borderRadius: t.radius.sm,
                paddingHorizontal: t.spacing.sm,
                paddingVertical: 6,
              }}
            >
              <Text
                style={{
                  fontFamily: t.font.mono,
                  fontSize: 10.5,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  color: c.primary,
                }}
              >
                {tr("Edit")}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => unlink(a.site_id)}
              hitSlop={8}
              style={{
                borderWidth: 1,
                borderColor: c.border_strong,
                borderRadius: t.radius.sm,
                paddingHorizontal: t.spacing.sm,
                paddingVertical: 6,
              }}
            >
              <Text
                style={{
                  fontFamily: t.font.mono,
                  fontSize: 10.5,
                  letterSpacing: 0.5,
                  textTransform: "uppercase",
                  color: c.signal,
                }}
              >
                {tr("Unlink")}
              </Text>
            </Pressable>
          </View>
          {missing_creds.has(a.site_id) && editing_site_id !== a.site_id ? (
            <Text
              style={{
                marginTop: t.spacing.sm,
                fontSize: 13,
                lineHeight: 19,
                color: c.signal,
              }}
            >
              {tr("No credentials on this device. Tap Edit to enter them.")}
            </Text>
          ) : null}
          {editing_site_id === a.site_id ? (
            <View style={{ marginTop: t.spacing.md }}>
              <LinkAccountFields
                site_id={a.site_id}
                submit_label={tr("Save")}
                on_linked={() => on_saved(a.site_id)}
              />
            </View>
          ) : null}
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
  catalog: provider_catalog_entry[];
  on_linked: (account: linked_account) => Promise<boolean>;
  onBack: () => void;
}) {
  const t = useTheme();
  const tr = useT();
  const c = t.color;
  const [selected_site_id, set_selected_site_id] = useState<string | null>(null);
  const [open, set_open] = useState(false);
  const [link_error, set_link_error] = useState(false);

  // The chosen provider, resolved from the backend-served catalog. site_id is
  // never typed by the resident; it must match a backend scrape script file name.
  const selected = props.catalog.find((p) => p.site_id === selected_site_id);
  const can_capture = selected != null;

  return (
    <Screen>
      <BackLink label={tr("Accounts")} onPress={props.onBack} />
      <SectionHeader
        eyebrow={tr("New account")}
        title={tr("Add account")}
        detail={tr("Choose your provider and sign in. Bex uses it to fetch your data.")}
      />

      {/* Provider dropdown. Options come from the backend provider catalog; the
          resident selects a site rather than typing one. */}
      <Text
        style={{
          fontFamily: t.font.body,
          fontSize: 13,
          color: c.ink_muted,
          marginBottom: t.spacing.xs,
        }}
      >
        {tr("Provider")}
      </Text>
      <Pressable
        onPress={() => set_open((v) => !v)}
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          borderWidth: 1,
          borderColor: c.border_strong,
          borderRadius: t.radius.sm,
          backgroundColor: c.surface_raised,
          paddingHorizontal: t.spacing.md,
          paddingVertical: 12,
        }}
      >
        <Text
          style={{
            fontFamily: t.font.body,
            fontSize: 16,
            color: selected ? c.ink : c.ink_subtle,
          }}
        >
          {selected ? selected.provider : tr("Select a provider")}
        </Text>
        <Text style={{ fontSize: 14, color: c.ink_subtle }}>{open ? "▲" : "▼"}</Text>
      </Pressable>
      {open ? (
        <View
          style={{
            borderWidth: 1,
            borderColor: c.border,
            borderRadius: t.radius.sm,
            backgroundColor: c.surface,
            marginTop: t.spacing.xs,
            overflow: "hidden",
          }}
        >
          {props.catalog.map((p, i) => (
            <Pressable
              key={p.site_id}
              onPress={() => {
                set_selected_site_id(p.site_id);
                set_open(false);
                set_link_error(false);
              }}
              style={{
                paddingHorizontal: t.spacing.md,
                paddingVertical: 12,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: c.border,
                backgroundColor:
                  p.site_id === selected_site_id ? c.primary_soft : c.surface,
              }}
            >
              <Text
                style={{ fontFamily: t.font.body, fontSize: 16, color: c.ink }}
              >
                {p.provider}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Credential fields are captured on-device by m-res-accounts. The portal
          passes the site_id only and never reads username/password. */}
      {can_capture ? (
        <View style={{ marginTop: t.spacing.md }}>
          <LinkAccountFields
            site_id={selected.site_id}
            on_linked={async () => {
              const ok = await props.on_linked({
                site_id: selected.site_id,
                provider: selected.provider,
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
