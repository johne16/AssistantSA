// The providers a resident can link. Serves the app's add-account dropdown and
// the assistant's linked-account context. To offer a new site, add a scrape
// script file (scrape_scripts/<site_id>.js) and its matching entry here.

import type { provider_catalog_entry } from "./types.js";

export const provider_catalog: provider_catalog_entry[] = [
  { site_id: "summit_electric", provider: "Summit Electric", service_kind: "power/electric" },
  {
    site_id: "bluecreek_water",
    provider: "Bluecreek Water",
    service_kind: "water",
  },
];
