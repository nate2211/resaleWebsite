# Deploy ResaleMasterLab to resalemasterlab.cloud-cord.com

The production Worker is configured as the origin for this exact Custom Domain:

```text
https://resalemasterlab.cloud-cord.com
```

`wrangler.jsonc` includes:

```json
"routes": [{ "pattern": "resalemasterlab.cloud-cord.com", "custom_domain": true }]
```

Cloudflare must manage the `cloud-cord.com` DNS zone. Remove a conflicting manual DNS record for the exact subdomain before the first Custom Domain deployment if Cloudflare reports a conflict.

## Cloudflare Git settings

```text
Root directory: /
Node version: 22
Build command: npm run build:windows
Deploy command: npm run deploy
Non-production deploy command: npm run preview:cloudflare
```

## Environment variables

```text
NEXT_PUBLIC_SITE_URL=https://resalemasterlab.cloud-cord.com
NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION=<Search Console verification token>
```

## Deploy and verify

```powershell
npm ci
npm test
npm run seo:validate
npm run build:windows
npm run deploy
$env:RML_BASE_URL="https://resalemasterlab.cloud-cord.com"
npm run check:production
```

Verify these URLs directly:

- `/api/health`
- `/sitemap.xml`
- `/robots.txt`
- `/manifest.webmanifest`
- `/thrift-check`
- `/listing-template`

The Worker has no Browser Run binding. Marketplace relays remain bounded to one official page per request. The image-comparison proxy is restricted to approved marketplace image CDNs, a 9-second timeout, and a 4.5 MB response limit.

## v19 post-deploy checks

After deployment, verify the full navigation on `/`, `/thrift-check`, `/listing-template`, `/methodology`, and `/about` at desktop and mobile widths. The narrow layout should expose every link through the three-bar menu.

Run one Search All request and confirm `/api/health` reports:

```json
{
  "revision": "market-search-depop-tab-capture-production-v19",
  "marketplaceBatchSize": { "standard": 3, "allMarkets": 2 },
  "marketplaceRelayConcurrency": 3,
  "depopDiscovery": "official-search-brand-theme-and-product-page-sources",
  "mercariJapanDiscovery": "zenmarket-mercari-store-27-catalog-and-page-sources"
}
```
