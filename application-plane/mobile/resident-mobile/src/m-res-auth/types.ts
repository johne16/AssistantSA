// m-res-auth owns the canonical tenant_context_token definition. It is the
// first module to read and parse the token, so the shape lives here; every
// other module (backend and mobile) and ap-voice's Rust types mirror this
// exactly with zero deviation.

// Canonical claims shape. RS256-signed JWT, pre-signed offline. Minimal PoC
// claim set. The encoded JWT travels on the wire as a string; this interface is
// the decoded claim set that consumers parse and verifiers validate against.
export interface tenant_context_token {
  sub: string; // resident/subject id
  city_tenant_id: string; // per-city namespace key; backend resolves it to the siloed per-city Postgres schema namespace
  iat: number; // issued-at, seconds since epoch
  exp: number; // expiry, seconds since epoch (PoC: 2027-06-18)
}

// The authenticated session this module passes to the consuming modules. The
// value carried is the encoded JWT string, never bare claims.
export interface resident_session {
  tenant_context_token: string; // encoded RS256 JWT
}

// Config for this module: the pre-signed token shipped in client config.
export interface auth_config {
  tenant_context_token: string; // encoded RS256 JWT, pre-signed offline
}
