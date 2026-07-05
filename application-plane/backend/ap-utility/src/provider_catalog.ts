// The providers a resident can link. Serves the app's add-account dropdown and
// the assistant's linked-account context. To offer a new site, add a scrape
// script file (scrape_scripts/<site_id>.js) and its matching entry here.

import type { provider_catalog_entry } from "./types.js";

export const provider_catalog: provider_catalog_entry[] = [
  { site_id: "cps", provider: "CPS Energy", service_kind: "power/electric" },
  { site_id: "att", provider: "AT&T", service_kind: "phone/internet" },
  { site_id: "herokuapp", provider: "Test: herokuapp", service_kind: "test site" },
  {
    site_id: "toscrape_js",
    provider: "Test: quotes.toscrape.com/js",
    service_kind: "test site",
  },
];
