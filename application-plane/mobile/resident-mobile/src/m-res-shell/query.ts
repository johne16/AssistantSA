// React Query client, AsyncStorage persistence, and NetInfo/AppState wiring for
// onlineManager and focusManager.

import { useEffect, useState } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { app_config } from "@/app-config";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  QueryClient,
  defaultShouldDehydrateQuery,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import type {
  PersistQueryClientOptions,
} from "@tanstack/react-query-persist-client";

// Max age of a persisted cache; older is discarded on restore.
const PERSIST_MAX_AGE = 1000 * 60 * 60 * 24; // 24 hours

// Cache-busting key. Bump when a persisted query's shape changes.
const PERSIST_BUSTER = "resident-cache-v1";

export const query_client = new QueryClient({
  defaultOptions: {
    queries: {
      networkMode: "offlineFirst",
      retry: 4,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30000),
      staleTime: 30000,
      gcTime: PERSIST_MAX_AGE,
      refetchOnReconnect: true,
    },
    mutations: {
      networkMode: "offlineFirst",
    },
  },
});

const async_storage_persister = createAsyncStoragePersister({
  storage: AsyncStorage,
});

// Persist a query unless it opts out with meta.persist: false (e.g. the
// notification /pending poll).
export const persist_options: Omit<PersistQueryClientOptions, "queryClient"> = {
  persister: async_storage_persister,
  maxAge: PERSIST_MAX_AGE,
  buster: PERSIST_BUSTER,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      defaultShouldDehydrateQuery(query) && query.meta?.persist !== false,
  },
};

// Wire NetInfo -> onlineManager and AppState -> focusManager. Idempotent.
let managers_wired = false;
export function setup_query_managers(): void {
  if (managers_wired) return;
  managers_wired = true;

  onlineManager.setEventListener((set_online) =>
    NetInfo.addEventListener((state) => {
      set_online(!!state.isConnected && state.isInternetReachable !== false);
    }),
  );

  if (Platform.OS !== "web") {
    focusManager.setEventListener((set_focused) => {
      const on_change = (status: AppStateStatus) => {
        set_focused(status === "active");
      };
      const sub = AppState.addEventListener("change", on_change);
      return () => sub.remove();
    });
  }
}

// --- backend reachability ---
// NetInfo only reports device connectivity; the gateway itself may be down when
// the app opens. One shared poller probes /health until it answers, then every
// query is refetched so the app-open reads land together, and the app-open
// triggers that live outside React Query (civic refresh, account sync) gate on
// useBackendReady so they fire once the backend is actually reachable.

const HEALTH_POLL_MS = 3000;
let backend_ready = false;
let health_poll_started = false;
const backend_ready_listeners = new Set<() => void>();

function start_health_poll(): void {
  if (health_poll_started) return;
  health_poll_started = true;
  const probe = async () => {
    try {
      const res = await fetch(`${app_config.api_gateway_base_url}/health`);
      if (res.ok) {
        backend_ready = true;
        // Refetch everything that failed or was restored from the persisted
        // cache while the backend was unreachable.
        void query_client.invalidateQueries();
        for (const listener of backend_ready_listeners) listener();
        return;
      }
    } catch {
      // Backend unreachable; keep polling.
    }
    setTimeout(() => void probe(), HEALTH_POLL_MS);
  };
  void probe();
}

// True once the backend has answered a health probe this session. Starts the
// shared poller on first use.
export function useBackendReady(): boolean {
  const [ready, set_ready] = useState(backend_ready);
  useEffect(() => {
    start_health_poll();
    if (backend_ready) {
      set_ready(true);
      return;
    }
    const listener = () => set_ready(true);
    backend_ready_listeners.add(listener);
    return () => {
      backend_ready_listeners.delete(listener);
    };
  }, []);
  return ready;
}

// True when the device is online, tracked via onlineManager.
export function useOnline(): boolean {
  const [online, set_online] = useState<boolean>(() => onlineManager.isOnline());
  useEffect(() => {
    return onlineManager.subscribe(() => set_online(onlineManager.isOnline()));
  }, []);
  return online;
}
