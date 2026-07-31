# ResaleMasterLab Depop parallel recovery v21

This build removes the Browser Bridge extension and keeps Depop inside the same-origin frontend API.

## Depop request flow

`/api/listings` races bounded public sources and returns the first source containing real product evidence:

1. Depop search, brand, theme, or product HTML, including the `/us/` route variant.
2. Depop public catalog v3/v2 responses when they are readable.
3. Jina Reader page extraction with complete link summaries.
4. Publicly indexed Depop product URLs from bounded search-index responses.

Raw 401, 403, 429, Cloudflare challenge, and “Sorry, not authorized” pages are discarded. Empty recovery returns a clean JSON product array, never a raw unavailable-page-source error message.

The Depop frontend API timeout is 30 seconds; other marketplaces keep their shorter timeout. Search results are hydrated through a bounded number of product-page requests to fill missing price, image, size, condition, seller, and description fields.

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
