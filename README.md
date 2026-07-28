# ResaleMasterLab — Official Marketplace Page Sources v10

This version restores the earlier marketplace-adapter behavior: each search begins with the marketplace's normal public search URL and query parameters, then the browser parses that page source for real listing records.

## Marketplace request flow

For every official search or product URL, the browser calls:

```text
/api/listings?source=<encoded official marketplace URL>
```

The route makes exactly one bounded upstream request and returns the raw HTML, JSON, React state, or text body. It does not use Browser Run, crawl search engines, parse listings on the server, run AI, or fan out to other pages.

The frontend then parses:

- regular listing-card anchors and visible text;
- JSON-LD product and `ItemList` records;
- `__NEXT_DATA__`;
- `__INITIAL_STATE__`, Apollo, and preloaded state;
- React/Next Flight `self.__next_f.push(...)` records;
- canonical/OpenGraph product metadata;
- page-source images, prices, brands, sizes, conditions, descriptions, and item URLs.

When a search card is missing important fields, the frontend hydrates at most eight canonical product pages with three concurrent requests. Each hydration is another isolated one-page relay request, so there is no single resource-heavy Worker invocation.

## Official query routes

- Depop: `/search/?q=...&page=...`, then brand and theme pages.
- Grailed: `/shop?query=...&page=...` or `/sold?...`.
- Poshmark: `/search?query=...&type=listings&src=ac&page=...`.
- Mercari Japan: `/search?keyword=...&status=on_sale|sold_out&page=...`.
- JDirectItems through ZenMarket: `search.aspx?...&searchMode=custom&stores=28`.
- Rakuten through ZenMarket: `search.aspx?...&searchMode=custom&stores=0`.
- Rakuten Rakuma through ZenMarket: `search.aspx?...&searchMode=custom&stores=25`.
- Bunjang: `/search?q=...&page=...`.

Depop's undocumented `webapi.depop.com` search endpoints are not used.

## Worker safety

Revision: `official-page-source-marketplaces-v10`

- No Browser Run binding.
- One official URL per relay request.
- HTTPS-only marketplace allowlist.
- At most two validated redirects.
- 15-second upstream timeout.
- 5.5 MB response-source limit so large Poshmark/Rakuten pages are not cut off too early.
- Raw source is returned directly rather than JSON-encoding a multi-megabyte body.
- Search and hydration fan-out use settled-result handling.

## Local development

```powershell
npm ci
npm run dev:windows
```

Open `http://localhost:5173`.

## Optional Browser Bridge

The included `browser-extension/` is only a fallback when a marketplace blocks Cloudflare egress. It fetches the same normal marketplace URL; it does not call undocumented listing APIs.

## Deployment

Target:

```text
https://resalewebsite.unusualsuspectsclothing.workers.dev/
```

```powershell
npm ci
npm test
npm run build:windows
npm run deploy
npm run check:production
```

Expected `/api/health` fields:

```json
{
  "revision": "official-page-source-marketplaces-v10",
  "marketplaceRequests": "official-page-source-relay",
  "browserBindingAvailable": false,
  "cloudflareMarketplaceFetches": "one-official-page-per-relay-request"
}
```
