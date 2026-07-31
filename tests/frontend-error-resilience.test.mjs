import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
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

test("Grailed upstream outages become partial HTTP 200 results instead of 502", async () => {
  const outDir = await mkdtemp(join(tmpdir(), "rml-grailed-resilience-"));
  try {
    const routeInput = fileURLToPath(new URL("../app/api/grailed-search/route.ts", import.meta.url));
    const parserInput = fileURLToPath(new URL("../app/lib/marketplace-source-parsers.ts", import.meta.url));
    const appRoot = fileURLToPath(new URL("../app", import.meta.url));
    const compiled = spawnSync("tsc", [
      "--target", "ES2022", "--module", "commonjs", "--moduleResolution", "node",
      "--lib", "ES2022,DOM", "--rootDir", appRoot, "--outDir", outDir,
      routeInput, parserInput,
    ], { encoding: "utf8" });
    assert.equal(compiled.status, 0, compiled.stderr || compiled.stdout);
    await writeFile(join(outDir, "package.json"), '{"type":"commonjs"}\n');
    const compiledRoute = join(outDir, "api", "grailed-search", "route.js");
    const script = String.raw`
      globalThis.fetch = async () => { throw new Error("temporary DNS failure"); };
      const { POST } = require(${JSON.stringify(compiledRoute)});
      (async () => {
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
      })().catch((error) => { console.error(error); process.exit(1); });
    `;
    const result = spawnSync(process.execPath, ["--eval", script], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const value = JSON.parse(result.stdout.trim());
    assert.equal(value.status, 200);
    assert.equal(value.body.partial, true);
    assert.deepEqual(value.body.hits, []);
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
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
