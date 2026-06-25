import type {
  auth_config,
  resident_session,
  tenant_context_token,
} from "./types";

// m-res-auth does not authenticate. It loads the pre-signed token from config,
// parses its claims once at startup to fail fast on a malformed token, and hands
// the established session to the consuming modules as the encoded token, never
// bare claims. It never mints or signs the token, and never decodes claims on
// the request path; the backend gateway verifies RS256 on every request.

// Decode the JWT payload without verifying the signature. Startup-only sanity
// check; the backend verifies RS256 at its edges.
export function parse_claims(encoded_token: string): tenant_context_token {
  const parts = encoded_token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new Error("tenant_context_token is not a well-formed JWT");
  }
  const payload_segment = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const json = decode_base64(payload_segment);
  const claims = JSON.parse(json) as tenant_context_token;
  return claims;
}

// Build the resident session this module passes to civic, accounts, assistant,
// and notifications. The carried value is the encoded JWT.
export function load_resident_session(config: auth_config): resident_session {
  // Parse once so a malformed token fails fast at startup.
  parse_claims(config.tenant_context_token);
  return { tenant_context_token: config.tenant_context_token };
}

// Base64url/base64 decode using the runtime's global atob.
function decode_base64(segment: string): string {
  const padded = segment + "=".repeat((4 - (segment.length % 4)) % 4);
  return atob(padded);
}
