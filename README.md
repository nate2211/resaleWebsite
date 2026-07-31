# ResaleMasterLab bounded marketplace pagination v25

This build preserves the first-party Depop recovery and strict real-photo Grailed cards while fixing ZenMarket multi-store recovery and Grailed post counts. It does not require a browser extension.

## Grailed request flow

1. ResaleMasterLab reads Grailed's public page-source configuration for the current Algolia application ID, public search key, and active/sold indexes.
2. `/api/grailed-search` tries the standard Algolia DNS names with both batch and single-index request formats.
3. Each active or sold request asks for exactly 40 hits from one Algolia page; `nbHits` is retained only as the available-result count and is never used as a loop bound.
4. `Load more` advances one page at a time and appends unique URLs, with a 20-page safety ceiling shared by every marketplace.
5. Only canonical `/listings/<id>-...` URLs, positive prices, meaningful titles, and first-party `/prd/listing/<id>/...` or current `/prd/listing/temp/...` photos become cards.
6. Valid index records missing card fields become bounded product-page hydration candidates.
7. The marketplace selector shows `loaded / found`, so a broad query can display `40 loaded / 36,000 found` without requesting 36,000 records.

Measurement guides, `/prd/measurement-type/`, `/prd/misc/`, logos, avatars, badges, placeholders, and generic site artwork are rejected. Active searches use `Listing_production`; sold evidence uses `Listing_sold_production` and prefers `sold_price`.

## ZenMarket request flow

The following established ZenMarket search routes are retained:

- Mercari Japan: `stores=27`
- JDirectItems Auction: `stores=28`
- Rakuten: `stores=0`
- Rakuten Rakuma: `stores=25`

For each store, `/api/zenmarket-search`:

1. Tries bounded ZenMarket catalog requests.
2. Accepts a response only when it contains complete product records; an HTTP 200 error envelope is not treated as success.
3. Rejects Cloudflare `Just a moment...` challenge HTML and ASP.NET error objects.
4. Tries the exact ZenMarket search page and dedicated store page.
5. Recovers products from the corresponding official source marketplace when ZenMarket is challenged.
6. Rebuilds each recovered result as the proper ZenMarket product URL (`mercariproduct.aspx`, `auction.aspx`, `rakutenproduct.aspx`, or `rakumaproduct.aspx`).

## Depop request flow

`/api/listings` preserves the bounded public recovery chain and suppresses raw 401, 403, 429, Cloudflare challenge, and “Sorry, not authorized” pages. Bare profile-shaped paths such as `/products/zostasho24/` are rejected. A Depop card must have a normal listing slug, a positive price, and a first-party `media-photos.depop.com` product image; the UI no longer substitutes the generic placeholder for incomplete Depop candidates.

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
