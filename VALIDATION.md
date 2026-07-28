# Validation — production-thrift-listing-v13

Completed in the packaging environment:

- 27 Node regression tests passed.
- All 45 application TypeScript/TSX files transpiled with zero syntax diagnostics.
- SEO validation passed for `https://resalemasterlab.cloud-cord.com`.
- Sitemap, robots, manifest, canonical metadata, Open Graph metadata, crawler-visible page copy, JSON-LD, icons, maskable icon, screenshots, and custom-domain configuration were validated.
- Thrift Check source validation covers phone-camera uploads, optional cost, sold/active marketplace evidence, fee/profit math, optional computer-vision metrics, perceptual similarity, and optional local-AI summary.
- Listing Template source validation covers the required local text and vision model gate, photo captions, image metrics, marketplace evidence, editable output fields, and copyable listing text.
- The navigation remains sticky on desktop and mobile layouts.
- Existing engagement, Depop, Grailed, Poshmark, Mercari Japan/ZenMarket, Rakuten, Rakuma, JDirectItems, AI Search, comparison, and watchlist functionality remains in the package.
- The health endpoint reports revision `production-thrift-listing-v13` and the new tool availability.
- ZIP CRC and integrity checks are run after packaging.

Dependency-backed Vinext build note:

- The packaging environment's npm mirror returned HTTP 503 while retrieving one dependency, so a fresh `npm ci` and full Vinext production build could not be completed here.
- `package-lock.json` is included. Cloudflare's build environment should run `npm clean-install` followed by `npm run build:windows` and `npm run deploy`.
