# Deploying AssistantSA on GitHub Codespaces

This guide is written for someone who has never used GitHub Codespaces. Every click is named. Follow the steps in order.

## Table of contents

- [1. Prerequisites](#1-prerequisites)
- [2. Creating a codespace on a repository branch (web UI)](#2-creating-a-codespace-on-a-repository-branch-web-ui)
  - [Opening in VS Code Desktop (optional)](#opening-in-vs-code-desktop-optional)
- [3. What the codespace gives you](#3-what-the-codespace-gives-you)
- [4. Opening a terminal and running commands](#4-opening-a-terminal-and-running-commands)
- [5. Installing the prerequisites the project needs](#5-installing-the-prerequisites-the-project-needs)
  - [5a. Check Node.js](#5a-check-nodejs)
  - [5b. Check Python 3 and pip](#5b-check-python-3-and-pip)
  - [5c. Install the Rust toolchain (rustup) for ap-voice](#5c-install-the-rust-toolchain-rustup-for-ap-voice)
  - [5d. Install the crawl-service Python dependencies](#5d-install-the-crawl-service-python-dependencies)
  - [5e. Build and start the app](#5e-build-and-start-the-app)
- [6. Setting environment variables / secrets](#6-setting-environment-variables--secrets)
  - [6a. Local .env file (inside the codespace)](#6a-local-env-file-inside-the-codespace)
  - [6b. GitHub Codespaces account secrets](#6b-github-codespaces-account-secrets)
- [7. Forwarding ports](#7-forwarding-ports)
- [8. Reaching the app from a mobile device or external client](#8-reaching-the-app-from-a-mobile-device-or-external-client)
- [9. Stopping, deleting, and rebuilding](#9-stopping-deleting-and-rebuilding)
  - [9a. Stop a codespace (stops compute charges)](#9a-stop-a-codespace-stops-compute-charges)
  - [9b. Delete a codespace (stops storage charges)](#9b-delete-a-codespace-stops-storage-charges)
  - [9c. Rebuild the container](#9c-rebuild-the-container)
- [Sources](#sources)

## 1. Prerequisites

1. Create a GitHub account. Go to https://github.com and sign up if you do not already have an account.
2. Make sure the AssistantSA project is pushed to a repository on GitHub. A codespace is always created from a repository hosted on GitHub.com.
3. Understand the billing basics. A codespace is a cloud-hosted development environment that runs on a Linux virtual machine, and GitHub charges for it in two ways: compute time (while the codespace is active) and storage (while the codespace exists).
4. Know your free monthly quota. Personal GitHub accounts include a monthly amount of free Codespaces usage that resets at the start of each billing cycle:
   - GitHub Free for personal accounts: 120 core hours of compute and 15 GB-month of storage.
   - GitHub Pro: 180 core hours of compute and 20 GB-month of storage.
5. Note that compute time is the length of time a codespace is active. Stopping a codespace stops compute charges. Storage charges continue until the codespace is deleted. See Step 9 for stopping and deleting.

## 2. Creating a codespace on a repository branch (web UI)

1. Go to https://github.com and open the AssistantSA repository.
2. Under the repository name, click the branch dropdown menu (it is labeled with the name of the current branch) and click the branch you want to create a codespace for.
3. Click the green **Code** button.
4. In the dialog that appears, click the **Codespaces** tab.
5. To create a codespace on the selected branch with default options, click the create button (**Create codespace on BRANCH**).
6. To choose advanced options instead (machine type, region, or a specific dev container configuration), at the top right of the Codespaces tab click the menu icon and click **New with options**, choose your selections from the dropdown menus, then click **Create codespace**.
7. Wait for the codespace to build and open. The first build can take several minutes.

### Opening in VS Code Desktop (optional)

1. You can connect to a codespace directly from the Visual Studio Code desktop application. This requires the GitHub Codespaces extension for VS Code.
2. Reference: https://docs.github.com/en/codespaces/developing-in-a-codespace/using-github-codespaces-in-visual-studio-code

## 3. What the codespace gives you

1. A codespace is a development environment hosted in the cloud. It runs on a Linux-based Docker container hosted on an Azure virtual machine.
2. By default it uses an Ubuntu Linux image that includes a selection of popular languages and tools.
3. The default machine starts at 2 cores, 8 GB RAM, and 32 GB storage, and larger machine types are available up to 32 cores, 128 GB RAM, and 128 GB storage.
4. When you open a codespace in your browser, you get the full Visual Studio Code editor running in the browser, including an integrated terminal.

## 4. Opening a terminal and running commands

1. In the browser VS Code editor, open the Command Palette with `Ctrl`+`Shift`+`P` (Windows/Linux) or `Shift`+`Command`+`P` (Mac).
2. Type `Terminal: Create New Terminal` and select it. A terminal panel opens at the bottom of the editor. The integrated terminal lives in the Panel area at the bottom of the editor.
3. The terminal is a normal Linux (Ubuntu) shell. Type commands and press Enter to run them.

## 5. Installing the prerequisites the project needs

The default Codespaces Linux image already includes runtime versions for popular languages including Node, Python, and others, plus common tools like git, wget, rsync, openssh, and nano. The project needs Node.js, Python 3 with pip, and the Rust toolchain. Node.js and Python 3 are preinstalled in the default image. Rust is not, and must be added.

### 5a. Check Node.js

1. In the terminal, run:
   ```
   node --version
   ```
2. Confirm a version prints. If you need a specific Node version, you can add the Node.js dev container feature to `.devcontainer/devcontainer.json`. Reference: https://github.com/devcontainers/features/tree/main/src/node

### 5b. Check Python 3 and pip

1. In the terminal, run:
   ```
   python3 --version
   pip3 --version
   ```
2. The default development container comes with the latest Python version and package managers (pip, Miniconda) preinstalled.

### 5c. Install the Rust toolchain (rustup) for ap-voice

1. Rust is not preinstalled. Install it with the official rustup command:
   ```
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   ```
   Reference: https://rustup.rs/
2. Follow the on-screen instructions. Choose the default installation when prompted.
3. Load Rust into the current shell:
   ```
   source "$HOME/.cargo/env"
   ```
4. Confirm the install:
   ```
   cargo --version
   ```

### 5d. Install the crawl-service Python dependencies

1. Install the Python dependencies for the crawl-service:
   ```
   pip3 install -r application-plane/backend/crawl-service/requirements.txt
   ```
2. Run the crawl4ai setup step:
   ```
   crawl4ai-setup
   ```

### 5e. Build and start the app

1. From the repository root, run these in order:
   ```
   npm install
   npm run build
   npm start
   ```
2. `npm start` runs the ap-server host, which spawns the ap-voice (Rust) and crawl-service (Python) sidecars, so Rust and Python must already be installed from the steps above.
3. The app gateway listens on `0.0.0.0:8080`.

## 6. Setting environment variables / secrets

The app reads configuration from environment variables. It uses these keys: `database_url`, `claude_api_key`, `token_verification_public_key`, `push_access_token`, `deepgram_api_key`, `elevenlabs_api_key`, and `elevenlabs_voice_id`. There are two ways to provide them.

### 6a. Local .env file (inside the codespace)

1. The project loads config from a gitignored `.env` file at the repository root, and a `.env.example` exists there as a template.
2. In the terminal, copy the template:
   ```
   cp .env.example .env
   ```
3. Open `.env` in the editor and fill in each value.
4. The `.env` file lives only inside this codespace and is not committed to the repository.

### 6b. GitHub Codespaces account secrets

1. Codespaces secrets are stored on your GitHub account and injected as environment variables into your codespaces.
2. In the upper-right corner of any GitHub page, click your profile picture, then click **Settings**.
3. In the sidebar, under "Code, planning, and automation," click **Codespaces**.
4. To the right of "Codespaces secrets," click **New secret**.
5. Under "Name," type the secret name. Names may contain only letters, numbers, and underscores, must not start with `GITHUB_` or a number, and are not case-sensitive.
6. Under "Value," type the secret value.
7. Select the "Repository access" dropdown menu and click each repository that should have access to the secret.
8. Click **Add secret**.
9. If you create or change a secret while a codespace is already running, stop the codespace and start it again for the new value to take effect.

## 7. Forwarding ports

The app listens on port 8080, with sidecars on 8090 and 8095.

1. GitHub Codespaces can automatically forward a port when an application running in the codespace starts listening on it. Forwarded ports appear in the Ports panel.
2. To open the Ports panel, in the codespace open the terminal area and click the **PORTS** tab.
3. To add a port manually, in the **PORTS** tab click **Add port** under the list of ports, type the port number (for example `8080`), and press Enter.
4. Every forwarded port has a visibility setting. By default a forwarded port is private and accessible on the internet only to you after you authenticate to GitHub.
5. To change visibility, in the **PORTS** tab right-click the port, click **Port Visibility**, then select **Public** (anyone with the URL and port can access) or keep it **Private**.
6. To get the address, in the **PORTS** tab, to the right of the local address for the port, click the copy icon. The forwarded URL has the form `https://CODESPACENAME-PORT.app.github.dev`.

## 8. Reaching the app from a mobile device or external client

1. The iPhone app points at `api_gateway_base_url`, which must be the forwarded URL of port 8080.
2. In the **PORTS** tab, right-click port `8080`, click **Port Visibility**, and select **Public**. A private port is only reachable by you after GitHub authentication, so an external device needs the port set to Public.
3. In the **PORTS** tab, copy the forwarded URL for port 8080 (the `https://CODESPACENAME-8080.app.github.dev` address).
4. Set `api_gateway_base_url` in the mobile client to that URL.
5. The mobile device can now reach the running app over the internet at that URL.

## 9. Stopping, deleting, and rebuilding

Closing the browser tab does not stop a codespace. It keeps running on the remote machine and keeps accruing compute charges.

### 9a. Stop a codespace (stops compute charges)

1. Go to https://github.com/codespaces.
2. To the right of the codespace you want to stop, click the ellipsis (**...**).
3. Click **Stop codespace**. Saved changes remain available when you next start it.

### 9b. Delete a codespace (stops storage charges)

1. Go to https://github.com/codespaces.
2. To the right of the codespace you want to delete, click the ellipsis (**...**).
3. Click **Delete**. Note that by default a stopped codespace is automatically deleted after 30 days of inactivity.

### 9c. Rebuild the container

1. In the codespace, open the Command Palette with `Ctrl`+`Shift`+`P` (Windows/Linux) or `Shift`+`Command`+`P` (Mac).
2. Type `Rebuild` and select **Codespaces: Rebuild Container**.
3. In the confirmation dialog, choose **Rebuild** or **Full Rebuild**. A full rebuild clears all cached Docker containers, images, and volumes before rebuilding.

## Sources

- https://docs.github.com/en/codespaces/developing-in-a-codespace/creating-a-codespace-for-a-repository
- https://docs.github.com/en/codespaces/about-codespaces/what-are-codespaces
- https://docs.github.com/en/codespaces/about-codespaces/deep-dive
- https://docs.github.com/en/codespaces/developing-in-a-codespace/developing-in-a-codespace
- https://docs.github.com/en/codespaces/setting-up-your-project-for-codespaces/adding-a-dev-container-configuration/setting-up-your-python-project-for-codespaces
- https://docs.github.com/en/codespaces/managing-your-codespaces/managing-your-account-specific-secrets-for-github-codespaces
- https://docs.github.com/en/codespaces/developing-in-a-codespace/forwarding-ports-in-your-codespace
- https://docs.github.com/billing/managing-billing-for-github-codespaces/about-billing-for-github-codespaces
- https://docs.github.com/en/codespaces/troubleshooting/troubleshooting-included-usage
- https://docs.github.com/en/codespaces/about-codespaces/understanding-the-codespace-lifecycle
- https://docs.github.com/en/codespaces/developing-in-a-codespace/stopping-and-starting-a-codespace
- https://docs.github.com/en/codespaces/developing-in-a-codespace/deleting-a-codespace
- https://docs.github.com/en/codespaces/developing-in-a-codespace/rebuilding-the-container-in-a-codespace
- https://rustup.rs/
