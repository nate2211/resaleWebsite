# Cloudflare Build Settings

```text
Worker name: resalewebsite
Production URL: https://resalewebsite.unusualsuspectsclothing.workers.dev/
Build command: npm run build:windows
Deploy command: npm run deploy
Non-production deploy command: npm run preview:cloudflare
Node version: 22
```

No `BROWSER` binding is required. Cloudflare performs only one bounded fetch for the exact official marketplace URL supplied by the frontend; parsing and comparisons run in the browser.
