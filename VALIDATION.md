# Validation — live-source-ranking-v26

Validated behavior:

- no Browser Bridge or browser-extension dependency;
- Depop uses the normal `/search/?q=` page before any fallback source;
- stale public-index links cannot win a race against the official Depop page;
- normal Depop search cards require a canonical listing slug, current positive price, meaningful title, and `media-photos.depop.com` product photo;
- discounted Depop cards use the final displayed price;
- the supplied Raf Simons Depop source produced 21 complete cards, including the target `shelfaschive_` listing at $160 with a P0 image;
- Grailed active search uses `Listing_by_listing_quality_production`;
- Grailed requests one bounded 40-hit page and never loops across `nbHits`;
- broad historical totals remain diagnostic-only as `rawNbHits` and are not shown as current inventory;
- Grailed query results must contain all meaningful query terms and reject sold/deleted/archived/inactive or stale active-index records;
- sold Grailed comparisons use `Listing_sold_production` and `sold_price`;
- current `/prd/listing/temp/...` and `/prd/listing/<id>/...` photos are accepted;
- measurement guides, `/prd/measurement-type/`, `/prd/misc/`, placeholders, and generic configuration objects never become cards;
- all marketplaces retain unique-URL pagination with a 20-page ceiling;
- ZenMarket store IDs 27, 28, 0, and 25 retain their established search and product links;
- Cloudflare challenge pages and ZenMarket error envelopes are rejected;
- all 55 supported automated tests pass;
- targeted TypeScript checks and SEO/PWA validation pass.

The uploaded source does not include project `node_modules`. A complete Vinext production build depends on installing the lockfile in an environment with normal public npm registry access.
