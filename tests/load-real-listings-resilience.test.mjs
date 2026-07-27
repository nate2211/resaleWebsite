import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");

test("real listing scans isolate request and response failures", () => {
  assert.match(page, /async function readApiJson/);
  assert.match(page, /returned an HTML page instead of JSON/);
  assert.match(page, /Promise\.allSettled\(queries\.map/);
  assert.match(page, /controller\.signal\.aborted \|\| generation !== requestGeneration\.current/);
  assert.match(page, /requestErrorMessage\(error, "The selected marketplace scan failed\."\)/);
  assert.match(page, /onClick=\{\(\) => \{ void loadRealListings\(false\); \}\}/);
});

test("deep inspection uses the same guarded JSON reader", () => {
  assert.match(page, /"Grailed sold inspection"/);
  assert.match(page, /`\$\{marketplace\} \$\{mode\} inspection`/);
});
