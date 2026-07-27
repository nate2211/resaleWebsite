import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("uses the supplied Vestiaire search and Raf Simons product patterns", async () => {
  const [route, analysis, research] = await Promise.all([
    readFile(new URL("app/api/listings/route.ts", root), "utf8"),
    readFile(new URL("app/lib/analysis.ts", root), "utf8"),
    readFile(new URL("app/api/research/route.ts", root), "utf8"),
  ]);

  assert.match(route, /function vestiaireSearchUrl/);
  assert.match(route, /new URLSearchParams\(\{ q: query\.trim\(\) \}\)/);
  assert.match(route, /red-cotton-raf-simons-knitwear-sweatshirt-69248166\.shtml/);
  assert.match(route, /vestiaireSearchUrl\(query, page\),[\s\S]*vestiaireKnownProductSeeds\(query\)/);
  assert.match(analysis, /URLSearchParams\(\{ q: query\.trim\(\) \}\)/);
  assert.match(research, /URLSearchParams\(\{ q: query\.trim\(\) \}\)/);
});

test("defaults domestic marketplaces on but restores explicit browser disables", async () => {
  const page = await readFile(new URL("app/page.tsx", root), "utf8");
  assert.match(page, /useState<Marketplace\[]>\(\[\s*\.\.\.RESALE_MARKETPLACES,\s*\]\)/);
  assert.match(page, /restore that exact domestic[\s\S]*explicitly disabled source/);
  assert.match(page, /RESALE_MARKETPLACES\.includes\(marketplace/);
  assert.match(page, /International sources always remain session-only opt-ins/);
});
