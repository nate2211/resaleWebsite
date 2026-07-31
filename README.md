# ResaleMasterLab live marketplace source ranking v26

This build restores Depop from its normal search and product pages, ranks Grailed through the current listing-quality index, preserves bounded pagination, and keeps the ZenMarket multi-store recovery. It does not require a browser extension.

## Depop request flow

1. The frontend uses the normal search URL: `https://www.depop.com/search/?q=<query>&page=<page>`.
2. `/api/listings` tries the official Depop page first. Public catalog data, readable-page recovery, and indexed links are fallback tiers rather than a race that can let stale indexed links win.
3. The search-page parser reads complete server-rendered product cards: canonical `/products/<seller>-<item>-<id>/` URL, title, brand, size, current price, and first-party `media-photos.depop.com` P0 image.
4. Discounted cards prefer the final displayed price instead of the struck-through original price.
5. Product-page hydration remains available for incomplete candidates.
6. Bare profile-shaped product paths, navigation artwork, Contentful tiles, placeholders, avatars, QR codes, and incomplete indexed links never become product cards.

The supplied `raf simons` search source parses into 21 current products, including the `shelfaschive_` AW05 Peter De Potter listing with its real P0 image and discounted $160 price.

## Grailed request flow

1. ResaleMasterLab reads Grailed's public page-source configuration.
2. Active searches use `Listing_by_listing_quality_production`, matching the ranking index exposed in current Grailed listing links. Sold comparisons continue to use `Listing_sold_production` and prefer `sold_price`.
3. `/api/grailed-search` requests one page of 40 hits. It never loops over the broad Algolia `nbHits` value.
4. Multiword queries use strict syntax, and returned hits must contain every meaningful query token in the title, designer, brand, description, or category evidence.
5. Sold, removed, deleted, archived, inactive, or very old unmodified active-index rows are rejected.
6. Results are ranked by exact query relevance and recent listing activity.
7. The raw broad index total is retained as `rawNbHits` for diagnostics only. The UI reports the validated current rows loaded, so a historical `93,000` count is not presented as current inventory.
8. `Load more` advances one bounded page at a time, appends unique listing URLs, and stops after 20 pages.
9. Only canonical `/listings/<id>-...` URLs, positive prices, meaningful titles, and first-party `/prd/listing/<id>/...` or `/prd/listing/temp/...` photos become cards.

Measurement guides, `/prd/measurement-type/`, `/prd/misc/`, logos, avatars, badges, placeholders, and generic configuration images remain rejected.

## ZenMarket request flow

The established store routes remain:

- Mercari Japan: `stores=27`
- JDirectItems Auction: `stores=28`
- Rakuten: `stores=0`
- Rakuten Rakuma: `stores=25`

The relay rejects Cloudflare challenge pages and HTTP 200 error envelopes, accepts only complete products, tries exact ZenMarket and dedicated store pages, recovers from official source marketplaces, and rebuilds normal ZenMarket product links.

## Run

```bash
npm install
npm run dev
```

## Validate

```bash
npm test
npm run seo:validate
```
