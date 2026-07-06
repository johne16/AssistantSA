// Voice WebSocket bridge. Serves the duplex voice socket at /voice/stream and
// proxies frames between the resident client and the ap-voice Rust service at
// ap_voice_ws_url. The first client frame is { tenant_context_token }; the bridge
// verifies the signature at the edge before opening the upstream connection.
//
// INTEGRATION SEAM: ap-voice is a separate Rust process whose WS accept side is
// not finalized here. This bridge proxies frames verbatim to ap_voice_ws_url;
// end-to-end voice is the remaining integration work. No Rust behavior is
// simulated. If the upstream is unreachable, the client socket is closed.

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";

import { WebSocket, WebSocketServer, type RawData } from "ws";

import type { token_verifier } from "./adapters/token.js";

export interface voice_bridge_deps {
  token_verifier: token_verifier;
  ap_voice_ws_url: string;
}

export const VOICE_PATH = "/voice/stream";

export function create_voice_bridge(deps: voice_bridge_deps): {
  wss: WebSocketServer;
  handle_upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void;
} {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (client: WebSocket) => {
    let upstream: WebSocket | null = null;
    // Only the very first frame is the handshake. Frames arriving while token
    // verification is still awaiting are audio; they queue in pending rather
    // than re-entering the auth branch.
    let auth_state: "pending" | "authorizing" | "authorized" = "pending";
    const pending: RawData[] = [];

    const close_both = () => {
      try {
        client.close();
      } catch {
        /* ignore */
      }
      try {
        upstream?.close();
      } catch {
        /* ignore */
      }
    };

    client.on("message", async (data: RawData, isBinary: boolean) => {
      // First frame authorizes the stream: { tenant_context_token }.
      if (auth_state === "pending") {
        auth_state = "authorizing";
        try {
          const text = data.toString();
          const open = JSON.parse(text) as { tenant_context_token?: string };
          if (!open.tenant_context_token) throw new Error("missing_token");
          await deps.token_verifier.verify(open.tenant_context_token);
        } catch (err) {
          console.error("[ap-server] voice-bridge authorization failed:", err);
          client.send(JSON.stringify({ type: "error", error: "unauthorized" }));
          close_both();
          return;
        }
        auth_state = "authorized";

        // Open the upstream ap-voice connection and flush queued frames.
        upstream = new WebSocket(deps.ap_voice_ws_url);
        upstream.on("open", () => {
          // Forward the original open frame so ap-voice gets the token too. It is
          // the JSON handshake, so send it as text; ws sends a Buffer as binary
          // by default, which ap-voice would misread as an audio frame.
          upstream?.send(data, { binary: false });
          // Queued frames are post-auth audio: binary.
          for (const frame of pending) upstream?.send(frame, { binary: true });
          pending.length = 0;
        });
        upstream.on("message", (up: RawData, upBinary: boolean) => {
          if (client.readyState === WebSocket.OPEN) client.send(up, { binary: upBinary });
        });
        upstream.on("close", close_both);
        upstream.on("error", () => {
          client.send(JSON.stringify({ type: "error", error: "voice_upstream_unavailable" }));
          close_both();
        });
        return;
      }

      // Post-auth frames: proxy to upstream, queueing until it is open.
      if (upstream && upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      } else {
        pending.push(data);
      }
    });

    client.on("close", close_both);
    client.on("error", close_both);
  });

  function handle_upgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  }

  return { wss, handle_upgrade };
}
