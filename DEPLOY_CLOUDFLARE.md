# Deploy the ResaleMasterLab frontend to Cloudflare

## Requested Wrangler configuration

The project uses this exact assets-only SPA configuration:

```toml
name = "audiomasterlab"
compatibility_date = "2026-06-22"

[assets]
directory = "./build"
not_found_handling = "single-page-application"
```

Cloudflare serves `build/index.html` for navigation paths that do not match a static file.

## Development styling and marketplace rendering

`npm run dev:windows` starts the Vinext App Router development server with the Cloudflare Vite environment. This keeps
`app/globals.css` on Vite hot reload while also attaching the remote Browser Run
binding used only when ordinary public marketplace requests return zero cards.
Authenticate with Cloudflare once before using the remote binding:

```powershell
npx wrangler login
Remove-Item -Recurse -Force node_modules\.vite -ErrorAction SilentlyContinue
npm run dev:windows
```

For interface-only development without Cloudflare or Browser Run, use:

```powershell
npm run dev:local:windows
```

The local-only mode still loads the complete stylesheet, but JavaScript-heavy
marketplace fallbacks and AI web browsing such as rendered Depop, ZenMarket/Rakuten, and public product pages are unavailable.

## Production styling

The production command enables `@cloudflare/vite-plugin` only for the Vinext build and then prepares the requested `build` directory:

```bash
npm run build:verified
```

`vite.config.ts` uses `wrangler.vinext-build.toml` for production and Cloudflare-enabled development. `scripts/prepare-static-build.mjs` now distinguishes a static export from Vinext's normal full-stack Worker output. Full-stack builds are accepted when a generated `wrangler.json`, compiled CSS, and JavaScript are present; stale `build/` output is removed. Static-only deployment remains available through `npm run build:static` and requires a real exported `index.html`.

Deploy with the latest Wrangler runtime so the requested June 22, 2026 compatibility date is recognized:

```bash
npx wrangler@latest login
npm run deploy
```

## Important assets-only limitation

This exact Wrangler configuration contains no Worker `main` entry. It deploys the frontend as a static SPA, but it cannot execute the same-origin server handlers under `app/api/*`. Features that require server-side marketplace fetching need the full-stack Worker deployment configuration or a separate public API origin.

## Marketplace APIs in production

`wrangler.toml` is the requested assets-only SPA configuration. It does not run marketplace, monitoring, authenticity, engagement, or AI endpoints. Deploy the full-stack Worker instead:

```powershell
npm run deploy
```

For a deliberately static frontend-only deployment:

```powershell
npm run deploy:static
```

The full-stack command uses the official Vinext Cloudflare deployment adapter,
keeps `/api/*` on the same origin as the browser application, and includes the
`BROWSER` binding declared in `wrangler.vinext-build.toml`. Ordinary HTTP is tried
first; Browser Run renders built-in dynamic marketplace sources when no public cards are found. AI Search uses Browser Run content and link extraction for JavaScript-heavy search/product pages, but filters out all built-in marketplace domains so the AI card contributes additional stores. The AI button still runs selected built-in adapters and Rakuten through ZenMarket in the same bounded parallel batch. The browser binding uses remote mode in development because Quick Actions do not run in the local-only Workers runtime.


## Depop production checklist

Depop is a JavaScript-heavy source and must use the full-stack Worker plus the
remote `BROWSER` binding. The listing route now decodes the production Quick
Action envelope (`success` + `result`) before sending rendered HTML to the Depop
parser. When a search page provides links without readable card data, it also
runs the `links` Quick Action and renders the individual `/products/` page to
recover public Open Graph/JSON-LD price and image data.

After deployment, verify the route directly:

```powershell
curl.exe "https://YOUR-DOMAIN/api/listings?marketplace=Depop&q=supreme&page=0&mode=active"
```

A healthy response should report `browserBindingAvailable: true` when ordinary
Depop HTML returned no cards, and one source failure must not cancel other
marketplaces because all production fan-outs use settled-result handling.

## Worker runtime module during Vinext builds

The Browser Run binding is read with `import("cloudflare:workers")`, which is
the binding-access pattern recommended by Vinext and Cloudflare. This module is
provided by the Workers runtime and is not an npm package. `vite.config.ts`
therefore lists `cloudflare:workers` in `build.rolldownOptions.external`; without
that entry, Vinext's client-reference analysis can fail before the server build
with a module-resolution error.


## Vinext development root route

The full-stack Vite configuration reads `wrangler.vinext-build.toml`. That file
must declare `main = "vinext/server/app-router-entry"`, and its asset fallback must be
`not_found_handling = "none"`. The Worker entry delegates requests to
`vinext/server/app-router-entry`. Using an assets-only SPA Wrangler file for Vinext
development causes repeated `GET / 404` responses because the asset middleware
handles `/` before the App Router.

## Local console diagnostics

Runtime PWA links are relative to the active origin, so localhost must request `/manifest.webmanifest`, `/favicon.svg`, and icons from port 5173 rather than the production hostname. `contentscript.js` / `ObjectMultiplex` liveness warnings come from injected browser extensions and are not part of the Worker or React bundle. Use a clean browser profile when verifying the application console. Transient same-origin API failures are retried, and query/page fetching is concurrency-limited.
