# Scraper sidecar image. Python + Scrapling + its headless browsers.
#
# `scrapling install` downloads Camoufox (a hardened Firefox) and the
# Playwright Chromium build, so the final image is large (~1.5-2 GB). That
# is expected for a browser-automation service. If you never use the
# `stealth`/`dynamic` modes you can drop the `scrapling install` line and
# the image shrinks dramatically, but competitor discovery and Instagram/
# Maps scraping need the browsers.
FROM python:3.12-slim

# Playwright/Camoufox need a set of shared libraries the slim image lacks.
# `scrapling install` pulls most via playwright, but these cover the gaps.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        fonts-liberation \
        libnss3 \
        libnspr4 \
        libdbus-1-3 \
        libatk1.0-0 \
        libatk-bridge2.0-0 \
        libcups2 \
        libdrm2 \
        libxkbcommon0 \
        libatspi2.0-0 \
        libxcomposite1 \
        libxdamage1 \
        libxfixes3 \
        libxrandr2 \
        libgbm1 \
        libasound2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && scrapling install

COPY app.py ./

# Run as a non-root user. Browsers refuse some sandbox features as root and
# it is good hygiene regardless.
RUN useradd --create-home --uid 10001 scraper \
    && chown -R scraper:scraper /app
USER scraper

EXPOSE 8000

# Single worker: the browser semaphore in app.py already bounds concurrency,
# and multiple uvicorn workers would each keep their own browser pool.
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000"]
