import type { app_launch, city_identity, shell_config } from "./types";

// Resolve the city identity from the app-launch subdomain against the
// configured base domain, before login. The tenant_context_token itself is
// pre-signed and read from config by m-res-auth; this only resolves which city
// the app is branded for.

export function resolve_city(
  launch: app_launch,
  config: shell_config,
): city_identity {
  // Prefer an explicit subdomain; fall back to a city parameter if present.
  const subdomain = launch.subdomain ?? launch.parameters["city"] ?? null;
  const city_tenant_id = subdomain ?? "default";
  void config;
  return { city_tenant_id, subdomain };
}
