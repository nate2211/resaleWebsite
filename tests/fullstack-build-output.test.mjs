import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("post-build preparation accepts valid full-stack Vinext output without static HTML", async () => {
  const temp = await mkdtemp(path.join(os.tmpdir(), "rml-vinext-"));
  await mkdir(path.join(temp, "scripts"), { recursive: true });
  await mkdir(path.join(temp, "dist", "worker", "client", "assets"), { recursive: true });
  await writeFile(path.join(temp, "scripts", "prepare-static-build.mjs"), await readFile(new URL("scripts/prepare-static-build.mjs", root)));
  await writeFile(path.join(temp, "dist", "worker", "wrangler.json"), JSON.stringify({ main: "index.js", assets: { directory: "./client" } }));
  await writeFile(path.join(temp, "dist", "worker", "index.js"), "export default { fetch() { return new Response('ok') } };\n");
  await writeFile(path.join(temp, "dist", "worker", "client", "assets", "app.js"), "console.log('client');\n");
  await writeFile(path.join(temp, "dist", "worker", "client", "assets", "app.css"), "body{display:block}\n");

  const result = spawnSync(process.execPath, ["scripts/prepare-static-build.mjs"], { cwd: temp, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /valid full-stack Vinext\/Cloudflare build/);
  assert.match(result.stdout, /Skipped \.\/build SPA preparation/);
});
