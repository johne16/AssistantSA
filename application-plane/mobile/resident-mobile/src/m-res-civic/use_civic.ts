import { useCallback, useMemo, useRef } from "react";
import { use_resident_session } from "@/m-res-auth";
import { civic_api_request, civic_dismiss_request } from "./gateway";
import type {
  civic_client,
  civic_read_response,
  civic_rep_update_listener,
  civic_view_request,
  find_my_rep_entry,
  my_area_entry,
} from "./types";

// use_civic exposes the fetch surface the portal calls. It reads the session
// internally and forwards the tenant_context_token on every gateway call. It
// does not render; the portal renders the returned civic_data.
//
// find_my_rep and every my_area kind are stale-while-revalidate: the gateway
// returns the stored result at once so the portal renders without a blocking
// spinner. The hook then runs a background refresh and, when ap-civic surfaces
// changed data, pushes the updated response to the registered listener so the
// portal replaces its view in place.

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

function my_area_changed(
  prev: my_area_entry,
  next: my_area_entry,
): boolean {
  if (prev.name !== next.name || prev.details.length !== next.details.length) {
    return true;
  }
  return prev.details.some(
    (d, i) => d.label !== next.details[i]!.label || d.value !== next.details[i]!.value,
  );
}

// True when the background re-read returned data that differs from what the
// portal is currently showing, for either stale-while-revalidate resource.
function read_changed(
  stored: civic_read_response,
  fresh: civic_read_response,
): boolean {
  if (fresh.stale_refreshed === true) return true;
  if (fresh.resource === "find_my_rep") {
    const a = stored.data as find_my_rep_entry | null;
    const b = fresh.data as find_my_rep_entry | null;
    return !!a && !!b && rep_changed(a, b);
  }
  if (fresh.resource === "my_area") {
    const a = stored.data as my_area_entry | null;
    const b = fresh.data as my_area_entry | null;
    return !!a && !!b && my_area_changed(a, b);
  }
  return false;
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

  // Background re-read the resource. If the gateway reports a refresh or the
  // data changed, notify the listeners so the portal replaces its view.
  const revalidate = useCallback(
    async (req: civic_view_request, stored: civic_read_response) => {
      try {
        const fresh = await civic_api_request(tenant_context_token, req);
        if (read_changed(stored, fresh)) {
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
      // Stale-while-revalidate applies to find_my_rep and every my_area kind.
      if (req.resource === "find_my_rep" || req.resource === "my_area") {
        void revalidate(req, response);
      }
      return response;
    },
    [tenant_context_token, revalidate],
  );

  const dismiss_alert = useCallback(
    (entry_id: string): Promise<void> =>
      civic_dismiss_request(tenant_context_token, "dismiss", entry_id),
    [tenant_context_token],
  );

  const restore_alert = useCallback(
    (entry_id: string): Promise<void> =>
      civic_dismiss_request(tenant_context_token, "restore", entry_id),
    [tenant_context_token],
  );

  return useMemo<civic_client>(
    () => ({ civic_view_request, on_rep_update, dismiss_alert, restore_alert }),
    [civic_view_request, on_rep_update, dismiss_alert, restore_alert],
  );
}
