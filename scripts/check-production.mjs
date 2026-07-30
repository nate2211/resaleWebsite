const base = (process.env.RML_BASE_URL || "https://resalemasterlab.cloud-cord.com").replace(/\/$/, "");

async function read(path, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${path}`, {
      signal: controller.signal,
      headers: { accept: "application/json,text/html;q=0.9,*/*;q=0.5", "cache-control": "no-cache" },
    });
    return { response, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}


async function post(path, payload, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${path}`, {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json", accept: "application/json", "cache-control": "no-cache" },
      body: JSON.stringify(payload),
    });
    return { response, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

const homepage = await read("/");
if (!homepage.response.ok || !/ResaleMasterLab/i.test(homepage.text)) {
  throw new Error(`Homepage verification failed with HTTP ${homepage.response.status}.`);
}


for (const route of ["/thrift-check", "/listing-template", "/manifest.webmanifest", "/sitemap.xml", "/robots.txt"]) {
  const result = await read(route);
  if (!result.response.ok || result.text.length < 40) {
    throw new Error(`${route} verification failed with HTTP ${result.response.status}.`);
  }
}

const healthResult = await read("/api/health");
if (!healthResult.response.ok) throw new Error(`/api/health returned HTTP ${healthResult.response.status}.`);
const health = JSON.parse(healthResult.text);
if (health.revision !== "market-search-depop-tab-capture-production-v19") {
  throw new Error(`The domain is serving an older revision: ${health.revision || "unknown"}.`);
}
if (health.marketplaceRequests !== "official-page-source-relay"
  || health.cloudflareMarketplaceFetches !== "one-official-page-per-relay-request") {
  throw new Error("The deployed version is not using the official marketplace page-source relay.");
}

const source = "https://www.depop.com/search/?q=supreme&page=1";
const relayResult = await read(`/api/listings?source=${encodeURIComponent(source)}`);
if (!relayResult.response.ok) {
  throw new Error(`The marketplace page-source relay returned HTTP ${relayResult.response.status}.`);
}
const upstreamStatus = Number(relayResult.response.headers.get("x-rml-upstream-status") || "0");
const finalUrl = relayResult.response.headers.get("x-rml-final-url") || "";
if (!upstreamStatus || !/depop\.com/i.test(finalUrl) || relayResult.text.length < 100) {
  throw new Error("The marketplace relay did not return a readable official Depop page source.");
}
if (!/official-page-source-relay/i.test(relayResult.response.headers.get("x-rml-marketplace-mode") || "")) {
  throw new Error("The marketplace endpoint is not serving the v19 Depop rendered-tab marketplace transport.");
}

const grailedResult = await post("/api/grailed-search", {
  query: "supreme",
  page: 0,
  mode: "active",
  index: "Listing_production",
  appId: "MNRWEFSS2Q",
  apiKey: "c89dbaddf15fe70e1941a109bf7c2a3d",
});
if (!grailedResult.response.ok) {
  throw new Error(`The Grailed public-index relay returned HTTP ${grailedResult.response.status}.`);
}
const grailedUpstreamStatus = Number(grailedResult.response.headers.get("x-rml-upstream-status") || "0");
let grailedHits = 0;
let grailedPartial = false;
try {
  const payload = JSON.parse(grailedResult.text);
  grailedHits = Array.isArray(payload.hits) ? payload.hits.length : 0;
  grailedPartial = payload.partial === true;
} catch {
  throw new Error("The Grailed public-index relay did not return JSON.");
}
if (!grailedPartial && (grailedUpstreamStatus < 200 || grailedUpstreamStatus >= 300)) {
  throw new Error(`Grailed production search returned unexpected upstream status ${grailedUpstreamStatus}.`);
}

const zenMarketResult = await post("/api/zenmarket-search", {
  marketplace: "Mercari Japan",
  query: "supreme",
  page: 0,
}, 20_000);
if (!zenMarketResult.response.ok) {
  throw new Error(`The ZenMarket catalog relay returned HTTP ${zenMarketResult.response.status}.`);
}
let zenMarketPartial = false;
let zenMarketItems = 0;
let zenMarketSourceUrl = "";
try {
  const payload = JSON.parse(zenMarketResult.text);
  zenMarketPartial = payload.partial === true;
  zenMarketSourceUrl = String(payload.sourceUrl || "");
  const data = payload.data && typeof payload.data === "object" ? payload.data : null;
  const items = data && (data.Items || data.items || data.Products || data.products);
  zenMarketItems = Array.isArray(items) ? items.length : 0;
} catch {
  throw new Error("The ZenMarket catalog relay did not return JSON.");
}
if (!/zenmarket\.jp\/en\/search\.aspx/i.test(zenMarketSourceUrl) || !/[?&]stores=27(?:&|$)/i.test(zenMarketSourceUrl)) {
  throw new Error("The ZenMarket catalog relay did not report its store-27 Mercari source page.");
}

const rejected = await read(`/api/listings?source=${encodeURIComponent("https://example.com/")}`);
if (rejected.response.status !== 400) {
  throw new Error(`The marketplace allowlist did not reject an unrelated host (HTTP ${rejected.response.status}).`);
}

console.log(JSON.stringify({
  base,
  revision: health.revision,
  homepage: homepage.response.status,
  marketplaceTransport: health.marketplaceRequests,
  relayUpstreamStatus: upstreamStatus,
  relayCharacters: relayResult.text.length,
  relayFinalUrl: finalUrl,
  grailedUpstreamStatus,
  grailedHits,
  grailedPartial,
  zenMarketItems,
  zenMarketPartial,
  zenMarketSourceUrl,
  allowlistRejection: rejected.response.status,
}, null, 2));
console.log("Production SEO routes, Thrift Check, Listing Template, and marketplace relays are healthy; Grailed and ZenMarket partial fallbacks are accepted during temporary upstream outages.");
