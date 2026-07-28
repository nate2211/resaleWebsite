# ResaleMasterLab marketplace search URL recovery v17

This release keeps every production feature from v16 and corrects the marketplace selector placement, Depop product-page extraction, and the exact ZenMarket search and product-link formats supplied for Mercari Japan, JDirectItems Auction, Rakuten, and Rakuten Rakuma.

Production domain: `https://resalemasterlab.cloud-cord.com`

## v17 changes

### Marketplace selector

- The marketplace selection panel now appears directly below the Depop, Grailed, and Poshmark cards.
- The panel uses a natural-width flex layout rather than a rigid multi-column grid.
- Helper text keeps normal word spacing and never uses forced word breaking or hyphenation.
- Desktop buttons remain compact; tablet and phone layouts stack without stretched text or blank space.
- The default-market checkboxes wrap as natural pills.

### Depop

Depop continues to start with its normal public pages:

- `https://www.depop.com/search/?q=<query>&page=<page>`
- `https://www.depop.com/brands/<slug>/?page=<page>`
- `https://www.depop.com/theme/<slug>/?page=<page>`
- `https://www.depop.com/products/<listing-slug>/`

The new dedicated product-page parser reads normal HTML, embedded React/JSON, Open Graph fields, JSON-LD, and readable page-source text. It preserves:

- Canonical `/products/` URL
- First-party `media-photos.depop.com` image
- Title and description
- Published USD price
- Size
- Condition
- Brand
- Seller context

A `view-source:` prefix is stripped when a user pastes one, but runtime requests use the normal HTTPS product URL.

### ZenMarket marketplace searches

Search terms are joined with the encoded plus separator expected by the supplied ZenMarket searches. The exact store-filter searches are:

- Mercari Japan: `stores=27`
- JDirectItems Auction: `stores=28`
- Rakuten: `stores=0`
- Rakuten Rakuma: `stores=25`

All use:

```text
https://zenmarket.jp/en/search.aspx?q=<encoded-query>&p=<page>&searchMode=custom&stores=<store-id>
```

Result cards normalize to ZenMarket's normal root product routes:

```text
https://zenmarket.jp/mercariproduct.aspx?itemCode=...
https://zenmarket.jp/auction.aspx?itemCode=...
https://zenmarket.jp/rakutenproduct.aspx?itemCode=...
https://zenmarket.jp/rakumaproduct.aspx?itemCode=...
```

The parser retains `q`, `p`, `pos`, and `cs` when they are present in the source link. It accepts both root and `/en/` source links, nested ASP.NET `.d` payloads, `Items` arrays, and serialized `ItemCode` records, then emits one canonical root product URL.

### Bounded production requests

- All-market mode continues to use two marketplaces per outer batch.
- At most three same-origin relay requests are active globally.
- Only the literal query is used when six or more markets are selected.
- ZenMarket compact catalog attempts are bounded to three endpoints.
- Page-source fallbacks run sequentially inside each marketplace.
- Product-page enrichment is limited to one listing per marketplace in all-market mode.
- Failed relays return a partial HTTP 200 envelope so the frontend can continue to the browser bridge without console 502 floods.
- No Cloudflare Browser Run binding is configured.

## Existing production features retained

- Complete sticky responsive navbar on every page
- Thrift Check with image upload/camera, profit math, sold analysis, optional vision, and optional local AI
- Listing Template with local image captioning, local text generation, and market-bounded pricing
- Depop, Grailed, Poshmark, Mercari Japan, JDirectItems, Rakuten, Rakuma, Bunjang, Goofish/Superbuy compatibility, and AI Search
- Grailed active/sold public-index search and nested image extraction
- Nonfatal engagement analysis
- Sitemap, robots, manifest, icons, screenshots, canonical metadata, Open Graph, Twitter cards, and JSON-LD

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

## Limitations

Marketplace pages can change or block datacenter traffic. The included browser bridge remains the fallback when an official page blocks the lightweight Cloudflare relay. Results are public planning evidence and should be verified on the original listing before purchase or publication.
