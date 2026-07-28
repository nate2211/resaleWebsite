import { existsSync, readFileSync } from "node:fs";

const required = [
  "app/layout.tsx", "app/sitemap.ts", "app/robots.ts", "app/manifest.ts",
  "app/thrift-check/page.tsx", "app/listing-template/page.tsx",
  "app/components/thrift-check-tool.tsx", "app/components/listing-template-tool.tsx",
  "app/lib/browser-ai.ts", "app/lib/image-metrics.ts",
  "app/about/page.tsx", "app/methodology/page.tsx", "app/faq/page.tsx",
  "app/contact/page.tsx", "app/accessibility/page.tsx", "app/privacy/page.tsx",
  "app/terms/page.tsx", "app/not-found.tsx", "DEPLOY_CLOUDFLARE.md",
  "public/favicon.ico", "public/favicon.svg", "public/icon-96.png", "public/icon-192.png",
  "public/icon-512.png", "public/icon-maskable-512.png", "public/apple-touch-icon.png",
  "public/og-card.png", "public/thrift-check-og.png", "public/listing-template-og.png",
  "public/screenshots/resalemasterlab-wide.png", "public/screenshots/resalemasterlab-mobile.png",
  "wrangler.jsonc", "wrangler.static.toml", "app/api/health/route.ts",
];
for (const file of required) if (!existsSync(file)) throw new Error(`Missing production/SEO file: ${file}`);
const domain = "https://resalemasterlab.cloud-cord.com";
const layout = readFileSync("app/layout.tsx", "utf8");
for (const token of ["metadataBase", "alternates", "openGraph", "twitter", "application/ld+json", "google-site-verification"]) {
  if (!layout.includes(token)) throw new Error(`Metadata is missing ${token}`);
}
if (!readFileSync("app/lib/site.ts", "utf8").includes(domain)) throw new Error("Production site constant is incorrect.");
const homepage = readFileSync("app/page.tsx", "utf8");
for (const token of ["Search, compare, and monitor resale listings", "Thrift Check", "Listing Template", "Saved automatically on this device"]) {
  if (!homepage.includes(token)) throw new Error(`Homepage is missing crawlable content: ${token}`);
}
const sitemap = readFileSync("app/sitemap.ts", "utf8");
for (const route of ["/thrift-check", "/listing-template", "/about", "/methodology", "/faq", "/contact", "/accessibility", "/privacy", "/terms"]) {
  if (!sitemap.includes(route)) throw new Error(`Sitemap is missing ${route}`);
}
const robots = readFileSync("app/robots.ts", "utf8");
if (!robots.includes('disallow: ["/api/"]') || !robots.includes("sitemap") || !robots.includes(domain)) throw new Error("robots.ts is incomplete.");
const manifest = readFileSync("app/manifest.ts", "utf8");
for (const token of ["maskable", "screenshots", "shortcuts", "/thrift-check", "/listing-template"]) {
  if (!manifest.includes(token)) throw new Error(`Manifest is missing ${token}`);
}
for (const page of ["app/thrift-check/page.tsx", "app/listing-template/page.tsx"]) {
  const source = readFileSync(page, "utf8");
  for (const token of ["metadata", "canonical", "application/ld+json", "WebApplication", "HowTo", "BreadcrumbList"]) {
    if (!source.includes(token)) throw new Error(`${page} is missing ${token}`);
  }
}
const productionConfig = readFileSync("wrangler.jsonc", "utf8");
for (const token of ['"name": "resalewebsite"', '"workers_dev": true', '"custom_domain": true', '"pattern": "resalemasterlab.cloud-cord.com"']) {
  if (!productionConfig.includes(token)) throw new Error(`Wrangler config is missing ${token}`);
}
if (/"browser"\s*:|"binding"\s*:\s*"BROWSER"/i.test(productionConfig)) throw new Error("Browser Run binding must remain absent.");
const headers = readFileSync("public/_headers", "utf8");
if (!headers.includes("camera=(self)")) throw new Error("Camera uploads are blocked by Permissions-Policy.");
console.log("Production SEO, PWA, custom-domain, Thrift Check, and Listing Template files are present.");
