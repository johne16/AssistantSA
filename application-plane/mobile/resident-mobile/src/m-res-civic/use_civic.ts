import { useCallback, useMemo, useRef } from "react";
import { use_resident_session } from "@/m-res-auth";
import { civic_api_request } from "./gateway";
import type {
  civic_client,
  civic_read_response,
  civic_rep_update_listener,
  civic_view_request,
  find_my_rep_entry,
} from "./types";

// use_civic exposes the fetch surface the portal calls. It reads the session
// internally and forwards the tenant_context_token on every gateway call. It
// does not render; the portal renders the returned civic_data.
//
// find_my_rep is stale-while-revalidate: the gateway returns the stored result
// at once so the portal renders without a blocking spinner. The hook then runs
// a background refresh and, when ap-civic surfaces changed rep data, pushes the
// updated response to the registered listener so the portal replaces its view
// in place.

function rep_changed(
  prev: find_my_rep_entry,
  next: find_my_rep_entry,
): boolean {
  return (
    prev.council_district !== next.council_district ||
    prev.representative_name !== next.representative_name ||
    prev.staff.length !== next.staff.length ||
    prev.boundary_layer !== next.boundary_layer
  );
}

export function use_civic(): civic_client {
  const { tenant_context_token } = use_resident_session();
  const listeners = useRef<Set<civic_rep_update_listener>>(new Set());

  // Register a listener for background-refreshed find_my_rep results. Returns
  // an unsubscribe.
  const on_rep_update = useCallback(
    (listener: civic_rep_update_listener): (() => void) => {
      listeners.current.add(listener);
      return () => {
        listeners.current.delete(listener);
      };
    },
    [],
  );

  // Background re-resolve find_my_rep. If the gateway reports a refresh or the
  // rep data changed, notify the listeners so the portal replaces its view.
  const revalidate_rep = useCallback(
    async (req: civic_view_request, stored: civic_read_response) => {
      try {
        const fresh = await civic_api_request(tenant_context_token, req);
        const stored_rep = stored.data as find_my_rep_entry | null;
        const fresh_rep = fresh.data as find_my_rep_entry | null;
        const changed =
          fresh.stale_refreshed === true ||
          (!!stored_rep && !!fresh_rep && rep_changed(stored_rep, fresh_rep));
        if (changed) {
          for (const listener of listeners.current) {
            listener(fresh);
          }
        }
      } catch {
        // Background refresh failure leaves the stored result in place.
      }
    },
    [tenant_context_token],
  );

  const civic_view_request = useCallback(
    async (req: civic_view_request): Promise<civic_read_response> => {
      const response = await civic_api_request(tenant_context_token, req);
      // Stale-while-revalidate only applies to find_my_rep.
      if (req.resource === "find_my_rep") {
        void revalidate_rep(req, response);
      }
      return response;
    },
    [tenant_context_token, revalidate_rep],
  );

  return useMemo<civic_client>(
    () => ({ civic_view_request, on_rep_update }),
    [civic_view_request, on_rep_update],
  );
}
