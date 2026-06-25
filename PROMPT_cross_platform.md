# Task: make the resident-mobile app work first-time on EVERY platform

The app must run with ZERO manual troubleshooting on all of:
- Android emulator
- Android physical device
- iOS simulator
- iOS physical device

No editing IPs, no flipping flags, no per-platform fixes after the fact. The code must already handle every case. Verify each requirement against official docs / actual file behavior before writing — do not write from memory.

## Known breakage to fix

1. **Backend URL is hardcoded to the emulator.**
   `application-plane/mobile/resident-mobile/src/app-config.ts` sets
   `api_gateway_base_url: "http://10.0.2.2:8080"`. That address only works on the
   Android emulator. A physical device must reach the dev machine's LAN IP; the
   iOS simulator uses `localhost`. Resolve the host automatically so the same
   build works everywhere — derive the dev-host IP from Expo at runtime (e.g.
   the Metro host URI exposed by `expo-constants`) and apply the gateway port,
   rather than committing a fixed address. Confirm the exact `expo-constants`
   field and shape before using it.

2. **Cleartext HTTP/WS is blocked on real devices.**
   The gateway is `http://`/`ws://` over LAN. Android (API 28+) and iOS ATS block
   cleartext by default, so a physical device fails even with the correct IP.
   Allow cleartext for the dev/LAN host on both platforms (Android manifest /
   network security config; iOS `NSAppTransportSecurity`). The project is a bare
   workflow on Android (committed `android/` dir, manifest is the source of
   truth); iOS has no native dir yet (app.json drives prebuild).

3. **Mic permission must be declared on both platforms.**
   Android `RECORD_AUDIO` + `MODIFY_AUDIO_SETTINGS` are in
   `android/app/src/main/AndroidManifest.xml`. iOS `NSMicrophoneUsageDescription`
   is in app.json `ios.infoPlist` and will apply when iOS is prebuilt. Verify
   both are present and correct.

## Inherent platform limit (not a bug to fix, just know it)

- Acoustic Echo Cancellation in `@speechmatics/expo-two-way-audio` does NOT work
  on emulators/simulators — physical device only. Do not chase echo on the
  emulator.

## Definition of done

A fresh checkout + install + run on any of the four targets connects to the
backend and exercises voice with no manual edits. The only expected runtime
interaction is granting the OS mic prompt.
