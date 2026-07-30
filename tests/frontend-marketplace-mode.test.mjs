import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

async function compiler(t) {
  const local = new URL("../node_modules/typescript/bin/tsc", import.meta.url);
  try { await access(local); return { command: process.execPath, prefix: [fileURLToPath(local)] }; }
  catch {
    const probe = spawnSync("tsc", ["--version"], { encoding: "utf8" });
    if (probe.status !== 0) { t.skip("TypeScript compiler is unavailable."); return null; }
    return { command: "tsc", prefix: [] };
  }
}

test("frontend sends Depop through the same-origin marketplace API without an extension", async () => {
  const client = await source("app/lib/frontend-marketplaces.ts");
  assert.match(client, /frontendApiFetchText/);
  assert.match(client, /\/api\/listings\?source=/);
  assert.match(client, /including Depop/);
  assert.match(client, /const relayed = await frontendApiFetchText/);
  assert.doesNotMatch(client, /__RML_EXTENSION_FETCH__|RML_FETCH_REQUEST|extensionFetchText|Browser Bridge/);
});

test("Depop API recovery is bounded and discards challenge HTML", async () => {
  const route = await source("app/api/listings/route.ts");
  assert.match(route, /^\s*"depop\.com",/m);
  assert.match(route, /function depopChallenge/);
  assert.match(route, /fetchDepopReader/);
  assert.match(route, /fetchIndexedDepopLinks/);
  assert.match(route, /MAX_INDEXED_DEPOP_LINKS = 12/);
  assert.match(route, /recovery: "depop-reader"/);
  assert.match(route, /recovery: "depop-index"/);
  assert.doesNotMatch(route, /browser-tab-only|chrome\.|BrowserRun/);
});

test("a mocked Depop 403 is replaced by readable product cards", async (t) => {
  const found = await compiler(t); if (!found) return;
  const outDir = await mkdtemp(join(tmpdir(), "rml-depop-api-v20-"));
  const originalFetch = globalThis.fetch;
  try {
    const input = fileURLToPath(new URL("../app/api/listings/route.ts", import.meta.url));
    const result = spawnSync(found.command, [...found.prefix, "--target", "ES2022", "--module", "commonjs", "--lib", "ES2022,DOM", "--outDir", outDir, input], { encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    await writeFile(join(outDir, "package.json"), '{"type":"commonjs"}\n');
    let calls = 0;
    globalThis.fetch = async (url) => {
      calls += 1;
      const value = String(url);
      if (value.startsWith("https://www.depop.com/")) {
        return new Response("Sorry, not authorized. 403 Forbidden", { status: 403, headers: { "content-type": "text/html" } });
      }
      if (value.startsWith("https://r.jina.ai/")) {
        return new Response("1. [Supreme Box Logo Tee](https://www.depop.com/products/seller-supreme-box-logo-tee/)\nM\n$55.00", { status: 200, headers: { "content-type": "text/plain" } });
      }
      throw new Error(`Unexpected URL ${value}`);
    };
    const route = createRequire(import.meta.url)(join(outDir, "route.js"));
    const sourceUrl = "https://www.depop.com/search/?q=supreme&page=1";
    const response = await route.GET(new Request(`https://resalemasterlab.cloud-cord.com/api/listings?source=${encodeURIComponent(sourceUrl)}`));
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("x-rml-recovery-transport"), "depop-reader");
    assert.match(body, /depop\.com\/products\/seller-supreme/);
    assert.doesNotMatch(body, /not authorized|403 forbidden/i);
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
    await rm(outDir, { recursive: true, force: true });
  }
});

test("Grailed public-index fallback only runs when page capture found no cards", async () => {
  const client = await source("app/lib/frontend-marketplaces.ts");
  assert.match(client, /const hasGrailedPageCards = marketplace === "Grailed"/);
  assert.match(client, /if \(marketplace === "Grailed" && !hasGrailedPageCards\)/);
});

test("known CORS-blocked hosts are not fetched directly from the page", async () => {
  const client = await source("app/lib/frontend-marketplaces.ts");
  assert.match(client, /if \(directBrowserFetchAllowed\(url\)\)/);
  assert.match(client, /"depop\.com"/);
  assert.match(client, /"grailed\.com"/);
  assert.match(client, /"poshmark\.com"/);
});

test("the Browser Bridge extension was removed", async () => {
  await assert.rejects(access(new URL("../browser-extension", import.meta.url)));
  const page = await source("app/page.tsx");
  const css = await source("app/globals.css");
  assert.doesNotMatch(page, /Browser Bridge|browserBridge|RML_BRIDGE/);
  assert.doesNotMatch(css, /browser-bridge/);
});

test("health and deployment identify frontend-API recovery", async () => {
  const health = await source("app/api/health/route.ts");
  const wrangler = await source("wrangler.jsonc");
  assert.match(health, /market-search-frontend-api-depop-recovery-v20/);
  assert.match(health, /frontend-api-page-source-recovery/);
  assert.match(wrangler, /frontend-api-page-source-recovery/);
  assert.doesNotMatch(wrangler, /"browser"\s*:/i);
});
