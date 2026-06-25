# AssistantSA

Resident-facing assistant for a city tenant. Residents get civic information (alerts, events, collection schedules, representatives), their utility bills and usage, push notifications, and an LLM assistant reachable by chat or voice that can answer using those same sources.

This proof of concept runs single-user with no sign in. A pre-signed `tenant_context_token` stands in for auth; the control-plane (`cp-*`) modules are out of scope. The specs in `design/05_module_specs/` are the source of truth.

## Architecture

Two planes:

- **Backend** a single host process (`ap-server`) composes the domain modules behind injected ports and exposes a REST gateway plus a voice WebSocket surface. It verifies the `tenant_context_token` (RS256) at the edge, runs the scheduler for periodic fetches, and persists per city in Postgres (schema-per-city, in-memory fallback). Domain modules: `ap-assistant`, `ap-civic`, `ap-utility`, `ap-notifications`. Voice runs as a separate Rust process, `ap-voice`.
- **Mobile** an Expo/React Native resident client. It targets the gateway at `api_gateway_base_url` and carries the `tenant_context_token` on every request.

Request flow: the mobile client calls the `ap-server` REST gateway (or opens the voice WebSocket); the gateway verifies the token and routes to the owning module handler. The assistant module dispatches tool calls back into `ap-civic` and `ap-utility` through the same ports.

## Layout

- `application-plane/backend/` backend services (TypeScript modules behind one host, plus the Rust voice service). See [backend/README.md](application-plane/backend/README.md).
  - [ap-voice/README.md](application-plane/backend/ap-voice/README.md) Rust voice service.
  - [crawl-service/README.md](application-plane/backend/crawl-service/README.md) Python crawl sidecar. Dead code: every civic source moved to raw HTTP GET, so nothing calls it and the host no longer spawns it. Kept in the tree pending exploration for future use.
- `application-plane/mobile/resident-mobile/` Expo/React Native resident client. See [resident-mobile/README.md](application-plane/mobile/resident-mobile/README.md).
  - `src/m-res-notifications/` Dead code for the moment: notifications are disconnected, the portal no longer wires the hook, and nothing raises a notification anywhere in the app. Kept in the tree for future push notifications. The preference toggles it defines now gate the home-screen alert feed instead.

## Supplemental instructions

| Doc | What |
| --- | --- |
| [package_installation_instructions.md](supplemental_instructions/package_installation_instructions.md) | Dependency install commands |
| [codespaces_deployment.md](supplemental_instructions/codespaces_deployment.md) | Run the backend on Codespaces |
| [android_emulator_testing.md](supplemental_instructions/android_emulator_testing.md) | Android emulator (Windows) |
| [ios_simulator_testing.md](supplemental_instructions/ios_simulator_testing.md) | iOS Simulator (Mac) |
| [mobile_deployment.md](supplemental_instructions/mobile_deployment.md) | Ship to a physical iPhone |

## Initial setup

One-time setup before the first dev run.

1. **Toolchains**: Node.js 20+, Rust (`cargo`) for `ap-voice`, Python 3 for `crawl-service`, the `redis-server` binary on PATH (the host spawns it), and optionally Postgres.
2. **Client runtime**: set up an Android emulator / iOS simulator (or a connected device with a development build). The browser is not a supported target.
3. **Backend and mobile deps, sidecar toolchains**: see [package_installation_instructions.md](supplemental_instructions/package_installation_instructions.md).
4. **Auth keypair and token**: the `tenant_context_token` is an RS256 JWT. From the repo root, generate the keypair, then sign the token:

   ```
   node scripts/generate_keys.mjs
   node scripts/sign_token.mjs
   ```

   `generate_keys.mjs` writes `application-plane/backend/keys/{private,public}.pem` (the backend reads `public.pem` to verify). `sign_token.mjs` signs the token with `private.pem` and writes it to `resident-mobile/src/secrets/tenant_context_token.ts`, which `app-config.ts` imports. Both the private key and the token are gitignored.
5. **Backend `.env`**: copy `.env.example` to a gitignored `.env` at the repo root and fill the secrets (`claude_api_key`, `database_url`, `deepgram_api_key`, `elevenlabs_api_key`). The public key is read from `backend/keys/public.pem`, not `.env`. Non-secret keys keep their defaults.
6. **Client gateway URL**: in `app-config.ts`, set `api_gateway_base_url` to a host the device can reach (`http://10.0.2.2:8080` for the Android emulator, the dev machine's LAN IP for a physical device, `http://localhost:8080` for the iOS simulator).

## Running in dev mode

Per-run steps. Backend commands run from the repo root.

1. Build and start the backend host. It loads `.env`, spawns Redis and the `ap-voice` sidecar (the `crawl-service` sidecar is dead code and no longer spawned), and serves the gateway on `:8080`:

   ```
   npm run build
   node --env-file=.env application-plane/backend/ap-server/dist/index.js
   ```

   The Redis command is platform-aware: `redis-server` on Linux/Codespaces, a Docker container on Windows (Docker Desktop must be running). Override with `redis_cmd` in `.env`. Expect `[ap-server] listening on 0.0.0.0:8080`. Ctrl-C stops the host and all sidecars.
2. In a second terminal, build and run the development build. This compiles the native project, installs it on the emulator/device, and starts Metro:

   ```
   cd application-plane/mobile/resident-mobile
   npm run android
   ```

   Use `npm run ios` on Mac. Expo Go is not supported: native modules such as `expo-notifications` require a development build.
