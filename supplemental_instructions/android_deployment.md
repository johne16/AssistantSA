# Installing the Resident Mobile App on a Physical Android Phone

This guide is written for someone who has never built or shipped a mobile app. It walks through getting the AssistantSA resident mobile app (Expo / React Native, Expo SDK 56, expo-router) onto a real Android phone. Follow the steps in order. Every command is shown exactly as you should type it.

The project lives at `application-plane/mobile/resident-mobile`. Run all `eas` and `npx expo` commands from inside that folder unless a step says otherwise.

There are two independent routes. Pick one; they are not steps of a single process.

- **Route A (Section A): free local install.** Builds on the Windows machine with Android Studio and installs over USB to any Android phone you physically hold. No developer account of any kind, no expiry. This is the chosen method for this project.
- **Route B (Section B): EAS cloud install.** Builds in Expo's cloud and installs wirelessly via an APK download. Requires only a free Expo account. Use only if you want to avoid the local Android SDK setup or want wireless distribution.

## Table of contents

- [Route A. Free local install with Android Studio](#route-a-free-local-install-with-android-studio)
  - [A.1 Prerequisites](#a1-prerequisites)
  - [A.2 Point the app at the backend](#a2-point-the-app-at-the-backend)
  - [A.3 Prepare the phone (per phone)](#a3-prepare-the-phone-per-phone)
  - [A.4 Generate the native Android project (one time)](#a4-generate-the-native-android-project-one-time)
  - [A.5 Install onto the phone](#a5-install-onto-the-phone)
  - [A.6 Iterating after the first install](#a6-iterating-after-the-first-install)
  - [A.7 Standalone release build (runs without the computer)](#a7-standalone-release-build-runs-without-the-computer)
- [Route B. EAS cloud install (free Expo account)](#route-b-eas-cloud-install-free-expo-account)
  - [B.1 Prerequisites](#b1-prerequisites)
  - [B.2 What a development build is, versus a production build](#b2-what-a-development-build-is-versus-a-production-build)
  - [B.3 Configure the project for EAS](#b3-configure-the-project-for-eas)
  - [B.4 Point the app at the backend (do this before building)](#b4-point-the-app-at-the-backend-do-this-before-building)
  - [B.5 Build for Android in the cloud with EAS Build](#b5-build-for-android-in-the-cloud-with-eas-build)
  - [B.6 Install the build onto the phone](#b6-install-the-build-onto-the-phone)
  - [B.7 Iterating after the first install](#b7-iterating-after-the-first-install)
  - [B.8 Google Play via EAS Submit (not needed for this project)](#b8-google-play-via-eas-submit-not-needed-for-this-project)
- [Sources](#sources)

---

# Route A. Free local install with Android Studio

Builds the app on the Windows machine and installs it onto a physical Android phone over USB. Debug builds are signed automatically with a local debug keystore, so there is no signing setup, no account, and no expiry.

## A.1 Prerequisites

1. **JDK 17.** Install Microsoft OpenJDK 17 with Chocolatey from an elevated PowerShell:

   ```powershell
   # install JDK 17 (required by the Android Gradle build)
   choco install -y microsoft-openjdk17
   ```

   If Chocolatey is not installed, download the JDK 17 MSI from https://learn.microsoft.com/en-us/java/openjdk/download instead. Close and reopen the terminal afterward so `JAVA_HOME` (set by the installer) takes effect.

2. **Android Studio.** Download from https://developer.android.com/studio and run the installer. In the setup wizard choose the **Standard** install type and accept the license agreements. This installs the Android SDK to `%LOCALAPPDATA%\Android\Sdk`.

3. **SDK components.** In Android Studio: **Settings > Languages & Frameworks > Android SDK**. On the **SDK Platforms** tab check **Android SDK Platform 36**. On the **SDK Tools** tab confirm **Android SDK Build-Tools** and **Android SDK Platform-Tools** are installed. Click OK to apply.

4. **Environment variables.** Press Win, type "environment variables", open **Edit environment variables for your account**:
   - New user variable: name `ANDROID_HOME`, value `%LOCALAPPDATA%\Android\Sdk`.
   - Edit the user `Path` variable and add a new entry: `%LOCALAPPDATA%\Android\Sdk\platform-tools`.

   Open a new PowerShell window and verify:

   ```powershell
   # confirm the Android Debug Bridge is on PATH
   adb --version
   ```

5. A USB cable to connect the phone to the computer.

6. The repo cloned with mobile deps installed (`npm install` in `application-plane/mobile/resident-mobile`).

7. The signed `tenant_context_token` present on the machine. If it is missing, run `node scripts/generate_keys.mjs` then `node scripts/sign_token.mjs` from the repo root.

## A.2 Point the app at the backend

By default `api_gateway_base_url` is resolved at runtime from the Metro dev server host the JS bundle loaded from. For this project the backend is reached over Tailscale, so hardcode the host instead.

1. Set up Tailscale first: [tailscale_setup.md](tailscale_setup.md).
2. Open `application-plane/mobile/resident-mobile/src/app-config.ts`.
3. Replace the `api_gateway_base_url: resolve_api_gateway_base_url()` line with the Tailscale host (the commented line below it is a template):

   ```ts
   api_gateway_base_url: "http://100.x.y.z:8080",
   ```

4. Save before building.

## A.3 Prepare the phone (per phone)

1. Enable Developer Options: on the phone, **Settings > About phone**, tap **Build number** seven times.
2. Enable USB debugging: **Settings > Developer options > USB debugging**.
3. Connect the phone to the computer with the USB cable.
4. On the phone, tap **Allow** on the "Allow USB debugging?" prompt (check "Always allow from this computer").
5. Verify the connection:

   ```powershell
   # phone must show with status "device", not "unauthorized"
   adb devices
   ```

## A.4 Generate the native Android project (one time)

From `application-plane/mobile/resident-mobile`:

```sh
npx expo prebuild --platform android
```

Re-run this only after changing native config or dependencies.

## A.5 Install onto the phone

1. From `application-plane/mobile/resident-mobile`, build and install:

   ```sh
   npx expo run:android
   ```

   With a physical phone connected, the build installs onto it (if both a phone and an emulator are available you are prompted to pick). The first build downloads Gradle dependencies and can take a while; later builds are much faster.

2. The command starts the Metro dev server and launches the app on the phone. Grant the microphone permission when the app asks.

## A.6 Iterating after the first install

- JavaScript, styling, text, and asset changes reload through Metro (`npx expo start` if it is not already running) without reinstalling. The phone and the computer must be on the same network for wireless reload; otherwise keep the USB cable connected and run:

  ```powershell
  # forward Metro's port to the phone over USB
  adb reverse tcp:8081 tcp:8081
  ```

- Changing native code, native dependencies, permissions, or app config requires rerunning `npx expo prebuild --platform android` (config changes) and `npx expo run:android`.

## A.7 Standalone release build (runs without the computer)

The debug build from A.5 downloads its JavaScript from the Metro dev server on the computer at every launch, so the phone must reach Metro to run. A release build embeds the JavaScript in the binary, so the app runs on its own with no computer and no USB.

1. From `application-plane/mobile/resident-mobile`, build and install the release variant:

   ```sh
   npx expo run:android --variant release
   ```

   The release variant is signed with the local debug keystore, so no signing setup is needed. This build is not code-signed for the Google Play Store.

2. Once installed, the app runs standalone. Metro does not need to be running and the USB cable can be unplugged. It still reaches the backend over Tailscale using the `api_gateway_base_url` baked in at build time (A.2), so that value must be set before building.

3. JavaScript changes no longer reload live; rerun this command to install an updated build.

---

# Route B. EAS cloud install (free Expo account)

An alternative to Route A. Builds in Expo's cloud and installs from an APK download, so no Android Studio or local SDK is needed. Skip this entire route if you are using Route A.

## B.1 Prerequisites

1. Create a free Expo account at https://expo.dev/signup. You will use this account to run cloud builds.

2. Install Node.js if you do not already have it. You need it to run the commands below.

3. Install the EAS CLI globally:

   ```sh
   npm install --global eas-cli
   ```

4. Log in to your Expo account from the terminal:

   ```sh
   eas login
   ```

Unlike iOS, no paid account is required to install on a physical Android phone. Android allows installing APKs directly.

## B.2 What a development build is, versus a production build

1. A development build is your own version of an Expo app. It includes the `expo-dev-client` library and is compiled with whatever native libraries your project requires, letting you use any native libraries and change any native config.

2. A production build is the optimized final binary you ship to Google Play.

3. This project requires a development build because it uses custom native modules that are not part of the Expo SDK (for example `@siteed/expo-audio-studio`, `react-native-audio-api`, and `expo-notifications`). You must create a development build (or a real build for distribution) to run it.

4. Development builds must be `.apk` files. The default Android build format is `.aab`, which is for Google Play distribution and cannot be installed directly on a phone. The `development` profile produces an `.apk`.

## B.3 Configure the project for EAS

1. From inside `application-plane/mobile/resident-mobile`, run:

   ```sh
   eas build:configure
   ```

   This creates an `eas.json` file in the project. `eas.json` is the configuration file for EAS CLI and services. By default it defines three build profiles: `development`, `preview`, and `production`.

2. The Android application ID is already set in `app.json` (`"package": "com.anonymous.residentmobile"`). Keep it the same across builds.

## B.4 Point the app at the backend (do this before building)

The value baked into a build cannot be changed over the air, so set the backend URL before you build.

1. Open `application-plane/mobile/resident-mobile/src/app-config.ts`.

2. Find `api_gateway_base_url`.

3. A real phone cannot reach `localhost:8080` on your computer. Change `api_gateway_base_url` to a URL the phone can reach: the Tailscale host (see [tailscale_setup.md](tailscale_setup.md)) or a publicly reachable backend URL.

4. Save the file before running any build command. Each build uses whatever value is in this file at build time.

## B.5 Build for Android in the cloud with EAS Build

1. Start an Android development build:

   ```sh
   eas build --platform android --profile development
   ```

2. Handle credentials when prompted. When asked whether to generate a new Android Keystore, answer yes. EAS creates and stores the keystore for you; there is no Apple-style device registration on Android.

3. The CLI prints a build dashboard link. Open it to watch progress. The build runs in Expo's cloud.

## B.6 Install the build onto the phone

1. When the build finishes, the dashboard shows an **Install** button that displays a QR code. Scan it with the phone camera, open the link, and tap **Install** to download the `.apk`.

2. Android blocks installs from outside Google Play by default. When prompted, allow the browser to install unknown apps, then confirm the install.

3. A development build connects to a dev server while you work. Start it with:

   ```sh
   npx expo start
   ```

   Then open the installed app on the phone and select the development server (the phone and the computer must be on the same network).

4. Alternative to the QR code: with the phone connected by USB, use the **Open with Orbit** option on the build page (requires the Expo Orbit desktop app).

## B.7 Iterating after the first install

1. JavaScript, styling, text, and asset changes reload through the dev server without a new build, or can be pushed over the air with EAS Update.

2. You must create a new full build with EAS Build whenever you make any of these changes:
   - Change native code or native dependencies (for example adding or upgrading a native library).
   - Change app permissions.
   - Update the Expo SDK version.
   - Anything that requires a new app binary.

3. Practical rule for this project: because it relies on custom native modules, adding or changing any native dependency means you must rebuild with `eas build --platform android --profile development` and reinstall from the new APK.

## B.8 Google Play via EAS Submit (not needed for this project)

For completeness: shipping through Google Play requires a Google Play Developer account, a Google Service Account key, a production build (`eas build --platform android --profile production`, which produces an `.aab`), and one manual upload of the first build in the Play Console before `eas submit --platform android` can be used.

---

## Sources

- https://docs.expo.dev/guides/local-app-development/
- https://docs.expo.dev/get-started/set-up-your-environment/?platform=android&device=physical&mode=development-build&buildEnv=local
- https://docs.expo.dev/workflow/android-studio-emulator/
- https://docs.expo.dev/develop/development-builds/introduction/
- https://docs.expo.dev/build/setup/
- https://docs.expo.dev/build/eas-json/
- https://docs.expo.dev/tutorial/eas/android-development-build/
- https://docs.expo.dev/eas-update/introduction/
- https://docs.expo.dev/submit/android/
