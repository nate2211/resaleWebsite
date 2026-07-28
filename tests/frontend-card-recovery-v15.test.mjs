import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

async function compiler(t) {
  const local = new URL("../node_modules/typescript/bin/tsc", import.meta.url);
  try { await access(local); return { command: process.execPath, prefix: [fileURLToPath(local)] }; }
  catch {
    const probe = spawnSync("tsc", ["--version"], { encoding: "utf8" });
    if (probe.status !== 0) { t.skip("TypeScript compiler is unavailable."); return null; }
    return { command: "tsc", prefix: [] };
  }
}

test("market selector uses a compact responsive panel without the old forced text gap", async () => {
  const page = await read("app/page.tsx");
  const css = await read("app/globals.css");
  assert.match(page, /market-selection-panel/);
  assert.match(page, /market-selection-buttons/);
  assert.match(page, /market-selection-note/);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.doesNotMatch(css, /market-selection-actions small[\s\S]{0,160}flex:\s*1 1 300px/);
});

test("Depop plain and image-wrapped product links remain recoverable", async (t) => {
  const found = await compiler(t); if (!found) return;
  const outDir = await mkdtemp(join(tmpdir(), "rml-depop-v15-"));
  try {
    const input = fileURLToPath(new URL("../app/lib/marketplace-source-parsers.ts", import.meta.url));
    const result = spawnSync(found.command, [...found.prefix, "--target", "ES2022", "--module", "commonjs", "--outDir", outDir, input], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(join(outDir, "package.json"), '{"type":"commonjs"}\n');
    const parser = createRequire(import.meta.url)(join(outDir, "marketplace-source-parsers.js"));
    const source = `1. [![Image 1: Supreme tee](https://media-photos.depop.com/r1/1/P0.jpg)](https://www.depop.com/products/seller-supreme-tee-abcd/) Supreme\nM\n$55.00\n\nself.__next_f.push([1,"{\\"title\\":\\"Supreme Hoodie\\",\\"url\\":\\"\\/products\\/seller-supreme-hoodie-efgh\\/\\",\\"price\\":75}"]);`;
    const cards = parser.parseDepopReaderMarkdown(source);
    assert.equal(cards.length, 2);
    assert.match(cards[0].url, /depop\.com\/products\//);
    assert.match(cards[0].image, /media-photos\.depop\.com/);
    assert.equal(cards[0].price, 55);
  } finally { await rm(outDir, { recursive: true, force: true }); }
});

test("ZenMarket nested AJAX payloads produce canonical cards for every configured store", async (t) => {
  const found = await compiler(t); if (!found) return;
  const outDir = await mkdtemp(join(tmpdir(), "rml-zen-v15-"));
  try {
    const input = fileURLToPath(new URL("../app/lib/zenmarket-source-parsers.ts", import.meta.url));
    const result = spawnSync(found.command, [...found.prefix, "--target", "ES2022", "--module", "commonjs", "--outDir", outDir, input], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(join(outDir, "package.json"), '{"type":"commonjs"}\n');
    const parser = createRequire(import.meta.url)(join(outDir, "zenmarket-source-parsers.js"));
    for (const [marketplace, expected] of [
      ["Mercari Japan", "mercariproduct.aspx"],
      ["JDirectItems Auction", "auction.aspx"],
      ["Rakuten", "rakutenproduct.aspx"],
      ["Rakuten Rakuma", "rakumaproduct.aspx"],
    ]) {
      const wrapped = { d: JSON.stringify({ Items: [{ ItemCode: "shop:item-1", ClearTitle: "Supreme test shirt", PreviewImageUrl: "https://example.test/photo.jpg", PriceTextControl: '<span data-jpy="12800">¥12,800</span>' }] }) };
      const records = parser.zenMarketCatalogRecords(wrapped, marketplace);
      assert.equal(records.length, 1);
      assert.match(records[0].url, new RegExp(expected.replace(".", "\\.")));
      assert.equal(records[0].price, 12800);
      assert.equal(records[0].currency, "JPY");
    }
  } finally { await rm(outDir, { recursive: true, force: true }); }
});

test("ZenMarket catalog relay is bounded and degrades to a partial HTTP 200", async () => {
  const route = await read("app/api/zenmarket-search/route.ts");
  assert.match(route, /mercari\.aspx\/getProducts/);
  assert.match(route, /rakuten\.aspx\/getProducts/);
  assert.match(route, /rakuma\.aspx\/getProducts/);
  assert.match(route, /yahoo\.aspx\/getProducts/);
  assert.match(route, /TOTAL_TIMEOUT_MS = 12_000/);
  assert.match(route, /ATTEMPT_TIMEOUT_MS = 4_500/);
  assert.match(route, /search\.aspx\/GetProducts/);
  assert.match(route, /partial: true/);
  assert.match(route, /Response\.json/);
});

test("frontend tries one ZenMarket catalog call before sequential page-source fallbacks", async () => {
  const client = await read("app/lib/frontend-marketplaces.ts");
  assert.match(client, /frontendZenMarketCatalogFetch/);
  assert.match(client, /for \(const url of urls\.slice\(0, requestLimit\)\)/);
  assert.match(client, /if \(listings\.length >= 8\) break/);
  assert.match(client, /zenMarketCatalogRecords/);
  assert.doesNotMatch(client, /storeId === "0"[^\n]*canonicalListingUrl/);
});
