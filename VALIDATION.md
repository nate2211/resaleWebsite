# Validation — market-search-depop-parallel-recovery-v21

The validation suite checks:

- no `browser-extension` directory or Browser Bridge hooks;
- Depop is routed through `/api/listings`;
- Depop recovery uses `Promise.any` across SSR HTML, public catalog data, Jina Reader, and indexed product links;
- forbidden/challenge HTML is suppressed;
- the frontend grants Depop a 30-second recovery timeout;
- mocked 403 responses are replaced by product links;
- an all-source failure returns clean empty JSON without the removed unavailable-page-source message;
- Grailed public-index fallback still runs only when page parsing has no cards;
- SEO and Vinext entry validation remain intact.
