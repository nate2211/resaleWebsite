import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("uses official marketplace search pages instead of Depop JSON endpoints", async () => {
  const client = await source("app/lib/frontend-marketplaces.ts");
  assert.match(client, /https:\/\/www\.depop\.com\/search\/\?q=/);
  assert.match(client, /https:\/\/www\.depop\.com\/brands\/\$\{slug\}/);
  assert.match(client, /https:\/\/www\.depop\.com\/theme\/\$\{slug\}/);
  assert.doesNotMatch(client, /webapi\.depop\.com|api\/v[23]\/search\/products/);
  assert.match(client, /https:\/\/www\.grailed\.com\/shop\?query=/);
  assert.match(client, /\/api\/grailed-search/);
  assert.match(client, /parseGrailedPublicConfig/);
  assert.match(client, /parseDepopReaderMarkdown/);
  assert.match(client, /https:\/\/poshmark\.com\/search\?query=/);
  assert.match(client, /searchMode=custom&stores=27/);
  assert.match(client, /zenmarket\.jp\/en\/mercari\.aspx\?q=/);
  assert.doesNotMatch(client, /jp\.mercari\.com\/search\?keyword=/);
  assert.match(client, /searchMode=custom&stores=28/);
  assert.match(client, /searchMode=custom&stores=0/);
  assert.match(client, /searchMode=custom&stores=25/);
});

test("parses structured page state and hydrates only missing listing fields", async () => {
  const client = await source("app/lib/frontend-marketplaces.ts");
  assert.match(client, /__NEXT_DATA__/);
  assert.match(client, /__INITIAL_STATE__/);
  assert.match(client, /self\\\.__next_f\\\.push/);
  assert.match(client, /jsonPayloadsFromScript/);
  assert.match(client, /canonicalListingUrl/);
  assert.match(client, /hydrateListingPages/);
  assert.match(client, /maxCandidates: allMarketsMode \? 2 : marketplace === "Grailed" \? 10 : 4/);
  assert.match(client, /length: Math\.min\(maxWorkers, candidates\.length\)/);
  assert.match(client, /Promise\.allSettled\(workers\)/);
});

test("relay returns official or recovered page source with upstream metadata", async () => {
  const route = await source("app/api/listings/route.ts");
  assert.match(route, /market-search-zenmarket-grailed-posts-v24/);
  assert.match(route, /x-rml-upstream-status/);
  assert.match(route, /x-rml-final-url/);
  assert.match(route, /x-rml-upstream-content-type/);
  assert.match(route, /x-rml-recovery-transport/);
  assert.match(route, /fetchDepopReader/);
  assert.match(route, /fetchIndexedDepopLinks/);
  assert.match(route, /fetchDepopApi/);
  assert.match(route, /Promise\.any\(tasks\)/);
  assert.match(route, /new Response\(body/);
  assert.doesNotMatch(route, /quickAction|cloudflare:workers|BrowserRun|DOMParser/);
});
