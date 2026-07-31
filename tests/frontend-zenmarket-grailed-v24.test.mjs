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

test("ZenMarket rejects Cloudflare/error envelopes and rebuilds normal product links from official stores", async (t) => {
  const found = await compiler(t); if (!found) return;
  const outDir = await mkdtemp(join(tmpdir(), "rml-zen-v25-"));
  try {
    const input = fileURLToPath(new URL("../app/lib/zenmarket-source-parsers.ts", import.meta.url));
    const result = spawnSync(found.command, [...found.prefix,
      "--target", "ES2022", "--module", "commonjs", "--lib", "ES2022,DOM", "--outDir", outDir, input,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(join(outDir, "package.json"), '{"type":"commonjs"}\n');
    const parser = createRequire(import.meta.url)(join(outDir, "zenmarket-source-parsers.js"));

    assert.equal(parser.isZenMarketChallengeSource('<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/">'), true);
    assert.equal(parser.zenMarketPayloadHasItems({ Message: "There was an error processing the request.", StackTrace: "", ExceptionType: "" }, "Mercari Japan"), false);

    const fixtures = [
      {
        marketplace: "Mercari Japan",
        sourceUrl: "https://jp.mercari.com/en/search?keyword=supreme",
        itemUrl: "https://jp.mercari.com/item/m123456789",
        code: "m123456789",
        route: "mercariproduct.aspx",
      },
      {
        marketplace: "JDirectItems Auction",
        sourceUrl: "https://auctions.yahoo.co.jp/search/search?p=supreme",
        itemUrl: "https://page.auctions.yahoo.co.jp/jp/auction/b1129248112",
        code: "b1129248112",
        route: "auction.aspx",
      },
      {
        marketplace: "Rakuten",
        sourceUrl: "https://search.rakuten.co.jp/search/mall/supreme/",
        itemUrl: "https://item.rakuten.co.jp/golden-state/10042419/",
        code: "golden-state:10042419",
        route: "rakutenproduct.aspx",
      },
      {
        marketplace: "Rakuten Rakuma",
        sourceUrl: "https://fril.jp/s?query=supreme",
        itemUrl: "https://item.fril.jp/402ce1b88a475da3e37f87e00783abd4",
        code: "402ce1b88a475da3e37f87e00783abd4",
        route: "rakumaproduct.aspx",
      },
    ];

    for (const fixture of fixtures) {
      const html = `<article><h3>Supreme Box Logo Tee</h3><img src="https://images.example.test/${fixture.code}.jpg" alt="Supreme Box Logo Tee"><a href="${fixture.itemUrl}">Supreme Box Logo Tee</a><span>¥12,800</span></article>`;
      const records = parser.parseOfficialStorePageSource(html, fixture.marketplace, fixture.sourceUrl);
      assert.equal(records.length, 1, fixture.marketplace);
      assert.equal(records[0].itemCode, fixture.code);
      assert.equal(records[0].price, 12800);
      assert.match(records[0].url, new RegExp(`zenmarket\\.jp/${fixture.route}\\?`));
      assert.equal(new URL(records[0].url).searchParams.get("itemCode"), fixture.code);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test("Grailed uses the quality index, returns strict current cards, and keeps the broad count diagnostic-only", async (t) => {
  const found = await compiler(t); if (!found) return;
  const outDir = await mkdtemp(join(tmpdir(), "rml-grailed-v25-"));
  const originalFetch = globalThis.fetch;
  try {
    const routeInput = fileURLToPath(new URL("../app/api/grailed-search/route.ts", import.meta.url));
    const parserInput = fileURLToPath(new URL("../app/lib/marketplace-source-parsers.ts", import.meta.url));
    const appRoot = fileURLToPath(new URL("../app", import.meta.url));
    const result = spawnSync(found.command, [...found.prefix,
      "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node",
      "--lib", "ES2022,DOM", "--rootDir", appRoot, "--outDir", outDir, routeInput, parserInput,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(join(outDir, "package.json"), '{"type":"commonjs"}\n');

    const calls = [];
    globalThis.fetch = async (url) => {
      calls.push(String(url));
      return Response.json({
        results: [{
          nbHits: 128,
          page: 0,
          nbPages: 6,
          hits: [
            {
              objectID: "94344907",
              id: 94344907,
              title: "Supreme Box Logo Hoodie",
              slug: "supreme-box-logo-hoodie",
              price: 275,
              designer_names: "Supreme",
              category: "tops",
              created_at: "2026-07-31T00:00:00Z",
              cover_photo: { original_url: "https://media-assets.grailed.com/prd/listing/94344907/real-photo" },
            },
            {
              id: 1,
              name: "chest",
              image_url: "https://media-assets.grailed.com/prd/measurement-type/bad",
              buyer_description: "measurement config",
            },
          ],
        }],
      });
    };

    const route = createRequire(import.meta.url)(join(outDir, "api/grailed-search/route.js"));
    const response = await route.POST(new Request("https://resalemasterlab.cloud-cord.com/api/grailed-search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "supreme", page: 0, mode: "active", index: "Listing_production",
        appId: "MNRWEFSS2Q", apiKey: "c89dbaddf15fe70e1941a109bf7c2a3d",
      }),
    }));
    const payload = await response.json();
    assert.equal(payload.nbHits, 1);
    assert.equal(payload.rawNbHits, 128);
    assert.equal(payload.hits.length, 1);
    assert.equal(payload.index, "Listing_by_listing_quality_production");
    assert.match(payload.hits[0].url, /grailed\.com\/listings\/94344907/);
    assert.match(payload.hits[0].image, /\/prd\/listing\/94344907\//);
    assert.doesNotMatch(JSON.stringify(payload.hits), /measurement-type/);
    assert.match(calls[0], /mnrwefss2q-dsn\.algolia\.net\/1\/indexes\/\*\/queries/);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(outDir, { recursive: true, force: true });
  }
});

test("frontend reports Grailed posts instead of unavailable and retains extension-free fallbacks", async () => {
  const client = await read("app/lib/frontend-marketplaces.ts");
  const page = await read("app/page.tsx");
  const route = await read("app/api/grailed-search/route.ts");
  const zenRoute = await read("app/api/zenmarket-search/route.ts");

  assert.match(route, /\$\{normalized\}-1\.algolianet\.com/);
  assert.doesNotMatch(route, /1-\$\{normalized\}-dsn/);
  assert.match(route, /\/1\/indexes\/\*\/queries/);
  assert.match(client, /directGrailedAlgoliaFetch/);
  assert.match(client, /totalResults\?: number/);
  assert.match(client, /0 Grailed posts matched this search/);
  assert.match(client, /0 Grailed posts loaded after the bounded public page and listing-index checks/);
  assert.match(client, /status: "live"[\s\S]{0,260}totalResults: 0/);
  assert.match(page, /\$\{state\.listings\.length\} loaded \/ \$\{state\.totalResults\} found/);
  assert.match(page, /totalResults: reportedTotal/);
  assert.match(zenRoute, /parseOfficialStorePageSource/);
  assert.match(zenRoute, /join\("%2B"\)/);
  assert.match(zenRoute, /jp\.mercari\.com\/en\/search\?keyword=/);
  assert.match(zenRoute, /No complete ZenMarket products were returned/);
  assert.doesNotMatch(zenRoute, /result\.data !== null\)[\s\S]{0,120}error processing/i);
});
