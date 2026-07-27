import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const routePath = new URL("../app/api/listings/route.ts", import.meta.url);

test("Vestiaire runtime recovery avoids stale empty responses", async () => {
  const route = await readFile(routePath, "utf8");
  assert.match(route, /cache-control": "no-store, max-age=0"/);
  assert.match(route, /async function discoverVestiaire/);
  assert.match(route, /vestiaireNextDataUrls/);
  assert.match(route, /_next\/data/);
  assert.match(route, /Sequential first-party/);
  assert.match(route, /bing\.com\/search\?count=30/);
  assert.match(route, /vestiaireEmptyShells/);
  assert.match(route, /15_000/);
});
