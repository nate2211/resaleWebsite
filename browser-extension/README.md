# ResaleMasterLab Browser Bridge 3.0

Browser Bridge 3.0 captures marketplace cards from normal rendered Chrome or Edge tabs.

## Important Depop behavior

Depop does not use an extension background request or the Cloudflare page-source relay. The bridge opens the exact public Depop search URL in a visible tab, waits for React/Next hydration, performs a bounded scroll, and returns a local DOM snapshot to ResaleMasterLab. This restores the prior normal-page behavior and removes the two request paths that were returning `403 Forbidden`.

A Depop verification page is not copied into listing results. The official tab remains visible so the user can complete verification and retry.

Grailed and Poshmark use rendered tab capture first and retain bounded secondary fallbacks. Other enabled marketplaces retain session-aware or page-source fallbacks.

## Install in Chrome or Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Remove the previous ResaleMasterLab Browser Bridge.
4. Choose **Load unpacked**.
5. Select this `browser-extension` folder.
6. Reload ResaleMasterLab and confirm **Browser Bridge connected**.

## Supported application origins

- `https://resalemasterlab.cloud-cord.com`
- `https://resalemasterlab.com`
- `https://www.resalemasterlab.com`
- `https://resalewebsite.unusualsuspectsclothing.workers.dev`
- local `localhost` and `127.0.0.1` development origins

Only hosts declared in `manifest.json` can be opened or captured.
