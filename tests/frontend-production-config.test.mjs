import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("targets the production custom domain while retaining workers.dev diagnostics", async () => {
  const wrangler = JSON.parse(await source("wrangler.jsonc"));
  assert.equal(wrangler.name, "resalewebsite");
  assert.equal(wrangler.workers_dev, true);
  assert.equal(wrangler.vars.RML_MARKETPLACE_TRANSPORT, "official-page-source-relay");
  assert.deepEqual(wrangler.routes, [{ pattern: "resalemasterlab.cloud-cord.com", custom_domain: true }]);
  assert.equal(wrangler.browser, undefined);
});

test("production checker verifies the bounded marketplace results API", async () => {
  const checker = await source("scripts/check-production.mjs");
  assert.match(checker, /production-thrift-listing-v13/);
  assert.match(checker, /one-official-page-per-relay-request/);
  assert.match(checker, /x-rml-upstream-status/);
  assert.match(checker, /example\.com/);
  assert.doesNotMatch(checker, /media-photos\.depop/);
  assert.doesNotMatch(checker, /image-proxy/);
});
