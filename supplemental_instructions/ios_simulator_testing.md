# Testing on the iOS Simulator (Mac)

Runs the resident-mobile client as a development build on the iOS Simulator on a Mac.

The project lives at `application-plane/mobile/resident-mobile`. Run all `npx expo` commands from inside that folder.

## Table of contents

- [Initial setup](#initial-setup)
  - [1. Install Xcode](#1-install-xcode)
  - [2. Select the Command Line Tools](#2-select-the-command-line-tools)
  - [3. Install the iOS Simulator runtime](#3-install-the-ios-simulator-runtime)
  - [4. Point the app at the backend](#4-point-the-app-at-the-backend)
  - [5. Build and install the development build (first run)](#5-build-and-install-the-development-build-first-run)
- [Running the simulator](#running-the-simulator)

# Initial setup

One-time. Do this once, then use the "Running the simulator" section for every test run.

## 1. Install Xcode

Install Xcode from the Mac App Store.

## 2. Select the Command Line Tools

Open Xcode > Settings (`⌘,`) > Locations, and pick the latest version in the Command Line Tools dropdown.

## 3. Install the iOS Simulator runtime

In Xcode > Settings > Components, under Platform Support > iOS, click Get.

## 4. Point the app at the backend

1. Open `application-plane/mobile/resident-mobile/src/app-config.ts`.
2. Set `api_gateway_base_url`:

   ```ts
   api_gateway_base_url: "http://localhost:8080"
   ```

   The Simulator shares the Mac's network, so `localhost` reaches a backend running on the same Mac. If the backend runs on another machine, use that machine's LAN IP instead. Save the file.

## 5. Build and install the development build (first run)

1. Boot a simulator and leave it running:

   ```sh
   xcrun simctl list devices available
   xcrun simctl boot "iPhone 15"
   open -a Simulator
   ```

2. From `application-plane/mobile/resident-mobile`, build and install:

   ```sh
   npx expo run:ios
   ```

   This compiles the development build, installs it on the booted Simulator, and launches it. Pass `npx expo run:ios --device` to pick a specific simulator. This is slow; it only needs to run again after native changes.

# Running the simulator

Per-run steps, after the initial setup is complete.

1. Boot a simulator and leave it running:

   ```sh
   xcrun simctl boot "iPhone 15"
   open -a Simulator
   ```

2. Start the backend (see the [root README](../README.md)).
3. From `application-plane/mobile/resident-mobile`, start Metro and open the build on the simulator:

   ```sh
   npm run ios
   ```

   This starts Metro and launches the installed development build on the simulator. JavaScript changes hot-reload through Metro. Native changes require rerunning `npx expo run:ios` (see Initial setup, step 5).
