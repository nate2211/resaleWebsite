# Deploy the frontend marketplace-results API edition

Target:

```text
https://resalewebsite.unusualsuspectsclothing.workers.dev/
```

## Cloudflare Git Build settings

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

`wrangler.jsonc` uses:

- Worker name `resalewebsite`;
- `workers_dev: true`;
- no custom-domain routes;
- no Browser Run binding;
- `RML_MARKETPLACE_TRANSPORT=frontend-api-relay`.

`/api/listings` is a bounded raw-response relay. Each invocation makes at most one active marketplace request at a time, follows at most two validated redirects, stops after 10 seconds, and reads at most 2 MB. Marketplace parsing and comparisons run in the browser.

`/api/web-listings` and `/api/image-proxy` remain disabled because AI discovery and image filtering are handled client-side.
