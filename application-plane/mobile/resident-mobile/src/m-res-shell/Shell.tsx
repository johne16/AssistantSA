import { useMemo } from "react";
import { load_resident_session, SessionProvider } from "@/m-res-auth";
import { Portal } from "@/m-res-portal";
import { app_config } from "@/app-config";

// The resident shell. This PoC has no login: the shell loads the pre-signed
// session from m-res-auth, provides it to the consuming modules, and renders
// the portal. The root layout owns the theme provider and fonts; the shell owns
// the session handoff. The city tenant comes from the tenant_context_token. No
// auth and no backend calls happen here.

export function Shell() {
  const session = useMemo(
    () => load_resident_session({ tenant_context_token: app_config.tenant_context_token }),
    [],
  );

  return (
    <SessionProvider session={session}>
      <Portal />
    </SessionProvider>
  );
}
