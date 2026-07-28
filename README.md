# ResaleMasterLab — Browser Marketplace Edition

ResaleMasterLab is a Vinext/React resale research application. This version moves marketplace discovery back into the user's browser so Cloudflare does not download, render, parse, or hydrate marketplace pages.

## Why this version exists

Cloudflare Error 1102 means a Worker exceeded its CPU-time or memory allowance. The previous production route performed large HTML/JSON parsing and multiple Browser Run operations inside `/api/listings`; that work has been removed.

In revision `frontend-marketplaces-cors-safe-v8`:

- `/api/listings` is intentionally disabled and returns HTTP 410.
- `/api/web-listings` is intentionally disabled and returns HTTP 410.
- The `BROWSER` binding is removed from `wrangler.jsonc`.
- Depop, Grailed, Poshmark, Mercari Japan, ZenMarket, Rakuten, Rakuma, JDirectItems, Bunjang, eBay, Mercari US, and Facebook Marketplace requests originate from the browser.
- Listing parsing, comparison matching, fee calculations, filters, and local AI ranking run client-side.
- Cloudflare serves the application and lightweight same-origin features only.

## Browser request order

For a marketplace known to block page-origin CORS, the client tries:

1. The optional ResaleMasterLab Browser Bridge extension.
2. Jina Reader (`r.jina.ai`) as a public reader fallback.
3. A live-search link when neither readable transport succeeds.

For hosts that are not on the known CORS-blocked list, a normal browser `fetch()` is attempted first. The app deliberately does **not** call `fetch()` against Depop, Grailed, Poshmark, ZenMarket, Rakuten, Mercari, eBay, or Facebook from the page origin, preventing the repeated CORS errors shown in DevTools.

The AI Search card additionally uses `s.jina.ai` when available to discover eBay, Mercari US, Facebook Marketplace, and other unsupported secondhand stores.

Cross-origin policies are controlled by each marketplace. A normal webpage cannot read a CORS-blocked response. The included extension is the reliable browser-side option for those sites and still avoids all Cloudflare marketplace computation.

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

The extension has explicit host permissions for the supported marketplace domains. It performs GET requests in the browser extension process and sends public response text back to the page for parsing. Version 1.1 uses a single shared page-response listener and singleton content/background listeners, so concurrent marketplace searches do not accumulate event listeners.

## Optional Jina key

Reader requests are attempted without a key first. To use a Jina API key from the browser, run this once in the browser console:

```js
localStorage.setItem("rml:jina-reader-key", "YOUR_JINA_KEY");
```

Remove it with:

```js
localStorage.removeItem("rml:jina-reader-key");
```

The key remains in that browser profile and is not sent to Cloudflare.

## Deploy to the existing workers.dev hostname

The Worker project name is `resalewebsite`, so deployment targets:

```text
https://resalewebsite.unusualsuspectsclothing.workers.dev/
```

Use:

```powershell
npm ci
npm test
npm run build:windows
npm run deploy
npm run check:production
```

Cloudflare Git Builds should use:

```text
Build command: npm run build:windows
Deploy command: npm run deploy
```

## Production health check

```text
https://resalewebsite.unusualsuspectsclothing.workers.dev/api/health
```

Expected fields:

```json
{
  "revision": "frontend-marketplaces-cors-safe-v8",
  "marketplaceRequests": "browser",
  "browserBindingAvailable": false,
  "cloudflareMarketplaceFetches": false
}
```

The old `/api/listings` route should return HTTP 410. This is intentional and confirms that Cloudflare is not requesting marketplace pages.

## Depop images

Depop image URLs are loaded directly from their published CDN with `referrerPolicy="no-referrer"`. The client rejects favicon, `.ico`, logo, sprite, and DuckDuckGo icon URLs. When an image host blocks direct browser loading, the card uses the local placeholder; the Worker image proxy is intentionally disabled.

## Important limitation

A deployed frontend cannot defeat marketplace CORS or login requirements. When direct fetch and public-reader access are blocked, ResaleMasterLab retains the original marketplace search URL and asks the user to open it directly or enable the included browser bridge. It does not bypass authentication, CAPTCHA, or anti-bot protections.


## Browser-extension console warnings

Messages mentioning `ObjectMultiplex`, `app-init-liveness`, `background-liveness`, or a bundled `contentscript.js` are not emitted by ResaleMasterLab or its included bridge. Those identifiers are commonly injected by another browser extension. The ResaleMasterLab bridge files are named `content.js` and `background.js`, and v1.1 installs each listener only once. Use an extension-free profile to identify the unrelated extension if those messages remain.
