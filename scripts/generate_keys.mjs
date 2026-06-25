// Generates the RS256 keypair for the tenant_context_token.
// public.pem is read by ap-server (backend/keys/public.pem) to verify tokens;
// private.pem is read by sign_token.mjs to sign them. Run once before signing.

import { generateKeyPairSync } from "node:crypto";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// keys live next to the backend host that verifies them
const here = dirname(fileURLToPath(import.meta.url));
const keys_dir = resolve(here, "../application-plane/backend/keys");
mkdirSync(keys_dir, { recursive: true });

// 2048-bit RSA, SPKI public / PKCS8 private, both PEM (what importSPKI expects)
const { publicKey, privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

writeFileSync(resolve(keys_dir, "private.pem"), privateKey);
writeFileSync(resolve(keys_dir, "public.pem"), publicKey);

console.log("keypair written to application-plane/backend/keys");
