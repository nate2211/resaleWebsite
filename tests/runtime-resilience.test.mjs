import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const source = (path) => readFile(new URL(path, root), "utf8");

test("keeps install assets on the active localhost or production origin", async () => {
  const layout = await source("app/layout.tsx");
  for (const path of ["/manifest.webmanifest", "/favicon.svg", "/icon-192.png", "/apple-touch-icon.png"]) {
    assert.match(layout, new RegExp(`href=\\"${path.replaceAll(".", "\\.")}\\"`));
  }
  assert.doesNotMatch(layout, /https:\/\/resalemasterlab\.com\/(?:manifest\.webmanifest|favicon\.svg|icon-192\.png)/);
  assert.match(layout, /metadataBase: configuredSiteUrl \?/);
});

test("retries transient API and public-page failures with bounded concurrency", async () => {
  const [page, safeWeb, webRoute] = await Promise.all([
    source("app/page.tsx"),
    source("app/lib/safe-web.ts"),
    source("app/api/web-listings/route.ts"),
  ]);
  assert.match(page, /API_RETRY_DELAYS_MS/);
  assert.match(page, /RETRYABLE_API_STATUS/);
  assert.match(page, /could not reconnect after retrying/);
  assert.match(page, /settleInBatches\(queries, 2/);
  assert.match(safeWeb, /WEB_RETRY_DELAYS_MS/);
  assert.match(safeWeb, /RETRYABLE_WEB_STATUS/);
  assert.match(webRoute, /mapSettledWithConcurrency\(searches, 2/);
  assert.match(webRoute, /discovered\.slice\(0, MAX_READS\),\s*4,/s);
});

test("AI Search excludes built-in marketplace domains", async () => {
  const route = await source("app/api/web-listings/route.ts");
  for (const domain of ["depop.com", "grailed.com", "poshmark.com", "zenmarket.jp", "rakuten.co.jp"]) {
    assert.match(route, new RegExp(domain.replaceAll(".", "\\.")));
  }
  assert.match(route, /supportedMarketplaceUrl/);
  assert.match(route, /NEGATIVE_SUPPORTED_SITES/);
  assert.match(route, /excludedSupportedDomains/);
  assert.match(route, /quickAction\("links"/);
});
