import assert from "node:assert/strict";
import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("AI Search renders unsupported shops and excludes built-in marketplace domains", async (t) => {
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

  const outDir = await mkdtemp(join(tmpdir(), "rml-ai-web-"));
  const originalFetch = globalThis.fetch;
  const originalBrowser = globalThis.__RML_WEB_BROWSER__;
  try {
    const inputs = [
      "app/api/web-listings/route.ts", "app/lib/authenticity.ts",
      "app/lib/safe-web.ts", "app/lib/analysis.ts",
    ].map((value) => fileURLToPath(new URL(value, root)));
    const result = spawnSync(command, [
      ...prefix, "--noCheck", "--target", "ES2022", "--module", "commonjs",
      "--moduleResolution", "node", "--skipLibCheck", "--outDir", outDir, ...inputs,
    ], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(join(outDir, "package.json"), '{"type":"commonjs"}\n');

    const productJson = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Raf Simons Public Shop Tee",
      image: "https://shop.example.com/tee.jpg",
      offers: { "@type": "Offer", price: 120, priceCurrency: "USD" },
      url: "https://shop.example.com/products/raf-tee",
    });
    const builtInJson = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: "Built-in Depop Listing",
      image: "https://depop.example/image.jpg",
      offers: { "@type": "Offer", price: 99, priceCurrency: "USD" },
      url: "https://www.depop.com/products/example-built-in/",
    });
    const secondhandProducts = new Map([
      ["https://www.ebay.com/itm/123456789012", {
        name: "Raf Simons eBay Archive Jacket", image: "https://i.ebayimg.com/raf.jpg", price: 240,
      }],
      ["https://www.mercari.com/us/item/m12345678901/", {
        name: "Raf Simons Mercari US Tee", image: "https://u-mercari-images.mercdn.net/raf.jpg", price: 95,
      }],
      ["https://www.facebook.com/marketplace/item/123456789012345/", {
        name: "Raf Simons Facebook Marketplace Coat", image: "https://scontent.example/raf.jpg", price: 180,
      }],
    ]);

    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url === "https://shop.example.com/products/raf-tee") {
        return new Response(`<html><head><script type="application/ld+json">${productJson}</script></head><body></body></html>`, {
          status: 200, headers: { "content-type": "text/html" },
        });
      }
      if (url === "https://www.depop.com/products/example-built-in/") {
        return new Response(`<html><head><script type="application/ld+json">${builtInJson}</script></head><body></body></html>`, {
          status: 200, headers: { "content-type": "text/html" },
        });
      }
      if (url === "https://www.facebook.com/marketplace/item/123456789012345/") {
        return new Response('<html><head><title>Facebook - log in or sign up</title></head><body>Log in to continue</body></html>', {
          status: 200, headers: { "content-type": "text/html" },
        });
      }
      const secondhand = secondhandProducts.get(url);
      if (secondhand) {
        const json = JSON.stringify({
          "@context": "https://schema.org", "@type": "Product",
          name: secondhand.name, image: secondhand.image,
          offers: { "@type": "Offer", price: secondhand.price, priceCurrency: "USD" },
          url,
        });
        return new Response(`<html><head><script type="application/ld+json">${json}</script></head><body></body></html>`, {
          status: 200, headers: { "content-type": "text/html" },
        });
      }
      return new Response(url.includes("format=rss") ? "<rss><channel></channel></rss>" : "<html></html>", {
        status: 200,
        headers: { "content-type": url.includes("format=rss") ? "application/rss+xml" : "text/html" },
      });
    };

    globalThis.__RML_WEB_BROWSER__ = {
      async quickAction(action, options) {
        const url = String(options.url || "");
        if (action === "links") {
          if (url.includes("ebay.com/sch")) return Response.json(["https://www.ebay.com/itm/123456789012"]);
          if (url.includes("mercari.com/search")) return Response.json(["https://www.mercari.com/us/item/m12345678901/"]);
          if (url.includes("facebook.com/marketplace")) return Response.json(["https://www.facebook.com/marketplace/item/123456789012345/"]);
          return Response.json([
            "https://shop.example.com/products/raf-tee",
            "https://www.depop.com/products/example-built-in/",
          ]);
        }
        assert.equal(action, "content");
        if (url.includes("ebay.com/sch")) return new Response('<a href="https://www.ebay.com/itm/123456789012">Raf Simons eBay Archive Jacket $240</a>');
        if (url.includes("mercari.com/search")) return new Response('<a href="https://www.mercari.com/us/item/m12345678901/">Raf Simons Mercari US Tee $95</a>');
        if (url.includes("facebook.com/marketplace")) return new Response('<a href="https://www.facebook.com/marketplace/item/123456789012345/">Raf Simons Facebook Marketplace Coat $180</a>');
        if (url.includes("bing.com/search") || url.includes("duckduckgo.com/html")) {
          return new Response(
            '<html><body>' +
            '<a href="https://shop.example.com/products/raf-tee">Raf Simons Public Shop Tee $120</a>' +
            '<a href="https://www.depop.com/products/example-built-in/">Built-in Depop Listing $99</a>' +
            '</body></html>',
            { status: 200 },
          );
        }
        return new Response("<html></html>", { status: 200 });
      },
    };

    const require = createRequire(import.meta.url);
    const route = require(join(outDir, "api/web-listings/route.js"));
    const request = new Request("https://resalemasterlab.example/api/web-listings", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "raf simons", queries: ["raf simons archive"] }),
    });
    const resultResponse = await route.POST(request);
    assert.equal(resultResponse.status, 200);
    const body = await resultResponse.json();
    assert.equal(body.browserBindingAvailable, true);
    assert.match(body.discoveryMode, /Browser Run/);
    const webShop = body.listings.find((item) => item.url === "https://shop.example.com/products/raf-tee");
    assert.ok(webShop, "rendered unsupported-store result should be read as a priced listing");
    assert.equal(webShop.image, "https://shop.example.com/tee.jpg");
    assert.equal(webShop.sourceHost, "shop.example.com");
    assert.equal(body.listings.some((item) => /depop\.com/.test(item.url)), false,
      "built-in marketplace results must be excluded from AI Search");
    assert.ok(body.excludedSupportedDomains.includes("depop.com"));
    assert.deepEqual(body.targetedSecondhandSources, ["eBay", "Mercari US", "Facebook Marketplace"]);
    for (const [url, expectedSource] of [
      ["https://www.ebay.com/itm/123456789012", "eBay"],
      ["https://www.mercari.com/us/item/m12345678901/", "Mercari US"],
      ["https://www.facebook.com/marketplace/item/123456789012345/", "Facebook Marketplace"],
    ]) {
      const listing = body.listings.find((item) => item.url === url);
      assert.ok(listing, `${expectedSource} should be returned by targeted AI Search`);
      assert.equal(listing.sourceName, expectedSource);
      if (expectedSource !== "Facebook Marketplace") assert.ok(listing.image);
      else assert.match(listing.riskSignals.join(" "), /detail page did not expose complete public metadata/i);
    }
    assert.equal(body.sourceCount, 4);
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.__RML_WEB_BROWSER__ = originalBrowser;
    await rm(outDir, { recursive: true, force: true });
  }
});

test("AI Search keeps Rakuten and the literal query in the combined parallel scan", async () => {
  const page = await import("node:fs/promises").then(({ readFile }) =>
    readFile(new URL("app/page.tsx", root), "utf8"));
  assert.match(page, /loadRealListings\(loadMore = false, forceAiSearch = false, forceRakuten = false\)/);
  assert.match(page, /\(forceRakuten \|\| includeAiSearch\)/);
  assert.match(page, /requestedSelections\.add\("Rakuten"\)/);
  assert.match(page, /\[literalQuery, \.\.\.aiSearchQueries\]/);
  assert.match(page, /Promise\.all\(requestMarkets\.map\(async \(marketplace\)/);
  assert.match(page, /zenMarketSelections/);
  assert.match(page, /providerBatchSize/);
  assert.match(page, /providerBatchIndex/);
  assert.match(page, /loadRealListings\(false, true, true\)/);
});
