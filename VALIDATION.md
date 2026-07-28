# Validation — grailed-depop-results-v11

Completed in the packaging environment:

- 19 focused Node regression tests passed.
- All application TypeScript/TSX files passed `tsc --noEmit --noCheck`.
- SEO and bounded Cloudflare deployment validation passed.
- The supplied Depop readable page fixture produced 24 canonical product cards with real `media-photos.depop.com` images; sale cards used the final displayed price.
- The supplied Grailed page source yielded its public application ID, search key, active index, and sold index.
- A mocked production `/api/grailed-search` request reached the expected `*-dsn.algolia.net/1/indexes/Listing_production/query` endpoint and returned the JSON envelope intact.
- Depop `webapi.depop.com` runtime calls remain absent.
- No Browser Run binding or Browser Run code is present.

Design invariants:

- Official marketplace URLs remain the first source.
- Depop's parse-aware fallback runs only when the official source is readable but contains no product cards.
- Grailed active and sold searches use separate public listing indexes.
- Worker requests remain bounded: one official page request or one Grailed JSON index request per invocation.
- Images, titles, prices, sizes, designers, and canonical URLs stay paired per listing.
- One failed source cannot cancel successful marketplace results.
