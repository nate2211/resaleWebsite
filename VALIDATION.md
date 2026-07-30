# Validation — market-search-frontend-api-depop-recovery-v20

Validation targets for this release:

- no `browser-extension` directory;
- no browser bridge, extension fetch, injected script, or tab-capture references in application code;
- Depop allowed by `/api/listings`;
- exact search, brand, and theme URLs retained;
- official page, readable page, and indexed product-link recovery retained;
- bounded Depop product-page hydration restored;
- raw 403/challenge HTML filtered by the API;
- project tests, TypeScript checks, SEO checks, and production build where dependencies are available.

## Completed checks

- `npm test`: 46 passed, 0 failed.
- Standalone TypeScript checks passed for `app/api/listings/route.ts` and `app/lib/frontend-marketplaces.ts`.
- `npm run seo:validate`: passed.
- Full dependency installation/build could not run in this execution environment because its internal npm mirror returned 404 for `zod-validation-error@4.0.2`; the lockfile points to the normal public npm package and was left unchanged.
