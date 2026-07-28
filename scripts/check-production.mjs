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
if (health.revision !== "official-page-source-marketplaces-v10") {
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
  throw new Error("The marketplace endpoint is not serving the v10 official page-source transport.");
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
  allowlistRejection: rejected.response.status,
}, null, 2));
console.log("Production shell and official marketplace page-source relay are healthy.");
