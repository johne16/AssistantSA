# AssistantSA backend

npm workspaces over `ap-*`, plus a standalone Rust voice service. The specs in `design/05_module_specs/` are the source of truth.

## Modules

- `ap-assistant` (TypeScript) LLM core and tool registry
- `ap-civic` (TypeScript) civic reads
- `ap-utility` (TypeScript) stored utility bill and usage
- `ap-notifications` (TypeScript) push delivery
- `ap-server` (TypeScript) composition root: REST gateway, voice WebSocket bridge, scheduler, edge token verification
- `ap-voice` (Rust) voice service, runs as a separate process
- `crawl-service` (Python) crawl4ai sidecar for `ap-civic` page fetches. See [crawl-service/README.md](crawl-service/README.md).

`ap-server` imports the other `ap-*` packages by name (`import ... from "ap-civic"`), which resolve to each package's compiled `dist/index.js` and `.d.ts`. The dependency packages must be built before `ap-server` typechecks or runs.

## Runtime processes

The backend runs as three processes, all managed by the host:

- `ap-server` (Node) the host. Serves the REST gateway and the voice WebSocket bridge, runs the scheduler, verifies tokens, and supervises the two sidecars below. Default listen `0.0.0.0:8080`.
- `ap-voice` (Rust) the voice service `ap-server` bridges to. Default `ws://localhost:8090/voice`.
- `crawl-service` (Python) the civic page-fetch sidecar. Default `http://127.0.0.1:8095`; `ap-civic` falls back to a raw GET when it is unreachable.

`ap-server` spawns `ap-voice` and `crawl-service` on startup and terminates them on shutdown, so one command brings the whole backend up and one signal takes it all down. The listen addresses passed to each sidecar are derived from the host's own config (`ap_voice_ws_url`, `crawl_service_url`). Set `spawn_sidecars=false` to run the sidecars externally instead.

### REST gateway surface (`ap-server`)

- `POST /civic` -> `ap-civic`
- `POST /utility/site-script`, `POST /utility/bill-push`, `POST /utility/read` -> `ap-utility`
- `POST /notifications/registrations` -> `ap-notifications`
- `POST /assistant/query` (SSE stream) -> `ap-assistant`

Every request carries the `tenant_context_token`, verified at the edge before routing. The voice WebSocket frames are proxied verbatim to `ap-voice`.

## Build

Run from the repo root.

```
# install and link the workspace packages into node_modules
npm install

# build the dependency packages first so their dist/ and .d.ts exist
npm run build -w ap-civic -w ap-utility -w ap-assistant -w ap-notifications

# build the host
npm run build -w ap-server
```

If `ap-server` reports `Cannot find module 'ap-civic'`, the dependency packages have not been built yet. Run the dependency build step above.

Typecheck or build a single module:

```
npm run build -w ap-civic
```

## Run

From the repo root, after building:

```
npm start
```

That runs `node application-plane/backend/ap-server/dist/index.js`, which starts the host and spawns both sidecars. Stopping the host (Ctrl-C / SIGTERM) stops them too.

Build and start in one go:

```
npm run build && npm start
```

## Sidecar prerequisites

`ap-server` launches the sidecars but does not install their toolchains. Before the first run:

- `ap-voice` (Rust): the default launch command is `cargo run --release`, so a Rust toolchain must be installed. Override with `ap_voice_cmd` to point at a prebuilt binary.
- `crawl-service` (Python): install its deps once (see [crawl-service/README.md](crawl-service/README.md)). The default launch command is `python3 crawl_service.py`; override with `crawl_service_cmd`.

## Config

`ap-server` loads config from the process environment at startup (`src/config.ts`), sourced from a gitignored `.env` at the deployment location; only a non-secret `.env.example` is committed.

- Secrets (`database_url`, `claude_api_key`, `token_verification_public_key`, `push_access_token`) are read from the environment with no default.
- Non-secret keys (listen address, source URLs, redis URL, voice and crawl service URLs, retention and refresh day counts) have built-in defaults that the environment overrides.

`ap-voice` reads its own environment variables independently of `ap-server`.
