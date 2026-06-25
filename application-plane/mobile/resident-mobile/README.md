# resident-mobile

Expo/React Native resident client. Entry is `expo-router` (`app/_layout.tsx`, `app/index.tsx`). The specs in `design/05_module_specs/` are the source of truth.

## Modules

Under `src/`:

- `m-res-shell` app shell and navigation
- `m-res-auth` tenant_context_token handling
- `m-res-portal` portal views
- `m-res-accounts` linked utility accounts and sync
- `m-res-assistant` assistant chat and voice
- `m-res-civic` civic reads
- `m-res-notifications` push registration and preferences

## Run

One-time setup (see `supplemental_instructions/package_installation_instructions.md`):

```
npm install
```

To run, pick one (not both). Each builds and installs the development build and starts Metro:

```
npm run android    # expo run:android
npm run ios        # expo run:ios (Mac only)
```

## After code changes

JS/TS changes: nothing. While Metro from `npm run android` is running, it hot-reloads on save.

Native changes (changed native code, or added a library with native modules): rebuild the dev build:

```
npm run android    # or: npm run ios
```

## Config

Client config lives in `src/app-config.ts`, the composition root that injects each module's config keys:

- `api_gateway_base_url` points at the `ap-server` REST gateway (default `http://localhost:8080`).
- `tenant_context_token` is the pre-signed PoC token (single user, no sign in); only the signed token ships, never the signing key.
- `tenant_base_domain`, `max_concurrent_syncs` per-module values.
