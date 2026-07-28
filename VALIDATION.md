# Validation status

Updated July 28, 2026.

Passed in this packaging environment:

- TypeScript/TSX syntax transpilation for all 32 application and route files; structural checks for the React client, deterministic analysis,
  local-model intelligence, safe public-web reader, engagement/authenticity
  research, favorites persistence, and listing-monitor API
- 45 source/regression tests: 44 passed and one rendered-preview test skipped because no production artifact is bundled. The executable Depop production fixture uses Cloudflare's current `{ success, result }` content and links envelopes, verifies rendered-link recovery, blocks the ordinary product fetch, and confirms Browser Run hydration still returns the listing price, image, and canonical URL. Coverage includes executable AI Browser Run discovery, paired Rakuten JSON-LD image/title/price/URL extraction, Depop, Mercari Japan, ZenMarket-card parsing, marketplace selection, indexed-search redirect, sold-listing, article-filter, and append-pagination fixtures
- empty-workspace checks confirming that demo listings, synthetic comparable
  prices, and generated resale projections are not preloaded
- listing-monitor checks for active, sold, removed, and unknown states, with
  sold price/date retained only from explicit public source evidence
- default UI-state checks confirming Engagement and Authenticity are expanded
  while International Markets and International Analysis remain closed
- guarded JSON-response handling, per-query failure isolation, state-safe append pagination, and non-throwing real-listing / Deep Inspection request paths
- Marketplace query orchestration now uses `Promise.allSettled` at every production fan-out boundary: per-query variations, per-market batches, the combined AI/built-in scan, international comparison scans, ZenMarket proxy requests, public-search providers, rendered/static discovery, and product hydration. A rejected source is converted into an isolated marketplace error result while fulfilled markets and previously loaded pagination results are preserved.
- article-specific search and result filters for T-shirts, sweatshirts, hoodies, knitwear, outerwear, bottoms, shoes, bags, and accessories
- The supplied current Depop search source was executed against the production parser and returned 21 unique canonical product cards; the first discounted listing retained its $34 sale price, size, image, and boosted state
- Goofish has been removed from the selectable marketplace arrays, international cards, research aliases, and FAQ source list. A dedicated AI Search card now occupies its former sixth grid position with an Include toggle, query field, status, and Run AI Search action. Legacy Goofish parser types remain internal only so older saved records do not crash.
- End-to-end route fixtures force ordinary HTTP to fail, then verify that Browser Run changes Depop and all three ZenMarket-backed adapters—JDirectItems Auction, Rakuten, and Rakuma—from `unavailable` to `live`. The AI route fixture proves direct rendered discovery returns priced eBay, Mercari US, and public Facebook Marketplace item pages plus an outside shop while filtering a built-in Depop result from the same rendered search. Rakuten remains in the built-in parallel batch and preserves paired image, title, canonical URL, and converted price.
- JSON parsing, CSS structure, shell syntax, source archive hygiene, and ZIP
  CRC/integrity validation

- Vinext 0.0.50 full-stack routing is configured with `main = "vinext/server/app-router-entry"`, the package export supported by this release. The unsupported `vinext/server/fetch-handler` custom Worker import has been removed.
- Every build command first runs `scripts/validate-vinext-entry.mjs`, which verifies the installed Vinext package export and Wrangler entry before Rolldown starts.

The rendered Worker preview test is skipped when `dist/server/index.js` is not
present. The assets-only release additionally validates that production preparation
accepts either a full-stack Vinext Worker artifact (`wrangler.json`, JavaScript, and compiled CSS) or a true static export containing `build/index.html`. The production source was transpiled with the available TypeScript compiler in no-check mode, and the full regression, SEO, JSON, TOML, CSS, shell, and archive checks passed. A dependency-backed Vinext build was attempted, but dependency installation did not complete within the packaging environment's command timeout. The source tree was therefore validated with the globally available TypeScript 5.8.3 compiler, executable route/parser fixtures, the full Node test suite, SEO/TOML/JSON checks, and archive integrity checks. No partial dependency cache, `node_modules`, `.next`, `dist`, or TypeScript build-info file is included in the ZIP.

- AI Search is a full marketplace-style card in the former Goofish position, with its own visible query field sharing the primary query state, Include control, status, and Run AI Search action. The route directly targets eBay search/item pages, Mercari US search and `/us/item/` pages, and public Facebook Marketplace search/item pages, then supplements them with static Bing RSS/HTML, DuckDuckGo, Brave, and Cloudflare Browser Run content/link extraction. It excludes only built-in adapter paths, limits each hostname to four results, keeps the literal query first, adds bounded AI query expansions, runs every selected marketplace in parallel, and force-includes Rakuten through ZenMarket in the built-in batch.
- Runtime PWA links are origin-relative, so local development loads the manifest, favicon, and install icons from port 5173 instead of the production hostname. Client API requests and server public-page reads retry transient failures, while marketplace query variations and AI page reads use bounded concurrency.
- `contentscript.js` / `ObjectMultiplex` liveness warnings were confirmed absent from the source tree and documented as injected browser-extension output rather than application listeners.
- Browse supports article, marketplace, condition, size, listed-after,
  listed-before, minimum/maximum price, newest/oldest, and price-direction filters.
- Public About, Methodology, FAQ, Contact, Accessibility, Privacy, and Terms
  routes are included in the sitemap and rendered independently of local workspace data.
- The optional assets-only `wrangler.static.toml`, `build` preparation and CSS validation,
  icons, manifest, robots, sitemap, Open Graph card, structured data, and static
  security/cache headers are packaged.


- Marketplace API responses use `Cache-Control: no-store` so empty source results cannot remain cached by browsers or Cloudflare.

- The three ZenMarket adapters are modeled separately: JDirectItems Auction uses store `28`, Rakuten uses store `0`, and Rakuma uses store `25`. Each proxy route receives static parsing and Browser Run before its original-market fallback; ZenMarket renders share a two-slot queue so selecting all three does not overload the binding. Rakuten discovery uses the captured canonical cross-site query (`/en/search.aspx?q=<query>&p=<page>&searchMode=custom&stores=0`) as its primary route. Rendered doT cards and structured AJAX/JSON records retain title, image, condition, JPY price, and the correct adapter-specific ZenMarket product URL.
- The supplied current ZenMarket search capture was executed against the production parser. It correctly returns zero static product cards because it is a JavaScript/AJAX shell, so it proceeds to Browser Run instead of producing false listings or prematurely selecting the official Rakuten fallback.
- Rakuten recovery now parses product-level JSON-LD and inline ItemList records so each title, JPY price, canonical URL, and image stays paired. Truncated item URLs are rejected, discovered images survive hydration when detail pages omit metadata, and rendered product images use `referrerPolicy="no-referrer"` to avoid referrer-based CDN failures.

- Production deployment now has one source-of-truth `wrangler.jsonc` used by both Vite and `@vinext/cloudflare deploy`. It declares the Vinext App Router entry, `BROWSER` binding, `nodejs_compat`, source maps, observability, workers.dev previews, and the existing `resalewebsite` workers.dev Worker with no custom-domain routes. The assets-only configuration moved to `wrangler.static.toml` so it cannot be selected accidentally by the production command.
- `/api/health` and every listing response expose revision `depop-workers-dev-production-v4`; `npm run check:production` fails when the domain serves an older Worker, lacks Browser Run, or returns no Depop product links.
- Depop has a rendered web-index fallback in addition to direct/rendered marketplace search. Canonical product links remain visible with an explicit price-unavailable state when product hydration is blocked, preventing a source-level anti-bot response from collapsing the marketplace to zero cards.
