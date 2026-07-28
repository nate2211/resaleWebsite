# Cloudflare Build Settings

Worker project: `resalewebsite`  
Production URL: `https://resalewebsite.unusualsuspectsclothing.workers.dev/`

| Setting | Value |
|---|---|
| Build command | `npm run build:windows` |
| Deploy command | `npm run deploy` |
| Non-production deploy command | `npm run preview:cloudflare` |
| Root directory | repository root |
| Node.js | 22 |

The `ExperimentalWarning: glob is an experimental feature` line during `[1/5] analyze client references` is a Node/Vinext warning, not a build failure. Wait for all five Vinext stages and the deploy command to finish.
