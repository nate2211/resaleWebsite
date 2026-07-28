# Validation — all-market-images-production-v16

Completed in the packaging environment:

- 40 Node regression tests passed with zero failures.
- All 50 application TypeScript/TSX files transpiled with zero syntax diagnostics.
- SEO validation passed for `https://resalemasterlab.cloud-cord.com`.
- Sitemap, robots, manifest, canonical metadata, Open Graph metadata, crawler-visible page copy, JSON-LD, icons, maskable icon, screenshots, and custom-domain configuration were validated.
- Every public/tool page uses the complete sticky site navigation. At widths below 1120px it collapses into an accessible three-bar dropdown, and below 640px the dropdown becomes a single-column menu.
- The main research workspace keeps its complete internal and public-page navigation in a sticky bar. It also collapses into an accessible three-bar dropdown on smaller screens.
- Depop validation covers official search, brand, theme, and product-page URL formats; HTML/React/JSON records; readable product-card parsing; canonical `/products/` links; prices, sizes, descriptions, and first-party `media-photos.depop.com` images.
- ZenMarket validation covers Mercari Japan store `27`, JDirectItems store `28`, Rakuten store `0`, and Rakuma store `25`; dedicated/search-page sources; nested ASP.NET `.d` payloads; `Items` arrays; canonical product links; images; titles; and JPY prices.
- An executable mocked Mercari catalog relay retried a compatibility endpoint, returned HTTP 200, unwrapped the nested `.d` response, and preserved the official ZenMarket store-27 source URL.
- Search All validation covers every selected marketplace, uses two-market batches and three relay slots when all marketplaces are selected, uses one literal query, and limits product-page enrichment to one listing per marketplace.
- Partial failures use settled-result handling so one failed marketplace, query variation, AI search, or enrichment request does not cancel successful results.
- Thrift Check source validation covers phone-camera uploads, optional cost, sold/active marketplace evidence, fee/profit math, optional computer-vision metrics, perceptual similarity, and optional local-AI summary.
- Listing Template source validation covers the required local text and vision model gate, photo captions, image metrics, marketplace evidence, editable output fields, and copyable listing text.
- The supplied Depop readable page fixture produces 24 canonical product cards with listing links, first-party images, sizes, and sale prices.
- Existing engagement, Grailed, Poshmark, ZenMarket/Rakuten/Rakuma/JDirectItems, AI Search, comparison, and watchlist functionality remains in the package.
- The health endpoint reports revision `all-market-images-production-v16`, the production domain, navigation mode, marketplace scheduler limits, and the new tool availability.
- ZIP CRC and integrity checks are run after packaging.

Dependency-backed Vinext build note:

- The package deliberately excludes `node_modules`. A fresh dependency-backed Vinext production build was not completed in this packaging environment.
- `package-lock.json` is included. Cloudflare's build environment should run `npm clean-install`, `npm test`, `npm run seo:validate`, `npm run build:windows`, and `npm run deploy`.
