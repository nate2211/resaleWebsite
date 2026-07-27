import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const build = path.join(root, "build");

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else files.push(absolute);
  }
  return files;
}

if (!(await exists(path.join(build, "index.html")))) {
  throw new Error("Missing build/index.html required by single-page-application fallback.");
}
const files = await walk(build);
if (!files.some((file) => file.endsWith(".css"))) {
  throw new Error("Missing compiled CSS in build/. Production would render without ResaleMasterLab styling.");
}
if (!files.some((file) => /\.(?:js|mjs)$/.test(file))) {
  throw new Error("Missing compiled JavaScript in build/.");
}
console.log("Validated static SPA artifact: index.html, JavaScript, and CSS are present in build/.");
