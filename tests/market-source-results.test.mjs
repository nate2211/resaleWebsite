import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("uses dedicated ZenMarket routes with indexed original-market fallbacks", async () => {
  const route = await source("app/api/listings/route.ts");
  for (const token of [
    "zenmarket.jp/en/yahoo.aspx",
    "zenmarket.jp/en/rakuten.aspx",
    "zenmarket.jp/en/rakuma.aspx",
    "auctions.yahoo.co.jp/search/search",
    "search.rakuten.co.jp/search/mall",
    "fril.jp/s?query=",
    "zenmarket.jp/en/auction.aspx",
    "zenmarket.jp/en/rakutenproduct.aspx",
    "auctions.yahoo.co.jp/auction",
    "item.rakuten.co.jp",
    "item.fril.jp",
  ]) assert.ok(route.includes(token), `Missing marketplace source token: ${token}`);
  assert.match(route, /Promise\.allSettled/);
  assert.match(route, /priceFromPublicText/);
  assert.match(route, /Public search evidence was used/);
});

test("restores Depop, Mercari Japan, and Goofish discovery routes", async () => {
  const [route, page, analysis] = await Promise.all([
    source("app/api/listings/route.ts"),
    source("app/page.tsx"),
    source("app/lib/analysis.ts"),
  ]);
  for (const token of [
    "depop.com/brands/",
    "depop.com/theme/",
    "depop.com/search/?q=",
    "site:depop.com/products",
    "jp.mercari.com/en/search?keyword=",
    "jp.mercari.com/search?keyword=",
    "site:jp.mercari.com/en/item",
    "www.goofish.com/search?q=",
    "site:goofish.com/item",
    "www.superbuy.com/en/page/buy/selfservice/",
    "www.superbuy.com/en/page/search/",
    "platform",
    "mercari.jp/v2/entities:search",
    "html.duckduckgo.com/html/",
    "searchHtmlItems",
  ]) assert.ok(route.includes(token), `Missing restored source route: ${token}`);
  assert.match(route, /host\.endsWith\("goofish\.com"\)/);
  assert.match(route, /proxyUrl: superbuyProxyUrl/);
  assert.match(analysis, /home: "https:\/\/www\.goofish\.com\/"/);
  assert.match(page, /Buy through Superbuy/);
  assert.match(page, /hasMore: Boolean\(response\.hasMore\) && addedCount > 0/);
});

test("normalizes public marketplace records and yen snippets", async (t) => {
  const localTsc = new URL("../node_modules/typescript/bin/tsc", import.meta.url);
  let command = "tsc";
  let prefix = [];
  try {
    await access(localTsc);
    command = process.execPath;
    prefix = [fileURLToPath(localTsc)];
  } catch {
    const probe = spawnSync("tsc", ["--version"], { encoding: "utf8" });
    if (probe.status !== 0) { t.skip("TypeScript compiler is not available."); return; }
  }
  const outDir = await mkdtemp(join(tmpdir(), "rml-market-source-"));
  try {
    const input = new URL("app/lib/public-listing-record.ts", root);
    const result = spawnSync(command, [
      ...prefix,
      "--noCheck", "--target", "ES2022", "--module", "NodeNext", "--moduleResolution", "NodeNext",
      "--outDir", outDir, fileURLToPath(input),
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const module = await import(pathToFileURL(join(outDir, "public-listing-record.js")));
    assert.deepEqual(module.priceFromPublicText("Public result ¥25,800"), { amount: 25800, currency: "JPY" });
    assert.deepEqual(module.priceFromPublicText("Public result 12,345円"), { amount: 12345, currency: "JPY" });
    const goofish = module.normalizePublicListingRecord({
      itemId: "1060593587010", itemTitle: "Raf Simons Runner", price: "988", currency: "CNY",
    }, "Goofish", "https://www.goofish.com/search?q=raf%20simons");
    assert.equal(goofish?.rawUrl, "https://www.goofish.com/item?id=1060593587010");
    assert.equal(goofish?.amount, 988);
    const mercari = module.normalizePublicListingRecord({
      id: "m12204888791", name: "RAF SIMONS T-Shirt", price: 18000, priceCurrency: "JPY",
    }, "Mercari Japan", "https://jp.mercari.com/en/search?keyword=raf%20simons");
    assert.equal(mercari?.rawUrl, "https://jp.mercari.com/en/item/m12204888791");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});


test("uses Cloudflare Browser Run only as a zero-card fallback", async () => {
  const [route, worker, wrangler, packageJson, vite] = await Promise.all([
    source("app/api/listings/route.ts"),
    source("worker/index.ts"),
    source("wrangler.vinext-build.toml"),
    source("package.json"),
    source("vite.config.ts"),
  ]);
  assert.match(route, /browserRenderedItems/);
  assert.match(route, /quickAction\("content"/);
  assert.match(route, /quickAction\("links"/);
  assert.match(route, /waitForSelector/);
  assert.match(route, /if \(items\.size === 0\)/);
  assert.match(worker, /__RML_BROWSER__/);
  assert.match(worker, /env\.BROWSER/);
  assert.match(wrangler, /\[browser\]/);
  assert.match(wrangler, /binding = "BROWSER"/);
  assert.match(wrangler, /remote = true/);
  assert.match(packageJson, /vite --mode cloudflare/);
  assert.match(packageJson, /vite --mode local/);
  assert.match(vite, /cloudflareDevelopment/);
});
