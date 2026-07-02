# Connecting your phone to the backend with Tailscale

This guide sets up a direct, private connection between your phone and the computer running the AssistantSA backend, so the phone can reach the backend even on a shared LAN with client isolation. The backend keeps running on your computer, so its outbound fetches keep leaving from your computer's Texas IP and geofenced San Antonio sites still work.

Follow the steps in order.

## Table of contents

- [1. How this works](#1-how-this-works)
- [2. Prerequisites](#2-prerequisites)
- [3. Install Tailscale on the computer (Windows)](#3-install-tailscale-on-the-computer-windows)
- [4. Install Tailscale on the phone](#4-install-tailscale-on-the-phone)
  - [4a. iPhone](#4a-iphone)
  - [4b. Android](#4b-android)
- [5. Confirm both devices are on the tailnet](#5-confirm-both-devices-are-on-the-tailnet)
- [6. Find the computer's Tailscale IP](#6-find-the-computers-tailscale-ip)
- [7. Bind the backend so the phone can reach it](#7-bind-the-backend-so-the-phone-can-reach-it)
- [8. Point the mobile client at the computer](#8-point-the-mobile-client-at-the-computer)
  - [8a. Hardcode the URL in app-config.ts](#8a-hardcode-the-url-in-app-configts)
  - [8b. Serve Metro over the Tailscale IP (leave the resolver in place)](#8b-serve-metro-over-the-tailscale-ip-leave-the-resolver-in-place)
- [9. Verifying the connection](#9-verifying-the-connection)
- [10. Everyday use](#10-everyday-use)
- [Sources](#sources)

## 1. How this works

1. Tailscale is a mesh VPN built on WireGuard. Each device you add gets a private `100.x.y.z` address on your personal network (your "tailnet").
2. Devices connect to each other over that private address regardless of what LAN they are on. Client isolation, guest WiFi, and host firewalls on the shared LAN do not block it, because the connection is an ordinary outbound connection to Tailscale's coordination network, not device-to-device LAN traffic.
3. Your phone reaches the backend at the computer's Tailscale IP. Only your own devices, signed in to your account, can see each other.

## 2. Prerequisites

1. A Tailscale account. The free Personal plan covers up to 3 users and 100 devices, which is more than enough here.
2. You will sign in to Tailscale on both the computer and the phone with the same account (or same identity provider login). Both devices must be on the same tailnet to see each other.
3. The AssistantSA backend already builds and runs on the computer (`npm install`, `npm run build`, `npm start`).

## 3. Install Tailscale on the computer (Windows)

1. Go to https://tailscale.com/download and download the Windows installer.
2. Run the installer and follow the prompts.
3. When Tailscale opens, click **Log in** and complete sign-in in the browser (choose an identity provider, for example Google or GitHub, and authorize). This first login creates your tailnet.
4. After login, the Tailscale icon appears in the system tray and the computer is connected.

## 4. Install Tailscale on the phone

### 4a. iPhone

1. Open the App Store and install **Tailscale**.
2. Open the app and tap **Log in**.
3. Sign in with the **same account** you used on the computer.
4. When prompted, allow Tailscale to add a VPN configuration and enable it.

### 4b. Android

1. Open the Google Play Store and install **Tailscale**.
2. Open the app and tap **Sign in**.
3. Sign in with the **same account** you used on the computer.
4. When prompted, allow Tailscale to set up the VPN connection.

## 5. Confirm both devices are on the tailnet

1. Go to https://login.tailscale.com/admin/machines in a browser.
2. Confirm both the computer and the phone appear in the **Machines** list. Each shows its `100.x.y.z` Tailscale IP.
3. If a device is missing, open the Tailscale app/tray on that device and make sure it is logged in and connected.

## 6. Find the computer's Tailscale IP

1. On the computer, open a terminal (PowerShell) and run:
   ```powershell
   # print this device's Tailscale IPv4 address
   tailscale ip -4
   ```
2. Note the `100.x.y.z` address that prints. This is the address the phone will use to reach the backend.
3. You can also read the same address from the **Machines** page in the admin console, next to the computer's name.

## 7. Bind the backend so the phone can reach it

1. The backend gateway must listen on all interfaces, not just `127.0.0.1`, or the phone cannot connect. The app gateway listens on `0.0.0.0:8080`, which is correct.
2. Allow inbound connections on the Tailscale interface through Windows Defender Firewall. In an **elevated** PowerShell:
   ```powershell
   # allow inbound TCP on the gateway port so the phone can reach it
   New-NetFirewallRule -DisplayName "AssistantSA backend 8080" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow
   ```
3. Start the backend from the repository root:
   ```powershell
   # start the ap-server host (spawns the Rust and Python sidecars)
   npm start
   ```

## 8. Point the mobile client at the computer

In dev, `api_gateway_base_url` is not read from a manually set field; `app-config.ts` derives it from the Metro dev server host the bundle loaded from. There are two ways to make the phone use the Tailscale IP. Use one.

### 8a. Hardcode the URL in app-config.ts

1. Open `application-plane/mobile/resident-mobile/src/app-config.ts`.
2. At the `api_gateway_base_url` field, comment out the resolver call and uncomment the literal, then set the Tailscale IP from Step 6:
   ```ts
   // api_gateway_base_url: resolve_api_gateway_base_url(),
   api_gateway_base_url: "http://100.x.y.z:8080",  // tailscale deployment
   ```
3. This is the single value every module reads.

### 8b. Serve Metro over the Tailscale IP (leave the resolver in place)

1. Leave `api_gateway_base_url: resolve_api_gateway_base_url()` as-is.
2. Start Expo so the phone loads the bundle from the computer's Tailscale IP, which makes the resolver derive the same host:
   ```powershell
   # bind the Metro packager to the Tailscale IP from Step 6
   $env:REACT_NATIVE_PACKAGER_HOSTNAME = "100.x.y.z"
   npx expo start
   ```

### After either option

1. Make sure the Tailscale VPN toggle on the phone is **on** whenever you use the app.

## 9. Verifying the connection

1. With Tailscale on and the backend running, open a browser on the phone and go to `http://100.x.y.z:8080`.
2. If the gateway responds, the phone can reach the backend and the mobile client will work.
3. If it does not respond, check, in order: Tailscale is on and connected on both devices (Step 5), the backend is running (Step 7), and the firewall rule was added (Step 7).

## 10. Everyday use

1. The computer stays signed in to Tailscale and keeps its Tailscale IP across networks, so the address in Step 8 does not need to change.
2. On the phone, keep the Tailscale VPN toggle on while using the app.
3. Start the backend on the computer whenever you need it. The phone reaches it over Tailscale from any network.

## Sources

- https://tailscale.com/download
- https://tailscale.com/kb/1017/install
- https://tailscale.com/docs/install/linux
- https://tailscale.com/docs/reference/tailscale-cli
- https://tailscale.com/docs/solutions/access-remote-desktops-using-windows-rdp
- https://tailscale.com/pricing
