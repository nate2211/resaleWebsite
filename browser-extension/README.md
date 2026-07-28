# ResaleMasterLab Browser Bridge

This optional Chrome/Edge extension lets the deployed ResaleMasterLab page read public marketplace responses directly from your browser. The marketplace response does **not** pass through a Cloudflare Worker.

## Install in Chrome or Edge

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select this `browser-extension` folder.
5. Reload `https://resalemasterlab.cloud-cord.com/`.

The bridge requests only the marketplace and public-reader hosts listed in `manifest.json`. It sends response text back to the ResaleMasterLab tab for parsing and analysis.
