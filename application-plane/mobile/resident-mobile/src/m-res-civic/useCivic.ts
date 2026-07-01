import { useCallback, useMemo } from "react";
import {
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useResidentSession } from "@/m-res-auth";
import { civic_api_request, civic_dismiss_request } from "./gateway";
import { civic_query_keys } from "./types";
import type { alert_entry, civic_client } from "./types";

// Stable empty fallback so an unresolved query keeps a constant reference (a new
// [] each render would make the portal's alerts mirror effect loop).
const EMPTY_ALERTS: alert_entry[] = [];

// useCivic exposes the civic surface the portal consumes. Alerts are read with
// React Query; dismiss/restore are per-resident mutations that throw on failure
// (the portal owns the optimistic hide + rollback) and invalidate the alerts
// query on settle.
export function useCivic(): civic_client {
  const { tenant_context_token } = useResidentSession();
  const client = useQueryClient();

  const alerts_query = useQuery({
    queryKey: civic_query_keys.alerts,
    queryFn: async (): Promise<alert_entry[]> => {
      const response = await civic_api_request(tenant_context_token, {
        resource: "alerts",
        params: {},
      });
      return (response.data as alert_entry[] | null) ?? [];
    },
  });

  const dismiss_mutation = useMutation({
    mutationFn: (entry_id: string) =>
      civic_dismiss_request(tenant_context_token, "dismiss", entry_id),
    onSettled: () =>
      client.invalidateQueries({ queryKey: civic_query_keys.alerts }),
  });

  const restore_mutation = useMutation({
    mutationFn: (entry_id: string) =>
      civic_dismiss_request(tenant_context_token, "restore", entry_id),
    onSettled: () =>
      client.invalidateQueries({ queryKey: civic_query_keys.alerts }),
  });

  // Depend on the stable mutateAsync, not the mutation object (new each render).
  const dismiss_async = dismiss_mutation.mutateAsync;
  const restore_async = restore_mutation.mutateAsync;

  const dismiss_alert = useCallback(
    (entry_id: string): Promise<void> => dismiss_async(entry_id).then(() => undefined),
    [dismiss_async],
  );

  const restore_alert = useCallback(
    (entry_id: string): Promise<void> => restore_async(entry_id).then(() => undefined),
    [restore_async],
  );

  const alerts = alerts_query.data ?? EMPTY_ALERTS;

  return useMemo<civic_client>(
    () => ({ alerts, dismiss_alert, restore_alert }),
    [alerts, dismiss_alert, restore_alert],
  );
}
