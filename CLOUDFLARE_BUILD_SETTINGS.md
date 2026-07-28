# Cloudflare Build Settings

```text
Worker name: resalewebsite
Production URL: https://resalemasterlab.cloud-cord.com/
Build command: npm run build:windows
Deploy command: npm run deploy
Non-production deploy command: npm run preview:cloudflare
Node version: 22
```

The Cloudflare zone for `cloud-cord.com` must be active in the same account. `wrangler.jsonc` publishes the Worker to the custom domain `resalemasterlab.cloud-cord.com` and keeps the `workers.dev` preview URL enabled.

No Browser Run binding is used. Marketplace adapters use bounded official page-source/index requests, while image analysis and optional local AI models execute in the visitor's browser.

## v16 production behavior

- Complete navigation remains visible on wider screens and becomes a three-bar dropdown below 1120px.
- Search All processes two marketplaces per orchestration batch when all supported marketplaces are selected; smaller selections use batches of three.
- The browser-side relay scheduler permits at most three concurrent marketplace relay requests.
- Depop uses official search/brand/theme/product sources; ZenMarket retries dedicated and unified store endpoints for Mercari `27`, JDirectItems `28`, Rakuten `0`, and Rakuma `25`; Grailed uses its bounded public listing index and approved image CDNs.
