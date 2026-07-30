# ResaleMasterLab Depop rendered-tab recovery v19

This release preserves the complete ResaleMasterLab feature set from the prior marketplace builds while restoring Depop to the normal public-page workflow that previously produced usable listing cards.

Production domain: `https://resalemasterlab.cloud-cord.com`

## Depop fix in v19

Depop is now **browser-tab-only**:

- ResaleMasterLab opens the normal URL `https://www.depop.com/search/?q=<query>&page=<page>` in a visible Chrome or Edge tab.
- The extension waits for the real page to hydrate, performs a bounded scroll to load listing cards, and captures rendered `/products/` links, text, prices, images, JSON-LD, React/Next state, and canonical metadata.
- Depop is never requested through the Cloudflare `/api/listings` relay.
- Depop is never requested with an extension background `fetch`.
- Depop product-page hydration is disabled during search, preventing one search from opening several extra tabs or generating repeated denial requests.
- The bridge timeout is long enough for a normal tab load and client-side hydration.
- A denial or verification page is returned as a clean retry message; the raw `Sorry, not authorized` HTML is not passed into the results parser.

The earlier alternate public URLs remain available to the parser and source-link tools:

- `https://www.depop.com/brands/<slug>/?page=<page>`
- `https://www.depop.com/theme/<slug>/?page=<page>`
- `https://www.depop.com/products/<listing-slug>/`

The main live search uses one normal search URL per request to avoid repeated navigation.

## Grailed recovery

- Rendered Browser Bridge cards remain the primary Grailed source.
- The public-index fallback runs only when rendered page capture found no cards.
- Empty partial objects such as `{ hits: [], partial: true }` are not used as listing results or shown as raw status text.

## Features retained

- Depop, Grailed, and Poshmark default marketplace cards
- Collapsible international marketplace panel
- Mercari Japan, JDirectItems Auction, Rakuten, Rakuten Rakuma, and Bunjang
- Exact ZenMarket store IDs 27, 28, 0, and 25
- AI Search, favorites, watchlist, compare, import, authenticity, engagement, fee/profit analysis, and local browser AI
- Thrift Check and Listing Template
- Sticky responsive navigation, SEO pages, sitemap, robots, manifest, icons, screenshots, Open Graph, and JSON-LD
- Bounded request queues and partial-failure handling

## Install Browser Bridge 3.0

1. Extract the project.
2. Open `chrome://extensions` or `edge://extensions`.
3. Enable **Developer mode**.
4. Remove the older ResaleMasterLab Browser Bridge.
5. Choose **Load unpacked** and select the project's `browser-extension` folder.
6. Reload ResaleMasterLab until the Browse page says **Browser Bridge connected**.
7. Run a Depop search. A normal Depop tab briefly opens while results render and are captured.

If Depop itself displays a verification page in that normal tab, complete it there and run the search again. The project does not bypass marketplace verification or account controls.

## Run and deploy

```powershell
npm ci
npm test
npm run seo:validate
npm run build:windows
npm run deploy
npm run check:production
```

Cloudflare Git builds should use Node 22, build command `npm run build:windows`, and deploy command `npm run deploy`.

## Validation

- 45 Node project tests pass.
- Browser extension JavaScript syntax checks pass.
- The changed TypeScript marketplace and relay files pass standalone TypeScript checking with `ES2022`, `DOM`, and `DOM.Iterable` libraries.
- A complete dependency install could not be run in this environment because its package mirror returned 404 for `zod-validation-error@4.0.2`; the public package lock remains unchanged for normal npm installs.
