import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("normalizes public engagement for supported marketplaces", async () => {
  const engagement = await source("app/lib/engagement.ts");

  for (const marketplace of ["Depop", "Grailed", "Poshmark"]) {
    assert.match(engagement, new RegExp(marketplace));
  }
  assert.match(engagement, /extractMarketplaceEngagement/);
  assert.match(engagement, /popularityScore/);
  assert.match(engagement, /likesPerDay/);
  assert.match(engagement, /viewsPerDay/);
  assert.match(engagement, /Missing likes are reported as unknown, not zero/);
  assert.match(engagement, /Poshmark shares mainly measure closet recirculation/);
  assert.match(engagement, /listing is boosted/);
  assert.match(engagement, /React Flight \/ Next hydration state/);
  assert.match(engagement, /JSON-LD and meta tags/);
  assert.match(engagement, /visible public counters/);
  assert.match(engagement, /findLabeledNumber/);
  assert.match(engagement, /readMethods/);
  assert.match(engagement, /did not publish readable/);
});

test("guards engagement requests and avoids private Depop manage pages", async () => {
  const route = await source("app/api/engagement/route.ts");

  assert.match(route, /marketplaceFromUrl/);
  assert.match(route, /Only public Depop, Grailed, and Poshmark HTTPS listing pages are supported/);
  assert.match(route, /replace\(\/\\\/manage/);
  assert.match(route, /hostname/);
  assert.match(route, /redirect/);
  assert.match(route, /MAX_HTML_LENGTH/);
  assert.match(route, /cache/);
});

test("shows engagement in Deep Inspection and gives it to the local model", async () => {
  const page = await source("app/page.tsx");
  const intelligence = await source("app/lib/model-intelligence.ts");

  assert.match(page, /Marketplace engagement/);
  assert.match(page, /\/api\/engagement/);
  assert.match(page, /Read marketplace engagement/);
  assert.match(page, /age-adjusted popularity reports/);
  assert.match(page, /Missing metrics remain unknown rather than zero/);
  assert.match(page, /popularitySignal/);
  assert.match(page, /never let popularity override sold-price evidence or net profit/);
  assert.match(page, /popularitySignals/);
  assert.match(page, /engagement-pill/);
  assert.match(page, /AI-adjusted popularity/);
  assert.match(page, /Get all public engagement/);
  assert.match(page, /engagementReport\.readMethods/);
  assert.match(page, /assessEngagement/);
  assert.match(intelligence, /finalizeEngagementAssessment/);
});

test("keeps popularity a bounded secondary analysis signal", async () => {
  const analysis = await source("app/lib/analysis.ts");

  assert.match(analysis, /engagementScore/);
  assert.match(analysis, /engagementEvidence/);
  assert.match(analysis, /popularityAdjustment/);
  assert.match(analysis, /Math\.max\(-3, Math\.min\(9/);
});
