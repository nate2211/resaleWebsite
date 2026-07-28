import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function compiler(t) {
  const local = new URL("../node_modules/typescript/bin/tsc", import.meta.url);
  try { await access(local); return { command: process.execPath, prefix: [fileURLToPath(local)] }; }
  catch {
    const probe = spawnSync("tsc", ["--version"], { encoding: "utf8" });
    if (probe.status !== 0) { t.skip("TypeScript compiler is unavailable."); return null; }
    return { command: "tsc", prefix: [] };
  }
}

test("Depop readable page cards and Grailed public index records produce real listings", async (t) => {
  const found = await compiler(t); if (!found) return;
  const outDir = await mkdtemp(join(tmpdir(), "rml-grailed-depop-"));
  try {
    const input = fileURLToPath(new URL("../app/lib/marketplace-source-parsers.ts", import.meta.url));
    const result = spawnSync(found.command, [
      ...found.prefix, "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node",
      "--outDir", outDir, input,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(join(outDir, "package.json"), '{"type":"commonjs"}\n');
    const require = createRequire(import.meta.url);
    const parser = require(join(outDir, "marketplace-source-parsers.js"));

    const depopMarkdown = `
# “supreme”(153K results)
1. [![Image 53: Supreme men's black and brown socks](https://media-photos.depop.com/r1/16996881/photo/P10.jpg)![Image 54: Supreme men's black and brown socks](https://media-photos.depop.com/r1/16996881/photo/P0.jpg)](https://www.depop.com/products/flyi9na813_-black-supreme-socks-2-pairs-582a/) Supreme

$24.99

$12.99
2. [![Image 55: Supreme hoodie](https://media-photos.depop.com/r1/22/hoodie/P0.jpg)](https://www.depop.com/products/seller-supreme-hoodie-abcd/) Supreme

M

$85.00
`;
    const depop = parser.parseDepopReaderMarkdown(depopMarkdown);
    assert.equal(depop.length, 2);
    assert.equal(depop[0].price, 12.99, "sale price should be the last displayed price");
    assert.match(depop[0].image, /media-photos\.depop\.com/);
    assert.doesNotMatch(depop[0].image, /favicon|\.ico/);
    assert.equal(depop[1].size, "M");

    const grailedSource = `window.PUBLIC_CONFIG={"algolia":{"app_id":"MNRWEFSS2Q","public_search_key":"c89dbaddf15fe70e1941a109bf7c2a3d","indexes":{"listings":[{"value":"Listing_production"},{"value":"Listing_sold_production"}]}}};`;
    const config = parser.parseGrailedPublicConfig(grailedSource);
    assert.equal(config.appId, "MNRWEFSS2Q");
    assert.equal(config.activeIndex, "Listing_production");
    assert.equal(config.soldIndex, "Listing_sold_production");

    const grailed = parser.grailedHitToRecord({
      objectID: "12345", title: "Supreme Box Logo Hoodie", price: 275,
      slug: "supreme-box-logo-hoodie", designers: [{ name: "Supreme" }],
      cover_photo: { original_url: "https://media-assets.grailed.com/hoodie.jpg" }, display_size: "M",
    }, "active");
    assert.equal(grailed.price, 275);
    assert.equal(grailed.brand, "Supreme");
    assert.match(grailed.url, /^\/listings\/12345-/);
    assert.match(grailed.image, /media-assets\.grailed\.com/);
  } finally { await rm(outDir, { recursive: true, force: true }); }
});

test("frontend uses Grailed public-index relay and parse-aware Depop reader fallback", async () => {
  const client = await readFile(new URL("../app/lib/frontend-marketplaces.ts", import.meta.url), "utf8");
  const route = await readFile(new URL("../app/api/grailed-search/route.ts", import.meta.url), "utf8");
  assert.match(client, /\/api\/grailed-search/);
  assert.match(client, /parseGrailedPublicConfig/);
  assert.match(client, /grailedHitToRecord/);
  assert.match(client, /parseDepopReaderMarkdown/);
  assert.match(client, /marketplace === "Depop" && !listings\.length/);
  assert.match(route, /algolia\.net|algolianet\.com/);
  assert.match(route, /partial:\s*true/);
  assert.match(route, /Listing_sold_production/);
  assert.match(route, /hitsPerPage:\s*24/);
  assert.doesNotMatch(route, /quickAction|BrowserRun|cloudflare:workers/);
});
