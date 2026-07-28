# ResaleMasterLab all-market image and result recovery v16

This release keeps every production feature from v15 and fixes the marketplace selector, all-market scheduling, Depop recovery, ZenMarket store adapters, Grailed image extraction, and analysis-ready marketplace images.

## v16 changes

- Full navigation links on the workspace, public pages, Thrift Check, Listing Template, and the 404 page.
- Desktop navigation stays visible; smaller screens use a three-bar button and accessible dropdown.
- Depop uses its normal `search`, `brands`, `theme`, and `/products/` page sources, including embedded React/JSON records and `media-photos.depop.com` images.
- Mercari Japan uses ZenMarket's Mercari catalog/page sources, store `27`, and `mercariproduct.aspx?itemCode=...` listing pages.
- JDirectItems Auction, Rakuten, and Rakuma use stores `28`, `0`, and `25`, dedicated pages, cross-site pages, nested AJAX payloads, and canonical ZenMarket product links.
- The marketplace selector uses a two-column compact toolbar on wide screens and a clean stacked layout on phones; helper text wraps normally without forced widths or stretched whitespace.
- A single Search All action includes every selected marketplace but uses groups of two when every marketplace is selected and limits raw relay requests to three at a time.
- When six or more marketplaces are selected, only the literal search is used, product-page enrichment is limited to one item per marketplace, and fallback pages are processed sequentially.

Production domain: `https://resalemasterlab.cloud-cord.com`

This package retains the v12 official marketplace page-source adapters, engagement fallbacks, Grailed public-index search, and ZenMarket store separation, then adds two crawlable product pages:

- `/thrift-check` — phone camera/image uploads, optional purchase price, sold/active marketplace evidence, fee-aware profit and ROI, deterministic computer-vision metrics, optional sold-image similarity, and optional local AI explanation.
- `/listing-template` — requires the locally loaded image-caption and writing models, then generates editable brand, title, category, condition, color, material, size, description, tags, list price, and floor price fields bounded by public marketplace evidence.

## Production and SEO

- Canonicals, Open Graph, Twitter cards, JSON-LD, sitemap, robots, PWA manifest, maskable icons, shortcuts, and screenshots use `resalemasterlab.cloud-cord.com`.
- The homepage and both tool pages contain server-rendered explanatory copy and ordinary anchor links.
- `wrangler.jsonc` configures `resalemasterlab.cloud-cord.com` as a Cloudflare Worker Custom Domain while keeping the workers.dev URL available for diagnostics.
- Add the Search Console token through `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`.

## Marketplace evidence

Marketplace search behavior combines the proven earlier adapters with the current bounded frontend scheduler:

- Depop official search/brand/theme sources and canonical product-page enrichment.
- Grailed active and sold public indexes.
- Poshmark normal listing search.
- ZenMarket: Mercari Japan `27`, JDirectItems `28`, Rakuten `0`, Rakuma `25`. The frontend accepts rendered `product-item product-link` cards, nested `.d` JSON payloads, `Items` arrays, `ItemCode`, `ClearTitle`, `PreviewImageUrl`, and `PriceTextControl`.
- Partial failures use settled-result handling.
- Browser Run is not configured.

## Local AI

The browser downloads and caches:

- `HuggingFaceTB/SmolLM2-135M-Instruct` for bounded writing/explanation.
- `Xenova/vit-gpt2-image-captioning` for item-photo captions.

Thrift Check can work without AI when the user supplies a searchable item description. Listing Template intentionally requires both models.

## Run and deploy

```powershell
npm ci
npm test
npm run seo:validate
npm run build:windows
npm run deploy
npm run check:production
```

Set Cloudflare Git builds to Node 22 with build command `npm run build:windows` and deploy command `npm run deploy`.

## Safety and limitations

Results are planning estimates. Public prices may be stale or incomplete. Image metrics measure visual/photo similarity and readability, not authenticity. Verify brand, fabric, size, measurements, condition, fees, and availability before purchasing or publishing.
