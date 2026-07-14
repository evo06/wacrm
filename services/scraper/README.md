# Scraper sidecar

Small FastAPI service that wraps [Scrapling](https://github.com/D4Vinci/Scrapling)
(BSD-3-Clause, free/open-source) so the Next.js CRM can scrape public profile
pages and run web searches for the **Auditoria de perfil** feature.

Node cannot run Scrapling (it's Python), so this runs as a separate container.

## Endpoints

All except `/health` require the header `X-Api-Key: $SCRAPER_API_KEY`.

- `GET /health` → `{ "ok": true }`
- `POST /scrape` `{ url, mode: "basic"|"stealth"|"dynamic", timeout_ms?, max_chars? }`
  → `{ ok, status, url, final_url, title, meta, text, error }`
  - `basic` — fast HTTP fetch (`Fetcher`). Good for most websites.
  - `stealth` — headless browser with anti-bot spoofing (`StealthyFetcher`).
    For Instagram / LinkedIn; often returns only OG metadata when logged out.
  - `dynamic` — full browser (`DynamicFetcher`). For JS-heavy pages / Google Maps.
- `POST /search` `{ query, engine: "duckduckgo"|"google_maps", max_results? }`
  → `{ ok, results: [{ title, url, snippet }] }`
  - `duckduckgo` uses the DuckDuckGo HTML endpoint (no API key). Brittle by
    design — markup can change and it can rate-limit; the caller degrades
    gracefully. `google_maps` is a not-yet-implemented stub.

## Run

From the repo root (needs `SCRAPER_API_KEY` in `.env.local`):

```
npm run scraper:up      # build + start (first build is slow: downloads browsers)
npm run scraper:logs
npm run scraper:status
npm run scraper:down
```

The first build downloads Camoufox + Chromium (`scrapling install`), so the
image is ~1.5–2 GB. That is expected for browser automation.

## Notes

- The Next.js side (`src/lib/webhooks/ssrf.ts`) is the primary SSRF guard; this
  service repeats a DNS + private-range check as defense in depth.
- Scraping failures return `{ "ok": false, "error": ... }` with HTTP 200 — a
  blocked/private page is expected data, not a server error.
