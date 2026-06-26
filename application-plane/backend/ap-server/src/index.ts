// ap-server composition root. Loads config, constructs every backend module with
// concrete port adapters, starts the express gateway + voice WebSocket + the
// scheduler, and handles graceful shutdown. No domain logic lives here.

import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer } from "ws";
import { fileURLToPath } from "node:url";
import { dirname, resolve as resolve_path } from "node:path";

import {
  create_civic_handler,
  type notifier as civic_notifier,
  type data_reader as civic_data_reader,
} from "ap-civic";
import { create_utility_handler, type notifier as utility_notifier } from "ap-utility";
import {
  create_assistant_core,
  create_assistant_handler,
  create_tool_registry,
  seed_tools,
} from "ap-assistant";

import { load_config, resolve_listen_address } from "./config.js";
import type { server_config } from "./types.js";
import { create_token_verifier } from "./adapters/token.js";
import {
  create_pool,
  create_civic_store,
  create_utility_store,
} from "./adapters/postgres.js";
import {
  create_memory_civic_store,
  create_memory_utility_store,
} from "./adapters/memory.js";
import { create_anthropic_llm } from "./adapters/anthropic.js";
import { create_session_store } from "./adapters/redis.js";
import {
  create_page_fetcher,
  create_gis_reader,
  create_utility_systems_reader,
  create_clock,
} from "./adapters/fetch.js";
import { create_tool_request_ports } from "./adapters/tool_ports.js";
import {
  create_supervisor,
  type sidecar_spec,
} from "./adapters/supervisor.js";
import { create_gateway } from "./gateway.js";
import { create_voice_bridge, VOICE_PATH } from "./voice-bridge.js";

// Path ap-voice dials for the assistant token stream (matches assistant_ws_url).
const ASSISTANT_WS_PATH = "/assistant";
import { start_scheduler } from "./scheduler.js";

// Backend root (this file runs from ap-server/dist), used to resolve sidecar cwds.
const backend_root = resolve_path(dirname(fileURLToPath(import.meta.url)), "../..");

// Build the sidecar specs ap-server supervises. Listen addresses are derived from
// the host's own config so the host stays the single source of truth for them.
function build_sidecar_specs(config: server_config): sidecar_spec[] {
  const voice_url = new URL(config.ap_voice_ws_url);
  // const crawl_url = new URL(config.crawl_service_url);
  const redis_url = new URL(config.redis_url);
  const [voice_cmd, ...voice_args] = config.ap_voice_cmd.split(/\s+/);
  // const [crawl_cmd, ...crawl_args] = config.crawl_service_cmd.split(/\s+/);
  const [redis_cmd, ...redis_cmd_args] = config.redis_cmd.split(/\s+/);
  return [
    {
      name: "redis",
      command: redis_cmd ?? "redis-server",
      args: [...redis_cmd_args, "--port", redis_url.port || "6379"],
      cwd: backend_root,
      env: {},
    },
    {
      name: "ap-voice",
      command: voice_cmd ?? "cargo",
      args: voice_args,
      cwd: resolve_path(backend_root, "ap-voice"),
      env: { AP_VOICE_LISTEN_ADDR: `${voice_url.hostname}:${voice_url.port}` },
    },
    // crawl-service (crawl4ai) is dead code; not spawned. See root README.
    // {
    //   name: "crawl-service",
    //   command: crawl_cmd ?? "python3",
    //   args: crawl_args,
    //   cwd: resolve_path(backend_root, "crawl-service"),
    //   env: {
    //     crawl_service_host: crawl_url.hostname,
    //     crawl_service_port: crawl_url.port,
    //   },
    // },
  ];
}

async function main(): Promise<void> {
  const config = load_config();

  // Bring the sidecars up first so they are warming while the host wires modules.
  const supervisor = config.spawn_sidecars
    ? create_supervisor(build_sidecar_specs(config))
    : undefined;
  supervisor?.start_all();

  // ap-civic's scheduled fetch reads the city it runs as from process.env;
  // populate it from config before constructing the modules.
  process.env["CIVIC_SCHEDULER_CITY_TENANT_ID"] = config.scheduler_city_tenant_id;

  // --- shared adapters ---
  const token_verifier = await create_token_verifier(
    config.token_verification_public_key,
  );
  const clock = create_clock();

  // Persistence: pg Pool with schema-per-city when database_url is set; otherwise
  // in-memory fallback stores so the PoC runs without a reachable database.
  const pool = create_pool(config.database_url);
  const civic_store = pool ? create_civic_store(pool) : create_memory_civic_store();
  const utility_store = pool
    ? create_utility_store(pool)
    : create_memory_utility_store();
  console.log(
    `[ap-server] persistence: ${pool ? "postgres (schema-per-city)" : "in-memory fallback"}`,
  );

  // ap-notifications is disconnected in this build. ap-civic and ap-utility keep
  // their notifier ports but are wired to no-op notifiers, so nothing is queued.
  const noop_civic_notifier: civic_notifier = { async notify() {} };
  const noop_utility_notifier: utility_notifier = { async notify() {} };

  // Data-access layer: read-any, write-own. Modules get read windows onto data
  // they do not own through here; the underlying tables stay owned by one module.
  // ap-civic owns no resident profile, so it reads saved addresses (owned by
  // ap-utility) through this reader.
  const civic_data_reader: civic_data_reader = {
    async list_resident_addresses(city_tenant_id) {
      return utility_store.list_resident_addresses(city_tenant_id);
    },
    async get_resident_address(city_tenant_id, sub) {
      const profile = await utility_store.get_profile(city_tenant_id, sub);
      const address = profile?.street.trim();
      return address ? address : null;
    },
  };

  // --- ap-civic ---
  const civic = create_civic_handler({
    config: {
      token_verification_public_key: config.token_verification_public_key,
      find_my_rep_gis_url: config.find_my_rep_gis_url,
      my_area_neighborhood_url: config.my_area_neighborhood_url,
      my_area_school_url: config.my_area_school_url,
      council_staff_source_url: config.council_staff_source_url,
      collection_schedule_source_url: config.collection_schedule_source_url,
      city_alerts_source_url: config.city_alerts_source_url,
      nws_alerts_api_url: config.nws_alerts_api_url,
      city_events_source_url: config.city_events_source_url,
      alerts_retention_days: config.alerts_retention_days,
      events_retention_days: config.events_retention_days,
      collection_schedule_refresh_days: config.collection_schedule_refresh_days,
      my_area_refresh_days: config.my_area_refresh_days,
    },
    store: civic_store,
    data_reader: civic_data_reader,
    page_fetcher: create_page_fetcher(config.crawl_service_url),
    gis_reader: create_gis_reader(config.geocode_url),
    notifier: noop_civic_notifier,
    token_verifier,
    clock,
  });

  // --- ap-utility ---
  const utility = create_utility_handler({
    config: {
      token_verification_public_key: config.token_verification_public_key,
      utility_retention_days: config.utility_retention_days,
      power_outage_source_url: config.power_outage_source_url,
      bill_due_reminder_days: config.bill_due_reminder_days,
      scrape_script_registry: config.scrape_script_registry,
    },
    store: utility_store,
    utility_systems: create_utility_systems_reader(),
    notifier: noop_utility_notifier,
    clock,
    token_verifier,
  });

  // --- ap-assistant ---
  const registry = create_tool_registry(seed_tools);
  const assistant_core = create_assistant_core({
    llm: create_anthropic_llm(config.claude_api_key, {
      claude_chat_model: config.claude_chat_model,
      claude_voice_model: config.claude_voice_model,
      claude_chat_max_tokens: config.claude_chat_max_tokens,
      claude_voice_max_tokens: config.claude_voice_max_tokens,
    }),
    store: create_session_store(config.redis_url),
    registry,
    ports: create_tool_request_ports(civic, utility),
    has_api_key: Boolean(config.claude_api_key),
    max_message_history: config.max_message_history,
  });
  const assistant = create_assistant_handler({
    core: assistant_core,
    token_verifier,
  });

  // --- transports ---
  const app = create_gateway({
    civic,
    utility,
    assistant,
    token_verifier,
  });

  const http_server = createServer(app);

  const voice = create_voice_bridge({
    token_verifier,
    ap_voice_ws_url: config.ap_voice_ws_url,
  });

  // ap-voice connects here for the assistant token stream (assistant_ws_url ->
  // /assistant). The handler verifies the token in the first frame and streams
  // { type: "text", text } chunks back, ending with { type: "done" }.
  const assistant_wss = new WebSocketServer({ noServer: true });
  assistant_wss.on("connection", (ws) => {
    assistant.handle_voice_connection(ws);
  });

  http_server.on(
    "upgrade",
    (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (req.url === VOICE_PATH) {
        voice.handle_upgrade(req, socket, head);
      } else if (req.url === ASSISTANT_WS_PATH) {
        assistant_wss.handleUpgrade(req, socket, head, (ws) => {
          assistant_wss.emit("connection", ws, req);
        });
      } else {
        socket.destroy();
      }
    },
  );

  const scheduler = start_scheduler({
    civic,
    utility,
    intervals: config.scheduler_intervals,
  });

  const { host, port } = resolve_listen_address(config.server_listen_address);
  http_server.listen(port, host, () => {
    console.log(`[ap-server] listening on ${host}:${port}`);
    console.log(`[ap-server] voice WebSocket at ${VOICE_PATH} -> ${config.ap_voice_ws_url}`);
  });

  // --- graceful shutdown ---
  let shutting_down = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shutting_down) return;
    shutting_down = true;
    console.log(`[ap-server] ${signal} received, shutting down`);
    scheduler.stop();
    voice.wss.close();
    http_server.close();
    if (supervisor) await supervisor.stop_all();
    if (pool) await pool.end();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[ap-server] fatal startup error:", err);
  process.exit(1);
});
