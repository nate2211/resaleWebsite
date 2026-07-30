# Deploy ResaleMasterLab to resalemasterlab.cloud-cord.com

The production Worker is configured for:

```text
https://resalemasterlab.cloud-cord.com
```

Cloudflare Git settings:

```text
Root directory: /
Node version: 22
Build command: npm run build:windows
Deploy command: npm run deploy
Non-production deploy command: npm run preview:cloudflare
```

Environment variables:

```text
NEXT_PUBLIC_SITE_URL=https://resalemasterlab.cloud-cord.com
NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=<Search Console verification token>
```

Deploy and verify:

```powershell
npm ci
npm test
npm run seo:validate
npm run build:windows
npm run deploy
$env:RML_BASE_URL="https://resalemasterlab.cloud-cord.com"
npm run check:production
```

The Worker has no Browser Run binding and this project contains no Browser Bridge extension. Depop is handled by the same-origin frontend marketplace API with bounded official-page, readable-page, indexed-link, and product-page recovery.
