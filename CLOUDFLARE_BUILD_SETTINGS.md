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
