import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("defines normalized SupremeCommunity and authorized-retailer knowledge", async () => {
  const authenticity = await source("app/lib/authenticity.ts");

  for (const sourceName of ["SupremeCommunity", "Dover Street Market", "END.", "SSENSE"]) {
    assert.match(authenticity, new RegExp(sourceName.replace(".", "\\.")));
  }
  assert.match(authenticity, /\/season\/itemdetails\/\{id\}\/\{slug\}\//);
  assert.match(authenticity, /\/products\/\{product-handle\}/);
  assert.match(authenticity, /extractReferenceProducts/);
  assert.match(authenticity, /makeAuthenticityReport/);
  assert.match(authenticity, /Reference matching is a research aid, not a certification/);
  assert.match(authenticity, /"reference-consistent" \| "inconclusive" \| "high-risk"/);
});

test("navigates Supreme collections into individual item detail references", async () => {
  const route = await source("app/api/authenticity/route.ts");

  assert.match(route, /https:\/\/www\.supremecommunity\.com\/season\//);
  assert.match(route, /\/season\/itemdetails\//);
  assert.match(route, /seasonLinks/);
  assert.match(route, /itemLinks/);
  assert.match(route, /readReferencePage/);
  assert.match(route, /source\.searchScope/);
});

test("gives the local model sourced authenticity evidence", async () => {
  const page = await source("app/page.tsx");
  const intelligence = await source("app/lib/model-intelligence.ts");

  assert.match(page, /Authenticity research/);
  assert.match(page, /\/api\/authenticity/);
  assert.match(page, /assessAuthenticity/);
  assert.match(page, /AI-adjusted reference result/);
  assert.match(page, /Never certify real\/fake/);
  assert.match(page, /SupremeCommunity \+ authorized retailers/);
  assert.match(page, /candidate\.authenticity\?\.references/);
  assert.match(intelligence, /finalizeAuthenticityAssessment/);
  assert.match(intelligence, /The model may make the result more cautious freely/);
});

test("provides guarded public HTML, CSS, and JavaScript evidence tools", async () => {
  const [webRoute, safeWeb, page] = await Promise.all([
    source("app/api/web/route.ts"),
    source("app/lib/safe-web.ts"),
    source("app/page.tsx"),
  ]);

  assert.match(webRoute, /"search" \| "read" \| "asset"/);
  assert.match(webRoute, /readPublicWebPage/);
  assert.match(webRoute, /readPublicAsset/);
  assert.match(safeWeb, /Only public HTTPS pages can be researched/);
  assert.match(safeWeb, /Local and private network hosts are blocked/);
  assert.match(safeWeb, /Private and reserved IP ranges are blocked/);
  assert.match(safeWeb, /Only the standard HTTPS port is accepted/);
  assert.match(safeWeb, /never executed by ResaleMasterLab/);
  assert.match(page, /action: "search"/);
  assert.match(page, /action: "read"/);
  assert.match(page, /action: "asset"/);
  assert.match(page, /READ CSS|READ \$\{asset\.contentType\.includes\("css"\)/);
  assert.match(page, /read as inert text only/);
});
