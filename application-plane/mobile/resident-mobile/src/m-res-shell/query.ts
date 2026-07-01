// React Query client, AsyncStorage persistence, and NetInfo/AppState wiring for
// onlineManager and focusManager.

import { useEffect, useState } from "react";
import { AppState, Platform, type AppStateStatus } from "react-native";
import NetInfo from "@react-native-community/netinfo";
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

// True when the device is online, tracked via onlineManager.
export function useOnline(): boolean {
  const [online, set_online] = useState<boolean>(() => onlineManager.isOnline());
  useEffect(() => {
    return onlineManager.subscribe(() => set_online(onlineManager.isOnline()));
  }, []);
  return online;
}
