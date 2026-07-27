import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const [page, route, analysis, apparel] = await Promise.all([
  readFile(new URL("app/page.tsx", root), "utf8"),
  readFile(new URL("app/api/listings/route.ts", root), "utf8"),
  readFile(new URL("app/lib/analysis.ts", root), "utf8"),
  readFile(new URL("app/lib/apparel.ts", root), "utf8"),
]);

test("supports article-specific clothing targets and result filters", () => {
  for (const article of [
    "T-Shirts", "Long Sleeve T-Shirts", "Sweatshirts", "Hoodies",
    "Sweaters & Knitwear", "Shirts & Button-Ups", "Jackets & Coats",
    "Jeans", "Pants", "Shorts", "Shoes", "Bags", "Accessories",
  ]) {
    assert.match(apparel, new RegExp(article.replace(/[&-]/g, ".")));
  }
  assert.match(analysis, /articleType\?: ApparelType/);
  assert.match(route, /inferApparelType\(normalized\.category, normalized\.title, normalized\.description\)/);
  assert.match(route, /apparelSearchTerm\(category\)/);
  assert.match(page, /<span>Article type<\/span>/);
  assert.match(page, /value=\{articleFilter\}/);
  assert.match(page, /articleTypeFilter === "All clothing"/);
});

test("load more preserves current order and appends unique URLs", () => {
  assert.match(page, /const currentLiveState = liveStateRef\.current\.length/);
  assert.match(page, /entry\.marketplace === marketplace && entry\.hasMore/);
  assert.match(page, /const requestedPage = loadMore \? pageRef\.current \+ 1 : 0/);
  assert.match(page, /function invalidateLivePagination\(\)/);
  assert.match(page, /const next = current\.map\(\(entry\) => \(\{ \.\.\.entry, hasMore: false \}\)\)/);
  assert.match(page, /const raw = \[\.\.\.previous, \.\.\.incoming\]/);
  assert.match(page, /Map preserves first-seen order/);
  assert.match(page, /Appended \$\{addedCount\} new listing/);
  assert.match(page, /hasMore: Boolean\(response\.hasMore\) && addedCount > 0/);
  assert.match(page, /Discovery order \(new pages append\)/);
  assert.match(page, /void loadRealListings\(true\)/);

  const previous = [{ url: "a" }, { url: "b" }];
  const incoming = [{ url: "b" }, { url: "c" }, { url: "d" }];
  const merged = [...new Map([...previous, ...incoming].map((item) => [item.url, item])).values()];
  assert.deepEqual(merged.map((item) => item.url), ["a", "b", "c", "d"]);
});
