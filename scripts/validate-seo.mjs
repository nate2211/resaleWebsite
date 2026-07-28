import { existsSync, readFileSync } from "node:fs";

const required = [
  "app/layout.tsx", "app/sitemap.ts", "app/robots.ts", "app/manifest.ts",
  "app/about/page.tsx", "app/methodology/page.tsx", "app/faq/page.tsx",
  "app/contact/page.tsx", "app/accessibility/page.tsx", "app/privacy/page.tsx",
  "app/terms/page.tsx", "app/not-found.tsx", "DEPLOY_CLOUDFLARE.md", "public/favicon.svg", "public/icon-192.png",
  "public/icon-512.png", "public/apple-touch-icon.png", "public/og-card.png",
  "wrangler.jsonc", "wrangler.static.toml", "app/api/health/route.ts",
];
for (const file of required) {
  if (!existsSync(file)) throw new Error(`Missing SEO/deployment file: ${file}`);
}
const layout = readFileSync("app/layout.tsx", "utf8");
for (const token of ["metadataBase", "alternates", "openGraph", "twitter", "application/ld+json"]) {
  if (!layout.includes(token)) throw new Error(`Metadata is missing ${token}`);
}
const page = readFileSync("app/page.tsx", "utf8");
for (const token of ["Search, compare, and monitor resale listings", "AI not ready · Load", "Saved automatically on this device"]) {
  if (!page.includes(token)) throw new Error(`The homepage is missing crawlable product content: ${token}`);
}
const sitemap = readFileSync("app/sitemap.ts", "utf8");
for (const route of ["/about", "/methodology", "/faq", "/contact", "/accessibility", "/privacy", "/terms"]) {
  if (!sitemap.includes(route)) throw new Error(`Sitemap is missing ${route}`);
}
const robots = readFileSync("app/robots.ts", "utf8");
if (!robots.includes('disallow: ["/api/"]') || !robots.includes("sitemap")) {
  throw new Error("robots.ts must expose the sitemap and keep API routes out of search.");
}
const faq = readFileSync("app/faq/page.tsx", "utf8");
if (!faq.includes("FAQPage") || !faq.includes("International Markets")) {
  throw new Error("The public FAQ must include structured FAQ data and current marketplaces.");
}
const productionConfig = readFileSync("wrangler.jsonc", "utf8");
for (const token of [
  '"name": "resalewebsite"',
  '"workers_dev": true',
  '"binding": "BROWSER"',
  '"main": "vinext/server/app-router-entry"',
]) {
  if (!productionConfig.includes(token)) throw new Error(`Production Wrangler config is missing ${token}`);
}
console.log("SEO and full-stack Cloudflare deployment files are present.");
