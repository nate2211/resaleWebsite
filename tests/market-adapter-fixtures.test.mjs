import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("parses Depop, Mercari Japan, and Goofish cards and builds a Superbuy proxy URL", async (t) => {
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

  const outDir = await mkdtemp(join(tmpdir(), "rml-adapters-"));
  try {
    const inputs = [
      "app/api/listings/route.ts", "app/lib/engagement.ts",
      "app/lib/apparel.ts", "app/lib/public-listing-record.ts",
    ].map((value) => fileURLToPath(new URL(value, root)));
    const result = spawnSync(command, [
      ...prefix, "--noCheck", "--target", "ES2022", "--module", "commonjs",
      "--moduleResolution", "node", "--jsx", "react-jsx", "--skipLibCheck",
      "--outDir", outDir, ...inputs,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(join(outDir, "package.json"), '{"type":"commonjs"}\n');
    const require = createRequire(import.meta.url);
    const route = require(join(outDir, "api/listings/route.js"));
    const adapter = route.__marketSourceTest;

    const depop = adapter.directItems(
      '<article><a href="/products/s1r-extremely-rare-piece-raf-simons/"><img src="https://media-photos.depop.com/item.jpg" alt="Raf Simons Smiley Sweater">Raf Simons Smiley Sweater Size M $320.11</a></article>',
      "Depop", "https://www.depop.com/theme/raf-simons/",
    );
    const mercari = adapter.directItems(
      '<li><a href="/en/item/m12204888791"><img src="https://static.mercdn.net/item.jpg" alt="RAF SIMONS T-Shirt">RAF SIMONS T-Shirt ¥18,000 Size S</a></li>',
      "Mercari Japan", "https://jp.mercari.com/en/search?keyword=raf%20simons",
    );
    const goofish = adapter.directItems(
      '<div><a href="https://www.goofish.com/item?id=1060593587010"><img src="https://gw.alicdn.com/item.jpg" alt="Raf Simons Runner">Raf Simons Runner CN¥ 988 size 42</a></div>',
      "Goofish", "https://www.goofish.com/search?q=raf%20simons",
    );

    assert.equal(depop.length, 1);
    assert.equal(depop[0].publicPrice, 320.11);
    assert.equal(depop[0].publicCurrency, "USD");
    assert.equal(mercari.length, 1);
    assert.equal(mercari[0].publicPrice, 18000);
    assert.equal(mercari[0].publicCurrency, "JPY");
    assert.equal(goofish.length, 1);
    assert.equal(goofish[0].publicPrice, 988);
    assert.equal(goofish[0].publicCurrency, "CNY");

    const proxy = adapter.superbuyProxyUrl(goofish[0].url);
    assert.match(proxy, /superbuy\.com\/en\/page\/buy\/selfservice\//);
    assert.match(decodeURIComponent(proxy), /goofish\.com\/item\?id=1060593587010/);

    const depopSources = adapter.sourceSearchCandidates("Depop", "supreme", "active", 0);
    assert.equal(depopSources[0], "https://www.depop.com/search/?q=supreme&page=1");
    assert.match(depopSources[1], /depop\.com\/brands\/supreme/);
    assert.match(depopSources[2], /depop\.com\/theme\/supreme/);

    const pageOne = adapter.sourceSearchCandidates("Mercari Japan", "raf simons", "active", 0);
    const pageTwo = adapter.sourceSearchCandidates("Mercari Japan", "raf simons", "active", 1);
    assert.notEqual(pageOne[0], pageTwo[0]);
    assert.match(pageTwo[0], /page=2/);

    const depopSearch = adapter.depopSearchItems(`
      <li class="styles_listItem__abc">
        <a href="/products/nate-supreme-tee/?isBoostedView=true" aria-label="Supreme men’s multi colour t-shirt">
          <img class="styles_mainImage__x" src="https://media-photos.depop.com/r1/example/P0.jpg" alt="Supreme men’s multi colour t-shirt">
        </a>
        <p class="styles_brandName__x">Supreme</p>
        <p class="styles_sizeAttributeText__x">M</p>
        <p class="styles_price__x">$48.00</p>
        <p class="styles_price__x">$34.00</p>
        <span class="styles_boostedTag__x">Boosted</span>
      </li>
      <li class="styles_listItem__def">
        <a href="/products/nate-supreme-tee/" aria-label="Supreme men’s multi colour t-shirt"></a>
        <p class="styles_price__x">$34.00</p>
      </li>
      <a href="/products/create/">Sell</a>
    `, "https://www.depop.com/search/?q=supreme&page=1");
    assert.equal(depopSearch.length, 1);
    assert.equal(depopSearch[0].url, "https://www.depop.com/products/nate-supreme-tee/");
    assert.equal(depopSearch[0].publicPrice, 34);
    assert.equal(depopSearch[0].publicCurrency, "USD");
    assert.match(depopSearch[0].description, /Supreme/);
    assert.match(depopSearch[0].description, /Size M/);
    assert.doesNotMatch(depopSearch[0].url, /products\/create/);

    const mercariRecords = Array.from({ length: 30 }, (_, index) => ({
      id: `m${String(index + 1).padStart(11, "0")}`,
      name: `Supreme item ${index + 1}`,
      price: 10000 + index,
      priceCurrency: "JPY",
      thumbnails: [`https://static.mercdn.net/item/detail/orig/photos/${index + 1}.jpg`],
      itemCondition: { name: "Used" },
      createdAt: "2026-07-27T00:00:00Z",
    }));
    const mercariPageOne = adapter.mercariItemsFromResponse({ items: mercariRecords }, 0);
    const mercariPageTwo = adapter.mercariItemsFromResponse({ items: mercariRecords }, 1);
    assert.equal(mercariPageOne.items.length, 24);
    assert.equal(mercariPageOne.hasMore, true);
    assert.equal(mercariPageTwo.items.length, 6);
    assert.equal(mercariPageTwo.hasMore, false);
    assert.equal(mercariPageOne.items[0].url, "https://jp.mercari.com/en/item/m00000000001");
    assert.equal(mercariPageOne.items[0].publicCurrency, "JPY");
    assert.match(mercariPageOne.items[0].image ?? "", /static\.mercdn\.net/);

    const activeBody = adapter.mercariSearchBody("supreme", "active");
    const soldBody = adapter.mercariSearchBody("supreme", "sold");
    assert.deepEqual(activeBody.searchCondition.status, ["STATUS_ON_SALE"]);
    assert.deepEqual(soldBody.searchCondition.status, ["STATUS_SOLD_OUT", "STATUS_TRADING"]);
    assert.equal(activeBody.pageSize, 120);
    assert.equal(activeBody.serviceFrom, "suruga");

    const dpop = await adapter.mercariDpop(
      "https://api.mercari.jp/v2/entities:search", "POST", "fixture-uuid",
    );
    const [encodedHeader, encodedPayload, encodedSignature] = dpop.split(".");
    const decode = (value) => JSON.parse(Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64url").toString("utf8"));
    const header = decode(encodedHeader);
    const payload = decode(encodedPayload);
    assert.equal(header.typ, "dpop+jwt");
    assert.equal(header.alg, "ES256");
    assert.equal(header.jwk.crv, "P-256");
    assert.equal(payload.htu, "https://api.mercari.jp/v2/entities:search");
    assert.equal(payload.htm, "POST");
    assert.equal(payload.uuid, "fixture-uuid");
    assert.equal(Buffer.from(encodedSignature, "base64url").length, 64);

    const indexedGoofish = adapter.searchHtmlItems(`
      <div class="result">
        <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fwww.goofish.com%2Fitem%3Fid%3D1060593587010">
          Raf Simons Runner archive sneaker
        </a>
        <span>Current listing CN¥ 988 · size 42</span>
      </div>
    `, "Goofish", "https://html.duckduckgo.com/html/?q=raf+simons");
    assert.equal(indexedGoofish.length, 1);
    assert.equal(indexedGoofish[0].url, "https://www.goofish.com/item?id=1060593587010");
    assert.equal(indexedGoofish[0].publicPrice, 988);
    assert.equal(indexedGoofish[0].publicCurrency, "CNY");

    const publicSearchUrls = adapter.publicSearchRequestUrls("site:goofish.com/item raf simons", 1);
    assert.equal(publicSearchUrls.length, 3);
    assert.match(publicSearchUrls[1].url, /html\.duckduckgo\.com/);

    const goofishSources = adapter.sourceSearchCandidates("Goofish", "raf simons", "active", 0);
    assert.equal(goofishSources[0], "https://www.superbuy.com/en/page/search/?nTag=Home-search&from=search-input&keyword=raf+simons&platform=xy");
    assert.match(goofishSources[1], /goofish\.com\/search\?q=raf%20simons&page=1/);
    const unwrapped = adapter.cleanUrl(
      adapter.superbuyProxyUrl("https://www.goofish.com/item?id=1060593587010"),
      "Goofish",
    );
    assert.equal(unwrapped, "https://www.goofish.com/item?id=1060593587010");

    const browserCalls = [];
    globalThis.__RML_BROWSER__ = {
      async quickAction(action, options) {
        browserCalls.push({ action, options });
        if (action === "content" && String(options.url).includes("depop.com")) {
          return new Response(`
            <ol class="styles_productGrid__fixture">
              <li class="styles_listItem__fixture">
                <a href="/products/public-supreme-box-logo-tee/" aria-label="Supreme Box Logo T-shirt">
                  <img class="styles_mainImage__fixture" src="https://media-photos.depop.com/public.jpg" alt="Supreme Box Logo T-shirt">
                </a>
                <p class="styles_brandName__fixture">Supreme</p>
                <p class="styles_sizeAttributeText__fixture">L</p>
                <p class="styles_price__fixture">$120.00</p>
              </li>
            </ol>
          `);
        }
        if (action === "content") return new Response("<html><body><div id=app></div></body></html>");
        return new Response(JSON.stringify([
          "https://www.goofish.com/item?id=1060593587010",
          "https://www.goofish.com/item?id=1060593587011",
        ]), { headers: { "content-type": "application/json" } });
      },
    };

    const renderedDepop = await adapter.browserRenderedItems(
      "Depop",
      ["https://www.depop.com/search/?q=supreme&page=1"],
    );
    assert.equal(renderedDepop.batches[0].items.length, 1);
    assert.equal(renderedDepop.batches[0].items[0].publicPrice, 120);
    assert.equal(renderedDepop.batches[0].items[0].url, "https://www.depop.com/products/public-supreme-box-logo-tee/");
    const depopBrowserCall = browserCalls.find((call) => call.action === "content" && String(call.options.url).includes("depop.com"));
    assert.equal(depopBrowserCall.options.gotoOptions.waitUntil, "networkidle2");
    assert.match(depopBrowserCall.options.waitForSelector.selector, /products/);

    const renderedGoofish = await adapter.browserRenderedItems(
      "Goofish",
      ["https://www.superbuy.com/en/page/search/?keyword=supreme&platform=xy"],
    );
    assert.equal(renderedGoofish.batches[0].items.length, 2);
    assert.equal(renderedGoofish.batches[0].items[0].url, "https://www.goofish.com/item?id=1060593587010");
    assert.equal(renderedGoofish.batches[0].items[1].url, "https://www.goofish.com/item?id=1060593587011");
    assert.ok(browserCalls.some((call) => call.action === "links"));

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("fixture direct fetch blocked"); };
    try {
      const depopResponse = await route.GET(new Request(
        "http://localhost/api/listings?marketplace=Depop&q=browser-fixture-supreme&page=0&mode=active",
      ));
      const depopPayload = await depopResponse.json();
      assert.equal(depopPayload.status, "live");
      assert.equal(depopPayload.diagnostics.browserBindingAvailable, true);
      assert.ok(depopPayload.diagnostics.browserRenderedBatches >= 1);
      assert.equal(depopPayload.diagnostics.discoveredUrls, 1);
      assert.equal(depopPayload.listings.length, 1);
      assert.equal(depopPayload.listings[0].price, 120);

      const goofishResponse = await route.GET(new Request(
        "http://localhost/api/listings?marketplace=Goofish&q=browser-fixture-supreme&page=0&mode=active",
      ));
      const goofishPayload = await goofishResponse.json();
      assert.equal(goofishPayload.status, "live");
      assert.equal(goofishPayload.diagnostics.browserBindingAvailable, true);
      assert.ok(goofishPayload.diagnostics.browserRenderedBatches >= 2);
      assert.equal(goofishPayload.diagnostics.discoveredUrls, 2);
      assert.equal(goofishPayload.listings.length, 2);
      assert.match(goofishPayload.listings[0].proxyUrl, /superbuy\.com/);
    } finally {
      globalThis.fetch = originalFetch;
      delete globalThis.__RML_BROWSER__;
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
