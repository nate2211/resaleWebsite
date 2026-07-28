# ResaleMasterLab

ResaleMasterLab searches and compares eight selectable resale sources, with only Depop,
Grailed, and Poshmark enabled by default. Five international marketplace sources are opt-in
and stay fully inactive while their collapsed sections are closed. A dedicated AI Search card
occupies the sixth position in the international grid:

- Mercari Japan active listings plus optional `status=sold_out` evidence
- JDirectItems Auction through the current ZenMarket JDirectItems storefront, its legacy `stores=28` route, and public Yahoo Auctions product-page fallback
- Rakuten through ZenMarket’s canonical cross-site `search.aspx` route (`searchMode=custom&stores=0`) first, followed by the official server-rendered Rakuten search
- Rakuten Rakuma through the current ZenMarket Rakuma storefront, its legacy `stores=25` route, and public Rakuma product-page fallback
- Bunjang through its direct Global Bunjang search
- AI Search for rendered public secondhand discovery on eBay, Mercari US, public Facebook Marketplace item pages, and other outside resale sites; its Run button also includes Rakuten through ZenMarket in the same batch

Closing **International Markets** deselects those sources, aborts outstanding
international requests, clears their live cards, and keeps domestic results.
Deep Inspection runs Grailed sold research independently; expanding
**International Analysis** launches the five overseas marketplace searches and Mercari Japan
sold inspection, then shows only rows with readable comparable evidence.

When the sitewide AI is enabled, it produces targeted query variations before
each selected marketplace request and influences comparable matching,
valuation, estimated profit, ranking, and AI Research recommendations. The
existing backend memory records searches, returned/sold results, favorites,
listing-link clicks, navigation, and AI interactions.



### Production API deployment

The requested root `wrangler.toml` remains an assets-only SPA configuration.
That mode can serve the compiled interface, but static assets cannot execute
`/api/listings`, `/api/engagement`, authenticity, monitoring, or AI route
handlers. Use the full-stack Vinext deployment command when marketplace data
must work in production:

```powershell
npm run deploy
```

This runs Vinext's Cloudflare Worker deployment workflow so the App Router API
handlers and frontend are deployed together. Use `npm run deploy:static` only
when intentionally publishing a frontend-only build whose server APIs live
somewhere else.


The `/api/listings` route uses several public discovery paths for sources whose
catalog HTML can vary by region or return an access-control page to a Worker:

1. the verified marketplace or buying-agent query route;
2. static parsing of the preferred proxy source;
3. an on-demand Cloudflare Browser Run render of ZenMarket when its initial HTML is
   only a JavaScript shell;
4. the official Rakuten catalog only after the preferred ZenMarket source produced no
   canonical product cards;
5. indexed public product URLs; and
6. the underlying Yahoo Auctions, Rakuten, or Rakuma public product page.

Every discovered URL is hydrated individually. One blocked page does not fail
the complete marketplace request. If an item page cannot be read, the app keeps
the search-card result only when its public title, product URL, and real currency
price are readable. Missing prices are never invented. API responses include a
`diagnostics` object with attempted direct URLs, successful/failed discovery
batches, discovered URL count, and hydrated card count.

Example local checks:

```text
/api/listings?marketplace=JDirectItems%20Auction&q=raf%20simons&category=All&page=0
/api/listings?marketplace=Rakuten&q=raf%20simons&category=All&page=0
/api/listings?marketplace=Rakuten%20Rakuma&q=raf%20simons&category=All&page=0
```

## International landed-cost assumptions

Prices are normalized to planning USD values and international sources add an
estimated proxy/service charge, origin shipping, international shipping,
currency-conversion reserve, and customs reserve to inbound cost. Current defaults use a 500 JPY ZenMarket proxy estimate, with editable/reviewable calculations in the listing inspector.
Customs remains an estimate because the actual U.S. rate depends on origin,
material, HTS classification, carrier, and entry method. The calculator does
not assume duty-free treatment below $800.

ResaleMasterLab is a React + Vite resale-research app for evaluating public
listings across domestic, international, and open-web sources. It combines indexed public listing discovery, direct marketplace browsing, and
a private local analysis workspace. Search selected marketplaces from one
screen, load additional batches, and automatically match related listings
before calculating resale opportunities.

## Main features

- Discover and hydrate real public Depop, Grailed, and Poshmark listing pages.
- Query each marketplace's real search-results URL first. When Depop or ZenMarket-backed Rakuten returns only a JavaScript
  shell to ordinary HTTP, render the public results through the configured
  Cloudflare Browser Run binding before allowing original-market or indexed
  discovery to take over.
- Load up to five result batches per query, deduplicate repeated listings, and append each new unique page beneath the current cards without replacing earlier results.
- Prevent overlapping scans when the search button is clicked repeatedly.
- Target and filter clothing by article type, including T-shirts, long-sleeve T-shirts, sweatshirts, hoodies, knitwear, button-ups, polos, tank tops, jackets, jeans, pants, shorts, dresses/skirts, shoes, bags, and accessories.
- Filter loaded results by dynamically discovered article type, brand, marketplace, size, condition, minimum price, and maximum price.
- Read public listing dates when exposed and filter by listed-after/listed-before dates.
- Sort Browse results by newest, oldest, price ascending, price descending,
  discovery order, AI relevance, brand, or resale deal score.
- Keep discovery order as the default so later pages append at the bottom; optionally sort by AI relevance, ascending price, descending price, brand, or resale deal score.
- Start every workspace with only Depop, Grailed, and Poshmark selected.
- Keep five international marketplace cards plus an AI Search card under a collapsed
  opt-in section; closing it deselects those sources, aborts their requests, and clears
  their live results.
- Keep Grailed sold research running inside Deep Inspection even when
  International Analysis is collapsed.
- Search Mercari Japan sold results plus all five international marketplace sources
  only after International Analysis is expanded, and hide empty international
  comparison rows instead of rendering placeholder “No comps” entries.
- Parse Grailed's rendered sold-result cards directly so the historical
  “Sold For” amount is retained even when an archived listing page exposes
  incomplete or different metadata.
- If Grailed serves an incomplete HTML shell, read its public browser-search
  configuration and query the matching active or sold public index, then merge
  and deduplicate those cards with rendered-page and indexed-web discovery.
- Keep Grailed routes strictly separated: `/shop?query=...` for normal browsing
  and active comparisons; `/sold?query=...` only for Deep Inspection and AI
  resale analysis.
- Try several intelligent Grailed sold-query variations—exact title,
  normalized punctuation, removed size, removed season/color, and Tee/T-Shirt—
  across two batches in Deep Inspection, with every query and result count
  visible in the interface.
- Retain real comparable listing URLs for Depop, Grailed, and Poshmark so
  comparable cards can be opened from Deep Inspection.
- Favorite listings through the app backend with local-workspace persistence,
  and optionally rank favorites and similar pieces before other results.
- Load SmolLM2-135M-Instruct locally in the browser through Transformers.js,
  with WebGPU when available and WASM fallback.
- Load the local browser model directly from the navbar by clicking
  **AI not ready · Load**, with a readable loading/ready/error state.
- Keep the loaded model alive while navigating between every ResaleMasterLab page,
  show its global state in the header, and release it only when the user clicks
  **Unload model** or closes/reloads the tab.
- Use the local model to propose specific marketplace query variants before
  collection, then ground its recommendation in the retrieved listing cards.
- Submit the header search directly into the live multi-market fetch pipeline;
  when AI is loaded, its query variants are fetched and merged automatically.
- Apply an optional site-wide AI instruction to search planning, opportunity
  ranking, minimum-profit/ROI preferences, and bounded resale-value estimates.
- Learn from searches, returned and sold results, favorites, listing/source
  clicks, section navigation, and AI conversations through the memory backend,
  with browser persistence restoring the history between local sessions.
- Render ranked opportunities directly in chat with product images, source
  links, sold/active comparison links, prices, expected profit, and ROI.
- Compare available listing images locally using a compact browser-side visual
  signature. Visual evidence affects ranking when cross-origin image access is
  available and is reported as unavailable instead of guessed when blocked.
- Route natural-language requests such as “find Supreme pieces on Depop to
  resell on Grailed” into source listings, target active comps, exact-title
  Grailed sold checks, fee calculations, and ranked candidate cards.
- Ground the research chat in favorites, current results, fresh marketplace
  requests, and current web-fashion research snippets.
- Show marketplace requests, evidence counts, candidate scoring, and local
  model status both in the chat and in a visible research activity trace.
- Inspect Depop product pages for public seller username, shop URL, total items
  sold, activity signal, rating, and review count.
- Automatically match similar brand/title listings across marketplaces.
- Import a public listing URL using JSON-LD or Open Graph metadata when the
  marketplace makes that metadata available.
- Manual import fallback when a marketplace blocks automated metadata access.
- Compare source price, inbound shipping, expected resale, selling fees,
  outbound shipping, risk reserve, net profit, ROI, margin, and confidence.
- Rank opportunities with an explainable deal score.
- Compare up to four listings side by side.
- Store real imported, favorited, and watched listing snapshots, settings, and
  listing-monitor checks in browser local storage.
- Restore Browse query, article/date/price filters, sorting, selected sources,
  favorites, watchlist, analyses, and model preferences from browser storage.
- Export the workspace as JSON or opportunity data as CSV.
- Responsive ResaleMasterLab interface for desktop, tablet, and mobile.
- System-font rendering with no remote Inter font files or font-asset 404s.
- Start with an empty workspace: no demo listings, synthetic comps, or generated resale prices are preloaded.
- Recheck favorite and watched listing URLs for active, sold, removed, or unknown status.
- Record sold price and sold date only when the public source page publishes them.
- Use the loaded local model to summarize ambiguous watch evidence without overriding confirmed source states or inventing values.

## Requirements

- Node.js 22.13 or later
- npm

## Start on Windows

1. Extract the ZIP.
2. Open the `resalemasterlab` folder.
3. Double-click `START_WINDOWS.bat`.
4. Open the local URL displayed in the terminal.

Or run this in PowerShell:

```powershell
npm install
npm run dev
```

Windows production build:

```powershell
npm run build
npm run start
```

## Start on macOS or Linux

```bash
npm install
npm run dev
```

## How to use ResaleMasterLab

1. Optionally enter a persistent instruction in **AI instruction**.
2. Enter a brand or product in the top search box and press Enter to fetch it.
3. In **Browse**, select an article type such as T-Shirts, Sweatshirts, or Hoodies, then refine marketplaces, filters, and sort order.
4. Open **International Markets** only when you want the five overseas sources or optional AI Search.
5. Review automatic cross-market matches or load another result batch.
6. Choose **Import**, paste the URL, and select **Inspect public metadata**.
7. Verify the imported title, price, size, condition, image, and shipping.
8. Enter comparable prices found on each marketplace.
9. Add the listing to Research and inspect the fee, profit, ROI, confidence,
   evidence, and risk breakdown.
10. Expand **International Analysis** when overseas comparable evidence is needed.
11. Add strong candidates to Favorites, Watchlist, or Compare.
12. Open **Favorites & Watchlist** and select **Check favorite listings** to refresh public active/sold/removed status.
13. Deep Inspection opens Engagement and Authenticity automatically; International Analysis remains closed until requested.

## Marketplace access

Marketplaces commonly use sign-in walls, rate limits, bot controls,
`X-Frame-Options`, and Content Security Policy. A normal web app cannot promise
to embed every authenticated page, and this project does not bypass those
controls.

ResaleMasterLab therefore uses two supported paths:

- **Full browsing:** the real marketplace opens in a normal tab.
- **Analysis:** the same-origin `/api/inspect` route attempts to read public
  structured metadata from a pasted listing URL. It follows only a short chain
  of redirects that remain on an allowed marketplace domain. It never accepts
  credentials, solves challenges, spoofs a signed-in session, or fetches an
  arbitrary host.

If metadata inspection receives a denial or rate limit, use manual import. The
original listing remains the source of truth.

Grailed sold cards provide historical market evidence, but a displayed amount
may be the archived listing price rather than a private accepted-offer amount.
Depop's “items sold” value is the seller's total shop history, not proof that
the inspected piece sold.

## Fee presets

The included US presets were reviewed on July 25, 2026:

- Depop: no US seller commission, with a 3.3% + $0.45 Depop Payments processing
  preset. Boosting is excluded.
- Grailed: 6% commission below $120 with a $1.99 minimum, or 9% at $120 and
  above. ResaleMasterLab also uses a clearly labeled 3.49% + $0.49 planning estimate
  for variable payment processing.
- Poshmark: $2.95 for sales below $15 and 20% for sales of $15 or more.

Official policy pages:

- [Depop seller fees and charges](https://depophelp.zendesk.com/hc/en-gb/articles/360001791127-Seller-fees-and-charges)
- [Grailed fees](https://support.grailed.com/hc/en-us/articles/30282580172045-What-are-the-fees)
- [Grailed payment processing](https://support.grailed.com/hc/en-us/articles/30299544492301-Does-Grailed-charge-a-payment-processing-fee)
- [Poshmark selling fees](https://support.poshmark.com/s/article/297755057)

Fee rules can change, and promotions, taxes, shipping discounts, boosting,
country, payment method, or account-specific terms can change the final payout.
Confirm the fee shown by the marketplace before buying inventory or listing an
item.

## Scoring model

ResaleMasterLab calculates each marketplace target using:

```text
landed cost = source ask + inbound shipping
net profit  = expected sale - selling fees - outbound shipping
              - risk reserve - landed cost
ROI         = net profit / landed cost
margin      = net profit / expected sale
```

The deal score combines projected ROI, margin, comparable-price evidence,
seller history, listing age, and recorded risk flags. It is a research aid—not
a guarantee that an item is authentic, will sell, or will achieve the expected
price.

## Project structure

```text
app/
  api/inspect/route.ts   public-metadata listing inspector
  api/listings/route.ts  paginated public listing discovery and hydration
  api/watch-status/      guarded public active/sold/removed listing checks
  lib/watch-status.ts    sold state, price, date, and evidence extraction
  lib/analysis.ts        fee rules and evidence-only opportunity scoring
  lib/apparel.ts         clothing article taxonomy and title/category inference
  globals.css            commercial ResaleMasterLab visual system
  layout.tsx             application metadata and font
  page.tsx               interactive research application
public/
  data/                  offline brand, category, and inspection reference
  favicon/icons/og-card  search, install, and social preview assets
worker/
  index.ts               Cloudflare Worker and static-asset entry
wrangler.toml            Cloudflare deployment and asset binding
app/about,faq,...         server-rendered public, legal, and trust pages
```

The app runs on React 19 through Vinext, a Vite-based full-stack runtime,
and deploys as a Cloudflare Worker with static assets. No application API key
or database is required for the browser-persistent workspace.

## Marketplace engagement and popularity research

Deep Inspection now includes an opt-in **Marketplace engagement** panel for
reads only public listing state and normalizes whichever signals each marketplace exposes:

- item likes, favorites, or Grailed listing followers
- public views, clicks, comments, offers, and Poshmark shares
- listing age, sold status, and engagement velocity
- seller followers, completed sales, rating, trust, and recent activity
- Depop boost status, so paid visibility is not confused with organic interest

The reader checks embedded marketplace state, React/Next/Vue hydration data,
JSON-LD, meta tags, visible counters, and public date labels before giving up on
a field. It understands abbreviated counts such as `1.2K` and relative listing
dates. The result is an age-adjusted 0–100 popularity estimate with a separate
confidence and evidence-completeness score. A metric stays **unknown** only when
the fetched public page does not publish a readable value; it is never silently
converted to zero. Poshmark shares receive deliberately low weight, and
a boosted Depop listing receives a caveat and small score reduction.

AI Research requests engagement reports for its highest-ranked domestic
candidates, shows the scores on candidate cards, and includes the exact metrics
in the local model prompt. Popularity is only a bounded secondary ranking
signal; sold-price evidence, fees, landed cost, expected profit, and image
matching remain primary. Engagement measures attention, not guaranteed demand,
authenticity, or future resale value.

## Authenticity reference research

Deep Inspection now includes an opt-in **Authenticity research** panel. It builds
an evidence report from:

- SupremeCommunity season pages and individual `/season/itemdetails/...` pages
- Dover Street Market collection and product pages
- END. brand/product JSON-LD and public product metadata
- SSENSE designer/product JSON-LD and public product metadata

The report normalizes product names, source URLs, reference prices, colorways,
materials, seasons, and release details when those fields are publicly exposed.
It compares that evidence with the listing title, stated brand, description,
price, and photo coverage. Results are deliberately labeled
**reference consistent**, **inconclusive**, or **high risk**—never “certified
real.” The panel also lists missing seller photos and links directly to every
reference used.

When the local browser model is loaded, it receives only the displayed sourced
evidence and writes a cautious explanation of the matches, gaps, and next
verification steps. AI Research also builds reference reports for its top
ranked candidates and includes those reports in the grounded recommendation.

## Guarded public-web tools

The AI Research controller can plan public-web searches, read returned HTML,
follow normal public links, and inspect linked CSS or JavaScript as inert text.
It does not execute third-party scripts. The server rejects credentials,
non-HTTPS URLs, nonstandard HTTPS ports, localhost and common private/reserved
IP ranges, oversized responses, and excessive redirects. It does not sign in,
solve bot challenges, bypass access controls, submit forms, or read private
pages. Web content is evidence for the model, not executable instructions and
not permanent model training.

## Site-wide local-model intelligence

Loading the browser model now changes the working analysis instead of only
writing an explanation. Its bounded structured outputs participate in:

- marketplace query expansion and AI Research intent/query planning
- semantic result inclusion and live-result reranking
- expected-resale multipliers within conservative limits
- deal score, confidence, engagement interpretation, and authenticity risk
- Research, Browse, Compare, Watchlist, candidate ranking, and CSV export
- favorite/brand affinity and recent-query context

Hard evidence remains authoritative. The model cannot erase sold-price math,
turn missing engagement into zero, certify authenticity, or make large price
changes. Every AI adjustment is clamped and shown with a short explanation.

## Search unfamiliar marketplaces and shops

The collapsed **International Markets** section includes **AI Search** as a
simple optional marketplace target. It has no separate domain or query form:
checking it includes public-web discovery in the same **Load real listings**
action used by the built-in marketplaces. It works with the exact search query
when the local model is not loaded; when the model is ready, bounded query
expansion and reranking improve discovery.

AI Search reads only public HTTPS pages, extracts structured product titles,
prices, images, descriptions, dates, and source hostnames when exposed, and
keeps each original listing URL. It explicitly searches eBay item pages,
Mercari US `/us/item/` pages, and public Facebook Marketplace item pages while
still excluding the built-in Depop, Grailed, Poshmark, Mercari Japan,
ZenMarket/Rakuten, Rakuma, Bunjang, and legacy Superbuy adapters. It first tries
the official public search pages plus static Bing RSS/HTML, DuckDuckGo, and Brave discovery;
when the full-stack Cloudflare deployment exposes the BROWSER binding, Browser
Run renders search pages, retrieves rendered links, and reads JavaScript-heavy
product pages before metadata extraction. The same AI action separately runs
all selected built-in marketplace adapters and always includes Rakuten through
ZenMarket in that parallel batch. When JDirectItems Auction, Rakuten, and Rakuma
are selected together, the client labels them as a three-store ZenMarket batch;
the server keeps their store identities (`28`, `0`, and `25`) separate and
limits Browser Run to two simultaneous ZenMarket renders so all three can finish.
Closing International Markets aborts and
clears these requests. It never signs in, accesses private hosts, uses
nonstandard ports, or bypasses CAPTCHA/bot protection.


## Development console notes

- `contentscript.js`, `ObjectMultiplex`, `app-init-liveness`, and
  `background-liveness` messages are injected by a browser extension rather
  than emitted by this repository. Test localhost in an extension-free browser
  profile or disable the wallet/provider extension for `localhost` to remove
  those warnings; increasing this app's listener limit would only hide an
  external extension problem.
- The React DevTools download notice is expected in development mode and is not
  included as an application error in a production build.
- Manifest, favicon, and install-icon links are origin-relative. Local
  development therefore requests them from `http://localhost:5173` instead of
  trying to resolve the production domain.
- Listing APIs automatically retry transient network/status failures and bound
  query/page concurrency so a Wi-Fi or interface change is less likely to lose
  the full scan.
- Marketplace searches use settled-result aggregation rather than fail-fast
  `Promise.all`. Every selected marketplace, query variation, ZenMarket provider,
  AI search, rendered browser request, and hydration task is allowed to finish.
  Failed sources receive their own error status while successful listings and
  previously loaded pagination results remain visible.


## Depop production rendering

The production Depop adapter decodes Cloudflare Browser Run Quick Action
responses before parsing them. Current Worker bindings wrap rendered HTML as
`{ "success": true, "result": "<html>..." }`; the adapter extracts `result`
while remaining compatible with raw-HTML local fixtures. If a rendered Depop
search page exposes only product links, the adapter calls the Browser Run
`links` action, keeps canonical `/products/` URLs, and renders the individual
product page when an ordinary Worker fetch cannot recover a public price or
image. A failed Depop source remains isolated from every other marketplace.

Production Depop requires the full-stack deployment:

```powershell
npm ci
npm test
npm run deploy
```

Do not use `npm run deploy:static` for a release that needs Depop or any other
same-origin `/api/*` marketplace route.

## Production deployment to Cloudflare

1. Copy `.env.example` to `.env.production` and set `NEXT_PUBLIC_SITE_URL` to
   the final HTTPS domain.
2. Install the locked dependencies with `npm ci`.
3. Authenticate with Cloudflare using `npx wrangler login`.
4. Run `npm run seo:validate`, `npm run lint`, and `npm run build`.
5. Deploy the full-stack Worker, API routes, client assets, and Browser Run
   binding with `npm run deploy`. Use `npm run deploy:static` only for a
   deliberately frontend-only release.
6. Attach the custom domain in Cloudflare and verify that `/robots.txt`,
   `/sitemap.xml`, `/manifest.webmanifest`, `/about`, `/methodology`, `/faq`,
   `/contact`, `/accessibility`, `/privacy`, and `/terms` return successfully on
   the production domain.
7. Add the production property to Google Search Console and submit
   `https://YOUR-DOMAIN/sitemap.xml`.

The included `wrangler.toml` remains the requested assets-only SPA configuration. Full-stack development and production use `wrangler.vinext-build.toml`, which declares the Cloudflare Browser Run binding and a compatibility date supported by the installed runtime. `npm run dev:windows` starts `vinext dev` with the Cloudflare Vite environment so marketplace API routes and remote browser fallbacks run while `app/globals.css` keeps normal Vite hot reload. `npm run dev:local:windows` also uses Vinext routing so the root App Router page cannot fall through to Vite's 404 handler.

A normal Vinext App Router build produces Worker, RSC, SSR, client JavaScript, and compiled CSS artifacts rather than a standalone `index.html`. The post-build validator accepts that full-stack output and removes stale `build/` assets. Because the exact root Wrangler file has no `main` Worker entry, `npm run deploy:static` serves only frontend assets; same-origin `/api/*` routes and Browser Run require `npm run deploy`.

## Search-engine files

- `app/layout.tsx`: canonical metadata, Open Graph, Twitter cards, icons, and
  Organization/WebSite/SoftwareApplication structured data.
- `app/sitemap.ts`: generated XML sitemap covering the homepage and all public
  company, methodology, FAQ, contact, accessibility, privacy, and terms pages.
- `app/robots.ts`: crawler rules and sitemap reference.
- `app/manifest.ts`: installable web-app manifest.
- `public/favicon.svg`, PNG icons, Apple touch icon, maskable icon, and social card.
- `public/_headers`: security and caching headers for Cloudflare static assets.
- `scripts/validate-seo.mjs`: validates required routes and deployment assets.

- `DEPLOY_CLOUDFLARE.md`: production environment, build, deploy, custom-domain,
  route verification, page-source, and Search Console checklist.


## Verify the production domain

After `npm run deploy`, run `npm run check:production`. The `/api/health`
response must report revision `depop-domain-production-v3` and
`browserBindingAvailable: true`. This also verifies that the custom domain is
serving the full-stack Worker rather than an older or assets-only deployment.
