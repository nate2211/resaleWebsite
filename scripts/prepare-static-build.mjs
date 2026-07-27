import { cp, mkdir, readdir, rm, stat, copyFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const output = path.join(root, "build");
const searchRoots = [path.join(root, "dist"), path.join(root, ".vinext")];
const requireStatic = process.argv.includes("--require-static");

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

async function filesUnder(directory) {
  const found = [];
  if (!(await exists(directory))) return found;

  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else found.push(absolute);
    }
  }

  await walk(directory);
  return found;
}

async function isUsableClientDirectory(directory) {
  if (!(await exists(directory))) return false;
  const files = await filesUnder(directory);
  return (
    files.some((file) => file.endsWith(".html")) &&
    files.some((file) => file.endsWith(".css")) &&
    files.some((file) => /\.(?:m?js)$/.test(file))
  );
}

async function findStaticClientOutput() {
  const preferred = [
    path.join(root, "dist", "client"),
    path.join(root, ".vinext", "client"),
  ];

  for (const candidate of preferred) {
    if (await isUsableClientDirectory(candidate)) return candidate;
  }

  const discovered = [];
  for (const searchRoot of searchRoots) {
    const files = await filesUnder(searchRoot);
    const htmlFiles = files.filter((file) => file.endsWith(".html"));

    for (const htmlFile of htmlFiles) {
      let candidate = path.dirname(htmlFile);
      while (candidate.startsWith(searchRoot)) {
        if (await isUsableClientDirectory(candidate)) {
          discovered.push(candidate);
          break;
        }
        if (candidate === searchRoot) break;
        candidate = path.dirname(candidate);
      }
    }
  }

  discovered.sort((a, b) => a.length - b.length);
  return discovered[0] ?? null;
}

async function findFullStackOutput() {
  const files = [];
  for (const searchRoot of searchRoots) files.push(...await filesUnder(searchRoot));

  const wranglerConfig = files.find((file) => /(?:^|[\\/])wrangler\.(?:json|jsonc)$/.test(file));
  const cssFiles = files.filter((file) => file.endsWith(".css"));
  const jsFiles = files.filter((file) => /\.(?:m?js)$/.test(file));

  if (!wranglerConfig || cssFiles.length === 0 || jsFiles.length === 0) return null;
  return { wranglerConfig, cssFiles, jsFiles, files };
}

const source = await findStaticClientOutput();
if (source) {
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(source, output, { recursive: true });

  let allFiles = await filesUnder(output);
  const cssFiles = allFiles.filter((file) => file.endsWith(".css"));
  if (cssFiles.length === 0) {
    throw new Error("The production client contains no CSS bundle. Verify app/layout.tsx imports app/globals.css.");
  }

  const indexPath = path.join(output, "index.html");
  if (!(await exists(indexPath))) {
    const htmlCandidate = allFiles.find((file) => path.basename(file) === "index.html") ||
      allFiles.find((file) => file.endsWith(".html"));
    if (!htmlCandidate) {
      throw new Error("Static output was detected, but no HTML entry file was generated.");
    }
    await copyFile(htmlCandidate, indexPath);
    allFiles = await filesUnder(output);
  }

  if (!allFiles.some((file) => /\.(?:m?js)$/.test(file))) {
    throw new Error("The production client contains no JavaScript bundle.");
  }

  console.log(`Prepared Cloudflare SPA assets from ${path.relative(root, source)} into ${path.relative(root, output)}.`);
  console.log(`Verified ${cssFiles.length} production CSS bundle(s).`);
  process.exit(0);
}

const fullStack = await findFullStackOutput();
if (fullStack) {
  // Never leave an old SPA artifact beside a new full-stack build. That could
  // cause a later assets-only deploy to publish stale code accidentally.
  await rm(output, { recursive: true, force: true });

  if (requireStatic) {
    throw new Error(
      "Vinext generated a full-stack Worker build, not a static export. " +
      "This application contains /api routes and requires `npm run deploy`. " +
      "A static ./build deployment is only possible after converting the app to `output: \"export\"` and removing server routes.",
    );
  }

  const marker = path.join(path.dirname(fullStack.wranglerConfig), "RESALEMASTERLAB_FULLSTACK_BUILD.txt");
  await writeFile(
    marker,
    [
      "ResaleMasterLab full-stack Vinext build detected.",
      `Generated Wrangler config: ${path.relative(root, fullStack.wranglerConfig)}`,
      `Compiled CSS bundles: ${fullStack.cssFiles.length}`,
      `Compiled JavaScript bundles: ${fullStack.jsFiles.length}`,
      "Run `vinext start` to test locally or `npm run deploy` to deploy the Worker and API routes.",
      "The assets-only ./build directory is intentionally not generated for this build.",
      "",
    ].join("\n"),
    "utf8",
  );

  console.log("Detected a valid full-stack Vinext/Cloudflare build.");
  console.log(`Generated Wrangler config: ${path.relative(root, fullStack.wranglerConfig)}`);
  console.log(`Verified ${fullStack.cssFiles.length} CSS bundle(s) and ${fullStack.jsFiles.length} JavaScript bundle(s).`);
  console.log("Skipped ./build SPA preparation because this project contains server-rendered pages and /api routes.");
  console.log("Use `npm run deploy` for Cloudflare or `npm run start:windows` for a local production test.");
  process.exit(0);
}

throw new Error(
  "No valid Vinext output was found. Expected either a static client directory containing HTML/CSS/JS, " +
  "or a full-stack Cloudflare output containing wrangler.json plus compiled CSS and JavaScript under dist/ or .vinext/.",
);
