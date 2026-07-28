# Validation — frontend-marketplaces-cors-safe-v8

Completed in the packaging environment:

- 14 focused Node regression tests passed.
- 37 TypeScript/TSX files transpiled with zero syntax errors.
- Focused TypeScript checking passed for the browser marketplace module and its analysis dependencies.
- Focused page type checking passed with temporary React declarations, including the new marketplace result orchestration.
- Browser extension JavaScript syntax checks passed.
- `manifest.json`, `package.json`, and `wrangler.jsonc` parse successfully.
- The final ZIP passes CRC/integrity verification.

Design invariants:

- `app/page.tsx` contains no calls to `/api/listings`, `/api/web-listings`, or `/api/image-proxy`.
- `app/lib/frontend-marketplaces.ts` owns marketplace URL construction, CORS allow-listing, extension-first blocked-host requests, direct fetch for readable hosts, Jina Reader fallback, JSON/JSON-LD parsing, HTML card parsing, markdown link parsing, currency normalization, image filtering, and deduplication.
- `wrangler.jsonc` has no Browser Run binding.
- `/api/listings`, `/api/web-listings`, and `/api/image-proxy` are lightweight disabled routes returning HTTP 410.
- `/api/health` reports revision `frontend-marketplaces-cors-safe-v8` and `cloudflareMarketplaceFetches: false`.
- The browser bridge extension has explicit marketplace host permissions and no Cloudflare marketplace proxy.
- Depop images reject favicons, `.ico` files, logos, sprites, and DuckDuckGo site icons.
- Marketplace batches continue using `Promise.allSettled`, so one CORS failure does not cancel other markets.

A complete Vinext build was not run in the packaging environment because the internal npm registry repeatedly returned HTTP 503 for `zod-validation-error-4.0.2.tgz`. Cloudflare's build environment should run `npm ci` and `npm run build:windows` using the included lockfile.

- Known CORS-blocked marketplace hosts never reach page-origin `fetch()`.
- Bridge message responses use one shared page listener and a pending-request map.
- Extension content/background listeners are guarded by singleton installation keys.


## v8 validation results

- 14 focused Node regression tests passed.
- 37 TypeScript/TSX sources passed TypeScript syntax transpilation.
- Browser extension content/background JavaScript passed `node --check`.
- Browser extension and Wrangler JSON passed JSON validation.
- Full dependency installation could not complete in the packaging environment because the npm mirror returned HTTP 503 for `zod-validation-error`; the lockfile was updated and the Cloudflare build can run `npm clean-install`.
