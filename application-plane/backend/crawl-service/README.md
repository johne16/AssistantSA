# crawl-service

crawl4ai Python sidecar for ap-civic. crawl4ai is Python, so page fetches that
need rendering or HTML-to-markdown extraction run here as a separate process.
The ap-server `page_fetcher` adapter (Node) calls `POST /fetch_markdown` over
HTTP; if this service is unreachable it falls back to a raw GET.

## Run

```
# from this folder
python -m venv .venv
.venv/Scripts/activate        # Windows; use source .venv/bin/activate on Linux
pip install -r requirements.txt
crawl4ai-setup                 # installs the Playwright browser crawl4ai drives
python crawl_service.py
```

## Config (env)

- `crawl_service_host` - bind host. Default `127.0.0.1`.
- `crawl_service_port` - bind port. Default `8095`.

Point ap-server at it with `crawl_service_url` (default `http://127.0.0.1:8095`).

## Endpoints

- `GET /health` -> `{ status: "ok" }`
- `POST /fetch_markdown { url }` -> `{ url, markdown, fetched_at, success }`
