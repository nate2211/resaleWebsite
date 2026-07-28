# Deploy ResaleMasterLab to Cloudflare Workers

## Production configuration

Production uses one source-of-truth file: `wrangler.jsonc`.

It deploys the Vinext App Router Worker, all `/api/*` routes, the `BROWSER`
Quick Actions binding, and the custom domains `resalemasterlab.com` and
`www.resalemasterlab.com`. Do not deploy production with the assets-only file.

Cloudflare prerequisites:

1. The `resalemasterlab.com` zone must be active in the same Cloudflare account.
2. Remove conflicting CNAME records on the apex or `www` hostname before the
   first Custom Domain deployment.
3. The Cloudflare account must support Browser Run.
4. Authenticate Wrangler and select the account that owns the zone. Set `CLOUDFLARE_ACCOUNT_ID` when your login can access more than one account.

```powershell
$env:CLOUDFLARE_ACCOUNT_ID = "YOUR_ACCOUNT_ID"
npm ci
npx wrangler login
npx wrangler whoami
npm test
npm run deploy
```

The deploy command is deliberately explicit:

```text
npx @vinext/cloudflare deploy --config wrangler.jsonc
```

It must not be replaced with `npx wrangler deploy`, `npm run deploy:static`, or
an assets-only dashboard deployment. Vinext performs compatibility checks and
deploys the generated App Router Worker using the same configuration that Vite
uses during the build.

## Verify the deployed Worker

Run:

```powershell
npm run check:production
```

Or inspect the endpoints directly:

```powershell
curl.exe -i "https://resalemasterlab.com/api/health"
curl.exe -i "https://resalemasterlab.com/api/listings?marketplace=Depop&q=raf%20simons&page=0&mode=active"
```

The health response must show:

```json
{
  "revision": "depop-domain-production-v3",
  "browserBindingAvailable": true
}
```

The listings response also includes the `x-rml-worker-revision` response header
and `diagnostics.workerRevision`. If either shows an older revision, the domain
is attached to an older Worker or a stale deployment was used.

## Depop production strategy

Depop is queried through several independent, settled paths:

1. Ordinary public search HTML.
2. Browser Run rendered search HTML.
3. Browser Run rendered `/products/` links.
4. Bing and DuckDuckGo public-index discovery.
5. Browser-rendered web-index discovery when ordinary index requests fail.
6. Ordinary and rendered product-page hydration for price and image metadata.

A canonical Depop product link is now retained even when Depop blocks price
hydration. The card is marked `Price unavailable — open Depop` rather than
removing the listing and making the marketplace appear empty.

## Static preview only

`wrangler.static.toml` is retained only for a frontend-only demonstration:

```powershell
npm run deploy:static
```

That deployment cannot execute `/api/listings`, AI Search, watch checks, or
Browser Run and must not be attached to the production domain.

## Logs

Stream production logs while issuing a Depop request:

```powershell
npx wrangler tail resalemasterlab --format pretty
```

The API response diagnostics report whether the Browser Run binding was found,
how many rendered batches completed, how many indexed discovery batches ran,
and which Worker revision served the request.


On Windows, `DEPLOY_PRODUCTION_WINDOWS.bat` runs the install, tests, full-stack deploy, and production verification in one command.
