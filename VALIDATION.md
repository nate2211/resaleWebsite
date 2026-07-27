# Validation status

Updated July 27, 2026.

Passed in this packaging environment:

- TypeScript/TSX syntax transpilation for the complete application, route, and Worker tree; structural checks for the React client, deterministic analysis,
  local-model intelligence, safe public-web reader, engagement/authenticity
  research, favorites persistence, and listing-monitor API
- 35 source/regression tests: 34 passed and one rendered-preview test skipped because no production artifact is bundled. Coverage includes executable Depop, Mercari Japan, Goofish/Superbuy, indexed-search redirect, sold-listing, article-filter, and append-pagination fixtures
- empty-workspace checks confirming that demo listings, synthetic comparable
  prices, and generated resale projections are not preloaded
- listing-monitor checks for active, sold, removed, and unknown states, with
  sold price/date retained only from explicit public source evidence
- default UI-state checks confirming Engagement and Authenticity are expanded
  while International Markets and International Analysis remain closed
- guarded JSON-response handling, per-query failure isolation, state-safe append pagination, and non-throwing real-listing / Deep Inspection request paths
- article-specific search and result filters for T-shirts, sweatshirts, hoodies, knitwear, outerwear, bottoms, shoes, bags, and accessories
- The supplied current Depop search source was executed against the production parser and returned 21 unique canonical product cards; the first discounted listing retained its $34 sale price, size, image, and boosted state
- Superbuy/Xianyu discovery now combines the exact `platform=xy` page, direct Goofish search, a Cloudflare Browser Run rendered-content and rendered-links fallback, Bing RSS, Bing HTML, and DuckDuckGo HTML; canonical item URLs remain visible with an explicit unknown price when item-page hydration is blocked
- End-to-end route fixtures force ordinary HTTP to fail, then verify that the Browser Run fallback changes both Depop and Goofish API responses from `unavailable` to `live`, including priced Depop cards and Goofish Superbuy handoff links
- JSON parsing, CSS structure, shell syntax, source archive hygiene, and ZIP
  CRC/integrity validation

The rendered Worker preview test is skipped when `dist/server/index.js` is not
present. The assets-only release additionally validates that production preparation
accepts either a full-stack Vinext Worker artifact (`wrangler.json`, JavaScript, and compiled CSS) or a true static export containing `build/index.html`. The production source was transpiled with TypeScript 5.8 in no-check mode, and the full regression, SEO, JSON, TOML, CSS, shell, and archive checks passed. A dependency-backed Vinext build was attempted, but the packaging environment's internal npm registry returned repeated HTTP 503 responses while installing dependencies. The source tree was therefore validated with the globally available TypeScript 5.8.3 compiler, executable route/parser fixtures, the full Node test suite, SEO/TOML/JSON checks, and archive integrity checks. No partial dependency cache, `node_modules`, `.next`, `dist`, or TypeScript build-info file is included in the ZIP.

- AI Search remains a checkbox-only public-web target with no custom domain or
  secondary query field.
- Browse supports article, marketplace, condition, size, listed-after,
  listed-before, minimum/maximum price, newest/oldest, and price-direction filters.
- Public About, Methodology, FAQ, Contact, Accessibility, Privacy, and Terms
  routes are included in the sitemap and rendered independently of local workspace data.
- The requested assets-only `wrangler.toml`, `build` preparation and CSS validation,
  icons, manifest, robots, sitemap, Open Graph card, structured data, and static
  security/cache headers are packaged.


- Marketplace API responses use `Cache-Control: no-store` so empty source results cannot remain cached by browsers or Cloudflare.
