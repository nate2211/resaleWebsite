# ResaleMasterLab real Grailed listings v22

This build keeps the working same-origin Depop recovery from v21 and fixes Grailed listing extraction without a browser extension.

## Grailed request flow

1. ResaleMasterLab reads Grailed's official public page source to obtain the current public search configuration.
2. `/api/grailed-search` performs one bounded public listing-index request for active or sold listings.
3. The API removes any hit that lacks a numeric listing ID, a real title, a positive active/sold price, and a first-party listing photo.
4. Product-page hydration reads the official `__NEXT_DATA__.props.pageProps.listing` object or Product JSON-LD.
5. The frontend renders a Grailed card only when it has a canonical `/listings/<id>-...` URL, positive price, non-generic title, and a real Grailed listing photo.

Grailed configuration objects are never treated as listings. Images under `/prd/measurement-type/`, `/prd/misc/`, logos, avatars, badges, placeholders, loading artwork, and generic site images are rejected. Empty or invalid records are removed rather than rendered with placeholder cards.

## Depop request flow

`/api/listings` preserves the v21 bounded public recovery sources:

1. Depop search, brand, theme, or product HTML, including the `/us/` route variant.
2. Depop public catalog v3/v2 responses when readable.
3. Jina Reader page extraction with complete link summaries.
4. Publicly indexed Depop product URLs from bounded search-index responses.

Raw 401, 403, 429, Cloudflare challenge, and “Sorry, not authorized” pages are discarded.

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
