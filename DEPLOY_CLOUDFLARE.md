# Deploy to Cloudflare workers.dev

Target:

```text
https://resalewebsite.unusualsuspectsclothing.workers.dev/
```

## Dashboard Git Build settings

```text
Build command: npm run build:windows
Deploy command: npm run deploy
Non-production deploy command: npm run preview:cloudflare
Root directory: /
```

## Command-line deployment

```powershell
npm ci
npm test
npm run build:windows
npm run deploy
npm run check:production
```

`wrangler.jsonc` has:

- `name: resalewebsite`
- `workers_dev: true`
- no custom-domain routes
- no Browser Run binding
- `RML_MARKETPLACE_TRANSPORT=browser`

Marketplace requests are made by the website in the user's browser. `/api/listings`, `/api/web-listings`, and `/api/image-proxy` are disabled and return HTTP 410 so old cached clients cannot accidentally restart Worker scraping.

## Browser Bridge

Install the optional unpacked extension from `browser-extension/` for marketplaces that block ordinary cross-origin browser requests.
