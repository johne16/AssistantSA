import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

import uvicorn
from crawl4ai import AsyncWebCrawler, BrowserConfig, CrawlerRunConfig, CacheMode
from fastapi import FastAPI
from pydantic import BaseModel

# crawl4ai sidecar for ap-civic. crawl4ai is Python, so page fetching that needs
# rendering or HTML-to-markdown extraction runs here as a separate process; the
# ap-server page_fetcher adapter (Node) calls this over HTTP. Config from env so
# nothing is hardcoded. No secrets are read here.

_host = os.environ.get("crawl_service_host", "127.0.0.1")
_port = int(os.environ.get("crawl_service_port", "8095"))


class fetch_request(BaseModel):
    url: str


crawler: AsyncWebCrawler | None = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    # One headless browser reused across requests, brought up at startup.
    global crawler
    crawler = AsyncWebCrawler(config=BrowserConfig(headless=True))
    await crawler.__aenter__()
    yield
    await crawler.__aexit__(None, None, None)
    crawler = None


app = FastAPI(lifespan=lifespan)


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/fetch_markdown")
async def fetch_markdown(request: fetch_request):
    # Bypass cache so civic fetches see current source content; ap-civic owns its
    # own dedupe and retention.
    run_conf = CrawlerRunConfig(cache_mode=CacheMode.BYPASS)
    result = await crawler.arun(url=request.url, config=run_conf)
    markdown = result.markdown.raw_markdown if result.success else ""
    return {
        "url": request.url,
        "markdown": markdown,
        "fetched_at": datetime.now(timezone.utc).isoformat(),
        "success": result.success,
    }


if __name__ == "__main__":
    uvicorn.run(app, host=_host, port=_port)
