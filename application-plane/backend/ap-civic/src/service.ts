// ap-civic service. Library behind injected ports; holds no concrete adapters.
// Serves stored civic data, runs scheduled public-source fetches (dedupe,
// prune, notify), and resolves address-derived records with
// stale-while-revalidate.

import type {
  alert_entry,
  alert_tier,
  civic_deps,
  civic_dismiss_request,
  civic_read_request,
  civic_read_response,
  civic_service,
  collection_schedule_entry,
  council_staff_member,
  event_entry,
  fetch_source,
  find_my_rep_entry,
  my_area_detail,
  my_area_entry,
  my_area_kind,
  notify_request_type,
  tenant_context_token,
} from "./types.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export function create_civic_service(deps: civic_deps): civic_service {
  const { config, store, data_reader, gis_reader, notifier, clock } = deps;

  // Resolve the address for an address-scoped read from the resident's saved
  // service address, read through the host's data layer. Address is never taken
  // from the caller. Throws if none is saved.
  async function resolve_address(
    tenant: string,
    sub: string,
    resource: string,
  ): Promise<string> {
    const saved = await data_reader.get_resident_address(tenant, sub);
    return require_address(saved ?? undefined, resource);
  }

  // -------------------------------------------------------------------------
  // Reads.
  // -------------------------------------------------------------------------

  async function read(
    request: civic_read_request,
  ): Promise<civic_read_response> {
    const tenant = request.claims.city_tenant_id;
    const sub = request.claims.sub;
    const { resource, params } = request;

    switch (resource) {
      case "alerts": {
        const [data, dismissed] = await Promise.all([
          store.list_alerts(tenant),
          store.list_alert_dismissals(tenant, sub),
        ]);
        const hidden = new Set(dismissed);
        return { resource, data: data.filter((a) => !hidden.has(a.entry_id)) };
      }
      case "events": {
        const data = await store.list_events(tenant);
        return { resource, data };
      }
      case "collection_schedule": {
        const address = await resolve_address(tenant, sub, resource);
        return read_collection_schedule(tenant, address);
      }
      case "find_my_rep": {
        const address = await resolve_address(tenant, sub, resource);
        return read_find_my_rep(tenant, address);
      }
      case "my_area": {
        const address = await resolve_address(tenant, sub, resource);
        const kind = require_kind(params.kind);
        return read_my_area(tenant, address, kind);
      }
      default:
        throw new Error(`unknown civic_resource: ${resource as string}`);
    }
  }

  // Address-derived reads are store-only: they serve whatever the last refresh
  // stored and never contact external sources. Fetching happens only in
  // refresh_address_data (app open) and the scheduled warm pass.
  async function read_find_my_rep(
    tenant: string,
    address: string,
  ): Promise<civic_read_response> {
    const stored = await store.get_find_my_rep(tenant, address);
    return { resource: "find_my_rep", data: stored };
  }

  async function read_collection_schedule(
    tenant: string,
    address: string,
  ): Promise<civic_read_response> {
    const stored = await store.get_collection_schedule(tenant, address);
    return { resource: "collection_schedule", data: stored };
  }

  async function read_my_area(
    tenant: string,
    address: string,
    kind: my_area_kind,
  ): Promise<civic_read_response> {
    const stored = await store.get_my_area(tenant, address, kind);
    return { resource: "my_area", data: stored };
  }

  // App-open refresh: resolve every address-derived record for the resident's
  // saved address. Each resource fails independently.
  async function refresh_address_data(
    claims: tenant_context_token,
  ): Promise<void> {
    const tenant = claims.city_tenant_id;
    const address = await data_reader.get_resident_address(tenant, claims.sub);
    if (!address) return;
    await resolve_address_data(tenant, address);
  }

  async function resolve_address_data(
    tenant: string,
    address: string,
  ): Promise<void> {
    const jobs: [string, () => Promise<unknown>][] = [
      ["find_my_rep", () => resolve_find_my_rep(tenant, address)],
      ["my_area neighborhood", () => resolve_my_area(tenant, address, "neighborhood")],
      ["my_area school", () => resolve_my_area(tenant, address, "school")],
      ["collection_schedule", () => resolve_collection_schedule(tenant, address)],
    ];
    await Promise.all(
      jobs.map(async ([name, job]) => {
        try {
          await job();
        } catch (err) {
          console.error(`[ap-civic] resolve_address_data ${name} failed:`, err);
        }
      }),
    );
  }

  // -------------------------------------------------------------------------
  // Address-derived resolution (GIS point-in-polygon).
  // -------------------------------------------------------------------------

  async function resolve_find_my_rep(
    tenant: string,
    address: string,
  ): Promise<find_my_rep_entry> {
    // Address -> district number via point-in-polygon. The current council member
    // name and office staff come from the district's staff directory page, which
    // is current; the GIS layer's own name field is not.
    const result = await gis_reader.query_point_in_polygon({
      url: config.find_my_rep_gis_url,
      address,
    });
    const council_district = str(result.attributes["District"]);
    const staff_page = await gis_reader.get(
      council_staff_url(config.council_staff_source_url, council_district),
    );
    const entry: find_my_rep_entry = {
      address,
      council_district,
      representative_name: parse_council_member(staff_page.body, council_district),
      staff: parse_council_staff(staff_page.body),
      boundary_layer: result.layer,
      resolved_at: clock.now().toISOString(),
    };
    await store.upsert_find_my_rep(tenant, entry);
    return entry;
  }

  // Single My Collection Day call: Request.aspx?addr={address} returns the whole
  // schedule for the address in one shot (weekly weekday for garbage/recycle/
  // organics, "Week of ..." for brush/bulky). No point-in-polygon, no per-commodity
  // layers.
  async function resolve_collection_schedule(
    tenant: string,
    address: string,
  ): Promise<collection_schedule_entry[]> {
    const fetched_at = clock.now().toISOString();
    const url = `${config.collection_schedule_source_url}?addr=${encodeURIComponent(address)}`;
    const response = await gis_reader.get(url);
    const entries = parse_collection_schedule(response.body, address, fetched_at);

    await store.upsert_collection_schedule(tenant, address, entries);
    return entries;
  }

  // Per-kind source: the layer url, the attribute holding the card title, and the
  // attribute -> display label list for the detail rows, in display order.
  function my_area_source(
    kind: my_area_kind,
  ): {
    url: string;
    name_field: string;
    detail_fields: { field: string; label: string }[];
  } | null {
    switch (kind) {
      case "neighborhood":
        return {
          url: config.my_area_neighborhood_url,
          name_field: "Name",
          detail_fields: [
            { field: "AssociationType", label: "Type" },
            { field: "PrimaryContact", label: "Contact" },
            { field: "PrimaryPhoneNumber", label: "Phone" },
            { field: "PrimaryEmailAddress", label: "Email" },
            { field: "PrimaryAddress", label: "Address" },
            { field: "District", label: "Council district" },
            { field: "MeetingDayAndTime", label: "Meets" },
            { field: "MeetingLocation", label: "Meeting location" },
            { field: "Website", label: "Website" },
          ],
        };
      case "school":
        return {
          url: config.my_area_school_url,
          name_field: "SDName",
          detail_fields: [
            { field: "SDCode", label: "District code" },
            { field: "Website", label: "Website" },
          ],
        };
      default:
        return null;
    }
  }

  async function resolve_my_area(
    tenant: string,
    address: string,
    kind: my_area_kind,
  ): Promise<my_area_entry> {
    const source = my_area_source(kind);
    let name = "";
    let details: my_area_detail[] = [];
    let boundary_layer: string = kind;
    if (source) {
      const result = await gis_reader.query_point_in_polygon({
        url: source.url,
        address,
      });
      name = str(result.attributes[source.name_field]);
      // Drop fields the source left empty so the card shows only populated rows.
      details = source.detail_fields
        .map((f) => ({ label: f.label, value: str(result.attributes[f.field]) }))
        .filter((d) => d.value !== "");
      boundary_layer = result.layer;
    }
    const entry: my_area_entry = {
      address,
      kind,
      name,
      details,
      boundary_layer,
      resolved_at: clock.now().toISOString(),
    };
    await store.upsert_my_area(tenant, entry);
    return entry;
  }

  // -------------------------------------------------------------------------
  // Scheduled fetch: fetch, dedupe, store new only, prune old, notify new only.
  // -------------------------------------------------------------------------

  async function run_scheduled_fetch(source: fetch_source): Promise<void> {
    switch (source) {
      case "city_alerts":
        await fetch_city_alerts();
        break;
      case "city_events":
        await fetch_city_events();
        break;
      case "collection_schedule":
        await warm_collection_schedule();
        break;
      default:
        throw new Error(`unknown fetch_source: ${source as string}`);
    }
  }

  async function fetch_city_alerts(): Promise<void> {
    const tenant = current_tenant();
    const fetched_at = clock.now().toISOString();

    // AHAS active-alerts page (raw HTML GET) plus structured NWS API. Each
    // source fails independently so one being down never drops the other's
    // alerts.
    const candidates: alert_entry[] = [];
    try {
      const ahas = await gis_reader.get(config.city_alerts_source_url);
      candidates.push(...parse_alerts_html(ahas.body, "ahas", fetched_at));
    } catch (err) {
      console.error("[ap-civic] fetch_city_alerts AHAS fetch failed:", err);
    }
    try {
      const nws = await gis_reader.get(config.nws_alerts_api_url);
      candidates.push(...parse_alerts_nws(nws.body, "nws", fetched_at));
    } catch (err) {
      console.error("[ap-civic] fetch_city_alerts NWS fetch failed:", err);
    }

    const known = new Set(await store.existing_entry_ids(tenant, "city_alerts"));
    const fresh = candidates.filter((e) => !known.has(e.entry_id));

    if (fresh.length > 0) {
      await store.insert_alerts(tenant, fresh);
    }
    await prune(tenant, "city_alerts", config.alerts_retention_days);
    for (const entry of fresh) {
      await send_notify(entry.title, entry.body, entry.entry_id, "emergency_alert");
    }
  }

  async function fetch_city_events(): Promise<void> {
    const tenant = current_tenant();
    const fetched_at = clock.now().toISOString();

    const candidates = await collect_event_pages(
      config.city_events_source_url,
      fetched_at,
    );

    const known = new Set(await store.existing_entry_ids(tenant, "city_events"));
    const fresh = candidates.filter((e) => !known.has(e.entry_id));

    if (fresh.length > 0) {
      await store.insert_events(tenant, fresh);
    }
    await prune(tenant, "city_events", config.events_retention_days);
    for (const entry of fresh) {
      await send_notify(entry.title, entry.description, entry.entry_id, "event_reminder");
    }
  }

  // sa.gov events is server-rendered HTML with ASP.NET postback pagination. GET
  // page 1, read the total page count, then POST the "Next" submit through the
  // remaining pages, re-reading the hidden form state from each response (the
  // OpenCities __SEAMLESSVIEWSTATE changes per page).
  async function collect_event_pages(
    url: string,
    fetched_at: string,
  ): Promise<event_entry[]> {
    const first = await gis_reader.get(url);
    const events = parse_events_html(first.body, url, fetched_at);

    const pages = parse_event_page_count(first.body);
    let html = first.body;
    for (let page = 2; page <= pages; page += 1) {
      const form = extract_aspnet_fields(html);
      // ctl10$ctl00$ctl09 is the "Next" pager submit button.
      form["ctl10$ctl00$ctl09"] = "Next";
      const res = await gis_reader.post(url, form);
      html = res.body;
      events.push(...parse_events_html(html, url, fetched_at));
    }
    return events;
  }

  // Scheduled warm: re-resolve every address-derived record for every address
  // already known to this city, so store-only reads stay current between app
  // opens. New addresses are seeded by the app-open refresh.
  async function warm_collection_schedule(): Promise<void> {
    const tenant = current_tenant();
    // Seed from every resident's saved address (read through the host's data
    // layer) plus any address already resolved, deduped.
    const residents = await data_reader.list_resident_addresses(tenant);
    const resolved = await store.list_resolved_addresses(tenant);
    const addresses = [...new Set([...residents.map((r) => r.address), ...resolved])];
    for (const address of addresses) {
      // resolve_address_data isolates per-resource failures, so one address or
      // resource failing never stops the rest of the warm pass.
      await resolve_address_data(tenant, address);
    }
  }

  async function prune(
    tenant: string,
    source: fetch_source,
    retention_days: number,
  ): Promise<void> {
    const cutoff = new Date(
      clock.now().getTime() - retention_days * DAY_MS,
    ).toISOString();
    await store.prune_older_than(tenant, source, cutoff);
  }

  async function send_notify(
    title: string,
    body: string,
    entry_id: string,
    type: notify_request_type,
  ): Promise<void> {
    await notifier.notify({
      city_tenant_id: current_tenant(),
      type,
      notification: { title, body, entry_id },
    });
  }

  // -------------------------------------------------------------------------
  // Writes. Per-resident alert dismissal only; the shared alert rows are never
  // mutated here.
  // -------------------------------------------------------------------------

  async function dismiss(request: civic_dismiss_request): Promise<void> {
    const tenant = request.claims.city_tenant_id;
    const sub = request.claims.sub;
    if (request.action === "dismiss") {
      await store.insert_alert_dismissal(
        tenant,
        sub,
        request.entry_id,
        clock.now().toISOString(),
      );
    } else {
      await store.delete_alert_dismissal(tenant, sub, request.entry_id);
    }
  }

  return { read, dismiss, refresh_address_data, run_scheduled_fetch };
}

// ---------------------------------------------------------------------------
// Helpers.
// ---------------------------------------------------------------------------

function require_address(address: string | undefined, resource: string): string {
  if (!address) {
    throw new Error(`address is required for resource ${resource}`);
  }
  return address;
}

function require_kind(kind: my_area_kind | undefined): my_area_kind {
  if (!kind) {
    throw new Error("kind is required for resource my_area");
  }
  return kind;
}

function str(value: unknown): string {
  return value == null ? "" : String(value);
}

// A JSON-parsed source attribute may carry a boolean as true, 1, "true", or
// "Yes" depending on the endpoint.
function truthy_flag(value: unknown): boolean {
  if (value === true || value === 1) return true;
  return (
    typeof value === "string" &&
    ["true", "yes", "y", "1"].includes(value.trim().toLowerCase())
  );
}

// District staff directory URL: the OpenCities directory filtered to one district.
function council_staff_url(base_url: string, council_district: string): string {
  const filter = `(dd_OCP Directory Filter=District ${council_district})`;
  const param = "dlv_OCP CL Main Directory Listing 2 Column";
  return `${base_url}?${encodeURIComponent(param)}=${encodeURIComponent(filter)}`;
}

// The current council member for a district is the side-nav biography link
// (City-Council/D{n}/Biography). The GIS layer's name field is stale.
function parse_council_member(html: string, council_district: string): string {
  const link = new RegExp(
    `City-Council/D${council_district}/Biography"[^>]*>([^<]+)</a>`,
    "i",
  ).exec(html);
  return link ? strip_html(link[1]!) : "";
}

// One staffer per <div class="list-item-container">: a title heading plus
// directory-data blocks keyed by an <h3> label (Title, Phone, Email). Phone/Email
// may be absent.
function parse_council_staff(html: string): council_staff_member[] {
  const members: council_staff_member[] = [];
  const item = /<div class="list-item-container">([\s\S]*?)<\/article>/gi;
  let match: RegExpExecArray | null;
  while ((match = item.exec(html)) !== null) {
    const block = match[1]!;
    const name = /<h2 class="list-item-title">([\s\S]*?)<\/h2>/i.exec(block)?.[1];
    if (!name) {
      continue;
    }
    const fields = new Map<string, string>();
    const field = /<h3>([^<]+)<\/h3>\s*<p>([\s\S]*?)<\/p>/gi;
    let f: RegExpExecArray | null;
    while ((f = field.exec(block)) !== null) {
      fields.set(f[1]!.trim().toLowerCase(), f[2]!);
    }
    const email_field = fields.get("email") ?? "";
    members.push({
      name: strip_html(name),
      title: strip_html(fields.get("title") ?? ""),
      phone: strip_html(fields.get("phone") ?? ""),
      email: /href="([^"]+)"/i.exec(email_field)?.[1] ?? strip_html(email_field),
    });
  }
  return members;
}

// The scheduled-fetch path runs server-side with no per-user request. ap-server
// injects the per-city tenant context the scheduler runs under; these resolve
// it from the injected config/runtime. Kept as a single seam so notify and
// store calls carry the correct city scope.
function current_tenant(): string {
  const tenant = process.env["CIVIC_SCHEDULER_CITY_TENANT_ID"];
  if (!tenant) {
    throw new Error("scheduler city_tenant_id is not configured");
  }
  return tenant;
}

// ---------------------------------------------------------------------------
// Source parsers. ap-server's fetched payloads are parsed into stored shapes.
// Concrete parsing is source-specific; these produce the stored entries with a
// stable entry_id for dedupe. Implementations are intentionally minimal pending
// real source layouts.
// ---------------------------------------------------------------------------

// AHAS activealerts.aspx is server-rendered HTML. The active alerts sit in
// <span id="contentLBL"> as one anchor each:
//   <a href="ActiveAlerts.aspx?id=9554"/>Jun 22, 2026 at 10:08 PM: <title></a>
// id is the stable dedupe key; the link text is "<timestamp>: <title>". Only the
// list page is read, so body is empty (detail lives on the per-id page).
function parse_alerts_html(
  html: string,
  source: string,
  fetched_at: string,
): alert_entry[] {
  const content = /<span[^>]*id="contentLBL"[^>]*>([\s\S]*?)<\/span>/i.exec(html);
  if (!content) {
    return [];
  }

  const entries: alert_entry[] = [];
  const anchor = /href="[^"]*\bid=(\d+)"[^>]*>([^<]+)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(content[1]!)) !== null) {
    const entry_id = match[1]!;
    const text = decode_entities(match[2]!.trim());
    // Split "<timestamp>: <title>" on the first ": " (the time's own colon has no
    // following space, so it is not matched).
    const sep = text.indexOf(": ");
    const timestamp = sep >= 0 ? text.slice(0, sep) : "";
    const title = sep >= 0 ? text.slice(sep + 2) : text;
    entries.push({
      entry_id,
      title,
      body: "",
      source,
      // AHAS city alerts are life-safety notices; tier them critical.
      tier: "critical",
      effective_at: to_iso(timestamp),
      expires_at: null,
      fetched_at,
    });
  }
  return entries;
}

// "Jun 22, 2026 at 10:08 PM" -> ISO 8601. Returns "" if unparseable.
function to_iso(timestamp: string): string {
  const parsed = new Date(timestamp.replace(" at ", " "));
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function decode_entities(text: string): string {
  return text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// NWS active-alerts GeoJSON (api.weather.gov/alerts/active). The body is a
// FeatureCollection; each feature's properties carry the alert. properties.id is
// the stable alert URN, used as the dedupe entry_id.
function parse_alerts_nws(
  body: string,
  source: string,
  fetched_at: string,
): alert_entry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    console.error("[ap-civic] parse_alerts_nws JSON parse failed:", err);
    return [];
  }
  const features = (parsed as { features?: unknown }).features;
  if (!Array.isArray(features)) {
    return [];
  }

  const entries: alert_entry[] = [];
  for (const feature of features) {
    const props = (feature as { properties?: Record<string, unknown> })
      .properties;
    if (!props) {
      continue;
    }
    const entry_id = str(props["id"]);
    if (!entry_id) {
      continue;
    }
    entries.push({
      entry_id,
      title: str(props["headline"] ?? props["event"]),
      body: str(props["description"]),
      source,
      tier: cap_severity_to_tier(str(props["severity"])),
      effective_at: str(props["effective"] ?? props["onset"] ?? props["sent"]),
      expires_at: str(props["expires"] ?? props["ends"]) || null,
      fetched_at,
    });
  }
  return entries;
}

// Map a CAP severity (NWS properties.severity) to a Feed tier.
// Extreme/Severe are life-safety (critical); Moderate is act-soon (important);
// Minor/Unknown/anything else is routine.
function cap_severity_to_tier(severity: string): alert_tier {
  switch (severity) {
    case "Extreme":
    case "Severe":
      return "critical";
    case "Moderate":
      return "important";
    default:
      return "routine";
  }
}

// sa.gov events listing. Each event is one <article>; the listing carries date
// parts, title, description, location and a detail link. The detail href is the
// stable dedupe key. No end time is published on the listing.
function parse_events_html(
  html: string,
  base_url: string,
  fetched_at: string,
): event_entry[] {
  const entries: event_entry[] = [];
  const article = /<article>([\s\S]*?)<\/article>/gi;
  let match: RegExpExecArray | null;
  while ((match = article.exec(html)) !== null) {
    const block = match[1]!;
    const href = /<a\s+href="([^"]+)"/i.exec(block)?.[1];
    const title = /<h2 class="list-item-title">([\s\S]*?)<\/h2>/i.exec(block)?.[1];
    if (!href || !title) {
      continue;
    }
    const date = /<span class="part-date">([^<]+)<\/span>\s*<span class="part-month">([^<]+)<\/span>\s*<span class="part-year">([^<]+)<\/span>/i.exec(
      block,
    );
    const description = /<span class="list-item-block-desc">([\s\S]*?)<\/span>/i.exec(
      block,
    )?.[1];
    const location = /<p class="list-item-address">([\s\S]*?)<\/p>/i.exec(block)?.[1];
    entries.push({
      entry_id: absolute_url(href, base_url),
      title: strip_html(title),
      description: description ? strip_html(description) : "",
      location: location ? strip_html(location) : "",
      starts_at: date ? to_iso(`${date[2]} ${date[1]}, ${date[3]}`) : "",
      when_display: date ? `${strip_html(date[2]!)} ${strip_html(date[1]!)}, ${strip_html(date[3]!)}` : "",
      ends_at: null,
      url: absolute_url(href, base_url),
      fetched_at,
    });
  }
  return entries;
}

// "Page 1 of N" on the listing; defaults to 1 page if absent.
function parse_event_page_count(html: string): number {
  const count = /Page\s+\d+\s+of\s+(\d+)/i.exec(html)?.[1];
  return count ? Number(count) : 1;
}

// Collect every hidden input's name/value so a postback carries the form state
// (__VIEWSTATE, __VIEWSTATEGENERATOR, __SEAMLESSVIEWSTATE, etc.).
function extract_aspnet_fields(html: string): Record<string, string> {
  const fields: Record<string, string> = {};
  const input = /<input[^>]*type="hidden"[^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = input.exec(html)) !== null) {
    const tag = match[0];
    const name = /\bname="([^"]*)"/i.exec(tag)?.[1];
    if (!name) {
      continue;
    }
    fields[name] = decode_entities(/\bvalue="([^"]*)"/i.exec(tag)?.[1] ?? "");
  }
  return fields;
}

function strip_html(html: string): string {
  return decode_entities(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function absolute_url(href: string, base_url: string): string {
  if (/^https?:\/\//i.test(href)) {
    return href;
  }
  const origin = /^(https?:\/\/[^/]+)/i.exec(base_url)?.[1] ?? "";
  return `${origin}${href.startsWith("/") ? "" : "/"}${href}`;
}

// My Collection Day Request.aspx?addr response: a one-element array whose
// attributes hold the full per-address schedule. Garbage/Recycle/Organics are
// weekdays; Brush/Bulky are "Week of MM/DD/YYYY" strings. Organics is only listed
// when the address qualifies. No holiday data is returned, so holiday_bump is
// false.
function parse_collection_schedule(
  body: string,
  address: string,
  fetched_at: string,
): collection_schedule_entry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    console.error("[ap-civic] parse_collection_schedule JSON parse failed:", err);
    return [];
  }
  const first = Array.isArray(parsed) ? parsed[0] : undefined;
  const attributes = (first as { attributes?: Record<string, unknown> })
    ?.attributes;
  if (!attributes) {
    return [];
  }

  const entries: collection_schedule_entry[] = [];
  const add = (
    service_type: string,
    collection_day: string,
    next_collection_date: string,
  ) => {
    if (!collection_day && !next_collection_date) {
      return;
    }
    entries.push({
      entry_id: `${address}|${service_type}`,
      address,
      collection_day,
      service_type,
      next_collection_date,
      holiday_bump: false,
      fetched_at,
    });
  };

  add("garbage", str(attributes["Garbage"]).toLowerCase(), "");
  add("recycling", str(attributes["Recycle"]).toLowerCase(), "");
  if (truthy_flag(attributes["isQualifyOrganics"])) {
    add("organics", str(attributes["Organics"]).toLowerCase(), "");
  }
  add("brush", "", str(attributes["Brush"]));
  add("bulky", "", str(attributes["Bulky"]));

  return entries;
}

