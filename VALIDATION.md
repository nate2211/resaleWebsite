# Validation — production-navigation-markets-v14

Completed in the packaging environment:

- 30 Node regression tests passed with zero failures.
- All 46 application TypeScript/TSX files transpiled with zero syntax diagnostics.
- SEO validation passed for `https://resalemasterlab.cloud-cord.com`.
- Sitemap, robots, manifest, canonical metadata, Open Graph metadata, crawler-visible page copy, JSON-LD, icons, maskable icon, screenshots, and custom-domain configuration were validated.
- Every public/tool page uses the complete sticky site navigation. At widths below 1120px it collapses into an accessible three-bar dropdown, and below 640px the dropdown becomes a single-column menu.
- The main research workspace keeps its complete internal and public-page navigation in a sticky bar. It also collapses into an accessible three-bar dropdown on smaller screens.
- Depop validation covers official search, brand, theme, and product-page URL formats; HTML/React/JSON records; readable product-card parsing; canonical `/products/` links; prices, sizes, descriptions, and first-party `media-photos.depop.com` images.
- Mercari Japan validation covers ZenMarket's normal Mercari page, cross-site search with `stores=27`, and canonical `mercariproduct.aspx?itemCode=...` listing links.
- Search All validation covers every selected marketplace, groups marketplaces in batches of three, limits same-origin relay calls to four concurrent requests, and reduces/sequences query variants when six or more markets are selected.
- Partial failures use settled-result handling so one failed marketplace, query variation, AI search, or enrichment request does not cancel successful results.
- Thrift Check source validation covers phone-camera uploads, optional cost, sold/active marketplace evidence, fee/profit math, optional computer-vision metrics, perceptual similarity, and optional local-AI summary.
- Listing Template source validation covers the required local text and vision model gate, photo captions, image metrics, marketplace evidence, editable output fields, and copyable listing text.
- Existing engagement, Grailed, Poshmark, ZenMarket/Rakuten/Rakuma/JDirectItems, AI Search, comparison, and watchlist functionality remains in the package.
- The health endpoint reports revision `production-navigation-markets-v14`, the production domain, navigation mode, marketplace scheduler limits, and the new tool availability.
- ZIP CRC and integrity checks are run after packaging.

Dependency-backed Vinext build note:

- The package deliberately excludes `node_modules`. A fresh dependency-backed Vinext production build was not completed in this packaging environment.
- `package-lock.json` is included. Cloudflare's build environment should run `npm clean-install`, `npm test`, `npm run seo:validate`, `npm run build:windows`, and `npm run deploy`.
