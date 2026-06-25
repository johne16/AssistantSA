# Package Installation Instructions

Project root: `C:\Users\john\Documents\UTSA\Lab\AssistantSA`

## Table of contents

- [Backend TypeScript modules (workspace)](#backend-typescript-modules-workspace)
- [ap-voice (Rust voice service)](#ap-voice-rust-voice-service)
- [crawl-service (Python crawl4ai sidecar)](#crawl-service-python-crawl4ai-sidecar)
- [Redis (Windows)](#redis-windows)
- [Environment](#environment)
- [resident-mobile base deps](#resident-mobile-base-deps)
- [resident-mobile module deps](#resident-mobile-module-deps)
- [resident-mobile module deps (added during build)](#resident-mobile-module-deps-added-during-build)

### Backend TypeScript modules (workspace)

- Folder: project root
```
npm install
```

### ap-voice (Rust voice service)

- Folder: `application-plane\backend\ap-voice`
```
cargo build
```

### crawl-service (Python crawl4ai sidecar)

- Folder: `application-plane\backend\crawl-service`
```
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
crawl4ai-setup
```

### Redis (Windows)

- Install Docker Desktop and ensure it is running. The host launches Redis as a container.

### Environment

- Copy `.env.example` to `.env` and source `san-antonio.env`.

### resident-mobile base deps

- Folder: `application-plane\mobile\resident-mobile`
```
npm install
```

### resident-mobile module deps

- Folder: `application-plane\mobile\resident-mobile`
```
npx expo install @tanstack/react-query zustand expo-secure-store @expo-google-fonts/bricolage-grotesque @expo-google-fonts/hanken-grotesk @expo-google-fonts/jetbrains-mono
```

### resident-mobile module deps (added during build)

- Folder: `application-plane\mobile\resident-mobile`
```
npx expo install expo-notifications react-native-sse @siteed/expo-audio-studio react-native-audio-api
```
