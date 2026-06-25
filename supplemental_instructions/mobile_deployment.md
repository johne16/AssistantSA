# Installing the Resident Mobile App on a Physical iPhone

This guide is written for someone who has never built or shipped a mobile app. It walks through getting the AssistantSA resident mobile app (Expo / React Native, Expo SDK 56, expo-router) onto a real iPhone. Follow the steps in order. Every command is shown exactly as you should type it.

The project lives at `application-plane/mobile/resident-mobile`. Run all `eas` and `npx expo` commands from inside that folder unless a step says otherwise.

There are two independent routes. Pick one; they are not steps of a single process.

- **Route A (Section A): free local install.** Builds on a Mac with Xcode and a free Apple ID, installs over USB to any iPhone you physically hold. Each install lasts 7 days. This is the chosen method for this project.
- **Route B (Section B): EAS cloud install.** Requires a paid Apple Developer membership, installs wirelessly. Use only if you want wireless distribution or TestFlight.

## Table of contents

- [Route A. Free local install with Xcode (no paid account)](#route-a-free-local-install-with-xcode-no-paid-account)
  - [A.1 Prerequisites](#a1-prerequisites)
  - [A.2 Point the app at the backend](#a2-point-the-app-at-the-backend)
  - [A.3 Generate the native iOS project (one time)](#a3-generate-the-native-ios-project-one-time)
  - [A.4 Install onto the iPhone (per phone)](#a4-install-onto-the-iphone-per-phone)
  - [A.5 Free-account limits](#a5-free-account-limits)
- [Route B. EAS cloud install (paid Apple Developer account)](#route-b-eas-cloud-install-paid-apple-developer-account)
  - [B.1 Prerequisites](#b1-prerequisites)
  - [B.2 What a development build is, versus a production build](#b2-what-a-development-build-is-versus-a-production-build)
  - [B.3 Configure the project for EAS](#b3-configure-the-project-for-eas)
  - [B.4 Point the app at the backend (do this before building)](#b4-point-the-app-at-the-backend-do-this-before-building)
  - [B.5 Build for iOS in the cloud with EAS Build (no Mac required)](#b5-build-for-ios-in-the-cloud-with-eas-build-no-mac-required)
  - [B.6 Two ways to get the app onto the iPhone](#b6-two-ways-to-get-the-app-onto-the-iphone)
    - [Option 1. Internal distribution development build (recommended for one personal iPhone)](#option-1-internal-distribution-development-build-recommended-for-one-personal-iphone)
    - [Option 2. TestFlight via EAS Submit](#option-2-testflight-via-eas-submit)
  - [B.7 Iterating after the first install](#b7-iterating-after-the-first-install)
- [Sources](#sources)

---

# Route A. Free local install with Xcode (no paid account)

Builds the app on the Mac mini with a free Apple ID and installs it onto a physical iPhone over USB. Works for any iPhone you physically hold. Each install lasts 7 days, then must be reinstalled over USB.

## A.1 Prerequisites

1. A Mac (the Mac mini) with Xcode installed.
2. A free Apple ID signed into Xcode: Xcode > Settings > Accounts > add the Apple ID.
3. A USB cable to connect the iPhone to the Mac.
4. The repo cloned on the Mac with mobile deps installed (`npm install` in `application-plane/mobile/resident-mobile`).
5. The signed `tenant_context_token` present on the Mac. If it is missing, run `node scripts/generate_keys.mjs` then `node scripts/sign_token.mjs` from the repo root.

## A.2 Point the app at the backend

1. Open `application-plane/mobile/resident-mobile/src/app-config.ts`.
2. Set `api_gateway_base_url` to the backend URL reachable from the iPhone:

   ```ts
   api_gateway_base_url: "<backend-url>:8080"
   ```

   Either the backend host's LAN IP (iPhone on the same Wi-Fi) or the Codespaces forwarded public URL.

3. Save before building. The value is baked in at build time.

## A.3 Generate the native iOS project (one time)

From `application-plane/mobile/resident-mobile`:

```sh
npx expo prebuild --platform ios
```

Re-run this only after changing native config or dependencies.

## A.4 Install onto the iPhone (per phone)

1. Connect the iPhone to the Mac with the USB cable.
2. Unlock the iPhone and tap Trust when prompted to trust the computer.
3. From `application-plane/mobile/resident-mobile`, build and install:

   ```sh
   npx expo run:ios --device
   ```

   Select the connected iPhone if prompted.
4. First build only, set up signing in Xcode:
   - Open `ios/residentmobile.xcworkspace` in Xcode.
   - Select the project, then the app target, then the Signing & Capabilities tab.
   - Check Automatically manage signing.
   - Set Team to the free Apple ID. Xcode generates a free provisioning profile and a unique bundle identifier.
   - Rerun `npx expo run:ios --device`.
5. First launch is blocked by an untrusted developer certificate. On the iPhone: Settings > General > VPN & Device Management > tap the developer profile under Developer App > Trust.
6. Open the app.

## A.5 Free-account limits

- The app expires 7 days after install. To renew, reconnect the iPhone over USB and rerun `npx expo run:ios --device`.
- A device can hold about 3 free-signed apps at once.
- A free Apple ID can register up to 10 bundle identifiers per 7 days.
- After the first USB install, JavaScript changes reload over Wi-Fi through Metro, but a native rebuild requires the USB cable again.

---

# Route B. EAS cloud install (paid Apple Developer account)

An alternative to Route A. Builds in Expo's cloud and installs wirelessly. Requires a paid Apple Developer membership. Skip this entire route if you are using Route A.

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

5. Get an Apple Developer Program membership. Installing a custom build on a physical iPhone, and using TestFlight, both require a paid Apple Developer Program membership. The documentation states: "Apple Developer Program membership is required to build for the Apple App Store" with a "$99 USD" annual fee. Sign up at https://developer.apple.com/account/.

---

## B.2 What a development build is, versus a production build

1. A development build is your own version of an Expo app. It includes the `expo-dev-client` library and is compiled with whatever native libraries your project requires, letting you use any native libraries and change any native config.

2. A production build is the optimized final binary you ship to the App Store.

3. This project requires a development build because it uses custom native modules that are not part of the Expo SDK (for example `@siteed/expo-audio-studio`, `react-native-audio-api`, and `expo-notifications`). You must create a development build (or a real build for distribution) to run it.

---

## B.3 Configure the project for EAS

1. From inside `application-plane/mobile/resident-mobile`, run:

   ```sh
   eas build:configure
   ```

   This creates an `eas.json` file in the project. `eas.json` is the configuration file for EAS CLI and services. By default it defines three build profiles: `development`, `preview`, and `production`.

2. The app configuration lives in `app.json` (or `app.config.js`). For iOS, it must include a bundle identifier, for example:

   ```json
   {
     "ios": {
       "bundleIdentifier": "com.yourcompany.yourapp"
     }
   }
   ```

   The bundle identifier is the unique ID Apple uses for your app. Set it once and keep it the same across builds.

---

## B.4 Point the app at the backend (do this before building)

The value baked into a build cannot be changed over the air, so set the backend URL before you build.

1. Open `application-plane/mobile/resident-mobile/src/app-config.ts`.

2. Find `api_gateway_base_url`. The default is `http://localhost:8080`.

3. A real iPhone cannot reach `localhost:8080` on your computer. Change `api_gateway_base_url` to the publicly reachable backend URL. For this project that is the Codespaces forwarded `8080` URL. The URL must be `https` and reachable from the public internet.

4. Save the file before running any build command. Each build uses whatever value is in this file at build time.

---

## B.5 Build for iOS in the cloud with EAS Build (no Mac required)

EAS Build runs iOS builds on Expo's hosted macOS machines, so you can trigger an iOS build from Windows or any non-Mac computer.

1. Start an iOS build:

   ```sh
   eas build --platform ios
   ```

2. Handle credentials when prompted. The Expo docs say: "If you have not generated a provisioning profile and/or distribution certificate yet, you can let EAS CLI take care of that for you by signing into your Apple Developer Program account and following the prompts." Choose to let EAS manage credentials. EAS will create and store the distribution certificate and provisioning profile for you. You will sign in with your Apple Developer account during this step.

3. The CLI prints a build dashboard link. Open it to watch progress. The build runs in Expo's cloud.

Which profile you build depends on how you want to install it. See Section B.6.

---

## B.6 Two ways to get the app onto the iPhone

Both options are documented by Expo. For a single personal iPhone, Option 1 (internal distribution) is simpler. It avoids creating an App Store Connect listing and avoids Apple's TestFlight processing wait. Use Option 1 unless you specifically want TestFlight.

### Option 1. Internal distribution development build (recommended for one personal iPhone)

This uses an ad hoc provisioning profile. An ad hoc profile contains an allow-list of device UDIDs, and only devices on that list at build time can install the app. So you register your iPhone first, then build.

1. Register your iPhone:

   ```sh
   eas device:create
   ```

   You will be prompted to select your account, log in with your Apple ID, and choose a registration method. Choose "Website" to generate a registration URL you can open on the iPhone.

2. On the iPhone, open the registration link in the browser and tap the download button. Then go to Settings and tap Install to finish registering the device.

3. Build with the development profile so the build targets your registered device:

   ```sh
   eas build --platform ios --profile development
   ```

   During first-time prompts: accept (or set) the iOS bundle identifier, authorize Apple account access and let EAS generate the Apple Distribution Certificate, and when asked, select your registered iPhone for the ad hoc build. Note: only builds created after a device is registered will install on that device, so always register before building.

4. When the build finishes, install it. The dashboard shows an Install button that displays a QR code. Scan that QR code with the iPhone camera to download and install the app. (Alternatively, with the device connected by USB, use the Open with Orbit option on your computer.)

5. A development build connects to a local dev server while you work. Start it with:

   ```sh
   npx expo start
   ```

   Then open the installed app on the iPhone and select "Fetch development servers" to connect.

### Option 2. TestFlight via EAS Submit

This path uploads the app to Apple's App Store Connect, where it appears in TestFlight for installation through the TestFlight app.

1. In App Store Connect (https://appstoreconnect.apple.com), create an app entry for your bundle identifier. After creating it, find the `ascAppId` (the App Store Connect app ID) under your app: App Information, Apple ID field.

2. Build a production binary:

   ```sh
   eas build --platform ios --profile production
   ```

3. Add the `ascAppId` to `eas.json` under the submit configuration:

   ```json
   {
     "submit": {
       "production": {
         "ios": {
           "ascAppId": "your-app-store-connect-app-id"
         }
       }
     }
   }
   ```

4. Submit the build:

   ```sh
   eas submit --platform ios
   ```

   Select the build you just made (or let it use the latest). For authentication, EAS uses either an App Store Connect API Key (configurable via `eas credentials --platform ios`) or your Apple ID credentials.

5. All iOS submissions through EAS Submit are uploaded to App Store Connect and appear in TestFlight after Apple finishes processing the build.

6. On the iPhone, install the TestFlight app from the App Store, sign in with the Apple ID that has access, and install the app from inside TestFlight. A TestFlight build is not automatically released to the App Store; releasing publicly requires filling in metadata and submitting for App Review separately.

---

## B.7 Iterating after the first install

1. If you change only JavaScript, styling, text, or image assets, you can push those over the air with EAS Update. The Expo docs describe it as serving updates "without requiring a full app store resubmission," and users "see the new version on their next app launch or reload."

2. You must create a new full build with EAS Build (not an over-the-air update) whenever you make any of these changes:
   - Change native code or native dependencies (for example adding or upgrading a native library).
   - Change app permissions (camera, location, and others).
   - Update the Expo SDK version.
   - Anything that requires a new app binary version.

3. Practical rule for this project: because it relies on custom native modules, adding or changing any native dependency means you must rebuild with `eas build --platform ios` and reinstall on the iPhone using the same option from Section B.6.

---

## Sources

- https://docs.expo.dev/develop/development-builds/introduction/
- https://docs.expo.dev/build/setup/
- https://docs.expo.dev/build/eas-json/
- https://docs.expo.dev/build/internal-distribution/
- https://docs.expo.dev/tutorial/eas/ios-development-build-for-devices/
- https://docs.expo.dev/submit/introduction/
- https://docs.expo.dev/submit/ios/
- https://docs.expo.dev/app-signing/app-credentials/
- https://docs.expo.dev/eas-update/introduction/
- https://developer.apple.com/account/
