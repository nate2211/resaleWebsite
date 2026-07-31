# Validation — market-search-bounded-pagination-v25

Validated behavior:

- no Browser Bridge or browser-extension dependency;
- ZenMarket store IDs 27, 28, 0, and 25 retain their established query links;
- Cloudflare challenge pages and `There was an error processing the request` envelopes are rejected;
- ZenMarket success requires actual product records with title, positive price, image, and product identity;
- official Mercari Japan, Yahoo Auctions, Rakuten, and Rakuma records are converted to canonical ZenMarket product links;
- Grailed uses standard Algolia host names and both batch and single-index request formats;
- Grailed preserves `nbHits` as the post count;
- Grailed displays `N posts`, including zero, instead of treating a completed count as unavailable;
- measurement guides, `/prd/measurement-type/`, `/prd/misc/`, placeholder images, and generic config objects never become listing cards;
- only strict real listing cards or bounded canonical product-page hydration candidates are returned;
- Depop's existing first-party recovery remains in place;
- all 50 automated tests pass;
- changed Grailed and ZenMarket TypeScript paths compile in targeted checks;
- SEO, PWA, custom-domain, Thrift Check, and Listing Template validation passes.

The uploaded source did not include project `node_modules`, so a complete Vinext production build was not run. An attempted `npm ci` was blocked by the environment's internal npm mirror returning 404 for `zod-validation-error@4.0.2`; the public lockfile remains intact. Public-index, challenge-page, error-envelope, canonical-link, and post-count behavior is covered by deterministic regression fixtures and the user-provided challenge captures.


## v25 bounded pagination and strict image validation

- Grailed requests exactly 40 hits per page and never loops across `nbHits`.
- Cloudflare Edge uses `redirect: manual`, eliminating the unsupported `redirect: error` failure.
- Active and sold Grailed indexes share the same bounded page contract and expose `hasMore`/`nextPage`.
- Every marketplace can append subsequent pages until a page returns no new unique URLs, with a 20-page safety ceiling.
- Depop profile-shaped `/products/<username>/` links are rejected. Only priced products with `media-photos.depop.com` imagery become cards.
