// ap-server config + adapter wiring types only. No domain types live here;
// domain types are owned by each module's own types.ts.

// Parsed scrape script registry entry (mirrors ap-utility's scrape_script_entry).
export interface scrape_script_entry {
  url: string;
  script: string;
}

export type scrape_script_registry = Record<string, scrape_script_entry>;

// Model + max_tokens per llm_path for the Anthropic adapter.
export interface anthropic_llm_config {
  claude_chat_model: string;
  claude_voice_model: string;
  claude_chat_max_tokens: number;
  claude_voice_max_tokens: number;
}

// Per-job scheduler intervals in milliseconds.
export interface scheduler_intervals {
  collection_schedule_interval_ms: number;
  city_alerts_interval_ms: number;
  city_events_interval_ms: number;
  power_outage_interval_ms: number;
  bill_reminder_interval_ms: number;
}

// Whole-process config read from the environment at startup. snake_case keys
// match the .env.example template verbatim. Secrets are loaded from env, never
// hardcoded.
export interface server_config {
  // ap-server
  server_listen_address: string; // "host:port"
  database_url: string;
  token_verification_public_key: string; // PEM SPKI

  // ap-assistant
  claude_api_key: string;
  claude_chat_model: string;
  claude_voice_model: string;
  claude_chat_max_tokens: number;
  claude_voice_max_tokens: number;
  // Max conversation messages retained per session (older ones are trimmed).
  max_message_history: number;
  redis_url: string;
  redis_cmd: string; // command line, split on whitespace

  // ap-civic
  find_my_rep_gis_url: string;
  my_area_police_url: string;
  my_area_fire_url: string;
  my_area_neighborhood_url: string;
  geocode_url: string;
  council_staff_source_url: string;
  collection_schedule_source_url: string;
  city_alerts_source_url: string;
  nws_alerts_api_url: string;
  city_events_source_url: string;
  alerts_retention_days: number;
  events_retention_days: number;
  collection_schedule_refresh_days: number;
  find_my_rep_refresh_days: number;

  // ap-utility
  utility_retention_days: number;
  power_outage_source_url: string;
  bill_due_reminder_days: number;
  scrape_script_registry: scrape_script_registry;

  // ap-voice bridge (ap-voice runs in its own process; ap-server only proxies)
  ap_voice_ws_url: string;

  // crawl4ai Python sidecar base URL for ap-civic page fetches
  crawl_service_url: string;

  // sidecar process supervision: ap-server spawns these on startup and stops
  // them on shutdown. spawn_sidecars=false leaves them to be run externally.
  spawn_sidecars: boolean;
  ap_voice_cmd: string; // command line, split on whitespace
  crawl_service_cmd: string; // command line, split on whitespace

  // scheduler
  scheduler_intervals: scheduler_intervals;

  // city the scheduler runs as, injected into ap-civic's server-side fetch path
  scheduler_city_tenant_id: string;
}

// Resolved listen address.
export interface listen_address {
  host: string;
  port: number;
}
