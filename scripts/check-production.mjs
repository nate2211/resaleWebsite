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
if (health.revision !== "frontend-marketplaces-v7") {
  throw new Error(`The domain is serving an older revision: ${health.revision || "unknown"}.`);
}
if (health.cloudflareMarketplaceFetches !== false || health.marketplaceRequests !== "browser") {
  throw new Error("The deployed version is not in browser-side marketplace mode.");
}

const disabledRoute = await read("/api/listings?marketplace=Depop&q=supreme");
if (disabledRoute.response.status !== 410) {
  throw new Error(`The old marketplace Worker route is still active (HTTP ${disabledRoute.response.status}).`);
}

console.log(JSON.stringify({
  base,
  revision: health.revision,
  homepage: homepage.response.status,
  marketplaceTransport: health.marketplaceRequests,
  cloudflareMarketplaceFetches: health.cloudflareMarketplaceFetches,
  legacyMarketplaceRoute: disabledRoute.response.status,
}, null, 2));
console.log("Production shell is healthy. Run a marketplace search in the browser; install browser-extension/ when a site blocks CORS.");
