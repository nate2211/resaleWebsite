import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("every shell uses the complete responsive navigation", async () => {
  const nav = await read("app/components/site-navigation.tsx");
  const publicShell = await read("app/components/public-shell.tsx");
  const featureShell = await read("app/components/feature-shell.tsx");
  const page = await read("app/page.tsx");
  const css = await read("app/globals.css");
  for (const path of ["/", "/thrift-check", "/listing-template", "/methodology", "/about", "/faq", "/contact", "/accessibility", "/privacy", "/terms"]) {
    assert.match(nav, new RegExp(path.replaceAll("/", "\\/")));
  }
  assert.match(nav, /site-navigation-toggle/);
  assert.match(nav, /aria-expanded=\{open\}/);
  assert.match(publicShell, /<SiteNavigation/);
  assert.match(featureShell, /<SiteNavigation/);
  assert.match(page, /subnav-menu-toggle/);
  assert.match(page, /workspaceNavOpen/);
  assert.match(css, /site-navigation-links\.open/);
  assert.match(css, /subnav\.menu-open \.subnav-menu/);
  assert.match(css, /position: sticky/);
});

test("Depop and ZenMarket Mercari use official search and listing page sources", async () => {
  const client = await read("app/lib/frontend-marketplaces.ts");
  const depopParser = await read("app/lib/marketplace-source-parsers.ts");
  assert.match(client, /depop\.com\/search\/\?q=/);
  assert.match(client, /depop\.com\/brands\/\$\{slug\}/);
  assert.match(client, /depopMarkdownListings\(source, response\.url\)/);
  assert.match(depopParser, /media-photos\\\.depop\\\.com/);
  assert.doesNotMatch(depopParser, /if \(!image\) continue/);
  assert.match(client, /zenmarket\.jp\/en\/mercari\.aspx\?q=/);
  assert.match(client, /searchMode=custom&stores=27/);
  assert.match(client, /zenmarket\.jp\/en\/mercariproduct\.aspx\?itemCode=/);
  assert.match(client, /storeId === "27"/);
});

test("one all-market action uses bounded marketplace and relay concurrency", async () => {
  const client = await read("app/lib/frontend-marketplaces.ts");
  const page = await read("app/page.tsx");
  assert.match(client, /MARKETPLACE_RELAY_CONCURRENCY = 3/);
  assert.match(client, /withMarketplaceRelaySlot/);
  assert.match(page, /Select all markets/);
  assert.match(page, /setSelectedMarkets\(\[\.\.\.MARKETPLACES\]\)/);
  assert.match(page, /settleInBatches\(requestMarkets, allMarketsMode \? 2 : 3/);
  assert.match(page, /allMarketsMode \? \[literalQuery\]/);
  assert.match(page, /scanMode: allMarketsMode \? "all-markets" : "standard"/);
  assert.match(page, /Promise\.allSettled/);
});
