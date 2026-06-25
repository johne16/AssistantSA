import { useMemo } from "react";
import { Platform } from "react-native";
import { load_resident_session, SessionProvider } from "@/m-res-auth";
import { Portal } from "@/m-res-portal";
import { app_config } from "@/app-config";
import { resolve_city } from "./city";
import type { app_launch } from "./types";

// The resident shell. This PoC has no login: the shell resolves the city from
// the launch subdomain, loads the pre-signed session from m-res-auth, provides
// it to the consuming modules, and renders the portal. The root layout owns the
// theme provider and fonts; the shell owns city resolution and the session
// handoff. No auth and no backend calls happen here.

function read_launch(): app_launch {
  // On web the subdomain comes from the host; on native there is no host, so
  // the city falls back to config. parameters carry any deep-link query values.
  if (Platform.OS === "web" && typeof window !== "undefined") {
    const host = window.location.hostname;
    const base = app_config.tenant_base_domain;
    const subdomain = host.endsWith(base)
      ? host.slice(0, Math.max(0, host.length - base.length - 1)) || null
      : null;
    return { subdomain, parameters: {} };
  }
  return { subdomain: null, parameters: {} };
}

export function Shell() {
  const session = useMemo(
    () => load_resident_session({ tenant_context_token: app_config.tenant_context_token }),
    [],
  );
  // Resolve the city before login so the app is branded for the right tenant.
  useMemo(
    () => resolve_city(read_launch(), { tenant_base_domain: app_config.tenant_base_domain }),
    [],
  );

  return (
    <SessionProvider session={session}>
      <Portal />
    </SessionProvider>
  );
}
