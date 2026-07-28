import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("moves marketplace requests out of Cloudflare routes", async () => {
  const [page, client, listingsRoute, webRoute, imageRoute, wrangler, health] = await Promise.all([
    source("app/page.tsx"),
    source("app/lib/frontend-marketplaces.ts"),
    source("app/api/listings/route.ts"),
    source("app/api/web-listings/route.ts"),
    source("app/api/image-proxy/route.ts"),
    source("wrangler.jsonc"),
    source("app/api/health/route.ts"),
  ]);

  assert.doesNotMatch(page, /\/api\/listings/);
  assert.doesNotMatch(page, /\/api\/web-listings/);
  assert.doesNotMatch(page, /\/api\/image-proxy/);
  assert.match(page, /searchMarketplaceFrontend/);
  assert.match(page, /searchAiWebFrontend/);
  assert.match(client, /mode:\s*"cors"/);
  assert.match(client, /CORS_BLOCKED_MARKETPLACE_HOSTS/);
  assert.match(client, /directBrowserFetchAllowed/);
  assert.match(client, /pendingBridgeRequests/);
  assert.match(client, /bridgeResponseListenerInstalled/);
  assert.match(client, /RML_FETCH_REQUEST/);
  assert.match(client, /https:\/\/r\.jina\.ai\//);
  assert.match(client, /https:\/\/s\.jina\.ai\//);
  assert.match(client, /Promise\.allSettled/);
  assert.match(listingsRoute, /status:\s*410/);
  assert.match(webRoute, /status:\s*410/);
  assert.match(imageRoute, /status:\s*410/);
  assert.doesNotMatch(wrangler, /"browser"\s*:/);
  assert.doesNotMatch(wrangler, /"binding"\s*:\s*"BROWSER"/);
  assert.match(health, /frontend-marketplaces-cors-safe-v8/);
  assert.match(health, /cloudflareMarketplaceFetches:\s*false/);
});

test("keeps the three ZenMarket stores separate in browser-side queries", async () => {
  const client = await source("app/lib/frontend-marketplaces.ts");
  assert.match(client, /stores=28/);
  assert.match(client, /stores=0/);
  assert.match(client, /stores=25/);
  assert.match(client, /JDirectItems Auction/);
  assert.match(client, /Rakuten Rakuma/);
});

test("loads Depop data and images without accepting favicon results", async () => {
  const client = await source("app/lib/frontend-marketplaces.ts");
  const page = await source("app/page.tsx");

  assert.match(client, /webapi\.depop\.com\/api\/v3\/search\/products/);
  assert.match(client, /webapi\.depop\.com\/api\/v2\/search\/products/);
  assert.match(client, /media-photos\.depop\.com|Depop/);
  assert.match(client, /favicon|\\\.ico/);
  assert.match(client, /duckduckgo\\\.com\\\/ip3/);
  assert.match(page, /referrerPolicy="no-referrer"/);
  assert.doesNotMatch(page, /\/api\/image-proxy/);
});

test("includes an explicit browser extension bridge", async () => {
  const manifest = JSON.parse(await source("browser-extension/manifest.json"));
  const content = await source("browser-extension/content.js");
  const background = await source("browser-extension/background.js");

  assert.equal(manifest.manifest_version, 3);
  assert.ok(manifest.host_permissions.includes("https://www.depop.com/*"));
  assert.ok(manifest.host_permissions.includes("https://zenmarket.jp/*"));
  assert.ok(manifest.host_permissions.includes("https://www.ebay.com/*"));
  assert.match(content, /RML_FETCH_REQUEST/);
  assert.match(content, /RML_FETCH_RESPONSE/);
  assert.match(content, /__RML_BROWSER_BRIDGE_CONTENT_INSTALLED__/);
  assert.match(background, /__RML_BROWSER_BRIDGE_BACKGROUND_INSTALLED__/);
  assert.match(background, /chrome\.runtime\.onMessage/);
  assert.match(background, /credentials:\s*"omit"/);
});
