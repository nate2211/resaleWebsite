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
      "app/api/listings/route.ts", "app/api/image-proxy/route.ts", "app/lib/engagement.ts",
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
    const imageProxyRoute = require(join(outDir, "api/image-proxy/route.js"));
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

    const goofishStructured = adapter.goofishStructuredItems(`
      <script type="application/json">{
        "items":[{
          "itemId":"1060593587999",
          "itemTitle":"Supreme Box Logo Tee",
          "price":688,
          "currency":"CNY",
          "image":"https://gw.alicdn.com/imgextra/i1/fixture.webp"
        }]
      }</script>
    `, "https://www.goofish.com/search?q=supreme");
    assert.equal(goofishStructured.length, 1);
    assert.equal(goofishStructured[0].url, "https://www.goofish.com/item?id=1060593587999");
    assert.equal(goofishStructured[0].publicPrice, 688);
    assert.equal(goofishStructured[0].publicCurrency, "CNY");
    assert.match(goofishStructured[0].image ?? "", /alicdn/);

    const superbuyAssignment = adapter.goofishStructuredItems(`
      <script>
        window.__INITIAL_STATE__ = {
          "searchResult":{"list":[{
            "platformCode":"xianyu",
            "goodsNo":"1060593588001",
            "goodsTitle":"Raf Simons Superbuy Assignment Jacket",
            "priceInfo":{"amount":799,"currency":"CNY"},
            "goodsImage":{"url":"https://gw.alicdn.com/superbuy-assignment.webp"}
          }]}
        };
      </script>
    `, "https://www.superbuy.com/en/page/fleamarket/?nTag=Home-search&from=search-input&keyword=raf+simons");
    assert.equal(superbuyAssignment.length, 1);
    assert.equal(superbuyAssignment[0].url, "https://www.goofish.com/item?id=1060593588001");
    assert.equal(superbuyAssignment[0].publicPrice, 799);
    assert.equal(superbuyAssignment[0].publicCurrency, "CNY");
    assert.match(superbuyAssignment[0].image ?? "", /superbuy-assignment/);

    const superbuyFlight = adapter.goofishStructuredItems(`
      <script>self.__next_f.push([1,"{\\"items\\":[{\\"goodsId\\":\\"1060593588002\\",\\"goodsName\\":\\"Supreme React Flight Tee\\",\\"goodsPrice\\":588,\\"currency\\":\\"CNY\\"}]}"])</script>
    `, "https://www.superbuy.com/en/page/fleamarket/?nTag=Home-search&from=search-input&keyword=supreme");
    assert.equal(superbuyFlight.length, 1);
    assert.equal(superbuyFlight[0].url, "https://www.goofish.com/item?id=1060593588002");
    assert.equal(superbuyFlight[0].publicPrice, 588);

    const superbuyMixedCase = adapter.goofishStructuredItems(`
      <script type="application/json">{
        "Results":[{
          "PlatformCode":"xianyu",
          "ItemID":"1060593588003",
          "GoodsTitle":"Raf Simons Mixed Case Coat",
          "GoodsPrice":"699",
          "CurrencyCode":"CNY",
          "ImageURL":"https://gw.alicdn.com/mixed-case.webp"
        }]
      }</script>
    `, "https://www.superbuy.com/en/page/fleamarket/?nTag=Home-search&from=search-input&keyword=raf+simons");
    assert.equal(superbuyMixedCase.length, 1);
    assert.equal(superbuyMixedCase[0].url, "https://www.goofish.com/item?id=1060593588003");
    assert.equal(superbuyMixedCase[0].publicPrice, 699);
    assert.equal(superbuyMixedCase[0].publicCurrency, "CNY");
    assert.match(superbuyMixedCase[0].image ?? "", /mixed-case/);

    const unrelatedSuperbuyCatalog = adapter.goofishStructuredItems(`
      <div data-item-id="998877665544"><h3>Ordinary Taobao item</h3><span>CN¥ 99</span></div>
    `, "https://www.superbuy.com/en/page/search/?nTag=Home-search&from=search-input&keyword=shirt");
    assert.equal(unrelatedSuperbuyCatalog.length, 0, "ordinary Superbuy catalog IDs must not be mislabeled as Goofish");

    const rakuten = adapter.rakutenSearchItems(`
      <ul><li class="searchresultitem">
        <a href="https://item.rakuten.co.jp/archive-shop/raf-001/" title="Raf Simons Archive Sweater">
          <img data-original="https://thumbnail.image.rakuten.co.jp/fixture.jpg" alt="Raf Simons Archive Sweater">
        </a>
        <p class="condition">中古</p><div class="price">12,800円</div>
      </li></ul>
    `, "https://search.rakuten.co.jp/search/mall/raf%20simons/?p=1");
    assert.equal(rakuten.length, 1);
    assert.equal(rakuten[0].url, "https://item.rakuten.co.jp/archive-shop/raf-001/");
    assert.equal(rakuten[0].publicPrice, 12800);
    assert.equal(rakuten[0].publicCurrency, "JPY");
    assert.match(rakuten[0].title, /Raf Simons Archive Sweater/);
    assert.match(rakuten[0].image ?? "", /thumbnail\.image\.rakuten\.co\.jp/);

    const rakutenJsonLd = adapter.rakutenJsonLdItems(`
      <script type="application/ld+json">{
        "@context":"https://schema.org",
        "@type":"ItemList",
        "itemListElement":[
          {"@type":"ListItem","position":1,"item":{
            "@type":"Product",
            "name":"Raf Simons JSON-LD Sweater",
            "image":["https://thumbnail.image.rakuten.co.jp/@0_mall/archive-shop/cabinet/raf-002.jpg"],
            "offers":{"@type":"Offer","price":24800,"priceCurrency":"JPY"},
            "url":"https://item.rakuten.co.jp/archive-shop/raf-002/"
          }}
        ]
      }</script>
    `, "https://search.rakuten.co.jp/search/mall/raf%20simons/?p=1");
    assert.equal(rakutenJsonLd.length, 1);
    assert.equal(rakutenJsonLd[0].url, "https://item.rakuten.co.jp/archive-shop/raf-002/");
    assert.equal(rakutenJsonLd[0].publicPrice, 24800);
    assert.equal(rakutenJsonLd[0].publicCurrency, "JPY");
    assert.match(rakutenJsonLd[0].image ?? "", /archive-shop\/cabinet\/raf-002\.jpg/);

    const inlineRakutenJsonLd = adapter.rakutenJsonLdItems(`
      <div data-comp-id-flat="searchResults">
        {"@context":"https://schema.org/","@type":"ItemList","itemListElement":[
          {"@type":"ListItem","position":1,"item":{"@type":"Product",
            "name":"Inline Raf Simons Coat",
            "image":["https://thumbnail.image.rakuten.co.jp/@0_mall/coat-shop/cabinet/coat-1.jpg"],
            "offers":{"@type":"Offer","price":99000,"priceCurrency":"JPY"},
            "url":"https://item.rakuten.co.jp/coat-shop/coat-1/"}}
        ]}
      </div>
    `, "https://search.rakuten.co.jp/search/mall/raf%20simons/?p=1");
    assert.equal(inlineRakutenJsonLd.length, 1);
    assert.match(inlineRakutenJsonLd[0].image ?? "", /coat-shop\/cabinet\/coat-1\.jpg/);
    assert.equal(inlineRakutenJsonLd[0].title, "Inline Raf Simons Coat");
    assert.equal(adapter.cleanUrl("https://item.rakuten.co.jp/un", "Rakuten"), "");

    const zenRakuten = adapter.zenMarketCardItems(`
      <a class="product-item product-link" href="https://zenmarket.jp/en/rakutenproduct.aspx?itemCode=archive-shop%3Araf-001">
        <div class="img-wrap"><img src="https://zenmarket.jp/img/fixture.jpg"></div>
        <h3 class="item-title translate">Raf Simons Archive Sweater</h3>
        <span class="current-price">¥12,800</span>
      </a>
    `, "Rakuten", "https://zenmarket.jp/en/search.aspx?q=raf+simons&p=1&searchMode=custom&stores=0");
    assert.equal(zenRakuten.length, 1);
    assert.equal(zenRakuten[0].publicPrice, 12800);
    assert.equal(zenRakuten[0].publicCurrency, "JPY");
    assert.match(zenRakuten[0].url, /zenmarket\.jp\/en\/rakutenproduct\.aspx/);

    const zenStructured = adapter.zenMarketStructuredItems(JSON.stringify({
      items: [{
        storeId: 0,
        storeName: "Rakuten",
        itemCode: "opinion-cosme:10001695",
        title: "Supreme Burberry Box Logo Hoodie",
        price: 105000,
        currency: "JPY",
        imageUrl: "https://tshop.r10s.jp/opinion-cosme/fixture.jpg",
      }],
    }), "Rakuten", "https://zenmarket.jp/en/search.aspx?q=supreme&p=1&searchMode=custom&stores=0");
    assert.equal(zenStructured.length, 1);
    assert.match(zenStructured[0].url, /rakutenproduct\.aspx\?itemCode=opinion-cosme%3A10001695/);
    assert.equal(zenStructured[0].publicPrice, 105000);
    assert.equal(zenStructured[0].publicCurrency, "JPY");
    assert.match(zenStructured[0].image ?? "", /tshop\.r10s\.jp/);

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

    const depopApiPayload = JSON.stringify({
      meta: { hasMore: true },
      products: [{
        id: 991,
        slug: "nate-supreme-box-logo-tee-abcd",
        description: "Supreme Box Logo Tee in excellent condition.",
        price: {
          priceAmount: "85.00",
          currencyName: "USD",
          nationalShippingCost: "7.99",
        },
        preview: {
          320: "https://media-photos.depop.com/r1/api-fixture/P0.jpg",
          1280: "https://media-photos.depop.com/r1/api-fixture/P0.jpg",
        },
        pictures: [{ 1280: "https://media-photos.depop.com/r1/api-fixture/P0.jpg" }],
        brand_name: "Supreme",
        sizes: ["M"],
        condition: "Excellent condition",
        seller: { username: "nate_fixture" },
        like_count: 14,
        status: "ON_SALE",
      }],
    });
    const depopStructured = adapter.depopStructuredItems(
      depopApiPayload,
      "https://webapi.depop.com/api/v3/search/products/?what=supreme&itemsPerPage=24&country=us&currency=USD",
    );
    assert.equal(depopStructured.length, 1);
    assert.equal(depopStructured[0].url, "https://www.depop.com/products/nate-supreme-box-logo-tee-abcd/");
    assert.equal(depopStructured[0].publicPrice, 85);
    assert.equal(depopStructured[0].publicCurrency, "USD");
    assert.equal(depopStructured[0].image, "https://media-photos.depop.com/r1/api-fixture/P0.jpg");
    assert.match(depopStructured[0].description, /Size M/);
    assert.match(depopStructured[0].description, /14 likes/);

    const depopFlight = adapter.depopStructuredItems(`
      <script>self.__next_f.push([1,${JSON.stringify(depopApiPayload)}])</script>
    `, "https://www.depop.com/search/?q=supreme&page=1");
    assert.equal(depopFlight.length, 1, "React Flight storefront records must be parsed");
    assert.match(depopFlight[0].image ?? "", /media-photos\.depop\.com/);

    const depopScraped = adapter.depopScrapedItems([{
      selector: 'a[href*="/products/"]',
      results: [{
        attributes: [
          { name: "href", value: "/products/rendered-supreme-tee-v6/" },
          { name: "aria-label", value: "Rendered Supreme Tee" },
        ],
        html: '<img src="https://media-photos.depop.com/r1/rendered-v6/P0.jpg" alt="Rendered Supreme Tee">',
        text: "Rendered Supreme Tee $72.00 Size M",
      }],
    }], "https://www.depop.com/search/?q=supreme");
    assert.equal(depopScraped.length, 1);
    assert.equal(depopScraped[0].url, "https://www.depop.com/products/rendered-supreme-tee-v6/");
    assert.equal(depopScraped[0].publicPrice, 72);
    assert.match(depopScraped[0].image ?? "", /media-photos\.depop\.com/);

    assert.equal(
      adapter.depopProductImage("https://external-content.duckduckgo.com/ip3/www.depop.com.ico", "https://www.depop.com/"),
      "",
      "search-engine favicons must never become product images",
    );
    assert.equal(
      adapter.depopProductImage("https://media-photos.depop.com/r1/api-fixture/P0.jpg", "https://www.depop.com/"),
      "https://media-photos.depop.com/r1/api-fixture/P0.jpg",
    );
    assert.ok(imageProxyRoute.__imageProxyTest.allowedDepopImage("https://media-photos.depop.com/r1/api-fixture/P0.jpg"));
    assert.equal(imageProxyRoute.__imageProxyTest.allowedDepopImage("https://external-content.duckduckgo.com/ip3/www.depop.com.ico"), undefined);

    const savedImageFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(new Uint8Array([255, 216, 255, 217]), {
      status: 200,
      headers: { "content-type": "image/jpeg", "content-length": "4" },
    });
    try {
      const proxiedImage = await imageProxyRoute.GET(new Request(
        "http://localhost/api/image-proxy?url=" + encodeURIComponent("https://media-photos.depop.com/r1/api-fixture/P0.jpg"),
      ));
      assert.equal(proxiedImage.status, 200);
      assert.equal(proxiedImage.headers.get("content-type"), "image/jpeg");
      assert.match(proxiedImage.headers.get("cache-control") || "", /s-maxage/);
    } finally {
      globalThis.fetch = savedImageFetch;
    }

    const apiUrls = adapter.depopApiSearchUrls("supreme box logo");
    assert.equal(apiUrls.length, 2);
    assert.match(apiUrls[0], /api\/v3\/search\/products/);
    assert.match(apiUrls[0], /what=supreme\+box\+logo/);
    assert.match(apiUrls[1], /api\/v2\/search\/products/);

    const savedDepopApiFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const target = String(input);
      if (target.includes("webapi.depop.com/api/v3/search/products")) {
        return new Response(depopApiPayload, { status: 200, headers: { "content-type": "application/json" } });
      }
      return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
    };
    try {
      const depopApi = await adapter.depopApiItems("supreme", 0, false);
      assert.equal(depopApi.items.length, 1);
      assert.equal(depopApi.items[0].publicPrice, 85);
      assert.match(depopApi.items[0].image ?? "", /media-photos\.depop\.com/);
      assert.ok(depopApi.sourceUrls.some((value) => value.includes("/api/v3/search/products/")));
    } finally {
      globalThis.fetch = savedDepopApiFetch;
    }

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
    assert.match(goofishSources[0], /superbuy\.com\/en\/page\/fleamarket\//);
    assert.match(goofishSources[0], /nTag=Home-search/);
    assert.match(goofishSources[0], /from=search-input/);
    assert.match(goofishSources[0], /keyword=raf\+simons/);
    assert.doesNotMatch(goofishSources[0], /_search=|position=|platform=/);
    assert.match(goofishSources[1], /superbuy\.com\/en\/page\/search\//);
    assert.match(goofishSources[1], /nTag=Home-search/);
    assert.match(goofishSources[2], /goofish\.com\/search\?q=raf%20simons&page=1/);

    const rakutenSources = adapter.sourceSearchCandidates("Rakuten", "raf simons", "active", 0);
    assert.match(rakutenSources[0], /zenmarket\.jp\/en\/search\.aspx\?q=raf%20simons&p=1&searchMode=custom&stores=0/);
    assert.match(rakutenSources[1], /search\.rakuten\.co\.jp\/search\/mall\/raf%20simons\/\?p=1/);
    assert.equal(rakutenSources.length, 2);
    const unwrapped = adapter.cleanUrl(
      adapter.superbuyProxyUrl("https://www.goofish.com/item?id=1060593587010"),
      "Goofish",
    );
    assert.equal(unwrapped, "https://www.goofish.com/item?id=1060593587010");
    assert.equal(
      adapter.cleanUrl("https://www.superbuy.com/en/page/buy/?platform=xy&itemId=1060593587012", "Goofish"),
      "https://www.goofish.com/item?id=1060593587012",
    );
    assert.equal(
      adapter.cleanUrl("https://www.superbuy.com/en/page/buy/?url=https%253A%252F%252F2.taobao.com%252Fitem.htm%253Fid%253D1060593587013", "Goofish"),
      "https://www.goofish.com/item?id=1060593587013",
    );

    const originalStaticFetch = globalThis.fetch;
    let directGoofishSearches = 0;
    globalThis.fetch = async (input) => {
      const value = String(input instanceof Request ? input.url : input);
      if (value.includes("superbuy.com/en/page/fleamarket") || value.includes("superbuy.com/en/page/search")) {
        if (value.includes("static-fallback-goofish")) return new Response("<html></html>");
        return new Response(`<script>window.__INITIAL_STATE__ = {
          "props":{"pageProps":{"items":[{"platform":"xianyu","goodsId":"1060593587555","goodsName":"Supreme Goofish Tee","goodsPrice":588,"currency":"CNY"}]}}
        };</script>`);
      }
      if (value.includes("goofish.com/search")) {
        directGoofishSearches += 1;
        if (value.includes("static-fallback-goofish")) {
          return new Response(`<script type="application/json">{
            "items":[{"itemId":"1060593587556","itemTitle":"Fallback Goofish Tee","price":488,"currency":"CNY"}]
          }</script>`);
        }
        return new Response("<html></html>");
      }
      if (value.includes("search.rakuten.co.jp")) {
        return new Response(`<li class="searchresultitem">
          <a href="https://item.rakuten.co.jp/archive-shop/raf-api/" title="Raf Simons API Jacket">
            <img src="https://thumbnail.image.rakuten.co.jp/api.jpg" alt="Raf Simons API Jacket">
          </a><div class="price">¥19,800</div>
        </li>`);
      }
      if (value.includes("goofish.com/item") || value.includes("item.rakuten.co.jp")) {
        throw new Error("fixture product hydration blocked");
      }
      return new Response("<html></html>");
    };
    try {
      const goofishStaticResponse = await route.GET(new Request(
        "http://localhost/api/listings?marketplace=Goofish&q=static-fixture-goofish&page=0&mode=active",
      ));
      const goofishStaticPayload = await goofishStaticResponse.json();
      assert.equal(goofishStaticPayload.status, "live");
      assert.equal(goofishStaticPayload.listings.length, 1);
      assert.equal(goofishStaticPayload.listings[0].url, "https://www.goofish.com/item?id=1060593587555");
      assert.match(goofishStaticPayload.listings[0].proxyUrl, /superbuy\.com/);
      assert.equal(directGoofishSearches, 0, "direct Goofish must not run when Superbuy returns listings");

      const goofishFallbackResponse = await route.GET(new Request(
        "http://localhost/api/listings?marketplace=Goofish&q=static-fallback-goofish&page=0&mode=active",
      ));
      const goofishFallbackPayload = await goofishFallbackResponse.json();
      assert.equal(goofishFallbackPayload.status, "live");
      assert.equal(goofishFallbackPayload.listings[0].url, "https://www.goofish.com/item?id=1060593587556");
      assert.equal(directGoofishSearches, 1, "direct Goofish should run only after an empty Superbuy response");

      const rakutenStaticResponse = await route.GET(new Request(
        "http://localhost/api/listings?marketplace=Rakuten&q=static-fixture-rakuten&page=0&mode=active",
      ));
      const rakutenStaticPayload = await rakutenStaticResponse.json();
      assert.equal(rakutenStaticPayload.status, "live");
      assert.equal(rakutenStaticPayload.listings.length, 1);
      assert.equal(rakutenStaticPayload.listings[0].url, "https://item.rakuten.co.jp/archive-shop/raf-api/");
      assert.ok(rakutenStaticPayload.listings[0].price > 0);
    } finally {
      globalThis.fetch = originalStaticFetch;
    }

    const browserCalls = [];
    globalThis.__RML_BROWSER__ = {
      async quickAction(action, options) {
        browserCalls.push({ action, options });
        if (action === "content" && String(options.url).includes("depop.com")) {
          const html = `
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
          `;
          return Response.json({ success: true, result: html });
        }
        if (action === "content" && String(options.url).includes("zenmarket.jp/en/yahoo.aspx")) {
          return new Response(`
            <div id="productsContainer">
              <a href="/en/auction.aspx?itemCode=x123456789" class="product-link product-item">
                <img data-original="https://zenmarket.jp/img/jdirect-browser.jpg" alt="Raf Simons JDirect Jacket">
                <h3 class="item-title">Raf Simons JDirect Jacket</h3>
                <span class="current-price">¥31,000</span>
                <div class="product-badge-store">JDirectItems Auction</div>
              </a>
            </div>
          `);
        }
        if (action === "content" && String(options.url).includes("zenmarket.jp/en/rakuma.aspx")) {
          return new Response(`
            <div id="productsContainer">
              <a href="/en/rakumaproduct.aspx?itemCode=rakuma-123" class="product-link product-item">
                <img data-original="https://zenmarket.jp/img/rakuma-browser.jpg" alt="Raf Simons Rakuma Shirt">
                <h3 class="item-title">Raf Simons Rakuma Shirt</h3>
                <span class="current-price">¥16,500</span>
                <div class="product-badge-store">Rakuma</div>
              </a>
            </div>
          `);
        }
        if (action === "content" && String(options.url).includes("zenmarket.jp")) {
          return new Response(`
            <div id="productsContainer">
              <div class="col-xs-6 product">
                <a href="/en/rakutenproduct.aspx?itemCode=archive-shop%3Araf-browser" class="product-link product-item">
                  <img data-original="https://zenmarket.jp/img/rakuten-browser.jpg" alt="Raf Simons ZenMarket Jacket">
                  <h3 class="item-title translate">Raf Simons ZenMarket Jacket</h3>
                  <span class="current-price">¥24,800</span>
                  <div class="product-badge-store">Rakuten</div>
                </a>
              </div>
              <a href="https://item.rakuten.co.jp/archive-shop/unrelated-footer-source/">Original store source</a>
            </div>
          `);
        }
        if (action === "content" && String(options.url).includes("search.rakuten.co.jp")) {
          return new Response(`
            <li class="searchresultitem">
              <a href="https://item.rakuten.co.jp/archive-shop/raf-browser/" title="Raf Simons Browser Jacket">
                <img src="https://thumbnail.image.rakuten.co.jp/browser.jpg" alt="Raf Simons Browser Jacket">
              </a>
              <div class="price">¥24,800</div>
            </li>
          `);
        }
        if (action === "content" && String(options.url).includes("superbuy.com")
          && String(options.url).includes("browser-priority-goofish")) {
          return new Response(`<script>window.__INITIAL_STATE__ = {
            "items":[{"platformCode":"xianyu","goodsId":"1060593587999","goodsName":"Superbuy Rendered Goofish Jacket","goodsPrice":688,"currency":"CNY"}]
          };</script>`);
        }
        if (action === "content") return new Response("<html><body><div id=app></div></body></html>");
        return Response.json({
          success: true,
          result: [
            "https://www.goofish.com/item?id=1060593587010",
            "https://www.goofish.com/item?id=1060593587011",
          ],
        });
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

    const renderedRakuten = await adapter.browserRenderedItems(
      "Rakuten",
      [
        "https://zenmarket.jp/en/search.aspx?q=raf%20simons&p=1&searchMode=custom&stores=0",
        "https://search.rakuten.co.jp/search/mall/raf%20simons/?p=1",
      ],
    );
    assert.equal(renderedRakuten.batches[0].items.length, 1);
    assert.equal(renderedRakuten.batches[0].items[0].publicPrice, 24800);
    assert.match(renderedRakuten.batches[0].items[0].url, /zenmarket\.jp\/en\/rakutenproduct\.aspx/);
    const zenMarketBrowserCall = browserCalls.find((call) => call.action === "content" && String(call.options.url).includes("zenmarket.jp"));
    assert.match(zenMarketBrowserCall.options.waitForSelector.selector, /productsContainer/);
    assert.equal(
      browserCalls.some((call) => call.action === "content" && String(call.options.url).includes("search.rakuten.co.jp")),
      false,
      "ZenMarket rendered results must stop the official Rakuten browser fallback",
    );

    const renderedJDirect = await adapter.browserRenderedItems(
      "JDirectItems Auction",
      ["https://zenmarket.jp/en/yahoo.aspx?q=raf%20simons&p=1"],
    );
    assert.equal(renderedJDirect.batches[0].items.length, 1);
    assert.match(renderedJDirect.batches[0].items[0].url, /zenmarket\.jp\/en\/auction\.aspx/);
    assert.equal(renderedJDirect.batches[0].items[0].publicPrice, 31000);

    const renderedRakuma = await adapter.browserRenderedItems(
      "Rakuten Rakuma",
      ["https://zenmarket.jp/en/rakuma.aspx?q=raf%20simons&p=1"],
    );
    assert.equal(renderedRakuma.batches[0].items.length, 1);
    assert.match(renderedRakuma.batches[0].items[0].url, /zenmarket\.jp\/en\/rakumaproduct\.aspx/);
    assert.equal(renderedRakuma.batches[0].items[0].publicPrice, 16500);

    const renderedGoofish = await adapter.browserRenderedItems(
      "Goofish",
      ["https://www.superbuy.com/en/page/search/?nTag=Home-search&from=search-input&keyword=supreme"],
    );
    assert.equal(renderedGoofish.batches[0].items.length, 2);
    assert.equal(renderedGoofish.batches[0].items[0].url, "https://www.goofish.com/item?id=1060593587010");
    assert.equal(renderedGoofish.batches[0].items[1].url, "https://www.goofish.com/item?id=1060593587011");
    assert.ok(browserCalls.some((call) => call.action === "links"));
    const superbuyBrowserCall = browserCalls.find((call) => call.action === "content" && String(call.options.url).includes("superbuy.com"));
    assert.equal(superbuyBrowserCall.options.waitForTimeout, 9000);
    assert.equal("waitForSelector" in superbuyBrowserCall.options, false);

    const regularBrowserFixture = globalThis.__RML_BROWSER__;
    const retryCalls = [];
    globalThis.__RML_BROWSER__ = {
      async quickAction(action, options) {
        retryCalls.push({ action, options });
        if (action === "content" && "waitForSelector" in options) throw new Error("fixture selector timeout");
        if (action === "content") return new Response(`
          <div id="productsContainer">
            <a class="product-item product-link" href="/en/rakutenproduct.aspx?itemCode=retry-shop%3A1001">
              <h3 class="item-title">ZenMarket Retry Jacket</h3>
              <span class="current-price">¥18,500</span>
            </a>
          </div>
        `);
        return new Response("[]", { headers: { "content-type": "application/json" } });
      },
    };
    const retryUrl = "https://zenmarket.jp/en/search.aspx?q=retry&p=1&searchMode=custom&stores=0";
    const retryHtml = await adapter.fetchRenderedText(retryUrl);
    const retryItems = adapter.directItems(retryHtml, "Rakuten", retryUrl);
    assert.equal(retryItems.length, 1);
    assert.equal(retryCalls.length, 2);
    assert.ok("waitForSelector" in retryCalls[0].options);
    assert.equal(retryCalls[1].options.waitForTimeout, 10000);
    assert.equal("waitForSelector" in retryCalls[1].options, false);
    globalThis.__RML_BROWSER__ = regularBrowserFixture;

    const depopLinkOnlyCalls = [];
    globalThis.__RML_BROWSER__ = {
      async quickAction(action, options) {
        depopLinkOnlyCalls.push({ action, options });
        const target = String(options.url);
        if (action === "links") {
          return Response.json({
            success: true,
            result: ["https://www.depop.com/products/production-link-only-jacket/"],
          });
        }
        if (target.includes("/products/production-link-only-jacket/")) {
          return Response.json({
            success: true,
            result: `<!doctype html><html><head>
              <meta property="og:title" content="Production Link Only Depop Jacket | Depop">
              <meta property="og:description" content="Supreme jacket in size L">
              <meta property="og:image" content="https://media-photos.depop.com/link-only.jpg">
              <meta property="product:price:amount" content="145.00">
              <meta property="product:price:currency" content="USD">
            </head><body></body></html>`,
          });
        }
        return Response.json({ success: true, result: "<html><body><div id=app></div></body></html>" });
      },
    };
    const linkOnly = await adapter.browserRenderedItems(
      "Depop",
      ["https://www.depop.com/search/?q=production-link-only&page=1"],
    );
    assert.equal(linkOnly.batches[0].items.length, 1, "Depop must recover canonical links from Browser Run");
    const savedFetchForHydration = globalThis.fetch;
    globalThis.fetch = async () => { throw new Error("fixture direct Depop product fetch blocked"); };
    try {
      const hydratedLinkOnly = await adapter.hydrate("Depop", linkOnly.batches[0].items[0]);
      assert.equal(hydratedLinkOnly.price, 145);
      assert.equal(hydratedLinkOnly.url, "https://www.depop.com/products/production-link-only-jacket/");
      assert.match(hydratedLinkOnly.image, /link-only\.jpg/);
      assert.ok(depopLinkOnlyCalls.some((call) => call.action === "links"));
      assert.ok(depopLinkOnlyCalls.some((call) => String(call.options.url).includes("/products/production-link-only-jacket/")));
    } finally {
      globalThis.fetch = savedFetchForHydration;
      globalThis.__RML_BROWSER__ = regularBrowserFixture;
    }

    const scrapeOnlyCalls = [];
    const savedBrowserForScrapeOnly = globalThis.__RML_BROWSER__;
    globalThis.__RML_BROWSER__ = {
      async quickAction(action, options) {
        scrapeOnlyCalls.push({ action, options });
        if (action === "content") throw new Error("fixture content timed out");
        if (action === "scrape") return Response.json({
          success: true,
          result: [{
            selector: 'a[href*="/products/"]',
            results: [{
              attributes: [
                { name: "href", value: "/products/scrape-only-supreme-jacket/" },
                { name: "aria-label", value: "Scrape-only Supreme Jacket" },
              ],
              html: '<img src="https://media-photos.depop.com/r1/scrape-only/P0.jpg" alt="Scrape-only Supreme Jacket">',
              text: "Scrape-only Supreme Jacket $99.00 Size L",
            }],
          }],
        });
        return Response.json({ success: true, result: [] });
      },
    };
    try {
      const scrapeOnly = await adapter.browserRenderedItems(
        "Depop",
        ["https://www.depop.com/search/?q=scrape-only&page=1"],
      );
      assert.equal(scrapeOnly.batches[0].items.length, 1,
        "Depop scrape must run even when Browser Run content times out");
      assert.equal(scrapeOnly.batches[0].items[0].publicPrice, 99);
      assert.match(scrapeOnly.batches[0].items[0].image ?? "", /media-photos\.depop\.com/);
      assert.ok(scrapeOnlyCalls.some((call) => call.action === "scrape"));
    } finally {
      globalThis.__RML_BROWSER__ = savedBrowserForScrapeOnly;
    }

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

      const priorityGoofishResponse = await route.GET(new Request(
        "http://localhost/api/listings?marketplace=Goofish&q=browser-priority-goofish&page=0&mode=active",
      ));
      const priorityGoofishPayload = await priorityGoofishResponse.json();
      assert.equal(priorityGoofishPayload.status, "live");
      assert.equal(priorityGoofishPayload.listings.length, 1);
      assert.equal(priorityGoofishPayload.listings[0].url, "https://www.goofish.com/item?id=1060593587999");
      assert.ok(priorityGoofishPayload.diagnostics.browserRenderedUrls.every((url) => url.includes("superbuy.com")));

      const priorityRakutenResponse = await route.GET(new Request(
        "http://localhost/api/listings?marketplace=Rakuten&q=browser-priority-rakuten&page=0&mode=active",
      ));
      const priorityRakutenPayload = await priorityRakutenResponse.json();
      assert.equal(priorityRakutenPayload.status, "live");
      assert.equal(priorityRakutenPayload.listings.length, 1);
      assert.match(priorityRakutenPayload.listings[0].url, /zenmarket\.jp\/en\/rakutenproduct\.aspx/);
      assert.ok(priorityRakutenPayload.diagnostics.browserRenderedUrls.every((url) => url.includes("zenmarket.jp")));


      const [jdirectResponse, rakutenBatchResponse, rakumaResponse] = await Promise.all([
        route.GET(new Request(
          "http://localhost/api/listings?marketplace=JDirectItems%20Auction&q=zenmarket-batch&page=0&mode=active&provider=zenmarket&providerBatchSize=3&providerBatchIndex=1",
        )),
        route.GET(new Request(
          "http://localhost/api/listings?marketplace=Rakuten&q=zenmarket-batch&page=0&mode=active&provider=zenmarket&providerBatchSize=3&providerBatchIndex=2",
        )),
        route.GET(new Request(
          "http://localhost/api/listings?marketplace=Rakuten%20Rakuma&q=zenmarket-batch&page=0&mode=active&provider=zenmarket&providerBatchSize=3&providerBatchIndex=3",
        )),
      ]);
      const [jdirectPayload, rakutenBatchPayload, rakumaPayload] = await Promise.all([
        jdirectResponse.json(), rakutenBatchResponse.json(), rakumaResponse.json(),
      ]);
      assert.equal(jdirectPayload.status, "live");
      assert.equal(rakutenBatchPayload.status, "live");
      assert.equal(rakumaPayload.status, "live");
      for (const payload of [jdirectPayload, rakutenBatchPayload, rakumaPayload]) {
        assert.equal(payload.diagnostics.sourceProvider, "ZenMarket");
        assert.equal(payload.diagnostics.providerBatchSize, 3);
        assert.ok(payload.diagnostics.browserRenderedUrls.every((url) => url.includes("zenmarket.jp")));
      }
      assert.equal(jdirectPayload.diagnostics.providerMarket.storeCode, "28");
      assert.equal(rakutenBatchPayload.diagnostics.providerMarket.storeCode, "0");
      assert.equal(rakumaPayload.diagnostics.providerMarket.storeCode, "25");
    } finally {
      globalThis.fetch = originalFetch;
      delete globalThis.__RML_BROWSER__;
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});
