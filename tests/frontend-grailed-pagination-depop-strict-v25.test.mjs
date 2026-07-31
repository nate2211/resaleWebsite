import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

async function compiler(t) {
  const local = new URL("../node_modules/typescript/bin/tsc", import.meta.url);
  try { await access(local); return { command: process.execPath, prefix: [fileURLToPath(local)] }; }
  catch {
    const probe = spawnSync("tsc", ["--version"], { encoding: "utf8" });
    if (probe.status !== 0) { t.skip("TypeScript compiler is unavailable."); return null; }
    return { command: "tsc", prefix: [] };
  }
}

test("Grailed requests one current quality-ranked 40-hit page and hides the broad historical count", async (t) => {
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

    const requestOptions = [];
    globalThis.fetch = async (_url, init = {}) => {
      requestOptions.push(init);
      const current = Array.from({ length: 40 }, (_, index) => ({
        id: 90000000 + index,
        objectID: String(90000000 + index),
        title: `Raf Simons Listing ${index}`,
        slug: `raf-simons-listing-${index}`,
        price: 100 + index,
        designer_names: "Raf Simons",
        category: "tops",
        created_at: "2026-07-31T00:00:00Z",
        cover_photo: { original_url: `https://media-assets.grailed.com/prd/listing/${90000000 + index}/photo-${index}` },
      }));
      const stale = Array.from({ length: 10 }, (_, index) => ({
        id: 80000000 + index, objectID: String(80000000 + index), title: `Raf Simons Stale ${index}`,
        slug: `raf-simons-stale-${index}`, price: 80, designer_names: "Raf Simons", category: "tops",
        created_at: "2018-01-01T00:00:00Z",
        cover_photo: { original_url: `https://media-assets.grailed.com/prd/listing/${80000000 + index}/photo-${index}` },
      }));
      const unrelated = Array.from({ length: 5 }, (_, index) => ({
        id: 70000000 + index, objectID: String(70000000 + index), title: `Unrelated Listing ${index}`,
        slug: `unrelated-listing-${index}`, price: 50, designer_names: "Other", category: "tops",
        created_at: "2026-07-31T00:00:00Z",
        cover_photo: { original_url: `https://media-assets.grailed.com/prd/listing/${70000000 + index}/photo-${index}` },
      }));
      return Response.json({ results: [{ nbHits: 93000, page: 0, nbPages: 2325, hits: [...current, ...stale, ...unrelated] }] });
    };

    const route = createRequire(import.meta.url)(join(outDir, "api/grailed-search/route.js"));
    const response = await route.POST(new Request("https://example.test/api/grailed-search", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "raf simons", page: 0, mode: "active", index: "Listing_production", appId: "MNRWEFSS2Q", apiKey: "c89dbaddf15fe70e1941a109bf7c2a3d" }),
    }));
    const payload = await response.json();
    assert.equal(requestOptions[0].redirect, "manual");
    const requestBody = JSON.parse(requestOptions[0].body);
    assert.equal(requestBody.requests[0].indexName, "Listing_by_listing_quality_production");
    assert.match(requestBody.requests[0].params, /hitsPerPage=40/);
    assert.match(requestBody.requests[0].params, /advancedSyntax=true/);
    assert.equal(payload.hits.length, 40);
    assert.equal(payload.nbHits, 40);
    assert.equal(payload.rawNbHits, 93000);
    assert.ok(payload.filteredIrrelevantOrStaleHits >= 15);
    assert.equal(payload.pageSize, 40);
    assert.equal(payload.hasMore, true);
    assert.equal(payload.nextPage, 1);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(outDir, { recursive: true, force: true });
  }
});

test("Depop rejects profile-shaped product paths and only accepts real priced product photos", async (t) => {
  const found = await compiler(t); if (!found) return;
  const outDir = await mkdtemp(join(tmpdir(), "rml-depop-v25-"));
  try {
    const input = fileURLToPath(new URL("../app/lib/marketplace-source-parsers.ts", import.meta.url));
    const result = spawnSync(found.command, [...found.prefix,
      "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--outDir", outDir, input,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(join(outDir, "package.json"), '{"type":"commonjs"}\n');
    const parser = createRequire(import.meta.url)(join(outDir, "marketplace-source-parsers.js"));

    const profile = parser.parseDepopProductPageSource(
      '<title>Depop</title><img src="https://contentful.depop.com/navigation.jpg"><p>$12</p>',
      "https://www.depop.com/products/zostasho24/",
    );
    assert.equal(profile, null);

    const url = "https://www.depop.com/products/seller-supreme-box-logo-hoodie-a1b2/";
    const product = parser.parseDepopProductPageSource(`<!doctype html><html><head>
      <meta property="og:title" content="Supreme Box Logo Hoodie | Depop">
      <meta property="og:image" content="https://media-photos.depop.com/b1/123/P0.jpg">
      <meta property="product:price:amount" content="185">
      <meta name="description" content="Supreme hoodie in good condition">
    </head></html>`, url);
    assert.ok(product);
    assert.equal(product.price, 185);
    assert.match(product.image, /^https:\/\/media-photos\.depop\.com\//);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});


test("Depop normal search HTML yields current cards with P0 photos and discounted prices", async (t) => {
  const found = await compiler(t); if (!found) return;
  const outDir = await mkdtemp(join(tmpdir(), "rml-depop-search-v26-"));
  try {
    const input = fileURLToPath(new URL("../app/lib/marketplace-source-parsers.ts", import.meta.url));
    const result = spawnSync(found.command, [...found.prefix,
      "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node", "--outDir", outDir, input,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(join(outDir, "package.json"), '{"type":"commonjs"}\n');
    const parser = createRequire(import.meta.url)(join(outDir, "marketplace-source-parsers.js"));
    const html = `<!doctype html><html><body><ul><li class="product-row">
      <div class="productCardRoot"><div class="productImageContainer"><a aria-label="Raf simons men's grey sweatshirt" href="/products/shelfaschive_-raf-simons-aw05-peter-de-0ece/?isBoostedView=true">
      <img src="https://media-photos.depop.com/b1/365402392/4315869052_hash/P10.jpg" alt="Raf simons men's grey sweatshirt">
      <img src="https://media-photos.depop.com/b1/365402392/4315869052_hash/P0.jpg" alt="Raf simons men's grey sweatshirt"></a></div>
      <div class="productAttributes"><p class="brandName">Raf Simons</p><p class="sizeAttributeText">XL</p>
      <p aria-description="Full price">$230.00</p><p aria-description="Discounted price">$160.00</p></div></div></li></ul></body></html>`;
    const rows = parser.parseDepopSearchPageSource(html, "https://www.depop.com/search/?q=raf+simons");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].price, 160);
    assert.equal(rows[0].brand, "Raf Simons");
    assert.equal(rows[0].size, "XL");
    assert.match(rows[0].image, /\/P0\.jpg$/);
    assert.equal(rows[0].url, "https://www.depop.com/products/shelfaschive_-raf-simons-aw05-peter-de-0ece/");
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});


test("Grailed sold mode uses the sold index and sold price with the same 40-hit page contract", async (t) => {
  const found = await compiler(t); if (!found) return;
  const outDir = await mkdtemp(join(tmpdir(), "rml-grailed-sold-v25-"));
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

    let postedBody;
    globalThis.fetch = async (_url, init = {}) => {
      postedBody = JSON.parse(init.body);
      return Response.json({ results: [{
        nbHits: 81, page: 0, nbPages: 3,
        hits: [{
          id: 99595713, objectID: "99595713", title: "Supreme MM6 Box Logo Hoodie",
          slug: "supreme-mm6-box-logo-hoodie", sold_price: 410, price: 495,
          designer_names: "Supreme", category: "tops", sold_at: "2026-07-30T00:00:00Z",
          cover_photo: { original_url: "https://media-assets.grailed.com/prd/listing/99595713/sold-photo" },
        }],
      }] });
    };
    const route = createRequire(import.meta.url)(join(outDir, "api/grailed-search/route.js"));
    const response = await route.POST(new Request("https://example.test/api/grailed-search", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "supreme hoodie", page: 0, mode: "sold", index: "Listing_sold_production", appId: "MNRWEFSS2Q", apiKey: "c89dbaddf15fe70e1941a109bf7c2a3d" }),
    }));
    const payload = await response.json();
    assert.equal(postedBody.requests[0].indexName, "Listing_sold_production");
    assert.match(postedBody.requests[0].params, /hitsPerPage=40/);
    assert.equal(payload.hits[0].price, 410);
    assert.match(payload.hits[0].description, /sold-price evidence/i);
    assert.equal(payload.hasMore, true);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(outDir, { recursive: true, force: true });
  }
});

test("frontend caps each marketplace page at 40 and can continue through twenty pages", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const client = await readFile(new URL("../app/lib/frontend-marketplaces.ts", import.meta.url), "utf8");
  assert.match(page, /\.values\(\)\]\.slice\(0, 40\)/);
  assert.match(page, /page >= 19/);
  assert.match(client, /const MARKETPLACE_PAGE_SIZE = 40/);
  assert.match(client, /const MAX_MARKETPLACE_PAGES = 20/);
  assert.match(client, /marketplace === "Depop"[\s\S]{0,120}filter\(isCompleteDepopListing\)/);
  assert.match(client, /marketplace === "Grailed" \? grailedHasMore/);
});
