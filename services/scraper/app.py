"""
Scraper sidecar — a small FastAPI service that wraps Scrapling so the
Next.js CRM (Node, which cannot run Scrapling directly) can fetch public
profile pages and run web searches for the "Auditoria de perfil" feature.

Design notes:
- Every mutating endpoint requires the shared secret in `X-Api-Key`, which
  must match env `SCRAPER_API_KEY`. The service refuses to start without it,
  so a misconfigured deploy fails loudly instead of running wide open.
- Scraping failures are returned as `{"ok": false, "error": ...}` with HTTP
  200. The Node caller treats a fetch that "worked but got blocked" as data,
  not as an exception — a private Instagram or a LinkedIn authwall is an
  expected outcome, not a 500.
- The primary SSRF guard lives on the Node side (`src/lib/webhooks/ssrf.ts`),
  which validates and DNS-resolves every URL before calling us. We repeat a
  DNS + private-range check here as defense in depth, so nothing that slips
  through can make the browser hit an internal address.
- A global semaphore bounds concurrent browser launches: StealthyFetcher /
  DynamicFetcher each spin up a real (headless) browser, and an unbounded
  audit could otherwise exhaust the container's memory.
"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import socket
from html import unescape
from html.parser import HTMLParser
from typing import Any, Literal, Optional
from urllib.parse import parse_qs, urlparse

from fastapi import FastAPI, Header, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

# Scrapling is imported lazily inside the fetch helpers so the module can be
# imported (and /health can answer) even before `scrapling install` has
# downloaded the browsers — useful during image build and healthchecks.

API_KEY = os.environ.get("SCRAPER_API_KEY", "").strip()
if not API_KEY:
    raise RuntimeError(
        "SCRAPER_API_KEY is not set. Refusing to start an unauthenticated scraper."
    )

# At most this many real browsers at once (StealthyFetcher / DynamicFetcher).
_BROWSER_SEMAPHORE = asyncio.Semaphore(int(os.environ.get("SCRAPER_MAX_BROWSERS", "2")))

DEFAULT_MAX_CHARS = 12_000
HARD_MAX_CHARS = 40_000

app = FastAPI(title="CRM Scraper Sidecar", version="1.0.0")


# ------------------------------------------------------------------
# Auth
# ------------------------------------------------------------------
def _require_key(x_api_key: Optional[str]) -> None:
    # Constant-ish comparison; the key is a long random string so a plain
    # `!=` is acceptable here (not a password hash / timing oracle target).
    if not x_api_key or x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail="invalid api key")


# ------------------------------------------------------------------
# SSRF guard (defense in depth; the Node side is the primary gate)
# ------------------------------------------------------------------
def _is_public_host(host: str) -> bool:
    """True only if every resolved address for `host` is publicly routable."""
    if not host:
        return False
    lowered = host.lower().strip("[]")
    if (
        lowered == "localhost"
        or lowered.endswith(".localhost")
        or lowered.endswith(".local")
        or lowered.endswith(".internal")
    ):
        return False

    # A bare IP literal: check it directly.
    try:
        ip = ipaddress.ip_address(lowered)
        return _is_public_ip(ip)
    except ValueError:
        pass

    # A hostname: resolve and require every A/AAAA record to be public.
    try:
        infos = socket.getaddrinfo(lowered, None)
    except socket.gaierror:
        return False
    if not infos:
        return False
    for info in infos:
        addr = info[4][0]
        # Strip IPv6 zone id if present (e.g. "fe80::1%eth0").
        addr = addr.split("%", 1)[0]
        try:
            ip = ipaddress.ip_address(addr)
        except ValueError:
            return False
        if not _is_public_ip(ip):
            return False
    return True


def _is_public_ip(ip: ipaddress._BaseAddress) -> bool:
    return not (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
        # 100.64.0.0/10 CGNAT is "private" per is_private in 3.12; keep the
        # explicit check for older behaviour / clarity.
        or (isinstance(ip, ipaddress.IPv4Address) and ip in ipaddress.ip_network("100.64.0.0/10"))
    )


def _validate_url(raw: str) -> str:
    parsed = urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        raise HTTPException(status_code=400, detail="only http/https urls are allowed")
    if not parsed.hostname:
        raise HTTPException(status_code=400, detail="missing host")
    if not _is_public_host(parsed.hostname):
        # 400, not 500 — the Node side already filtered these, so a hit here
        # is a caller bug or an SSRF probe, both client-side.
        raise HTTPException(status_code=400, detail="host is not publicly routable")
    return raw


# ------------------------------------------------------------------
# HTML → text / metadata extraction
# ------------------------------------------------------------------
class _TextExtractor(HTMLParser):
    """Collect visible text and <meta>/<title> without pulling in a heavy dep."""

    _SKIP = {"script", "style", "noscript", "template", "svg"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self.meta: dict[str, str] = {}
        self.title: Optional[str] = None
        self._skip_depth = 0
        self._in_title = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        if tag in self._SKIP:
            self._skip_depth += 1
            return
        if tag == "title":
            self._in_title = True
        if tag == "meta":
            a = {k.lower(): (v or "") for k, v in attrs}
            key = (a.get("property") or a.get("name") or "").lower()
            if key in ("og:title", "og:description", "og:site_name", "description") and a.get("content"):
                self.meta.setdefault(key, unescape(a["content"]).strip())

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP and self._skip_depth > 0:
            self._skip_depth -= 1
        if tag == "title":
            self._in_title = False

    def handle_data(self, data: str) -> None:
        if self._skip_depth > 0:
            return
        text = data.strip()
        if not text:
            return
        if self._in_title and self.title is None:
            self.title = text
        self.parts.append(text)

    def text(self, max_chars: int) -> str:
        joined = " ".join(self.parts)
        joined = " ".join(joined.split())  # collapse whitespace
        return joined[:max_chars]


def _extract(html: str, max_chars: int) -> dict[str, Any]:
    parser = _TextExtractor()
    try:
        parser.feed(html)
    except Exception:
        # Malformed markup shouldn't crash the request; return whatever we got.
        pass
    title = parser.meta.get("og:title") or parser.title
    return {
        "title": title,
        "meta": parser.meta,
        "text": parser.text(max_chars),
    }


# ------------------------------------------------------------------
# Scrapling fetchers
# ------------------------------------------------------------------
def _blocking_fetch(url: str, mode: str, timeout_ms: int) -> dict[str, Any]:
    """Runs in a worker thread — Scrapling's fetchers are synchronous."""
    from scrapling.fetchers import DynamicFetcher, Fetcher, StealthyFetcher

    timeout_s = max(1, timeout_ms // 1000)
    if mode == "basic":
        page = Fetcher.get(url, timeout=timeout_ms, stealthy_headers=True)
    elif mode == "stealth":
        page = StealthyFetcher.fetch(
            url, headless=True, network_idle=True, timeout=timeout_ms
        )
    elif mode == "dynamic":
        page = DynamicFetcher.fetch(
            url, headless=True, network_idle=True, timeout=timeout_ms
        )
    else:
        raise ValueError(f"unknown mode: {mode}")

    status = getattr(page, "status", None)
    html = getattr(page, "html_content", None) or getattr(page, "body", None) or str(page)
    final_url = getattr(page, "url", url) or url
    return {"status": status, "html": html, "final_url": final_url, "timeout_s": timeout_s}


async def _scrape(url: str, mode: str, timeout_ms: int, max_chars: int) -> dict[str, Any]:
    needs_browser = mode in ("stealth", "dynamic")
    try:
        if needs_browser:
            async with _BROWSER_SEMAPHORE:
                raw = await asyncio.to_thread(_blocking_fetch, url, mode, timeout_ms)
        else:
            raw = await asyncio.to_thread(_blocking_fetch, url, mode, timeout_ms)
    except Exception as exc:  # noqa: BLE001 — any fetcher/browser failure is data
        return {"ok": False, "error": "fetch_failed", "detail": str(exc)[:300], "url": url}

    status = raw["status"]
    html = raw["html"] or ""
    extracted = _extract(html, max_chars)
    ok = bool(extracted["title"] or extracted["text"] or extracted["meta"])
    # An authwall / block often returns 200 with a tiny body or a 4xx/5xx.
    if isinstance(status, int) and status >= 400:
        ok = ok and status < 400
    return {
        "ok": ok if ok else False,
        "status": status,
        "url": url,
        "final_url": raw["final_url"],
        "title": extracted["title"],
        "meta": extracted["meta"],
        "text": extracted["text"],
        "error": None if ok else "blocked_or_empty",
    }


# ------------------------------------------------------------------
# Search (competitor discovery) — DuckDuckGo HTML endpoint.
# Brittle by design: no official API, markup can change, and it can rate-limit
# or serve a CAPTCHA. Treated as best-effort; the caller degrades gracefully.
# ------------------------------------------------------------------
class _DdgParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.results: list[dict[str, str]] = []
        self._current_href: Optional[str] = None
        self._capture_title = False
        self._capture_snippet = False
        self._title_buf: list[str] = []
        self._snippet_buf: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, Optional[str]]]) -> None:
        a = {k.lower(): (v or "") for k, v in attrs}
        cls = a.get("class", "")
        if tag == "a" and "result__a" in cls:
            self._current_href = _ddg_real_url(a.get("href", ""))
            self._capture_title = True
            self._title_buf = []
        elif tag == "a" and "result__snippet" in cls:
            self._capture_snippet = True
            self._snippet_buf = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._capture_title:
            self._capture_title = False
            title = " ".join(" ".join(self._title_buf).split())
            if self._current_href and title:
                self.results.append(
                    {"url": self._current_href, "title": title, "snippet": ""}
                )
            self._current_href = None
        elif tag == "a" and self._capture_snippet:
            self._capture_snippet = False
            snippet = " ".join(" ".join(self._snippet_buf).split())
            if snippet and self.results:
                self.results[-1]["snippet"] = snippet

    def handle_data(self, data: str) -> None:
        if self._capture_title:
            self._title_buf.append(data)
        elif self._capture_snippet:
            self._snippet_buf.append(data)


def _ddg_real_url(href: str) -> Optional[str]:
    """DuckDuckGo wraps results as /l/?uddg=<encoded real url>."""
    if not href:
        return None
    if href.startswith("//"):
        href = "https:" + href
    parsed = urlparse(href)
    if "duckduckgo.com" in (parsed.hostname or "") or parsed.path.startswith("/l/"):
        qs = parse_qs(parsed.query)
        target = qs.get("uddg", [None])[0]
        return target
    if parsed.scheme in ("http", "https"):
        return href
    return None


def _blocking_search(query: str, max_results: int) -> list[dict[str, str]]:
    from scrapling.fetchers import StealthyFetcher

    url = "https://html.duckduckgo.com/html/"
    page = StealthyFetcher.fetch(
        f"{url}?q={_urlencode(query)}",
        headless=True,
        network_idle=True,
        timeout=25_000,
    )
    html = getattr(page, "html_content", None) or getattr(page, "body", None) or str(page)
    parser = _DdgParser()
    try:
        parser.feed(html or "")
    except Exception:
        pass
    # Dedupe by URL, keep order, cap.
    seen: set[str] = set()
    out: list[dict[str, str]] = []
    for r in parser.results:
        u = r["url"]
        if u in seen:
            continue
        seen.add(u)
        out.append(r)
        if len(out) >= max_results:
            break
    return out


def _urlencode(value: str) -> str:
    from urllib.parse import quote_plus

    return quote_plus(value)


# ------------------------------------------------------------------
# Request/response models
# ------------------------------------------------------------------
class ScrapeRequest(BaseModel):
    url: str
    mode: Literal["basic", "stealth", "dynamic"] = "basic"
    timeout_ms: int = Field(default=30_000, ge=1_000, le=90_000)
    max_chars: int = Field(default=DEFAULT_MAX_CHARS, ge=200, le=HARD_MAX_CHARS)


class SearchRequest(BaseModel):
    query: str
    engine: Literal["duckduckgo", "google_maps"] = "duckduckgo"
    max_results: int = Field(default=8, ge=1, le=20)


# ------------------------------------------------------------------
# Routes
# ------------------------------------------------------------------
@app.get("/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


@app.post("/scrape")
async def scrape(
    body: ScrapeRequest, x_api_key: Optional[str] = Header(default=None)
) -> JSONResponse:
    _require_key(x_api_key)
    url = _validate_url(body.url)
    result = await _scrape(url, body.mode, body.timeout_ms, body.max_chars)
    return JSONResponse(result)


@app.post("/search")
async def search(
    body: SearchRequest, x_api_key: Optional[str] = Header(default=None)
) -> JSONResponse:
    _require_key(x_api_key)
    if body.engine == "google_maps":
        # Google Maps scraping is the most brittle path; left as a follow-up.
        return JSONResponse({"ok": False, "error": "not_implemented", "results": []})
    query = body.query.strip()
    if not query:
        return JSONResponse({"ok": False, "error": "empty_query", "results": []})
    try:
        async with _BROWSER_SEMAPHORE:
            results = await asyncio.to_thread(_blocking_search, query, body.max_results)
    except Exception as exc:  # noqa: BLE001
        return JSONResponse(
            {"ok": False, "error": "search_failed", "detail": str(exc)[:300], "results": []}
        )
    return JSONResponse({"ok": True, "results": results})
