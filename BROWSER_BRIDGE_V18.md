# Browser Bridge v18 recovery

## What changed

- Depop, Grailed, and Poshmark use Browser Bridge first when the extension is connected.
- Extension requests now use the user's normal browser session instead of `credentials: "omit"`.
- When a credentialed extension request is blocked or incomplete, the bridge opens the official search URL in an inactive tab and captures the rendered DOM.
- The capture includes JSON-LD, Next.js state, listing anchors, product images, visible card text, and normalized bridge records.
- Human-verification pages are detected. The marketplace tab is brought forward so verification can be completed manually, and the UI asks the user to retry.
- A successful Grailed page capture suppresses the public-index fallback request, preventing empty `{ hits: [] }` partial responses from appearing during normal searches.
- The Browse view now shows whether Browser Bridge is connected.

## Install the extension

1. Open `chrome://extensions` or `edge://extensions`.
2. Enable Developer mode.
3. Remove the previous ResaleMasterLab Browser Bridge.
4. Select **Load unpacked** and choose the `browser-extension` folder.
5. Reload ResaleMasterLab and confirm that the Browse page says **Browser Bridge connected**.

## Verification behavior

The bridge does not bypass a marketplace verification screen. If Depop or another marketplace presents one, the extension opens that official page in a browser tab. Complete the verification once and run the search again.

## Validation performed

- Browser extension JavaScript syntax checks passed.
- 45 Node project tests passed.
- Changed TS/TSX files passed TypeScript syntax transpilation.
- A full dependency install/build could not be executed in this environment because the configured package registry returned a 404 for `zod-validation-error@4.0.2`.
