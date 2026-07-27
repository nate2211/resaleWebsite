import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const installedPackagePath = resolve(root, "node_modules", "vinext", "package.json");
const wranglerPath = resolve(root, "wrangler.vinext-build.toml");

let vinextPackage;
try {
  vinextPackage = JSON.parse(await readFile(installedPackagePath, "utf8"));
} catch (error) {
  throw new Error(
    `Vinext is not installed at ${installedPackagePath}. Run npm install before building.`,
    { cause: error },
  );
}

const appRouterExport = vinextPackage.exports?.["./server/app-router-entry"];
if (!appRouterExport) {
  throw new Error(
    `Installed vinext ${vinextPackage.version ?? "unknown"} does not export ` +
      '`vinext/server/app-router-entry`. Install the package version pinned in package.json.',
  );
}

const wrangler = await readFile(wranglerPath, "utf8");
if (!/^main\s*=\s*"vinext\/server\/app-router-entry"/m.test(wrangler)) {
  throw new Error(
    'wrangler.vinext-build.toml must set main = "vinext/server/app-router-entry".',
  );
}

if (/vinext\/server\/fetch-handler/.test(wrangler)) {
  throw new Error("The unsupported vinext/server/fetch-handler entry is still configured.");
}

console.log(
  `Verified Vinext ${vinextPackage.version}: vinext/server/app-router-entry is exported and configured.`,
);
