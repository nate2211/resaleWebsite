# ResaleMasterLab frontend-API Depop recovery v20

This release removes the Browser Bridge extension and restores Depop to the first-party ResaleMasterLab frontend/API flow used by the earlier working marketplace builds.

Production domain: `https://resalemasterlab.cloud-cord.com`

## Depop request order

For each Depop search, the frontend tries the normal public marketplace pages in this order:

1. `https://www.depop.com/search/?q=<query>&page=<page>`
2. `https://www.depop.com/brands/<slug>/?page=<page>`
3. `https://www.depop.com/theme/<slug>/?page=<page>`

Every URL is requested through the same-origin `/api/listings` route. No Chrome/Edge extension, injected page script, background tab, or browser message bridge is included or used.

The API applies bounded recovery instead of returning raw denial HTML:

- official Depop HTML/React page source first;
- readable Markdown page source when the origin returns a challenge or no cards;
- indexed public `/products/` links for search/brand/theme pages when both page-source paths are empty;
- up to four product pages hydrated through the same API to recover missing title, image, price, size, condition, brand, seller, and description fields.

Raw `Sorry, not authorized` and `403 Forbidden` pages are detected and discarded before the frontend parser sees them.

## Other retained features

- Depop, Grailed, and Poshmark selected by default
- Grailed public page-source plus bounded public-index fallback
- International marketplace panel with Mercari Japan, JDirectItems Auction, Rakuten, Rakuten Rakuma, and Bunjang
- ZenMarket store IDs 27, 28, 0, and 25
- AI Search, favorites, watchlist, compare, import, authenticity, engagement, fee/profit analysis, and local browser AI
- Thrift Check and Listing Template
- Sticky responsive navigation, SEO pages, sitemap, robots, manifest, icons, Open Graph, and JSON-LD
- Bounded request queues and partial-failure handling

## Run and deploy

```powershell
npm ci
npm test
npm run seo:validate
npm run build:windows
npm run deploy
npm run check:production
```

Cloudflare Git builds should use Node 22, build command `npm run build:windows`, and deploy command `npm run deploy`.
