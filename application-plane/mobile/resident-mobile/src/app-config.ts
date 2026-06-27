// Client-side composition config for the resident app. Mirrors ap-server's
// env-loaded config on the backend: the app's composition root reads these
// non-secret values and injects each module's config keys. The
// tenant_context_token is the pre-signed PoC stand-in (single user, no sign in,
// exp 2027-06-18); only the signed token ships, never the signing key.

// Locally minted RS256-signed JWT, written by scripts/sign_token.mjs and bundled
// at build time. The file is gitignored and stays local; run the script before
// building. Payload decodes to { sub, city_tenant_id, iat, exp }.
import { tenant_context_token } from "./secrets/tenant_context_token";
import Constants from "expo-constants";

// Port the ap-server REST/WS gateway listens on. The dev host is resolved at
// runtime; only the port is fixed.
const api_gateway_port = 8080;

// Resolve the dev machine's host the device should reach for the gateway.
// Constants.expoConfig.hostUri is the Metro dev server origin (e.g.
// "192.168.1.5:8081"), present only during development under @expo/cli. The
// Expo CLI fills it with the LAN IP, which is reachable from the Android
// emulator, an Android physical device, the iOS simulator, and an iOS physical
// device alike, so one derivation covers every target. The host portion is
// stripped of the Metro port and the gateway port is applied. Falls back to
// localhost when hostUri is absent (e.g. a production build).
function resolve_api_gateway_base_url(): string {
    const host_uri = Constants.expoConfig?.hostUri;
    const dev_host = host_uri ? host_uri.split(":")[0] : "localhost";
    return `http://${dev_host}:${api_gateway_port}`;
}

export const app_config = {
    // m-res-shell
    tenant_base_domain: "assistantsa.app",
    // m-res-auth
    tenant_context_token,
    // m-res-accounts / m-res-civic / m-res-assistant
    api_gateway_base_url: resolve_api_gateway_base_url(),
    // m-res-accounts
    max_concurrent_syncs: 3,
    // m-res-assistant
    // ElevenLabs voice ids the voice picker offers, grouped by app language then
    // gender, two per gender. The Language preference (en|es) selects which set
    // surfaces. Paste the ids saved from the ElevenLabs voice library below.
    voice_ids: {
        en: {
            male: ["7EzWGsX10sAS4c9m9cPf", "gPPH6SLdL8XSX6GNJ40G"],
            female: ["Nhs7eitvQWFTQBsf0yiT", "DXFkLCBUTmvXpp2QwZjA"],
        },
        es: {
            male: ["2AwUE4CaPbZK4AHHRugG", "sDh3eviBhiuHKi0MjTNq"],
            female: ["dvIBbCEt41yUyHBRbI5A", "22dcXdsgE2CBQsk9cnTY"],
        },
    },
    // Voice used until the resident picks one. Paste one English male id here.
    default_voice_id: "7EzWGsX10sAS4c9m9cPf",
};
