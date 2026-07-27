import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function sources() {
  const [analysis, listings, page, research] = await Promise.all([
    readFile(new URL("app/lib/analysis.ts", root), "utf8"),
    readFile(new URL("app/api/listings/route.ts", root), "utf8"),
    readFile(new URL("app/page.tsx", root), "utf8"),
    readFile(new URL("app/api/research/route.ts", root), "utf8"),
  ]);
  return { analysis, listings, page, research };
}

test("keeps international marketplace routes and sold searches distinct", async () => {
  const { analysis, listings, research } = await sources();

  for (const marketplace of [
    "Mercari Japan", "JDirectItems Auction", "Rakuten",
    "Rakuten Rakuma", "Bunjang", "Goofish",
  ]) {
    assert.match(analysis, new RegExp(marketplace));
    assert.match(listings, new RegExp(marketplace));
  }

  assert.match(listings, /const status = mode === "sold" \? "sold_out" : "on_sale"/);
  assert.match(listings, /stores=28/);
  assert.match(listings, /stores=0/);
  assert.match(listings, /stores=25/);
  assert.match(listings, /www\.goofish\.com\/search\?q=/);
  assert.match(listings, /variant === "fleamarket" \? "fleamarket" : "search"/);
  assert.match(listings, /nTag: "Home-search"/);
  assert.match(listings, /from: "search-input"/);
  assert.match(listings, /keyword: query/);
  assert.match(listings, /superbuyProxyUrl/);
  assert.match(listings, /landedImportCosts/);
  for (const source of [analysis, research]) {
    assert.match(source, /zenmarket\.jp\/en\/search\.aspx\?q=/);
    assert.match(source, /searchMode=custom&stores=0/);
    assert.match(source, /www\.superbuy\.com\/en\/page\/search\//);
    assert.match(source, /nTag: "Home-search"/);
    assert.match(source, /from: "search-input"/);
    assert.doesNotMatch(source, /Agent-product-search|_search: "keyword"|position: "5"|platform: "xianyu"/);
  }
});

test("uses only the three resale marketplaces by default", async () => {
  const { analysis, page } = await sources();

  assert.match(analysis, /RESALE_MARKETPLACES = \["Depop", "Grailed", "Poshmark"\]/);
  assert.match(analysis, /INTERNATIONAL_MARKETPLACES(?::[^=]+)? = \[/);
  assert.match(page, /useState<Marketplace\[]>\(\[\s*\.\.\.RESALE_MARKETPLACES,\s*\]\)/);
  assert.doesNotMatch(page, /className="market-switcher"/);
  assert.match(page, /RESALE_MARKETPLACES\.map\(\(marketplace\) => renderMarketplaceCard/);
  assert.match(page, /<h2>AI Search<\/h2>/);
  assert.match(page, /aria-label="AI Search query"/);
  const internationalBlock = analysis.match(/INTERNATIONAL_MARKETPLACES(?::[^=]+)? = \[([\s\S]*?)\];/)?.[1] || "";
  assert.doesNotMatch(internationalBlock, /Goofish/);
});

test("gates and clears browse international requests", async () => {
  const { page } = await sources();

  assert.match(page, /internationalMarketsOpen \|\| !MARKETPLACE_INFO\[marketplace\]\.sourcingOnly/);
  assert.match(page, /setSelectedMarkets\(selectedMarkets\.filter/);
  assert.match(page, /message: "Open International Markets to enable this source\."/);
  assert.match(page, /listings: \[\],\s*hasMore: false/);
  assert.match(page, /requestGeneration\.current \+= 1/);
  assert.match(page, /requestAbortController\.current\?\.abort\(\)/);
  assert.match(page, /generation !== requestGeneration\.current/);
  assert.match(page, /No requests run while this section is closed/);
});

test("runs Grailed sold independently and opts into international analysis", async () => {
  const { page } = await sources();

  assert.match(page, /marketplace: "Grailed", mode: "sold"/);
  assert.match(page, /if \(!internationalAnalysisOpen\) return;/);
  assert.match(page, /internationalAnalysisAbort\.current\?\.abort\(\)/);
  assert.match(page, /INTERNATIONAL_MARKETPLACES\.map\(async \(marketplace\)/);
  assert.match(page, /fetchBatch\("Mercari Japan", "sold"/);
  assert.match(page, /Grailed sold inspection/);
  assert.match(page, /Grailed \+ Mercari Japan sold inspection/);
  assert.match(page, /internationalCompRows = compRows\.filter/);
  assert.match(page, /row\.prices\.length > 0 \|\| row\.comparableListings\.length > 0/);
  assert.match(page, /Closing this section cancels display updates and clears these results/);
});


test("starts international targets off and requires an explicit marketplace selection", async () => {
  const { page } = await sources();

  assert.match(page, /useState\(false\).*internationalMarketsOpen|internationalMarketsOpen.*useState\(false\)/s);
  assert.match(page, /!MARKETPLACE_INFO\[marketplace as Marketplace\]\?\.sourcingOnly/);
  assert.match(page, /AI Search is an international opt-in target and always starts off/);
  assert.match(page, /Select at least one marketplace before loading listings\./);
  assert.match(page, /function toggleMarketplace\(marketplace: Marketplace\)/);
  assert.match(page, /disabled=\{!selectedForSearch\}/);
  assert.match(page, /setSelectedMarkets\(selectedMarkets\.filter/);
});
