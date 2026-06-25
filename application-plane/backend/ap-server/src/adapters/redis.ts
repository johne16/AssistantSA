// ioredis-backed session_store for ap-assistant. Conversation history is stored
// as a JSON array per session key. Falls back to an in-memory Map when no
// redis_url is configured, so the PoC runs without Redis.

import Redis from "ioredis";

import type { llm_message, session_store } from "ap-assistant";

const KEY_PREFIX = "assistant:session:";

export function create_session_store(redis_url: string): session_store {
  if (!redis_url) return create_memory_session_store();

  const redis = new Redis(redis_url, { lazyConnect: false, maxRetriesPerRequest: 2 });

  return {
    async load(session_id) {
      const raw = await redis.get(KEY_PREFIX + session_id);
      if (!raw) return [];
      try {
        return JSON.parse(raw) as llm_message[];
      } catch {
        return [];
      }
    },
    async save(session_id, history) {
      await redis.set(KEY_PREFIX + session_id, JSON.stringify(history));
    },
  };
}

// In-process fallback.
function create_memory_session_store(): session_store {
  const sessions = new Map<string, llm_message[]>();
  return {
    async load(session_id) {
      return sessions.get(session_id) ?? [];
    },
    async save(session_id, history) {
      sessions.set(session_id, history);
    },
  };
}
