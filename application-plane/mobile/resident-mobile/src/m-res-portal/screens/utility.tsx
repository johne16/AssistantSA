// Utility screens. Forward utility_view_request to use_accounts and render the
// returned utility_data. Bills and usage each carry a 'Sync all accounts'
// control that issues one sync per linked account via sync_all; the refresh icon
// is bound to ACTUAL in-progress sync state (subscribed via on_sync_result),
// held from sync start until a syncResult lands per account, then settled to a
// last-synced state. The portal never holds credentials; LinkAccountFields
// captures them and writes them to the keystore.

import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { use_theme, use_t } from "@/m-res-shell";
import {
  LinkAccountFields,
  type bill_view,
  type outage_view,
  type usage_view,
  type use_accounts_value,
} from "@/m-res-accounts";
import { Screen } from "../components/chrome";
import {
  BackLink,
  BlockedNotice,
  Card,
  Field,
  KeyValue,
  Note,
  OutlineButton,
  PrimaryButton,
  Row,
  SectionHeader,
  SyncBar,
} from "../components/ui";
import type { linked_account, panel_id, sync_ui_state } from "../types";

// Format the sync-bar meta line from the shared sync state.
function sync_meta(state: sync_ui_state): string {
  if (state.syncing) return "Syncing accounts...";
  if (state.error) return "Last sync failed";
  if (state.last_synced_at) return "Last synced just now";
  return "Not synced yet";
}

function Spinner() {
  const t = use_theme();
  return (
    <View style={{ paddingVertical: t.spacing.xl, alignItems: "center" }}>
      <ActivityIndicator color={t.color.primary} />
    </View>
  );
}

export function UtilityHubScreen(props: { select: (id: panel_id) => void }) {
  const tr = use_t();
  return (
    <Screen>
      <SectionHeader
        title={tr("Utilities")}
        detail={tr("Your bills, usage, and linked accounts.")}
      />
      <Row
        label={tr("Bills")}
        blurb={tr("Your utility bills")}
        onPress={() => props.select("utility_bills")}
      />
      <Row
        label={tr("Usage")}
        blurb={tr("What you have used")}
        onPress={() => props.select("utility_usage")}
      />
      <Row
        label={tr("Accounts")}
        blurb={tr("Link your utility accounts")}
        onPress={() => props.select("utility_accounts")}
      />
      <Row
        label={tr("Power status")}
        blurb={tr("Outages at your address, from CPS Energy")}
        onPress={() => props.select("power_status")}
      />
    </Screen>
  );
}

export function BillsScreen(props: {
  accounts: use_accounts_value;
  sync_state: sync_ui_state;
  on_sync_all: () => void;
  onBack: () => void;
}) {
  const tr = use_t();
  const [bills, set_bills] = useState<bill_view[] | null>(null);
  const [loading, set_loading] = useState(true);

  // Re-read stored bills on open and whenever a sync settles.
  useEffect(() => {
    let live = true;
    set_loading(true);
    props.accounts
      .utility_view_request({ resource: "bills", params: {} })
      .then((d) => {
        if (live) set_bills(d.bills ?? []);
      })
      .finally(() => {
        if (live) set_loading(false);
      });
    return () => {
      live = false;
    };
  }, [props.accounts, props.sync_state.last_synced_at]);

  return (
    <Screen>
      <BackLink label={tr("Utilities")} onPress={props.onBack} />
      <SectionHeader title={tr("Your bills")} detail={tr("Your linked utility accounts.")} />
      <SyncBar
        syncing={props.sync_state.syncing}
        meta={sync_meta(props.sync_state)}
        onPress={props.on_sync_all}
      />
      {loading ? (
        <Spinner />
      ) : (
        (bills ?? []).map((b) => (
          <Card key={b.statement_id} title={b.account_ref}>
            <KeyValue
              pairs={[
                { k: tr("Due date"), v: b.due_date },
                { k: tr("Statement"), v: b.statement_id },
              ]}
            />
          </Card>
        ))
      )}
    </Screen>
  );
}

export function UsageScreen(props: {
  accounts: use_accounts_value;
  sync_state: sync_ui_state;
  on_sync_all: () => void;
  onBack: () => void;
}) {
  const tr = use_t();
  const [usage, set_usage] = useState<usage_view[] | null>(null);
  const [loading, set_loading] = useState(true);

  useEffect(() => {
    let live = true;
    set_loading(true);
    props.accounts
      .utility_view_request({ resource: "usage", params: {} })
      .then((d) => {
        if (live) set_usage(d.usage ?? []);
      })
      .finally(() => {
        if (live) set_loading(false);
      });
    return () => {
      live = false;
    };
  }, [props.accounts, props.sync_state.last_synced_at]);

  return (
    <Screen>
      <BackLink label={tr("Utilities")} onPress={props.onBack} />
      <SectionHeader
        title={tr("Your usage")}
        detail={tr("What you have used, from your utility accounts.")}
      />
      <SyncBar
        syncing={props.sync_state.syncing}
        meta={sync_meta(props.sync_state)}
        onPress={props.on_sync_all}
      />
      {loading ? (
        <Spinner />
      ) : (
        (usage ?? []).map((u, i) => (
          <Card
            key={`${u.account_ref}-${i}`}
            eyebrow={u.account_ref}
            title={`${u.amount} ${u.unit}`}
          >
            <KeyValue
              pairs={[
                { k: tr("From"), v: u.period_start },
                { k: tr("To"), v: u.period_end },
              ]}
            />
          </Card>
        ))
      )}
    </Screen>
  );
}

export function PowerStatusScreen(props: {
  accounts: use_accounts_value;
  address: string;
  onBack: () => void;
}) {
  const tr = use_t();
  const [outage, set_outage] = useState<outage_view[] | null>(null);
  const [loading, set_loading] = useState(true);
  // Outage status is scoped by address only; it does not require a linked account.
  const has_address = props.address.length > 0;

  useEffect(() => {
    if (!has_address) {
      set_loading(false);
      return;
    }
    let live = true;
    props.accounts
      .utility_view_request({ resource: "outage", params: {} })
      .then((d) => {
        if (live) set_outage(d.outage ?? []);
      })
      .finally(() => {
        if (live) set_loading(false);
      });
    return () => {
      live = false;
    };
  }, [props.accounts, has_address]);

  return (
    <Screen>
      <BackLink label={tr("Utilities")} onPress={props.onBack} />
      <SectionHeader
        title={tr("Power status")}
        detail={
          props.address
            ? `${tr("Outage status for")} ${props.address}${tr(", from CPS Energy.")}`
            : tr("Outage status from CPS Energy.")
        }
      />
      {!has_address ? (
        <BlockedNotice
          title={tr("No address saved.")}
          body={tr("Save your address to see outage and power status here.")}
        />
      ) : loading ? (
        <Spinner />
      ) : (outage ?? []).length === 0 ? (
        <Card
          eyebrow="CPS Energy"
          title={tr("Power is on")}
          hint={tr("No outage reported at your address.")}
        />
      ) : (
        (outage ?? []).map((o) => (
          <Card key={o.outage_id} eyebrow="CPS Energy" title={o.status}>
            <KeyValue
              pairs={[
                { k: tr("Address"), v: o.address },
                { k: tr("Reported"), v: o.reported_at },
              ]}
            />
          </Card>
        ))
      )}
    </Screen>
  );
}

export function AccountsScreen(props: {
  linked: linked_account[];
  on_unlink: (site_id: string) => Promise<boolean>;
  on_linked: (account: linked_account) => Promise<boolean>;
  onBack: () => void;
}) {
  const t = use_theme();
  const tr = use_t();
  const [provider, set_provider] = useState("");
  const [sign_in_url, set_sign_in_url] = useState("");
  // site_id whose last unlink failed, so its card can show a retry message.
  const [unlink_error, set_unlink_error] = useState<string | null>(null);
  // Set when the last link save failed; the fields stay so the resident can retry.
  const [link_error, set_link_error] = useState(false);
  // The site_id for a new link, derived once the resident names a provider.
  const new_site_id = useMemo(
    () => provider.trim().toLowerCase().replace(/\s+/g, "-"),
    [provider],
  );
  const can_capture = new_site_id.length > 0 && sign_in_url.trim().length > 0;

  const error_text = {
    marginTop: t.spacing.sm,
    fontSize: 13,
    lineHeight: 19,
    color: t.color.accent,
  };

  async function unlink(site_id: string) {
    const ok = await props.on_unlink(site_id);
    set_unlink_error(ok ? null : site_id);
  }

  return (
    <Screen>
      <BackLink label={tr("Utilities")} onPress={props.onBack} />
      <SectionHeader
        title={tr("Utility accounts")}
        detail={tr("Link a provider so AssistantSA can read your bills and usage.")}
      />
      {props.linked.map((a) => (
        <Card key={a.site_id} title={a.provider}>
          <KeyValue
            pairs={[
              { k: tr("Account"), v: a.site_id },
              { k: tr("Status"), v: tr("Connected") },
            ]}
          />
          <OutlineButton title={tr("Unlink")} onPress={() => unlink(a.site_id)} />
          {unlink_error === a.site_id ? (
            <Text style={error_text}>
              {tr("Couldn't unlink. Check your connection and try again.")}
            </Text>
          ) : null}
        </Card>
      ))}

      <Card title={tr("Link a new account")}>
        <Field
          label={tr("Provider name")}
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
        {/* Credential fields are captured by m-res-accounts. The portal passes
            the site_id + url only and never reads username/password. */}
        {can_capture ? (
          <View style={{ marginTop: 16 }}>
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
                  set_provider("");
                  set_sign_in_url("");
                } else {
                  set_link_error(true);
                }
              }}
            />
            {link_error ? (
              <Text style={error_text}>
                {tr("Couldn't link the account. Check your connection and try again.")}
              </Text>
            ) : null}
          </View>
        ) : (
          <Note>
            {tr("Enter a provider name and sign-in URL to continue. Your username and password stay encrypted on this phone and never leave it.")}
          </Note>
        )}
      </Card>
    </Screen>
  );
}
