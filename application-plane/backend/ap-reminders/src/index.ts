// ap-reminders public surface. ap-server wires concrete adapters into these factories.

import { importSPKI, jwtVerify } from "jose";
import type { tenant_context_token, token_verifier } from "./types.js";

export { create_reminders_service } from "./service.js";
export { create_reminders_handler } from "./handler.js";
export type { reminders_service } from "./service.js";
export type { reminders_handler } from "./handler.js";
export * from "./types.js";

// RS256 token_verifier backed by jose. The public key is the configured
// token_verification_public_key (PEM SPKI). No signing key in this module.
export async function create_token_verifier(
  public_key_pem: string,
): Promise<token_verifier> {
  const key = await importSPKI(public_key_pem, "RS256");
  return {
    async verify(token: string): Promise<tenant_context_token> {
      const { payload } = await jwtVerify(token, key, { algorithms: ["RS256"] });
      return {
        sub: payload.sub as string,
        city_tenant_id: payload["city_tenant_id"] as string,
        iat: payload.iat as number,
        exp: payload.exp as number,
      };
    },
  };
}
