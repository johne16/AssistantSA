# Testing on an Android emulator (Windows)

Runs the resident-mobile client as a development build on an Android emulator on this Windows machine.

The project lives at `application-plane/mobile/resident-mobile`. Run all `npx expo` commands from inside that folder.

## Table of contents

- [Initial setup](#initial-setup)
  - [1. Install a JDK](#1-install-a-jdk)
  - [2. Install the command-line tools](#2-install-the-command-line-tools)
  - [3. Set environment variables](#3-set-environment-variables)
  - [4. Install the SDK packages](#4-install-the-sdk-packages)
  - [5. Create the virtual device](#5-create-the-virtual-device)
  - [6. (Optional) Attach an OEM skin](#6-optional-attach-an-oem-skin)
  - [7. Point the app at the backend](#7-point-the-app-at-the-backend)
  - [8. Create the app icon and splash assets](#8-create-the-app-icon-and-splash-assets)
  - [9. Build and install the development build (first run)](#9-build-and-install-the-development-build-first-run)
- [Windows build troubleshooting](#windows-build-troubleshooting)
  - [`ninja: error: mkdir(...): No such file or directory`](#ninja-error-mkdir-no-such-file-or-directory)
  - [`missing and no known rule to make it` for an audio-api `.a` lib](#missing-and-no-known-rule-to-make-it-for-an-audio-api-a-lib)
  - [`Unresolved reference 'R'`/`BuildConfig` or `package com.<x> does not exist`](#unresolved-reference-rbuildconfig-or-package-comx-does-not-exist)
  - [A stale generated file persists after a fix](#a-stale-generated-file-persists-after-a-fix)
- [Running the emulator](#running-the-emulator)

# Initial setup

One-time. Do this once, then use the "Running the emulator" section for every test run.

## 1. Install a JDK

The Gradle build needs a JDK 17 on PATH. If `java -version` fails, install Microsoft's build, which sets `JAVA_HOME` and PATH:

```powershell
winget install --id Microsoft.OpenJDK.17 --exact
```

## 2. Install the command-line tools

1. Download the "Command line tools only" zip for Windows from https://developer.android.com/studio (bottom of the page).
2. Extract it and arrange the files so this exact path exists:

   ```
   %LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\bin\sdkmanager.bat
   ```

   The `bin`, `lib`, `NOTICE.txt`, and `source.properties` from the zip must sit directly under `cmdline-tools\latest`.

## 3. Set environment variables

```powershell
# persist the SDK location for future sessions
[Environment]::SetEnvironmentVariable("ANDROID_HOME", "$env:LOCALAPPDATA\Android\Sdk", "User")
# append the three tool dirs (sdkmanager/avdmanager, adb, emulator) to the user PATH
[Environment]::SetEnvironmentVariable("Path", "$([Environment]::GetEnvironmentVariable('Path','User'));$env:LOCALAPPDATA\Android\Sdk\cmdline-tools\latest\bin;$env:LOCALAPPDATA\Android\Sdk\platform-tools;$env:LOCALAPPDATA\Android\Sdk\emulator", "User")
```

Close and reopen the terminal so the variables load.

## 4. Install the SDK packages

```powershell
# accept licenses, then pull platform-tools, emulator, a platform, and an x86_64 system image
sdkmanager --licenses
sdkmanager "platform-tools" "emulator" "platforms;android-34" "system-images;android-34;google_apis;x86_64"
```

## 5. Create the virtual device

```powershell
# list available device profiles for the -d flag
avdmanager list device
# create an AVD against the installed system image
avdmanager create avd -n pixel_api34 -k "system-images;android-34;google_apis;x86_64" -d pixel_7
# confirm it was created
avdmanager list avd
```

## 6. (Optional) Attach an OEM skin

A skin only changes the bezel art and screen size/resolution; it does not add OneUI or any OEM software. The emulator's `-skin` flag is deprecated, so attach it through the AVD's `config.ini`.

1. Download a skin. Samsung Galaxy skins (S, Z Fold/Flip, A, Tab) are at https://developer.samsung.com/galaxy-emulator-skin. Other OEMs publish on their own developer sites; community skins live in repos like https://github.com/ipavl/android-emulator-skins.
2. Extract it so the skin folder (the one containing a `layout` file) sits somewhere stable, for example under the SDK:

   ```
   %LOCALAPPDATA%\Android\Sdk\skins\<skin_folder>
   ```

3. Read the skin's resolution. Open the `layout` file inside the skin folder and find the display block's `width` and `height` (in pixels). The skin's density is in its `hardware.ini` (`hw.lcd.density`).
4. Point the AVD at the skin and match its resolution by adding these keys to `%USERPROFILE%\.android\avd\pixel_api34.avd\config.ini`:

   ```ini
   skin.name=<skin_folder>
   skin.path=C:\Users\<you>\AppData\Local\Android\Sdk\skins\<skin_folder>
   hw.lcd.width=<width from layout>
   hw.lcd.height=<height from layout>
   hw.lcd.density=<density from hardware.ini>
   ```

   `skin.path` is the full path to the folder holding the `layout` file. Restart the emulator to apply.

## 7. Point the app at the backend

1. Open `application-plane/mobile/resident-mobile/src/app-config.ts`.
2. Set `api_gateway_base_url` to the emulator's alias for this machine's localhost:

   ```ts
   api_gateway_base_url: "http://10.0.2.2:8080"
   ```

   `10.0.2.2` is the Android emulator's route to the host's `localhost`. Save the file.

## 8. Create the app icon and splash assets

`app.json` references image files prebuild requires. Provide PNGs at the declared paths: `assets/images/icon.png`, `android-icon-foreground.png`, `android-icon-background.png`, `android-icon-monochrome.png`, `splash-icon.png`, and the `assets/expo.icon` bundle (`icon.json` plus `Assets/`) for `ios.icon`.

## 9. Build and install the development build (first run)

1. Start the emulator and leave it running:

   ```powershell
   emulator -avd pixel_api34
   ```

2. From `application-plane/mobile/resident-mobile`, build and install:

   ```
   npm run android
   ```

# Windows build troubleshooting

Failures seen on Windows during the first build. Each entry is the symptom and its fix, ending with the command to resume the build.

## `ninja: error: mkdir(...): No such file or directory`

The project path exceeds the 260-character limit and the default cmake 3.22.1 ninja is not long-path aware. Apply all of the following.

1. Enable long paths (run as Administrator, then reboot):

   ```powershell
   Set-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" LongPathsEnabled 1
   ```

2. Install a newer cmake whose ninja honors the long-path flag:

   ```powershell
   sdkmanager "cmake;3.31.6"
   ```

3. Overwrite the default 3.22.1 ninja with the long-path-aware one:

   ```powershell
   cp "C:\Users\<you>\AppData\Local\Android\Sdk\cmake\3.31.6\bin\ninja.exe" "C:\Users\<you>\AppData\Local\Android\Sdk\cmake\3.22.1\bin\ninja.exe"
   ```

4. Delete every stale native cache before rebuilding:

   ```powershell
   ls application-plane\mobile\resident-mobile\node_modules -Recurse -Directory -Filter .cxx | rm -r -force
   ```

5. Resume the build:

   ```powershell
   npm run android
   ```

## `missing and no known rule to make it` for an audio-api `.a` lib

`react-native-audio-api`'s Gradle task fetches prebuilt libs via `bash`, which does not run on Windows. Fetch them manually (requires Git Bash, `curl`, `unzip`):

```powershell
cd application-plane\mobile\resident-mobile\node_modules\react-native-audio-api\android
bash ../scripts/download-prebuilt-binaries.sh android
```

Then delete the downloaded iOS/macOS artifacts, or Metro crashes on their symlinks with `EACCES`:

```powershell
rm -r -force application-plane\mobile\resident-mobile\node_modules\react-native-audio-api\common\cpp\audioapi\external\ffmpeg_ios,application-plane\mobile\resident-mobile\node_modules\react-native-audio-api\common\cpp\audioapi\external\iphoneos,application-plane\mobile\resident-mobile\node_modules\react-native-audio-api\common\cpp\audioapi\external\iphonesimulator,application-plane\mobile\resident-mobile\node_modules\react-native-audio-api\common\cpp\audioapi\external\macosx
```

Then resume the build:

```powershell
npm run android
```

## `Unresolved reference 'R'`/`BuildConfig` or `package com.<x> does not exist`

Set `namespace` and `applicationId` in `android/app/build.gradle` to `com.anonymous.residentmobile`, then resume the build:

```powershell
npm run android
```

## A stale generated file persists after a fix

Delete the build output (do not use `gradlew clean`):

```powershell
rm -r -force application-plane\mobile\resident-mobile\android\app\build,application-plane\mobile\resident-mobile\android\build
```

Then resume the build:

```powershell
npm run android
```

# Running the emulator

Per-run steps, after the initial setup is complete.

1. Start the emulator and leave it running:

   ```powershell
   emulator -avd pixel_api34 -no-snapshot-load
   ```

2. Start the backend (see the [root README](../README.md)).
3. From `application-plane/mobile/resident-mobile`, start Metro and open the build on the emulator:

   ```
   npm run android
   ```

   This starts Metro and launches the installed development build on the emulator. JavaScript changes hot-reload through Metro. Native changes require rerunning `npm run android` (see Initial setup, step 9).
