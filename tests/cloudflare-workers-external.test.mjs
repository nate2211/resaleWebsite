import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Vinext leaves the workerd cloudflare:workers module external", async () => {
  const [vite, route] = await Promise.all([
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/listings/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /import\("cloudflare:workers"\)/);
  assert.match(vite, /rolldownOptions\s*:\s*\{/);
  const externalMatches = vite.match(/external\s*:\s*\["cloudflare:workers"\]/g) ?? [];
  assert.ok(externalMatches.length >= 2, "expected both SSR and Rolldown externalization");
});
