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

`npm run dev:windows` starts Vinext with the Cloudflare Vite environment. This keeps
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
marketplace fallbacks such as rendered Depop or Goofish results are unavailable.

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
first; Browser Run renders Depop or Goofish/Superbuy only when no public cards were
found. The browser binding uses remote mode in development because Quick Actions do
not run in the local-only Workers runtime.
