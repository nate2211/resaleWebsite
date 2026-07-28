# Validation — market-search-url-recovery-production-v17

Completed in the packaging environment:

- 43 Node regression tests passed with zero failures.
- 48 application TypeScript/TSX files transpiled with zero syntax diagnostics.
- Focused TypeScript checks passed for the Depop parser, ZenMarket parser, frontend marketplace transport, ZenMarket relay, and page-source relay.
- SEO/PWA/custom-domain validation passed for `https://resalemasterlab.cloud-cord.com`.
- Marketplace selector CSS has balanced braces and validated responsive rules.
- The selection panel appears after the Depop/Grailed/Poshmark card grid.
- The selector uses flex-wrapped natural-width pills, normal word spacing, no forced breaking, and phone-safe stacked buttons.
- Depop validation covers the supplied `_bing_pong_` product URL and returns a canonical product link, published price, size, first-party image, title, condition, and seller context.
- Depop search validation retains normal search, brand, theme, embedded React/JSON, readable card, and canonical `/products/` paths.
- ZenMarket search validation covers exact store IDs `27`, `28`, `0`, and `25` using `/en/search.aspx`.
- ZenMarket query encoding joins multiword terms with `%2B` in search-page URLs.
- ZenMarket source fixtures rebuild root product routes for `mercariproduct.aspx`, `auction.aspx`, `rakutenproduct.aspx`, and `rakumaproduct.aspx`.
- `itemCode`, `q`, `p`, `pos`, and `cs` are retained when present.
- ZenMarket nested ASP.NET `.d`, `Items`, serialized `ItemCode`, title, image, and JPY-price parsing remains covered.
- Failed marketplace network relays return an HTTP 200 error envelope with `x-rml-relay-error`, allowing the frontend to continue without a visible 502 response.
- Grailed nested-image and active/sold public-index fixtures remain passing.
- All-market scheduling remains bounded at two marketplaces per all-market batch and three simultaneous relay slots.
- Production revision checks expect `market-search-url-recovery-production-v17`.
- ZIP CRC, file count, and SHA-256 are verified after packaging.
- Clean project file count: 121 files.

Dependency-backed build note:

- `node_modules` is intentionally excluded from the artifact.
- `package-lock.json` is included for Cloudflare's clean installation.
- A fresh full Vinext production build was not run in this packaging environment.
