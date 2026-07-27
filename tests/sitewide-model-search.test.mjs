import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("loaded model changes search, ranking, scoring, compare, watchlist, and exports", async () => {
  const [page, intelligence] = await Promise.all([
    source("app/page.tsx"),
    source("app/lib/model-intelligence.ts"),
  ]);

  assert.match(page, /type SiteAiEngine/);
  assert.match(page, /planSitewide/);
  assert.match(page, /planResearch/);
  assert.match(page, /reviewListings/);
  assert.match(page, /rerankCandidates/);
  assert.match(page, /applyModelListingReview/);
  assert.match(page, /combinedModelReviews/);
  assert.match(page, /AI reranking/);
  assert.match(page, /modelReviews=\{combinedModelReviews\}/);
  assert.match(page, /modelReviews\[listing\.id\]/);
  assert.match(page, /modelReady: siteModelState === "ready"/);
  assert.match(intelligence, /resaleMultiplier/);
  assert.match(intelligence, /authenticityContribution/);
  assert.match(intelligence, /engagementContribution/);
});

test("collapsible Search discovers unfamiliar public listing sites safely", async () => {
  const [page, route, safeWeb, analysis] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/web-listings/route.ts"),
    source("app/lib/safe-web.ts"),
    source("app/lib/analysis.ts"),
  ]);

  assert.match(page, /<h2>AI Search<\/h2>/);
  assert.match(page, /aiWebSearchSelected/);
  assert.match(page, /internationalMarketsOpen && \(aiWebSearchSelected \|\| forceAiSearch\)/);
  assert.match(page, /includeAiSearch/);
  assert.match(page, /fetchAiWebListingResults/);
  assert.match(page, /Exact-query secondhand discovery/);
  assert.match(page, /\/api\/web-listings/);
  assert.match(page, /webSearchAbortController\.current\?\.abort\(\)/);
  assert.match(page, /setWebSearchListings\(\[\]\)/);
  assert.match(page, /aiEngine\.planResearch/);
  assert.doesNotMatch(route, /body\.site|function sourceHost|site:\$\{host\}/);
  assert.match(route, /`"\$\{query\}" resale listing`/);
  assert.match(route, /readPublicWebPage\(item\.url, true\)/);
  assert.match(route, /extractReferenceProducts/);
  assert.match(route, /Public HTTPS pages only/);
  assert.match(safeWeb, /Local and private network hosts are blocked/);
  assert.match(analysis, /webDiscovered\?: boolean/);
  assert.match(analysis, /sourceName\?: string/);
});
