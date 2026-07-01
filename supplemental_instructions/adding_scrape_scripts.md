# Adding a utility scrape script to the backend

Each utility site gets one JavaScript file. The backend loads it at startup and
serves it to the app on demand, matched to a linked account by `site_id`.

Scripts live in `application-plane/backend/ap-utility/scrape_scripts/`.

## Steps

1. Name the file `<site_id>.js`. The base name is the `site_id` and must match
   the `site_id` of the linked account in the app.
2. Put a `// @url <login-url>` header on its own line. Files without this header
   are skipped at load.
3. Define a global `run_scrape(creds)` function. It runs inside the off-screen
   WebView, is re-injected on every page load of the job URL, and must return
   (or resolve a promise to) `{ bills, usage }`.
4. Restart the backend. The registry is built once at startup; new or edited
   files are not picked up until restart.

## `run_scrape(creds)` contract

- `creds` is `{ sign_in_url, username, password }`, read from the device
  keystore at scrape time.
- Return shape:
  - `bill_view = { due_date (ISO YYYY-MM-DD), total (number) }`
  - `usage_view = { account_ref, period_start, period_end, amount, unit }`
  - Return empty arrays for data a site does not expose.
- Throw (or reject) to surface an error to the host.

## Host-provided helper

- `window.__set_value(el, value)` sets an input's value without focusing it, so
  the keyboard does not pop on the hidden WebView. Use it instead of assigning
  `el.value` or calling `el.focus()`.

## Multi-page logins

The script is re-injected on every navigation. To span a login redirect, fill
and submit the form on the login page and return a promise that never settles so
no result is posted; read and resolve the data on the page load that follows.
See `scrape_scripts/cps.js` for a worked example.
