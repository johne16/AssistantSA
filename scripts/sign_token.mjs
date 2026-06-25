// Signs the single-user PoC tenant_context_token (RS256) with private.pem and
// writes it as an importable TS module the mobile client bundles at build time.
// Run generate_keys.mjs first. The token is local-only and gitignored.

import { createSign } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

// signing key produced by generate_keys.mjs
const private_key = readFileSync(
  resolve(here, "../application-plane/backend/keys/private.pem"),
  "utf8",
);

// single-user PoC claims; exp one year out
const now = Math.floor(Date.now() / 1000);
const payload = {
  sub: "resident-poc",
  city_tenant_id: "san-antonio",
  iat: now,
  exp: now + 60 * 60 * 24 * 365,
};

// hand-build the RS256 JWT: base64url(header).base64url(payload).signature
const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64url");
const signing_input = `${b64url({ alg: "RS256", typ: "JWT" })}.${b64url(payload)}`;
const signer = createSign("RSA-SHA256");
signer.update(signing_input);
const signature = signer.sign(private_key).toString("base64url");
const token = `${signing_input}.${signature}`;

// write into the mobile client as a module app-config.ts imports
const out_dir = resolve(
  here,
  "../application-plane/mobile/resident-mobile/src/secrets",
);
mkdirSync(out_dir, { recursive: true });
writeFileSync(
  resolve(out_dir, "tenant_context_token.ts"),
  `export const tenant_context_token = ${JSON.stringify(token)};\n`,
);

console.log(
  "signed token written to resident-mobile/src/secrets/tenant_context_token.ts",
);
