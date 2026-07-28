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

test("all-market mode is bounded and does not multiply query variations", async () => {
  const page = await read("app/page.tsx");
  const client = await read("app/lib/frontend-marketplaces.ts");
  assert.match(page, /const allMarketsMode = requestMarkets\.length >= 6/);
  assert.match(page, /settleInBatches\(requestMarkets, allMarketsMode \? 2 : 3/);
  assert.match(page, /allMarketsMode \? \[literalQuery\]/);
  assert.match(page, /scanMode: allMarketsMode \? "all-markets" : "standard"/);
  assert.match(client, /MARKETPLACE_RELAY_CONCURRENCY = 3/);
  assert.match(client, /maxCandidates: allMarketsMode \? 1 : 4/);
  assert.match(client, /maxWorkers: allMarketsMode \? 1 : 3/);
});

test("marketplace relay permits every supported source family", async () => {
  const route = await read("app/api/listings/route.ts");
  for (const host of ["depop.com", "grailed.com", "poshmark.com", "zenmarket.jp", "rakuten.co.jp", "auctions.yahoo.co.jp", "fril.jp", "globalbunjang.com", "superbuy.com", "goofish.com", "2.taobao.com"]) {
    assert.match(route, new RegExp(host.replaceAll(".", "\\.")));
  }
});

test("Grailed nested cover photos produce an analysis-ready image", async (t) => {
  const found = await compiler(t); if (!found) return;
  const outDir = await mkdtemp(join(tmpdir(), "rml-grailed-v16-"));
  try {
    const input = fileURLToPath(new URL("../app/lib/marketplace-source-parsers.ts", import.meta.url));
    const result = spawnSync(found.command, [...found.prefix, "--target", "ES2022", "--module", "commonjs", "--outDir", outDir, input], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(join(outDir, "package.json"), '{"type":"commonjs"}\n');
    const parser = createRequire(import.meta.url)(join(outDir, "marketplace-source-parsers.js"));
    const record = parser.grailedHitToRecord({
      objectID: "12345",
      title: "Supreme Box Logo Hoodie",
      price: 220,
      cover_photo: { large: { url: "https://media-assets.grailed.com/prd/listing/hoodie.jpg" } },
      designers: [{ name: "Supreme" }],
    }, "active");
    assert.match(record.image, /media-assets\.grailed\.com/);
    assert.equal(record.price, 220);
    assert.match(record.url, /\/listings\/12345/);
  } finally { await rm(outDir, { recursive: true, force: true }); }
});

test("compact selector CSS remains syntactically balanced and mobile-safe", async () => {
  const css = await read("app/globals.css");
  const opens = (css.match(/\{/g) || []).length;
  const closes = (css.match(/\}/g) || []).length;
  assert.equal(opens, closes);
  assert.match(css, /grid-template-columns: minmax\(0, 1fr\) auto/);
  assert.match(css, /overflow-wrap: normal/);
  assert.match(css, /@media \(max-width: 420px\)/);
});

test("ZenMarket relay retries a compatibility endpoint and unwraps a real card payload", async (t) => {
  const found = await compiler(t); if (!found) return;
  const outDir = await mkdtemp(join(tmpdir(), "rml-zen-route-v16-"));
  const originalFetch = globalThis.fetch;
  try {
    const routeInput = fileURLToPath(new URL("../app/api/zenmarket-search/route.ts", import.meta.url));
    const parserInput = fileURLToPath(new URL("../app/lib/zenmarket-source-parsers.ts", import.meta.url));
    const appRoot = fileURLToPath(new URL("../app", import.meta.url));
    const result = spawnSync(found.command, [...found.prefix, "--target", "ES2022", "--module", "commonjs", "--lib", "ES2022,DOM", "--rootDir", appRoot, "--outDir", outDir, routeInput, parserInput], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(join(outDir, "package.json"), '{"type":"commonjs"}\n');
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls += 1;
      if (calls === 1) return new Response("not available", { status: 404 });
      return Response.json({ d: JSON.stringify({ Items: [{ ItemCode: "m123", ClearTitle: "Supreme tee", PreviewImageUrl: "https://static.mercdn.net/item/detail/orig/photos/m123.jpg", PriceTextControl: "¥12,800" }] }) });
    };
    const route = createRequire(import.meta.url)(join(outDir, "api/zenmarket-search/route.js"));
    const request = new Request("https://resalemasterlab.cloud-cord.com/api/zenmarket-search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ marketplace: "Mercari Japan", query: "supreme", page: 0 }),
    });
    const response = await route.POST(request);
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(payload.storeId, 27);
    assert.ok(calls >= 2);
    assert.equal(payload.data.Items[0].ItemCode, "m123");
    assert.match(payload.sourceUrl, /searchMode=custom&stores=27/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(outDir, { recursive: true, force: true });
  }
});
