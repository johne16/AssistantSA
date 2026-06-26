// HTTP-fetch-backed port adapters built on global fetch (Node 18+):
//   page_fetcher           (ap-civic) - HTTP GET + naive HTML-to-text fallback
//   gis_reader             (ap-civic) - structured GET + point-in-polygon query
//   utility_systems_reader (ap-utility) - outage source GET
// plus the real Date clock injected into ap-civic and ap-utility.

import type {
  clock,
  gis_query_request,
  gis_query_response,
  http_get_response,
  page_fetch_request,
  page_fetch_response,
  page_fetcher,
  gis_reader,
} from "ap-civic";
import type { outage_source_entry, utility_systems_reader } from "ap-utility";

// Log any non-2xx HTTP response to the console. Callers still get the body/status
// back; this only surfaces the failure so a blocked or moved source is visible.
function log_http(label: string, url: string, status: number): void {
  if (status < 200 || status >= 300) {
    console.error(`[ap-server] ${label} non-2xx ${status}: ${url}`);
  }
}

// Strip HTML tags to plain text. Fallback used only when the crawl4ai sidecar is
// not reachable, since a raw GET cannot render JS-driven pages the way crawl4ai
// does.
function html_to_text(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// page_fetcher backed by the crawl4ai Python sidecar over HTTP. crawl4ai is
// Python, so it runs as a separate process (application-plane/backend/crawl-service);
// this adapter POSTs the url to its /fetch_markdown endpoint and returns the
// rendered markdown. If the sidecar is unreachable, falls back to a raw GET plus
// HTML-to-text so civic fetches still produce something. crawl_service_url comes
// from config, never hardcoded.
export function create_page_fetcher(crawl_service_url?: string): page_fetcher {
  return {
    async fetch_markdown(request: page_fetch_request): Promise<page_fetch_response> {
      if (crawl_service_url) {
        try {
          const res = await fetch(`${crawl_service_url}/fetch_markdown`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ url: request.url }),
          });
          if (res.ok) {
            const json = (await res.json()) as {
              url: string;
              markdown: string;
              fetched_at: string;
            };
            return {
              url: json.url,
              markdown: json.markdown,
              fetched_at: json.fetched_at,
            };
          }
          log_http("page_fetcher crawl4ai", request.url, res.status);
        } catch (err) {
          // Sidecar down; fall through to the raw-GET fallback below.
          console.error(`[ap-server] page_fetcher crawl4ai unreachable: ${request.url}:`, err);
        }
      }
      const res = await fetch(request.url);
      const html = await res.text();
      log_http("page_fetcher fallback", request.url, res.status);
      return {
        url: request.url,
        markdown: html_to_text(html),
        fetched_at: new Date().toISOString(),
      };
    },
  };
}

// geocode_url is the Esri World GeocodeServer base; query_point_in_polygon
// geocodes the address to a lon/lat there, then intersects that point against the
// target FeatureServer layer.
export function create_gis_reader(geocode_url: string): gis_reader {
  return {
    async get(url: string): Promise<http_get_response> {
      const res = await fetch(url);
      const body = await res.text();
      log_http("gis_reader.get", url, res.status);
      return { url, status: res.status, body };
    },
    async post(url: string, form: Record<string, string>): Promise<http_get_response> {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams(form).toString(),
      });
      const body = await res.text();
      log_http("gis_reader.post", url, res.status);
      return { url, status: res.status, body };
    },
    async query_point_in_polygon(
      request: gis_query_request,
    ): Promise<gis_query_response> {
      // Address -> lon/lat (WGS84).
      const geo_params = new URLSearchParams({
        SingleLine: request.address,
        outFields: "location",
        f: "json",
      });
      const geo_url = `${geocode_url}/findAddressCandidates?${geo_params.toString()}`;
      const geo_res = await fetch(geo_url);
      log_http("gis_reader.query geocode", geo_url, geo_res.status);
      const geo_json = (await geo_res.json()) as {
        candidates?: Array<{ location?: { x: number; y: number } }>;
      };
      const location = geo_json.candidates?.[0]?.location;
      if (!location) {
        return { layer: request.layer ?? "default", attributes: {} };
      }
      // Point-in-polygon against the layer; inSR=4326 so ArcGIS reprojects.
      const params = new URLSearchParams({
        geometry: `${location.x},${location.y}`,
        geometryType: "esriGeometryPoint",
        inSR: "4326",
        spatialRel: "esriSpatialRelIntersects",
        outFields: "*",
        returnGeometry: "false",
        f: "json",
      });
      const query_url = `${request.url}/query?${params.toString()}`;
      const res = await fetch(query_url);
      log_http("gis_reader.query layer", query_url, res.status);
      const json = (await res.json()) as {
        features?: Array<{ attributes?: Record<string, unknown> }>;
      };
      const attributes = json.features?.[0]?.attributes ?? {};
      return { layer: request.layer ?? "default", attributes };
    },
  };
}

// CPS Energy outages come from the KUBRA StormCenter ZIP thematic layer.
// source_url is the StormCenter currentState endpoint, which names the current
// deployment path; the per-ZIP outage file lives under it. We return only the
// entries for the resident's ZIP (parsed from the address) so the read is
// "outage in your area", not at the exact address.
interface kubra_thematic_entry {
  id: string;
  title: string;
  desc?: {
    name?: string;
    n_out?: number;
    cust_a?: { val?: number };
    etr?: string;
    start_time?: string;
  };
}

export function create_utility_systems_reader(): utility_systems_reader {
  return {
    async fetch_outages(source_url: string, address: string): Promise<outage_source_entry[]> {
      const zip = /\b(\d{5})\b/.exec(address)?.[1];
      if (!zip) return [];
      // currentState -> the current deployment's data path.
      const state_res = await fetch(source_url);
      log_http("utility_systems.fetch_outages state", source_url, state_res.status);
      if (!state_res.ok) return [];
      const state = (await state_res.json()) as {
        data?: { interval_generation_data?: string };
      };
      const base = state.data?.interval_generation_data;
      if (!base) return [];
      // ZIP-aggregated outage file under that deployment.
      const origin = new URL(source_url).origin;
      const data_url = `${origin}/${base}/public/thematic-7/thematic_areas.json`;
      const data_res = await fetch(data_url);
      log_http("utility_systems.fetch_outages data", data_url, data_res.status);
      if (!data_res.ok) return [];
      const json = (await data_res.json()) as { file_data?: kubra_thematic_entry[] };
      return (json.file_data ?? [])
        .filter((e) => e.title === zip || e.desc?.name === zip)
        .map((e) => ({
          outage_id: `${e.id}|${e.desc?.start_time ?? ""}`,
          address: `ZIP ${zip}`,
          status: `${e.desc?.n_out ?? 0} outage(s), ${e.desc?.cust_a?.val ?? 0} customers affected${e.desc?.etr ? `, ETR ${e.desc.etr}` : ""}`,
          reported_at: e.desc?.start_time ?? e.desc?.etr ?? "",
        }));
    },
  };
}

export function create_clock(): clock {
  return { now: () => new Date() };
}
