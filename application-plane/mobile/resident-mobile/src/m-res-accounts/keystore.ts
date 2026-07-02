// Device keystore access for utility account credentials, keyed by site_id.
// Credentials are written here from the link-account screen and read at scrape
// time. They never leave the device and the backend never receives them.

import * as SecureStore from "expo-secure-store";

import type { credential_entry, stored_credentials } from "./types";

// SecureStore keys allow only [A-Za-z0-9._-]. Namespace per site_id.
const key_prefix = "m_res_accounts.cred.";

function store_key(site_id: string): string {
  return key_prefix + site_id;
}

// Write the resident's credentials for a site to the keystore.
export async function save_credentials(entry: credential_entry): Promise<void> {
  const value: stored_credentials = {
    username: entry.username,
    password: entry.password,
  };
  await SecureStore.setItemAsync(store_key(entry.site_id), JSON.stringify(value));
}

// Read stored credentials for a site. Null when none are linked.
export async function read_credentials(
  site_id: string,
): Promise<stored_credentials | null> {
  const raw = await SecureStore.getItemAsync(store_key(site_id));
  if (raw == null) return null;
  return JSON.parse(raw) as stored_credentials;
}

// Remove stored credentials for a site.
export async function delete_credentials(site_id: string): Promise<void> {
  await SecureStore.deleteItemAsync(store_key(site_id));
}
