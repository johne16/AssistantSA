// ap-utility public surface. ap-server wires concrete adapters into these factories.

import { importSPKI, jwtVerify } from "jose";
import type {
  tenant_context_token,
  token_verifier,
} from "./types.js";

export { create_utility_service } from "./service.js";
export { create_utility_handler } from "./handler.js";
export type { utility_service, utility_read_result } from "./service.js";
export type { utility_handler } from "./handler.js";
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
      if (typeof payload.sub !== "string" || payload.sub.length === 0) {
        throw new Error("tenant_context_token missing sub claim");
      }
      if (
        typeof payload["city_tenant_id"] !== "string" ||
        payload["city_tenant_id"].length === 0
      ) {
        throw new Error("tenant_context_token missing city_tenant_id claim");
      }
      return {
        sub: payload.sub,
        city_tenant_id: payload["city_tenant_id"],
        iat: payload.iat as number,
        exp: payload.exp as number,
      };
    },
  };
}
