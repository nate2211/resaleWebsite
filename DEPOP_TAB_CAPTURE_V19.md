# Depop rendered-tab capture v19

## Regression removed

The previous bridge could still reach Depop through two denial-prone paths:

1. an extension service-worker `fetch`, and
2. the Cloudflare `/api/listings` relay after a bridge challenge or timeout.

Both paths are disabled for every `depop.com` URL in v19.

## New request path

`ResaleMasterLab page -> Browser Bridge -> visible normal Depop tab -> rendered DOM snapshot -> local parser`

The capture includes listing anchors, first-party images, visible prices, card text, canonical metadata, JSON-LD, embedded React/Next state, and an explicit normalized `items` payload.

The frontend waits up to 55 seconds, while the extension allows up to 30 seconds for navigation and roughly 13 seconds for hydration. Depop search-page capture is limited to one URL and product hydration is disabled.

## Verification behavior

When the official Depop tab itself shows a verification or blocked page, Browser Bridge returns no denial HTML. The tab stays visible and ResaleMasterLab displays a clean instruction to complete the official page and retry.

## Validation performed

- 45 project tests passed.
- All three extension JavaScript files passed `node --check`.
- Changed TypeScript files passed standalone type checking.
