// Civic screens. Each forwards a civic_view_request to use_civic and renders the
// returned civic_data. The portal never reaches the gateway; m-res-civic does.
//
// find-my-rep renders the immediate stored result with NO blocking spinner and
// subscribes to on_rep_update so a background-refreshed result replaces it.

import React, { useEffect, useState } from "react";
import type {
  alert_entry,
  civic_client,
  collection_schedule_entry,
  event_entry,
  find_my_rep_entry,
  my_area_entry,
  my_area_kind,
} from "@/m-res-civic";
import { Screen } from "../components/chrome";
import { BackLink, Card, KeyValue, Note, Row, SectionHeader } from "../components/ui";
import { use_t } from "@/m-res-shell";
import type { panel_id } from "../types";

export function CivicAlertsScreen(props: {
  civic: civic_client;
  address: string;
  onBack: () => void;
}) {
  const tr = use_t();
  const [data, set_data] = useState<alert_entry[]>([]);
  useEffect(() => {
    let live = true;
    props.civic
      .civic_view_request({ resource: "alerts", params: { address: props.address } })
      .then((res) => {
        if (live) set_data((res.data as alert_entry[]) ?? []);
      });
    return () => {
      live = false;
    };
  }, [props.civic, props.address]);
  return (
    <Screen>
      <BackLink label={tr("City")} onPress={props.onBack} />
      <SectionHeader title={tr("Alerts")} detail={tr("Current alerts from the city.")} />
      {(data ?? []).map((a) => (
        <Card key={a.entry_id} title={a.title} hint={a.body}>
          <KeyValue
            pairs={[{ k: tr("Source"), v: a.source }]}
          />
        </Card>
      ))}
    </Screen>
  );
}

export function CivicEventsScreen(props: {
  civic: civic_client;
  address: string;
  onBack: () => void;
}) {
  const tr = use_t();
  const [data, set_data] = useState<event_entry[]>([]);
  useEffect(() => {
    let live = true;
    props.civic
      .civic_view_request({ resource: "events", params: { address: props.address } })
      .then((res) => {
        if (live) set_data((res.data as event_entry[]) ?? []);
      });
    return () => {
      live = false;
    };
  }, [props.civic, props.address]);
  return (
    <Screen>
      <BackLink label={tr("City")} onPress={props.onBack} />
      <SectionHeader
        title={tr("Events")}
        detail={tr("City events near you, published by San Antonio.")}
      />
      {(data ?? []).map((e) => (
        <Card key={e.entry_id} title={e.title} hint={e.description}>
          <KeyValue
            pairs={[
              { k: tr("When"), v: e.starts_at },
              { k: tr("Where"), v: e.location },
            ]}
          />
        </Card>
      ))}
    </Screen>
  );
}

export function CollectionScreen(props: {
  civic: civic_client;
  address: string;
  onBack: () => void;
}) {
  const tr = use_t();
  const [data, set_data] = useState<collection_schedule_entry[]>([]);
  useEffect(() => {
    if (!props.address) return;
    let live = true;
    props.civic
      .civic_view_request({
        resource: "collection_schedule",
        params: { address: props.address },
      })
      .then((res) => {
        if (live) set_data((res.data as collection_schedule_entry[]) ?? []);
      });
    return () => {
      live = false;
    };
  }, [props.civic, props.address]);
  return (
    <Screen>
      <BackLink label={tr("City")} onPress={props.onBack} />
      <SectionHeader
        title={tr("Trash & recycling")}
        detail={
          props.address
            ? `${tr("Collection days for")} ${props.address}${tr(", from Solid Waste Management.")}`
            : tr("Collection days from Solid Waste Management.")
        }
      />
      {(data ?? []).map((s) => (
        <Card key={s.entry_id} title={s.service_type}>
          <KeyValue
            pairs={
              s.collection_day
                ? [{ k: tr("Day"), v: s.collection_day }]
                : [{ k: tr("Next pickup"), v: s.next_collection_date }]
            }
          />
        </Card>
      ))}
    </Screen>
  );
}

// find-my-rep: render the stored result immediately (no blocking spinner) and
// replace in place when on_rep_update pushes a refreshed result.
export function FindRepScreen(props: {
  civic: civic_client;
  address: string;
  onBack: () => void;
}) {
  const tr = use_t();
  const [rep, set_rep] = useState<find_my_rep_entry | null>(null);
  useEffect(() => {
    let live = true;
    // Immediate stored result; resolves fast, rendered without a spinner gate.
    props.civic
      .civic_view_request({ resource: "find_my_rep", params: { address: props.address } })
      .then((res) => {
        if (live) set_rep(res.data as find_my_rep_entry | null);
      });
    // Background-refreshed result replaces the view in place.
    const off = props.civic.on_rep_update((res) => {
      set_rep(res.data as find_my_rep_entry | null);
    });
    return () => {
      live = false;
      off();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.address]);
  return (
    <Screen>
      <BackLink label={tr("My area")} onPress={props.onBack} />
      <SectionHeader
        title={tr("Find my rep")}
        detail={
          props.address
            ? `${tr("Who represents")} ${props.address}. ${tr("Based on your profile address.")}`
            : tr("Who represents you. Based on your profile address.")
        }
      />
      {rep ? (
        <>
          <Card
            eyebrow={`${tr("District")} ${rep.council_district}`}
            title={rep.representative_name}
          />
          {rep.staff.map((s) => (
            <Card key={s.name} title={s.name}>
              <KeyValue
                pairs={[
                  { k: tr("Title"), v: s.title },
                  { k: tr("Phone"), v: s.phone },
                  { k: tr("Email"), v: s.email },
                ]}
              />
            </Card>
          ))}
        </>
      ) : null}
    </Screen>
  );
}

// Shared my_area leaf for police / school / neighborhood.
const MY_AREA_META: Record<
  my_area_kind,
  { back: string; eyebrow: string; title: string }
> = {
  police: { back: "My area", eyebrow: "SAPD", title: "Police substation" },
  fire: { back: "My area", eyebrow: "SAFD", title: "Fire response area" },
  school: { back: "My area", eyebrow: "Schools", title: "School district" },
  neighborhood: {
    back: "My area",
    eyebrow: "Neighborhood",
    title: "Neighborhood association",
  },
};

export function MyAreaLeafScreen(props: {
  civic: civic_client;
  address: string;
  kind: my_area_kind;
  onBack: () => void;
}) {
  const tr = use_t();
  const meta = MY_AREA_META[props.kind];
  const [data, set_data] = useState<my_area_entry | null>(null);
  useEffect(() => {
    if (!props.address) return;
    let live = true;
    props.civic
      .civic_view_request({
        resource: "my_area",
        params: { address: props.address, kind: props.kind },
      })
      .then((res) => {
        if (live) set_data(res.data as my_area_entry | null);
      });
    return () => {
      live = false;
    };
  }, [props.civic, props.address, props.kind]);
  return (
    <Screen>
      <BackLink label={tr(meta.back)} onPress={props.onBack} />
      <SectionHeader
        eyebrow={tr(meta.eyebrow)}
        title={tr(meta.title)}
        detail={
          props.address
            ? `${tr("Drawn from your address,")} ${props.address}.`
            : tr("Drawn from your profile address.")
        }
      />
      {data ? (
        <Card title={data.name} hint={data.detail}>
          <KeyValue pairs={[{ k: tr("Boundary"), v: data.boundary_layer }]} />
          {props.kind === "police" ? (
            <Note>{tr("For emergencies call 911.")}</Note>
          ) : null}
        </Card>
      ) : null}
    </Screen>
  );
}

// City hub: lists civic sections. select takes a panel_id.
export function CityHubScreen(props: { select: (id: panel_id) => void }) {
  const tr = use_t();
  return (
    <Screen>
      <SectionHeader
        title={tr("City")}
        detail={tr("Status, alerts, events, and who to contact in San Antonio.")}
      />
      <Row
        label={tr("Alerts")}
        blurb={tr("Current alerts from the city")}
        onPress={() => props.select("civic_alerts")}
      />
      <Row
        label={tr("Events")}
        blurb={tr("City events calendar")}
        onPress={() => props.select("civic_events")}
      />
      <Row
        label={tr("Trash & recycling")}
        blurb={tr("Your collection days by address")}
        onPress={() => props.select("collection")}
      />
      <Row
        label={tr("Departments")}
        blurb={tr("Every City department and office")}
        onPress={() => props.select("agencies")}
      />
      <Row
        label={tr("My area")}
        blurb={tr("Reps, police, schools, and more for your address")}
        onPress={() => props.select("my_area")}
      />
      <Row
        label="311"
        blurb={tr("Report a problem to the city")}
        tag={tr("Unavailable")}
        onPress={() => props.select("three_one_one")}
      />
    </Screen>
  );
}

export function MyAreaHubScreen(props: {
  address: string;
  select: (id: panel_id) => void;
}) {
  const tr = use_t();
  return (
    <Screen>
      <BackLink label={tr("City")} onPress={() => props.select("city_hub")} />
      <SectionHeader
        title={tr("My area")}
        detail={
          props.address
            ? `${tr("Everything tied to")} ${props.address}. ${tr("Drawn from your profile address.")}`
            : tr("Everything tied to your profile address.")
        }
      />
      <Row
        label={tr("Find my rep")}
        blurb={tr("Mayor, council member, and trustee")}
        onPress={() => props.select("find_rep")}
      />
      <Row
        label={tr("Police substation")}
        blurb={tr("SAPD patrol substation serving you")}
        onPress={() => props.select("area_police")}
      />
      <Row
        label={tr("Fire response area")}
        blurb={tr("SAFD area of responsibility serving you")}
        onPress={() => props.select("area_fire")}
      />
      <Row
        label={tr("School district")}
        blurb={tr("Your assigned district and schools")}
        onPress={() => props.select("area_school")}
      />
      <Row
        label={tr("Neighborhood association")}
        blurb={tr("The registered association for your address")}
        onPress={() => props.select("area_neighborhood")}
      />
    </Screen>
  );
}
