# Deploy Grailed and Depop results v11

Production URL:

```text
https://resalewebsite.unusualsuspectsclothing.workers.dev/
```

Cloudflare Git settings:

```text
Build command: npm run build:windows
Deploy command: npm run deploy
Non-production deploy command: npm run preview:cloudflare
Root directory: /
Node version: 22
```

`wrangler.jsonc` uses Worker name `resalewebsite`, `workers_dev: true`, no custom routes, and no Browser Run binding.

The `/api/listings` endpoint is a one-URL page-source relay. It returns raw official marketplace HTML/JSON with these headers:

- `x-rml-upstream-status`
- `x-rml-final-url`
- `x-rml-upstream-content-type`
- `x-rml-truncated`

All marketplace parsing and bounded product-page enrichment run in the frontend.

Deploy and verify:

```powershell
npm ci
npm test
npm run build:windows
npm run deploy
npm run check:production
```

## Grailed and Depop result verification

- `/api/grailed-search` performs one public Algolia listing query using the configuration exposed by Grailed's official page source.
- Depop first uses its official search, brand, and theme URLs. When those return only a shell, the frontend parses the readable source for canonical `/products/` cards and `media-photos.depop.com` images.
- Neither path uses Browser Run.
