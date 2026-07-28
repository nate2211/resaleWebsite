# Validation — official-page-source-marketplaces-v10

Completed in the packaging environment:

- 17 focused Node regression tests passed.
- Full TypeScript no-check validation passed.
- Official Depop, Grailed, Poshmark, Mercari Japan, ZenMarket, Rakuten, Rakuma, Yahoo Auction, and Bunjang URL contracts are present.
- Depop `webapi.depop.com` search calls are absent from runtime source and extension permissions.
- Frontend parsers cover JSON-LD, Next data, initial state, React Flight, HTML cards, canonical metadata, and reader markdown.
- Product-page enrichment is capped at eight listings and three concurrent requests.
- The relay has no Browser Run, DOM parser, AI, search-engine crawl, or server-side hydration loop.
- `wrangler.jsonc`, package JSON, extension manifest, and application sources validated successfully.

Design invariants:

- Normal marketplace search pages are always tried first.
- The Worker receives one exact source URL per request.
- Raw upstream source is returned with status/final-URL metadata headers.
- One failed page or product hydration cannot cancel successful marketplace results.
- Images are kept paired with the same structured listing record and icon/logo URLs are rejected.
- `/api/health` reports revision `official-page-source-marketplaces-v10`.
