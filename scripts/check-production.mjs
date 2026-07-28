const base = (process.env.RML_BASE_URL || "https://resalewebsite.unusualsuspectsclothing.workers.dev").replace(/\/$/, "");
const query = process.env.RML_DEPOP_QUERY || "raf simons";

async function readJson(path, timeoutMs = 90000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${base}${path}`, {
      signal: controller.signal,
      headers: { accept: "application/json", "cache-control": "no-cache" },
    });
    const text = await response.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 1000) }; }
    if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${JSON.stringify(body)}`);
    return { response, body };
  } finally {
    clearTimeout(timer);
  }
}

const health = await readJson("/api/health", 30000);
if (health.body.revision !== "depop-production-results-images-v6") {
  throw new Error(`The domain is serving an older Worker revision: ${health.body.revision || "unknown"}`);
}
if (!health.body.browserBindingAvailable) {
  throw new Error("The deployed Worker has no BROWSER binding. Deploy with npm run deploy, not deploy:static.");
}

const depop = await readJson(`/api/listings?marketplace=Depop&mode=active&page=0&q=${encodeURIComponent(query)}`);
console.log(JSON.stringify({
  base,
  health: health.body,
  depopStatus: depop.body.status,
  depopListings: depop.body.listings?.length || 0,
  diagnostics: depop.body.diagnostics,
}, null, 2));

if (!Array.isArray(depop.body.listings) || depop.body.listings.length === 0) {
  throw new Error("The production Depop request returned no listing links. Check the printed diagnostics and Worker logs.");
}
const faviconListings = depop.body.listings.filter((listing) =>
  /(?:external-content\.duckduckgo\.com\/ip3\/|favicon|\.ico(?:$|\?))/i.test(String(listing?.image || "")),
);
if (faviconListings.length) {
  throw new Error(`Depop returned ${faviconListings.length} favicon image(s) instead of product photos.`);
}
const photographed = depop.body.listings.find((listing) =>
  /^https:\/\/media-photos\.depop\.com\//i.test(String(listing?.image || "")),
);
if (!photographed) {
  throw new Error("Depop returned listings but none contained a first-party product photo. Check depopApiItems and product hydration diagnostics.");
}
const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(photographed.image)}`;
const proxyController = new AbortController();
const proxyTimer = setTimeout(() => proxyController.abort(), 30000);
try {
  const proxy = await fetch(`${base}${proxyUrl}`, { signal: proxyController.signal, headers: { accept: "image/*" } });
  if (!proxy.ok || !String(proxy.headers.get("content-type") || "").startsWith("image/")) {
    throw new Error(`The Depop image proxy failed with HTTP ${proxy.status} and content-type ${proxy.headers.get("content-type") || "unknown"}.`);
  }
} finally {
  clearTimeout(proxyTimer);
}
