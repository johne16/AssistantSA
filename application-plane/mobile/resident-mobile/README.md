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

## Patched dependency: @speechmatics/expo-two-way-audio

The voice playback engine is patched via `patch-package` (patch in `patches/`, applied automatically by the `postinstall` script on every `npm install`).

What the patch adds: a `flush()` function on the native audio engine (Android `AudioTrack.flush()` after pause/play; iOS `AVAudioPlayerNode.stop()`/`play()`), exposed through both native modules and the JS wrapper (`src/core.ts`, `build/core.js`, `build/core.d.ts`).

Why: the library queues PCM into an Android `AudioTrack` (`MODE_STREAM`) / iOS player node with no public mid-stream flush, so barge-in could not cut in-flight assistant speech. `m-res-assistant/audio-io.ts` calls `flush()` on barge-in to drop the rest of the reply instantly.

The patch touches native source, so after a fresh install the dev build must be rebuilt (`npm run android` / `npm run ios`) for it to take effect.

Regenerating the patch (after editing the library source in `node_modules`):

```
# Windows: override git line-ending/long-path handling for the diff, and remove
# stale Gradle output so it is not swept into the patch.
rm -rf node_modules/@speechmatics/expo-two-way-audio/android/build
GIT_CONFIG_COUNT=2 \
GIT_CONFIG_KEY_0=core.autocrlf GIT_CONFIG_VALUE_0=false \
GIT_CONFIG_KEY_1=core.longpaths GIT_CONFIG_VALUE_1=true \
npx patch-package @speechmatics/expo-two-way-audio
```

## Config

Client config lives in `src/app-config.ts`, the composition root that injects each module's config keys:

- `api_gateway_base_url` points at the `ap-server` REST gateway (default `http://localhost:8080`).
- `tenant_context_token` is the pre-signed PoC token (single user, no sign in); only the signed token ships, never the signing key.
- `tenant_base_domain`, `max_concurrent_syncs` per-module values.
