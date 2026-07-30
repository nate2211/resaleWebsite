import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("frontend prefers Browser Bridge for marketplaces that reject cloud egress", async () => {
  const client = await source("app/lib/frontend-marketplaces.ts");
  assert.match(client, /frontendApiFetchText/);
  assert.match(client, /\/api\/listings\?source=/);
  assert.match(client, /x-rml-upstream-status/);
  assert.match(client, /const preferBridge = bridgeReady/);
  assert.match(client, /\["depop\.com", "grailed\.com", "poshmark\.com"\]/);
  assert.match(client, /if \(preferBridge\)[\s\S]*?const bridged = await tryBridge\(\)/);
  assert.match(client, /const relayed = await frontendApiFetchText/);
});

test("Grailed public-index fallback only runs when page capture found no cards", async () => {
  const client = await source("app/lib/frontend-marketplaces.ts");
  assert.match(client, /const hasGrailedPageCards = marketplace === "Grailed"/);
  assert.match(client, /if \(marketplace === "Grailed" && !hasGrailedPageCards\)/);
});

test("marketplace API remains a bounded raw fallback without parsing loops", async () => {
  const route = await source("app/api/listings/route.ts");
  assert.match(route, /MAX_BODY_BYTES = 5_500_000/);
  assert.match(route, /UPSTREAM_TIMEOUT_MS = 15_000/);
  assert.match(route, /official-page-source-relay/);
  assert.match(route, /readLimitedText/);
  assert.doesNotMatch(route, /quickAction|cloudflare:workers|BrowserRun|DOMParser|hydrate|search engine/i);
});

test("known CORS-blocked hosts are not fetched directly from the page", async () => {
  const client = await source("app/lib/frontend-marketplaces.ts");
  assert.match(client, /if \(directBrowserFetchAllowed\(url\)\)/);
  assert.match(client, /"depop\.com"/);
  assert.match(client, /"grailed\.com"/);
  assert.match(client, /"poshmark\.com"/);
});

test("Browser Bridge captures rendered marketplace tabs and preserves verification", async () => {
  const manifest = JSON.parse(await source("browser-extension/manifest.json"));
  const background = await source("browser-extension/background.js");
  const marketplace = await source("browser-extension/marketplace-content.js");
  assert.equal(manifest.version, "2.0.0");
  assert.ok(manifest.permissions.includes("tabs"));
  assert.ok(manifest.content_scripts.some((entry) => entry.js.includes("marketplace-content.js")));
  assert.match(background, /credentials: "include"/);
  assert.match(background, /captureThroughTab/);
  assert.match(background, /requiresUserAction/);
  assert.match(marketplace, /RML_CAPTURE_PAGE/);
  assert.match(marketplace, /__RML_BRIDGE_SNAPSHOT__/);
  assert.match(marketplace, /Marketplace verification is open in a browser tab/);
});

test("health and deployment identify Browser Bridge-aware revision", async () => {
  const health = await source("app/api/health/route.ts");
  const wrangler = await source("wrangler.jsonc");
  assert.match(health, /market-search-browser-bridge-production-v18/);
  assert.match(wrangler, /official-page-source-relay/);
  assert.doesNotMatch(wrangler, /"browser"\s*:/i);
});
