import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("production domain, sitemap, robots, and custom domain are aligned", async () => {
  const [site, sitemap, robots, wrangler] = await Promise.all([
    source("app/lib/site.ts"), source("app/sitemap.ts"), source("app/robots.ts"), source("wrangler.jsonc"),
  ]);
  for (const value of [site, sitemap, robots, wrangler]) assert.match(value, /resalemasterlab\.cloud-cord\.com/);
  assert.match(wrangler, /"custom_domain"\s*:\s*true/);
});

test("Thrift Check is crawlable and contains deterministic sold and image analysis", async () => {
  const [page, tool] = await Promise.all([
    source("app/thrift-check/page.tsx"), source("app/components/thrift-check-tool.tsx"),
  ]);
  for (const token of ["WebApplication", "HowTo", "BreadcrumbList", "Thrift Check"]) assert.match(page, new RegExp(token));
  for (const token of ["Grailed", "Depop", "Poshmark", "feeForSale", "compareImageMetrics", "Run Thrift Check"]) assert.match(tool, new RegExp(token));
});

test("Listing Template requires both local AI models and uses market pricing", async () => {
  const [page, tool, ai] = await Promise.all([
    source("app/listing-template/page.tsx"), source("app/components/listing-template-tool.tsx"), source("app/lib/browser-ai.ts"),
  ]);
  assert.match(page, /AI Listing Template|Listing Template/);
  assert.match(tool, /aiState !== "ready"/);
  assert.match(tool, /searchMarketplaceFrontend/);
  assert.match(tool, /LIST_PRICE/);
  assert.match(ai, /image-to-text/);
  assert.match(ai, /SmolLM2-135M-Instruct/);
});

test("PWA assets and screenshot files exist", async () => {
  const manifest = await source("app/manifest.ts");
  for (const token of ["maskable", "screenshots", "shortcuts", "/thrift-check", "/listing-template"]) assert.match(manifest, new RegExp(token));
  for (const file of [
    "public/favicon.ico", "public/icon-96.png", "public/icon-192.png", "public/icon-512.png",
    "public/icon-maskable-512.png", "public/screenshots/resalemasterlab-wide.png",
    "public/screenshots/resalemasterlab-mobile.png", "public/thrift-check-og.png", "public/listing-template-og.png",
  ]) assert.equal(existsSync(new URL(`../${file}`, import.meta.url)), true, `${file} missing`);
});

test("navbar links to both production tools and remains sticky", async () => {
  const [home, css] = await Promise.all([source("app/page.tsx"), source("app/globals.css")]);
  assert.match(home, /href="\/thrift-check"/);
  assert.match(home, /href="\/listing-template"/);
  assert.match(css, /\.topbar[\s\S]*position:\s*sticky/);
  assert.match(css, /\.feature-topbar[\s\S]*position:\s*sticky/);
});
