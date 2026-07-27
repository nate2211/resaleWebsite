import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("starts empty and does not generate demo listings or synthetic comps", async () => {
  const [page, analysis] = await Promise.all([
    source("app/page.tsx"),
    source("app/lib/analysis.ts"),
  ]);
  assert.match(page, /useState<Listing\[]>\(\[\]\)/);
  assert.match(page, /useState\(""\)/);
  assert.doesNotMatch(page, /SAMPLE_LISTINGS/);
  assert.doesNotMatch(analysis, /demo-supreme|SAMPLE_LISTINGS/);
  assert.doesNotMatch(page, /price \* 1\.35/);
  assert.match(page, /verifiedComps\.Depop = compPrices\.Depop/);
  assert.match(analysis, /expectedSale = prices\.length \? median\(prices\) : 0/);
});

test("checks favorites and watched listings with bounded local-model interpretation", async () => {
  const [page, route, parser] = await Promise.all([
    source("app/page.tsx"),
    source("app/api/watch-status/route.ts"),
    source("app/lib/watch-status.ts"),
  ]);
  assert.match(page, /Check favorite listings/);
  assert.match(page, /checkMonitoredListings\(scope: "favorites" \| "all"\)/);
  assert.match(page, /assessWatchStatus/);
  assert.match(page, /modelStatus: assessment\.status/);
  assert.match(page, /soldPrice/);
  assert.match(page, /soldAt/);
  assert.match(route, /Public page evidence only/);
  assert.match(route, /no login or bot bypass/i);
  assert.match(parser, /active" \| "sold" \| "removed" \| "unknown/);
});

test("extracts a published sold price and sold date without inventing missing fields", async () => {
  const watchUrl = new URL("../app/lib/watch-status.ts", import.meta.url).href;
  const script = String.raw`
    import { extractWatchStatus } from ${JSON.stringify(watchUrl)};
    const sold = extractWatchStatus({
      html: '<script type="application/ld+json">' + JSON.stringify({
        "@type":"Product", name:"Test Tee", soldPrice:"84.00", offers:{price:"96.00", priceCurrency:"USD", availability:"https://schema.org/SoldOut"}, soldAt:"2026-07-25T18:20:00Z"
      }) + '<\\/script>',
      text: 'This item sold', url: 'https://example.com/item', finalUrl: 'https://example.com/item', title: 'Test Tee', httpStatus: 200,
    });
    const active = extractWatchStatus({
      html: '<script type="application/ld+json">' + JSON.stringify({"@type":"Product", offers:{availability:"https://schema.org/InStock"}}) + '<\\/script>',
      text: 'Buy now', url: 'https://example.com/active', finalUrl: 'https://example.com/active', title: 'Active Tee', httpStatus: 200,
    });
    console.log(JSON.stringify({sold, active}));
  `;
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "--eval", script], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout.trim());
  assert.equal(output.sold.status, "sold");
  assert.equal(output.sold.soldPrice, 84);
  assert.equal(output.sold.soldAt, "2026-07-25T18:20:00.000Z");
  assert.equal(output.active.status, "active");
  assert.equal(output.active.soldPrice, undefined);
});

test("opens engagement and authenticity while keeping international analysis closed", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /engagementOpen, setEngagementOpen\] = useState\(true\)/);
  assert.match(page, /authenticityOpen, setAuthenticityOpen\] = useState\(true\)/);
  assert.match(page, /internationalAnalysisOpen, setInternationalAnalysisOpen\] = useState\(false\)/);
  assert.match(page, /setInternationalAnalysisOpen\(false\)/);
});
