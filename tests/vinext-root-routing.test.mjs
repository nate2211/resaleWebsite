import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const wrangler = await readFile(new URL("../wrangler.jsonc", import.meta.url), "utf8");
const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const vite = await readFile(new URL("../vite.config.ts", import.meta.url), "utf8");
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("Vinext full-stack development uses the exported App Router Worker entry", () => {
  assert.equal(packageJson.devDependencies.vinext, "0.0.50");
  assert.match(wrangler, /"main"\s*:\s*"vinext\/server\/app-router-entry"/);
  assert.match(wrangler, /"binding"\s*:\s*"ASSETS"/);
  assert.match(wrangler, /"not_found_handling"\s*:\s*"none"/);
  assert.doesNotMatch(wrangler, /fetch-handler/);
  assert.doesNotMatch(wrangler, /single-page-application/);
});

test("the root App Router page and Vinext plugin remain registered", () => {
  assert.match(page, /["']use client["']/);
  assert.match(vite, /vinext\(\)/);
  assert.match(vite, /configPath:\s*["']\.\/wrangler\.jsonc["']/);
});
