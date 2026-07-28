const base = (process.env.RML_BASE_URL || "https://resalewebsite.unusualsuspectsclothing.workers.dev").replace(/\/$/, "");

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

const homepage = await read("/");
if (!homepage.response.ok || !/ResaleMasterLab/i.test(homepage.text)) {
  throw new Error(`Homepage verification failed with HTTP ${homepage.response.status}.`);
}

const healthResult = await read("/api/health");
if (!healthResult.response.ok) throw new Error(`/api/health returned HTTP ${healthResult.response.status}.`);
const health = JSON.parse(healthResult.text);
if (health.revision !== "frontend-marketplace-results-api-v9") {
  throw new Error(`The domain is serving an older revision: ${health.revision || "unknown"}.`);
}
if (health.marketplaceRequests !== "frontend-api-relay" || health.cloudflareMarketplaceFetches !== "single-bounded-relay-only") {
  throw new Error("The deployed version is not using the bounded frontend marketplace-results relay.");
}

const relayPath = `/api/listings?source=${encodeURIComponent("https://www.depop.com/search/?q=supreme&page=1")}`;
const relayResult = await read(relayPath);
if (!relayResult.response.ok) {
  throw new Error(`The marketplace-results API returned HTTP ${relayResult.response.status}.`);
}
const relay = JSON.parse(relayResult.text);
if (relay.transport !== "frontend-api" || typeof relay.status !== "number" || typeof relay.body !== "string") {
  throw new Error("The marketplace-results API did not return the expected raw-response envelope.");
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
  relayUpstreamStatus: relay.status,
  relayCharacters: relay.body.length,
  allowlistRejection: rejected.response.status,
}, null, 2));
console.log("Production shell and the bounded frontend marketplace-results API are healthy.");
