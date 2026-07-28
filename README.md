# ResaleMasterLab — Frontend Marketplace Results API

ResaleMasterLab is a Vinext/React resale-research application. This revision restores the earlier **frontend API marketplace-results flow** without restoring the resource-heavy Cloudflare implementation that caused Worker Error 1102.

## How marketplace loading works

For each marketplace URL, the frontend calls the same-origin endpoint:

```text
/api/listings?source=<encoded marketplace URL>
```

That endpoint is deliberately a thin relay. It performs one bounded upstream `GET`, streams at most 2 MB of raw response text back to the browser, and stops after 10 seconds. It does **not**:

- invoke Browser Run;
- render JavaScript pages;
- crawl search engines;
- hydrate product pages;
- run marketplace HTML/JSON parsers;
- compare listings or run AI analysis.

All JSON, JSON-LD, HTML, markdown, image filtering, deduplication, comparisons, fees, filters, and local-AI ranking remain in `app/lib/frontend-marketplaces.ts` and `app/page.tsx` in the user's browser.

## Request order

The frontend tries transports in this order:

1. Bounded same-origin marketplace-results API.
2. Optional ResaleMasterLab Browser Bridge extension.
3. Direct page-origin fetch only for hosts known to permit CORS.
4. Jina Reader fallback.
5. Original live marketplace search link.

Known CORS-blocked marketplaces are never fetched directly from the page, so Depop, Grailed, and Poshmark no longer flood DevTools with predictable CORS errors.

## Worker safety

Revision: `frontend-marketplace-results-api-v9`

The Worker does only one upstream request per `/api/listings` invocation. Safeguards include:

- HTTPS-only marketplace allowlist;
- no credentials or custom ports in source URLs;
- manual redirect validation;
- maximum two redirects;
- 10-second upstream timeout;
- 2 MB response-body limit;
- no Browser Run binding;
- no server-side marketplace parsing;
- no server-side marketplace concurrency fan-out.

The frontend still uses `Promise.allSettled`, so one failed marketplace or query cannot cancel successful results from other markets.

## Install

```powershell
npm ci
npm run dev:windows
```

Open:

```text
http://localhost:5173
```

## Optional Browser Bridge

The extension is in `browser-extension/`.

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Choose **Load unpacked**.
4. Select the `browser-extension` folder.
5. Reload ResaleMasterLab.

The bridge is only a fallback when a marketplace blocks the relay or requires a browser-context response. It uses a single shared page listener and singleton content/background listeners.

## Deploy to your workers.dev hostname

Target:

```text
https://resalewebsite.unusualsuspectsclothing.workers.dev/
```

Commands:

```powershell
npm ci
npm test
npm run build:windows
npm run deploy
npm run check:production
```

Cloudflare Git Build settings:

```text
Build command: npm run build:windows
Deploy command: npm run deploy
Non-production deploy command: npm run preview:cloudflare
```

## Production health check

```text
https://resalewebsite.unusualsuspectsclothing.workers.dev/api/health
```

Expected fields:

```json
{
  "revision": "frontend-marketplace-results-api-v9",
  "marketplaceRequests": "frontend-api-relay",
  "browserBindingAvailable": false,
  "cloudflareMarketplaceFetches": "single-bounded-relay-only"
}
```

The production checker also verifies that `/api/listings` returns the raw frontend-API envelope and rejects unrelated hosts.

## Images

Marketplace image URLs are extracted and filtered in the browser. The client rejects favicon, `.ico`, logo, sprite, QR-code, avatar, and DuckDuckGo site-icon URLs. Depop product photos remain direct first-party CDN URLs when published in the marketplace response.

## Console warnings

Messages mentioning `ObjectMultiplex`, `app-init-liveness`, `background-liveness`, or a large injected `contentscript.js` are not emitted by ResaleMasterLab. They come from another installed browser extension. The included bridge files are `content.js` and `background.js`.
