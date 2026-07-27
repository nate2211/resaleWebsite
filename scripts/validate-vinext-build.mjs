import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const staticBuild = path.join(root, "build");
const roots = [path.join(root, "dist"), path.join(root, ".vinext")];

async function exists(target) {
  try { await stat(target); return true; } catch { return false; }
}

async function walk(directory) {
  const files = [];
  if (!(await exists(directory))) return files;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

if (await exists(path.join(staticBuild, "index.html"))) {
  const files = await walk(staticBuild);
  if (!files.some((file) => file.endsWith(".css"))) throw new Error("Missing compiled CSS in build/.");
  if (!files.some((file) => /\.(?:m?js)$/.test(file))) throw new Error("Missing compiled JavaScript in build/.");
  console.log("Validated static Vinext artifact: index.html, JavaScript, and CSS are present in build/.");
  process.exit(0);
}

const files = [];
for (const directory of roots) files.push(...await walk(directory));
const wrangler = files.find((file) => /(?:^|[\\/])wrangler\.(?:json|jsonc)$/.test(file));
const css = files.filter((file) => file.endsWith(".css"));
const js = files.filter((file) => /\.(?:m?js)$/.test(file));

if (!wrangler) throw new Error("Missing generated Cloudflare wrangler.json in the Vinext output.");
if (css.length === 0) throw new Error("Missing compiled CSS in the full-stack Vinext client output.");
if (js.length === 0) throw new Error("Missing compiled JavaScript in the full-stack Vinext output.");

console.log(`Validated full-stack Vinext artifact: ${path.relative(root, wrangler)}, ${css.length} CSS bundle(s), ${js.length} JavaScript bundle(s).`);
