# ResaleMasterLab ZenMarket + Grailed posts v24

This build preserves the first-party Depop recovery and strict real-photo Grailed cards while fixing ZenMarket multi-store recovery and Grailed post counts. It does not require a browser extension.

## Grailed request flow

1. ResaleMasterLab reads Grailed's public page-source configuration for the current Algolia application ID, public search key, and active/sold indexes.
2. `/api/grailed-search` tries the standard Algolia DNS names with both batch and single-index request formats.
3. The API preserves Grailed's `nbHits` value as the total post count while separately filtering the returned records.
4. Only canonical `/listings/<id>-...` URLs, positive prices, meaningful titles, and first-party `/prd/listing/<id>/...` photos become cards.
5. Valid index records missing card fields become bounded product-page hydration candidates.
6. The marketplace selector shows `N posts` whenever Grailed returns a completed count, including `0 posts`, rather than incorrectly showing `unavailable`.

Measurement guides, `/prd/measurement-type/`, `/prd/misc/`, logos, avatars, badges, placeholders, and generic site artwork are rejected.

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

`/api/listings` preserves the bounded v21 public recovery chain and suppresses raw 401, 403, 429, Cloudflare challenge, and “Sorry, not authorized” pages.

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
