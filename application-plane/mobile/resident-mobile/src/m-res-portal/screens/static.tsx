// Static / placeholder screens with no backend data flow: departments directory,
// 311 (blocked), bill-pay (blocked), and discovery (teaser content). Discovery
// and reviews have no client module in this build; they render artificial teaser
// content as a placeholder. The departments list is static directory text.

import React from "react";
import { Text, View } from "react-native";
import { use_theme, use_t } from "@/m-res-shell";
import { Screen } from "../components/chrome";
import {
  BackLink,
  BlockedNotice,
  Card,
  Field,
  KeyValue,
  Row,
  SectionHeader,
} from "../components/ui";
import type { panel_id } from "../types";

// --- Departments directory (static text from the city) ---

const DEPARTMENTS: { name: string; blurb: string }[] = [
  {
    name: "311 Customer Service",
    blurb:
      "Find information and get help with City services such as trash pickup or pothole repair.",
  },
  {
    name: "Solid Waste Management",
    blurb:
      "Garbage and recycling collection, as well as brush and bulk waste service.",
  },
  {
    name: "Animal Care Services",
    blurb: "Animal control and pet adoption services. Adopt, foster, or report.",
  },
  {
    name: "Public Works",
    blurb: "Builds and repairs City streets, drains and street signs.",
  },
  {
    name: "Parks & Recreation",
    blurb: "Maintains City parks and facilities. Reserve a park facility.",
  },
  {
    name: "Library",
    blurb: "The San Antonio Public Library system. Books, eBooks, Wi-Fi access.",
  },
  {
    name: "Development Services",
    blurb: "Manages land and building development. Apply for permits or licenses.",
  },
  {
    name: "Metropolitan Health District",
    blurb: "Health services and programs. Restaurant inspections and food permits.",
  },
  {
    name: "Municipal Court",
    blurb: "Hears cases for minor offenses, including tickets and parking.",
  },
  {
    name: "Police",
    blurb: "The San Antonio Police Department, primary law enforcement agency.",
  },
  {
    name: "Fire",
    blurb: "Fire and emergency services. Fire codes and safety information.",
  },
  {
    name: "Neighborhood & Housing Services",
    blurb: "Rental and housing help, homeownership, and eviction resources.",
  },
  {
    name: "Human Services",
    blurb: "Financial and social services for residents in need.",
  },
  {
    name: "Emergency Management",
    blurb: "Responds to emergencies and disasters. Sign up for AlertSA.",
  },
  {
    name: "Mayor & City Council",
    blurb: "Find your councilmember. View agendas and public meetings.",
  },
];

export function AgenciesScreen(props: { onBack: () => void }) {
  const tr = use_t();
  return (
    <Screen>
      <BackLink label={tr("City")} onPress={props.onBack} />
      <SectionHeader
        title={tr("Departments")}
        detail={tr(
          "The City departments residents reach for most. Ask AssistantSA to find any other."
        )}
      />
      {DEPARTMENTS.map((d) => (
        <Row key={d.name} label={tr(d.name)} blurb={tr(d.blurb)} staticRow />
      ))}
    </Screen>
  );
}

// --- 311 (blocked feature) ---

export function ThreeOneOneScreen(props: { onBack: () => void }) {
  const tr = use_t();
  return (
    <Screen>
      <BackLink label={tr("City")} onPress={props.onBack} />
      <SectionHeader title={tr("Report to 311")} detail={tr("Report a problem to the city.")} />
      <BlockedNotice
        title={tr("This feature is blocked pending access to an external dependency.")}
        body={tr(
          "Filing a 311 report needs backend access to the city's 311 system. Until San Antonio grants that access, AssistantSA can't capture or submit reports here."
        )}
      />
    </Screen>
  );
}

// --- Discovery (teaser placeholder, no backend module in this build) ---

const BUSINESSES: {
  id: panel_id;
  name: string;
  blurb: string;
}[] = [
  {
    id: "discovery",
    name: "Cedar Creek Plumbing",
    blurb: "Plumbing · ★ 4.8 · open until 9 PM",
  },
  {
    id: "discovery",
    name: "Millpond Roasters",
    blurb: "Coffee · ★ 4.4 · Riverwalk",
  },
  {
    id: "discovery",
    name: "Birch Street Hardware",
    blurb: "Hardware · ★ 4.9 · Maple District",
  },
  {
    id: "discovery",
    name: "San Antonio Tire & Auto",
    blurb: "Auto · ★ 4.3 · Eastside",
  },
];

export function DiscoveryScreen() {
  const t = use_theme();
  const tr = use_t();
  return (
    <Screen>
      <SectionHeader title={tr("Discover")} detail={tr("Local businesses in your city.")} />
      <Field label="" placeholder={tr("plumber open now")} />
      <View style={{ height: t.spacing.md }} />
      {BUSINESSES.map((b) => (
        <Row key={b.name} label={b.name} blurb={tr(b.blurb)} staticRow />
      ))}
    </Screen>
  );
}
