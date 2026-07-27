import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const validator = await readFile(
  new URL("../scripts/validate-vinext-entry.mjs", import.meta.url),
  "utf8",
);
const wrangler = await readFile(
  new URL("../wrangler.vinext-build.toml", import.meta.url),
  "utf8",
);

test("builds validate the installed Vinext App Router export first", () => {
  assert.match(packageJson.scripts.build, /^node scripts\/validate-vinext-entry\.mjs && /);
  assert.match(packageJson.scripts["build:windows"], /^node scripts\/validate-vinext-entry\.mjs && /);
  assert.match(validator, /\.\/server\/app-router-entry/);
  assert.match(validator, /vinext\/server\/app-router-entry/);
  assert.match(wrangler, /^main\s*=\s*"vinext\/server\/app-router-entry"/m);
});
