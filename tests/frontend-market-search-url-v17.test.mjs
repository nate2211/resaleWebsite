import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
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

test("selector is below default marketplace cards and uses natural wrapping", async () => {
  const page = await read("app/page.tsx");
  const css = await read("app/globals.css");
  assert.ok(page.indexOf("default-marketplace-grid") < page.indexOf("market-selection-panel"));
  assert.match(css, /\.default-query-options \{[\s\S]*display: flex !important/);
  assert.match(css, /hyphens: none/);
  const selectorCss = css.slice(css.lastIndexOf(".market-selection-panel {"));
  assert.doesNotMatch(selectorCss, /minmax\(220px, 1fr\)/);
});

test("exact ZenMarket search stores and root product routes are preserved", async (t) => {
  const client = await read("app/lib/frontend-marketplaces.ts");
  assert.match(client, /function encodeZenMarketQuery/);
  assert.match(client, /q=\$\{zenQ\}&p=\$\{p\}&searchMode=custom&stores=27/);
  for (const store of [27, 28, 0, 25]) {
    assert.match(client, new RegExp(`searchMode=custom&stores=${store}`));
  }
  const found = await compiler(t); if (!found) return;
  const outDir = await mkdtemp(join(tmpdir(), "rml-zen-v17-"));
  try {
    const input = fileURLToPath(new URL("../app/lib/zenmarket-source-parsers.ts", import.meta.url));
    const result = spawnSync(found.command, [...found.prefix, "--target", "ES2022", "--module", "commonjs", "--lib", "ES2022,DOM", "--outDir", outDir, input], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(join(outDir, "package.json"), '{"type":"commonjs"}\n');
    const parser = createRequire(import.meta.url)(join(outDir, "zenmarket-source-parsers.js"));
    const fixtures = [
      ["Mercari Japan", "m51717888914", "mercariproduct.aspx", 27],
      ["JDirectItems Auction", "b1129248112", "auction.aspx", 28],
      ["Rakuten", "golden-state:10042419", "rakutenproduct.aspx", 0],
      ["Rakuten Rakuma", "402ce1b88a475da3e37f87e00783abd4", "rakumaproduct.aspx", 25],
    ];
    for (const [marketplace, code, route, store] of fixtures) {
      const sourceUrl = `https://zenmarket.jp/en/search.aspx?q=raf%2Bsimons&p=1&searchMode=custom&stores=${store}`;
      const source = `<article><a class="product-item product-link" href="https://zenmarket.jp/${route}?itemCode=${encodeURIComponent(code)}&q=raf%20simons&p=1&pos=1"><img src="https://zenmarket.jp/img/${store}.jpg"><h3 class="item-title">Raf Simons item</h3><span>¥12,800</span></a></article>`;
      const cards = parser.parseZenMarketPageSource(source, marketplace, sourceUrl);
      assert.equal(cards.length, 1, marketplace);
      assert.match(cards[0].url, new RegExp(`zenmarket\\.jp/${route}\\?`));
      assert.equal(new URL(cards[0].url).searchParams.get("itemCode"), code);
      assert.equal(cards[0].price, 12800);
    }
  } finally { await rm(outDir, { recursive: true, force: true }); }
});

test("Depop product source returns canonical data and first-party image", async (t) => {
  const found = await compiler(t); if (!found) return;
  const outDir = await mkdtemp(join(tmpdir(), "rml-depop-v17-"));
  try {
    const input = fileURLToPath(new URL("../app/lib/marketplace-source-parsers.ts", import.meta.url));
    const result = spawnSync(found.command, [...found.prefix, "--target", "ES2022", "--module", "commonjs", "--lib", "ES2022,DOM", "--outDir", outDir, input], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(join(outDir, "package.json"), '{"type":"commonjs"}\n');
    const parser = createRequire(import.meta.url)(join(outDir, "marketplace-source-parsers.js"));
    const url = "https://www.depop.com/products/_bing_pong_-anti-social-social-club-floral-e98a/";
    const source = `
      <meta property="og:title" content="Anti Social Social Club Men's Black T-shirt | Depop">
      <meta property="og:image" content="https://media-photos.depop.com/b1/123/P0.jpg">
      <meta property="product:price:amount" content="9.99">
      # Anti Social Social Club Men's Black T-shirt
      Size L
      Excellent condition
      • Anti Social Social Club
      item listed by _bing_bong_
    `;
    const item = parser.parseDepopProductPageSource(source, url);
    assert.equal(item.url, url);
    assert.equal(item.price, 9.99);
    assert.equal(item.size, "L");
    assert.match(item.image, /media-photos\.depop\.com/);
    assert.match(item.title, /Anti Social Social Club/);
  } finally { await rm(outDir, { recursive: true, force: true }); }
});
