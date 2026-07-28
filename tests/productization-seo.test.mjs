import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("persists commercial Browse filters and loads AI from the navbar", async () => {
  const page = await source("app/page.tsx");

  for (const token of [
    "minimumPrice", "maximumPrice", "listedAfter", "listedBefore",
    "price-ascending", "price-descending", "newest", "oldest",
    "resalemasterlab:browse:v1", "resalemasterlab:workspace:v2",
  ]) assert.match(page, new RegExp(token));

  assert.match(page, /AI not ready · Load/);
  assert.match(page, /resalemasterlab:load-ai/);
  assert.match(page, /Saved automatically on this device/);
  assert.match(page, /Search selected marketplaces/);
});

test("packages crawlable public pages and Google-facing metadata", async () => {
  const [layout, sitemap, robots, manifest, faq, wrangler] = await Promise.all([
    source("app/layout.tsx"), source("app/sitemap.ts"), source("app/robots.ts"),
    source("app/manifest.ts"), source("app/faq/page.tsx"), source("wrangler.static.toml"),
  ]);

  for (const token of ["ResaleMasterLab", "metadataBase", "openGraph", "twitter", "application/ld+json"]) {
    assert.match(layout, new RegExp(token.replace(/[+]/g, "\\+")));
  }
  for (const route of ["/about", "/methodology", "/faq", "/contact", "/accessibility", "/privacy", "/terms"]) {
    assert.match(sitemap, new RegExp(route));
  }
  assert.match(robots, /disallow: \["\/api\/"\]/);
  assert.match(robots, /sitemap/);
  assert.match(manifest, /icon-maskable-512\.png/);
  assert.match(faq, /FAQPage/);
  assert.match(wrangler, /name = "resalemasterlab-static"/);
  assert.match(wrangler, /compatibility_date = "2026-07-28"/);
  assert.match(wrangler, /directory = "\.\/build"/);
  assert.match(wrangler, /not_found_handling = "single-page-application"/);
});

test("keeps the AI Search marketplace card public-web guarded", async () => {
  const [page, webRoute, listingRoute, engagement] = await Promise.all([
    source("app/page.tsx"), source("app/api/web-listings/route.ts"),
    source("app/api/listings/route.ts"), source("app/lib/engagement.ts"),
  ]);

  assert.match(page, /checked=\{aiWebSearchSelected\}/);
  assert.match(page, /<h2>AI Search<\/h2>/);
  assert.match(page, /aria-label="AI Search query"/);
  assert.doesNotMatch(page, /AI Search[\s\S]{0,600}placeholder=.*(?:site|domain)/i);
  assert.doesNotMatch(webRoute, /body\.site|site:\$\{host\}|function sourceHost/);
  assert.match(listingRoute, /JDirectItems Auction/);
  assert.match(engagement, /parseGrailed/);
  assert.match(webRoute, /public/i);
});


test("loads the same ResaleMasterLab styling in development and production", async () => {
  const [layout, vite, packageJson, prepare, validate, globals, postcss] = await Promise.all([
    source("app/layout.tsx"), source("vite.config.ts"), source("package.json"),
    source("scripts/prepare-static-build.mjs"), source("scripts/validate-vinext-build.mjs"),
    source("app/globals.css"), source("postcss.config.mjs"),
  ]);
  assert.match(layout, /import "\.\/globals\.css"/);
  assert.match(vite, /devSourcemap: true/);
  assert.match(vite, /cssCodeSplit: false/);
  assert.match(vite, /@cloudflare\/vite-plugin/);
  assert.match(vite, /configPath: "\.\/wrangler\.jsonc"/);
  assert.match(vite, /command === "serve" \|\| command === "build"/);
  assert.match(vite, /\.\.\.\(enableCloudflare/);
  assert.match(packageJson, /prepare-static-build\.mjs/);
  assert.match(prepare, /production client contains no CSS bundle/);
  assert.match(validate, /full-stack Vinext/);
  assert.match(prepare, /Detected a valid full-stack Vinext\/Cloudflare build/);
  assert.doesNotMatch(globals, /@import\s+["']tailwindcss["']/);
  assert.match(globals, /--canvas:/);
  assert.match(postcss, /plugins:\s*\{\}/);
});
