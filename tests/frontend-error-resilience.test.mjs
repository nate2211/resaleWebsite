import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import test from "node:test";

const engagementRoute = new URL("../app/api/engagement/route.ts", import.meta.url).href;
const grailedRoute = new URL("../app/api/grailed-search/route.ts", import.meta.url).href;

test("blocked engagement metadata returns an unknown report with HTTP 200", async () => {
  const source = await readFile(new URL("../app/api/engagement/route.ts", import.meta.url), "utf8");
  assert.match(source, /function unavailableReport/);
  assert.match(source, /demandLevel: "unknown"/);
  assert.match(source, /completeness: 0/);
  assert.match(source, /return reply\(value\);/);
  assert.doesNotMatch(source, /marketplace did not expose[\s\S]{0,300}, 422/);
});

test("Grailed upstream outages become partial HTTP 200 results instead of 502", () => {
  const script = String.raw`
    globalThis.fetch = async () => { throw new Error("temporary DNS failure"); };
    const { POST } = await import(${JSON.stringify(grailedRoute)});
    const response = await POST(new Request("https://example.test/api/grailed-search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        query: "supreme", page: 0, mode: "active",
        index: "Listing_production", appId: "MNRWEFSS2Q",
        apiKey: "c89dbaddf15fe70e1941a109bf7c2a3d",
      }),
    }));
    console.log(JSON.stringify({ status: response.status, body: await response.json() }));
  `;
  const result = spawnSync(process.execPath, [
    "--experimental-strip-types", "--input-type=module", "--eval", script,
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const value = JSON.parse(result.stdout.trim());
  assert.equal(value.status, 200);
  assert.equal(value.body.partial, true);
  assert.deepEqual(value.body.hits, []);
});

test("Mercari Japan uses ZenMarket store 27 and unauthenticated Jina calls are suppressed", async () => {
  const source = await readFile(new URL("../app/lib/frontend-marketplaces.ts", import.meta.url), "utf8");
  assert.match(source, /searchMode=custom&stores=27/);
  assert.match(source, /zenmarket\.jp\/en\/mercari\.aspx\?q=/);
  assert.match(source, /storeId === "27"/);
  assert.match(source, /mercari\(\?:product\)\?\\\.aspx|mercari\(\?:product\)\?/);
  assert.doesNotMatch(source, /jp\.mercari\.com\/search\?keyword=/);
  assert.match(source, /if \(!key\) return \[\];/);
  assert.match(source, /allowReader: false/);
});
