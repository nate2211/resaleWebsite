# Deploy ResaleMasterLab to the existing workers.dev Worker

Production URL: `https://resalewebsite.unusualsuspectsclothing.workers.dev/`

This project does **not** require a custom domain. The Worker name is `resalewebsite`, and it must match the existing Cloudflare Workers project connected to the Git repository. Cloudflare appends the account subdomain `unusualsuspectsclothing.workers.dev` automatically.

## Cloudflare Workers Builds settings

In **Workers & Pages → resalewebsite → Settings → Builds**, use:

- Root directory: repository root
- Build command: `npm run build:windows`
- Deploy command: `npm run deploy`
- Non-production deploy command: `npm run preview:cloudflare`
- Node.js: 22

The build command only compiles Vinext. The deploy command is what uploads and activates the full Worker, including `/api/*`, server rendering, assets, and the `BROWSER` binding. Do not use `npm run deploy:static`.

## Required Wrangler settings

`wrangler.jsonc` intentionally contains:

```json
{
  "name": "resalewebsite",
  "workers_dev": true,
  "preview_urls": true,
  "browser": { "binding": "BROWSER" }
}
```

There are no `routes` or `custom_domain` entries. Adding either can disable or redirect the existing workers.dev deployment.

## Deploy locally on Windows

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = "YOUR_ACCOUNT_ID"
npm ci
npm test
npm run deploy
$env:RML_BASE_URL = "https://resalewebsite.unusualsuspectsclothing.workers.dev"
npm run check:production
```

Or run `DEPLOY_PRODUCTION_WINDOWS.bat`.

## Verify production

```powershell
curl.exe -i "https://resalewebsite.unusualsuspectsclothing.workers.dev/api/health"
curl.exe -i "https://resalewebsite.unusualsuspectsclothing.workers.dev/api/listings?marketplace=Depop&q=raf%20simons&page=0&mode=active"
```

The health endpoint should contain:

```json
{
  "revision": "depop-production-results-images-v6",
  "browserBindingAvailable": true
}
```

If the homepage updates but `/api/health` is missing, the Git integration is deploying static assets or using the wrong deploy command. Set the deploy command to `npm run deploy`.
