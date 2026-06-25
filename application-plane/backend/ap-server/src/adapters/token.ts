// jose-backed token verifier (RS256 signature check) and claims decoder
// (no signature check). Each module owns its own token_verifier/claims_decoder
// port type; these concrete adapters satisfy all of them with the same shape.

import { importSPKI, jwtVerify, decodeJwt, type KeyObject, type CryptoKey } from "jose";

export interface tenant_claims {
  sub: string;
  city_tenant_id: string;
  iat: number;
  exp: number;
}

// Map a verified/decoded JWT payload onto the tenant_context_token shape.
function to_claims(payload: Record<string, unknown>): tenant_claims {
  return {
    sub: String(payload["sub"] ?? ""),
    city_tenant_id: String(payload["city_tenant_id"] ?? ""),
    iat: Number(payload["iat"] ?? 0),
    exp: Number(payload["exp"] ?? 0),
  };
}

export interface token_verifier {
  verify(token: string): Promise<tenant_claims>;
}

export interface claims_decoder {
  decode(token: string): tenant_claims;
}

// RS256 verifier against the configured PEM SPKI public key.
export async function create_token_verifier(
  public_key_pem: string,
): Promise<token_verifier> {
  const key: CryptoKey | KeyObject = await importSPKI(public_key_pem, "RS256");
  return {
    async verify(token: string): Promise<tenant_claims> {
      const { payload } = await jwtVerify(token, key, { algorithms: ["RS256"] });
      return to_claims(payload as Record<string, unknown>);
    },
  };
}

// Decoder for the gateway path, where the edge already verified the signature.
export function create_claims_decoder(): claims_decoder {
  return {
    decode(token: string): tenant_claims {
      return to_claims(decodeJwt(token) as Record<string, unknown>);
    },
  };
}
