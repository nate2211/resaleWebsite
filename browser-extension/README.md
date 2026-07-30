# ResaleMasterLab Browser Bridge 2.0

This Chrome/Edge extension lets ResaleMasterLab read official marketplace pages through your normal browser session when a Cloudflare relay receives a 403, a bot challenge, or an empty server-rendered page.

The bridge does not forge tracking updates, bypass account permissions, or defeat a marketplace challenge. It first tries a credentialed extension request. If that response is blocked or incomplete, it opens the official marketplace search in a normal browser tab, waits for the page to render, and returns a bounded DOM snapshot to ResaleMasterLab for local parsing. When a marketplace asks for human verification, the tab is brought forward so you can complete it; retry the search afterward.

## Install in Chrome or Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Remove an older ResaleMasterLab Browser Bridge if one is installed.
4. Choose **Load unpacked**.
5. Select this `browser-extension` folder.
6. Reload ResaleMasterLab. The marketplace page shows **Browser Bridge connected** when the extension is detected.

## Supported application origins

- `https://resalemasterlab.cloud-cord.com`
- `https://resalemasterlab.com`
- `https://www.resalemasterlab.com`
- `https://resalewebsite.unusualsuspectsclothing.workers.dev`
- local `localhost` and `127.0.0.1` development origins

Only the marketplace hosts declared in `manifest.json` can be opened or read.
