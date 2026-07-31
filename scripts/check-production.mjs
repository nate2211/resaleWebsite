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
if (health.revision !== "market-search-zenmarket-grailed-posts-v24") {
  throw new Error(`The domain is serving an older revision: ${health.revision || "unknown"}.`);
}
if (health.marketplaceRequests !== "frontend-api-depop-parallel-recovery"
  || health.cloudflareMarketplaceFetches !== "parallel-depop-ssr-api-reader-index-recovery") {
  throw new Error("The deployed version is not using the frontend marketplace API recovery flow.");
}

const source = "https://www.depop.com/search/?q=supreme&page=1";
const relayResult = await read(`/api/listings?source=${encodeURIComponent(source)}`);
if (!relayResult.response.ok) {
  throw new Error(`The marketplace page-source relay returned HTTP ${relayResult.response.status}.`);
}
const upstreamStatus = Number(relayResult.response.headers.get("x-rml-upstream-status") || "0");
const finalUrl = relayResult.response.headers.get("x-rml-final-url") || "";
const recoveryTransport = relayResult.response.headers.get("x-rml-recovery-transport") || "";
if (!upstreamStatus || !/depop\.com/i.test(finalUrl) || relayResult.text.length < 20) {
  throw new Error("The marketplace API did not return a clean Depop page-source or recovery response.");
}
if (/sorry,? not authorized|403 forbidden/i.test(relayResult.text)) {
  throw new Error("The marketplace API exposed raw Depop forbidden HTML instead of applying recovery.");
}
if (!/frontend-api-depop-parallel-recovery/i.test(relayResult.response.headers.get("x-rml-marketplace-mode") || "")) {
  throw new Error("The marketplace endpoint is not serving the v22 marketplace recovery transport.");
}
if (!/^(official|depop-api|depop-reader|depop-index|depop-empty)$/.test(recoveryTransport)) {
  throw new Error(`Unexpected Depop recovery transport: ${recoveryTransport || "missing"}.`);
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
  const hits = Array.isArray(payload.hits) ? payload.hits : [];
  grailedHits = hits.length;
  grailedPartial = payload.partial === true;
  for (const hit of hits) {
    const serialized = JSON.stringify(hit);
    if (!/\/prd\/listing\/\d+\//i.test(serialized)
        || /measurement(?:-type)?|\/prd\/misc\/|placeholder|favicon|logo/i.test(serialized)) {
      throw new Error("Grailed returned a non-listing, measurement, or placeholder image record.");
    }
  }
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
  recoveryTransport,
  grailedUpstreamStatus,
  grailedHits,
  grailedPartial,
  zenMarketItems,
  zenMarketPartial,
  zenMarketSourceUrl,
  allowlistRejection: rejected.response.status,
}, null, 2));
console.log("Production SEO routes, Thrift Check, Listing Template, and marketplace relays are healthy; Grailed and ZenMarket partial fallbacks are accepted during temporary upstream outages.");
