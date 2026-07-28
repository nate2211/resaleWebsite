# Validation — frontend-marketplace-results-api-v9

Completed in the packaging environment:

- 14 focused Node regression tests passed.
- The lightweight marketplace relay passed an executable fixture with a mocked Depop response.
- The relay allowlist rejected an unrelated hostname with HTTP 400.
- `app/api/listings/route.ts` passed focused TypeScript checking.
- `app/lib/frontend-marketplaces.ts` and its local analysis dependencies passed focused TypeScript checking.
- All application TypeScript and TSX sources passed syntax transpilation.
- Browser-extension JavaScript passed syntax validation.
- `manifest.json`, `package.json`, and `wrangler.jsonc` parse successfully.
- Final ZIP CRC/integrity verification passed.

Design invariants:

- `app/lib/frontend-marketplaces.ts` calls `/api/listings?source=...` before other transports.
- Known CORS-blocked hosts never reach page-origin `fetch()`.
- `/api/listings` performs no Browser Run calls, DOM parsing, search-engine discovery, hydration, AI work, or comparison work.
- The relay is HTTPS-only and marketplace-host allowlisted.
- Upstream response text is limited to 2 MB and 10 seconds.
- Marketplace parsing, image filtering, currency normalization, deduplication, and comparison matching stay client-side.
- Marketplace and query fan-out uses `Promise.allSettled`.
- `wrangler.jsonc` has no Browser Run binding.
- `/api/health` reports revision `frontend-marketplace-results-api-v9`.
