import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("frontend uses the same-origin marketplace results API before fallbacks", async () => {
  const client = await source("app/lib/frontend-marketplaces.ts");
  assert.match(client, /frontendApiFetchText/);
  assert.match(client, /\/api\/listings\?source=/);
  assert.match(client, /x-rml-upstream-status/);
  assert.match(client, /const relayed = await frontendApiFetchText/);
  assert.ok(client.indexOf("frontendApiFetchText(url, signal)") < client.indexOf("extensionFetchText(url, signal)"));
});

test("marketplace API is a bounded raw relay without Browser Run or parsing loops", async () => {
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

test("health and deployment identify frontend API relay revision", async () => {
  const health = await source("app/api/health/route.ts");
  const wrangler = await source("wrangler.jsonc");
  assert.match(health, /official-page-source-marketplaces-v10/);
  assert.match(wrangler, /official-page-source-relay/);
  assert.doesNotMatch(wrangler, /"browser"\s*:/i);
});
