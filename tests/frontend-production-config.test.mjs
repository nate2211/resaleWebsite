import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("targets the existing workers.dev deployment without custom routes", async () => {
  const wrangler = JSON.parse(await source("wrangler.jsonc"));
  assert.equal(wrangler.name, "resalewebsite");
  assert.equal(wrangler.workers_dev, true);
  assert.equal(wrangler.vars.RML_MARKETPLACE_TRANSPORT, "frontend-api-relay");
  assert.equal(wrangler.routes, undefined);
  assert.equal(wrangler.browser, undefined);
});

test("production checker verifies the bounded marketplace results API", async () => {
  const checker = await source("scripts/check-production.mjs");
  assert.match(checker, /frontend-marketplace-results-api-v9/);
  assert.match(checker, /single-bounded-relay-only/);
  assert.match(checker, /relay\.transport !== "frontend-api"/);
  assert.match(checker, /example\.com/);
  assert.doesNotMatch(checker, /media-photos\.depop/);
  assert.doesNotMatch(checker, /image-proxy/);
});
