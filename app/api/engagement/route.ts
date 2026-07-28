import {
  extractMarketplaceEngagement,
  marketplaceFromUrl,
  type EngagementMarketplace,
  type EngagementReport,
} from "../../lib/engagement";

const ALLOWED_HOSTS = new Set([
  "depop.com", "www.depop.com",
  "grailed.com", "www.grailed.com",
  "poshmark.com", "www.poshmark.com",
]);
const MAX_HTML_LENGTH = 5_000_000;
const cache = new Map<string, { until: number; value: unknown }>();

function unavailableReport(
  marketplace: EngagementMarketplace,
  url: string,
  reason: string,
  upstreamStatus?: number,
): EngagementReport & { available: false; upstreamStatus?: number } {
  return {
    marketplace,
    url,
    metrics: {},
    seller: {},
    popularityScore: 0,
    demandLevel: "unknown",
    confidence: 0,
    completeness: 0,
    scoreDrivers: [],
    caveats: [
      reason,
      "Missing marketplace engagement values are unknown, not zero.",
    ],
    evidence: [],
    readMethods: ["public listing request unavailable"],
    inspectedAt: new Date().toISOString(),
    available: false,
    ...(upstreamStatus ? { upstreamStatus } : {}),
  };
}

function reply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": status === 200 ? "public, max-age=120, s-maxage=300" : "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function assertListingUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a complete Depop, Grailed, or Poshmark listing URL.");
  }
  if (url.protocol !== "https:" || !ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new Error("Only public Depop, Grailed, and Poshmark HTTPS listing pages are supported.");
  }
  if (url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Credentials and nonstandard ports are not accepted.");
  }
  const marketplace = marketplaceFromUrl(url.toString());
  if (!marketplace) throw new Error("The URL is not a supported marketplace listing.");
  const path = url.pathname.toLowerCase();
  if (marketplace === "Depop" && !path.includes("/products/")) throw new Error("Use an individual Depop product URL.");
  if (marketplace === "Grailed" && !path.includes("/listings/")) throw new Error("Use an individual Grailed listing URL.");
  if (marketplace === "Poshmark" && !path.includes("/listing/")) throw new Error("Use an individual Poshmark listing URL.");

  // Seller-only Depop manage pages can contain private account state and often omit
  // public likes. Read the canonical public product page instead.
  if (marketplace === "Depop") {
    url.pathname = url.pathname.replace(/\/manage\/?$/i, "/");
  }
  url.username = "";
  url.password = "";
  url.hash = "";
  return { url, marketplace };
}

async function fetchWithSafeRedirects(initial: URL, marketplace: EngagementMarketplace) {
  let current = initial;
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.8",
          "User-Agent": "Mozilla/5.0 (compatible; ResaleMasterLab/2.1; public marketplace engagement reader; no login or bot bypass)",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { response, finalUrl: current, body: "" };
        const next = assertListingUrl(new URL(location, current).toString());
        if (next.marketplace !== marketplace) throw new Error("Cross-marketplace redirects are blocked.");
        current = next.url;
        continue;
      }
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_HTML_LENGTH * 2) throw new Error("The listing page is too large for safe engagement inspection.");
      const body = (await response.text()).slice(0, MAX_HTML_LENGTH);
      return { response, finalUrl: current, body };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("The marketplace redirected too many times.");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { url?: string };
  let validated: { url: URL; marketplace: EngagementMarketplace };
  try {
    validated = assertListingUrl(String(body.url || ""));
  } catch (error) {
    return reply({ error: error instanceof Error ? error.message : "Invalid listing URL." }, 400);
  }

  const cacheKey = validated.url.toString();
  const cached = cache.get(cacheKey);
  if (cached && cached.until > Date.now()) return reply(cached.value);

  try {
    const { response, finalUrl, body: html } = await fetchWithSafeRedirects(validated.url, validated.marketplace);
    if (!response.ok) {
      const reason = response.status === 403 || response.status === 429
        ? "The marketplace did not expose readable public engagement metadata right now."
        : `The marketplace returned HTTP ${response.status} while engagement data was requested.`;
      const value = unavailableReport(
        validated.marketplace,
        finalUrl.toString(),
        reason,
        response.status,
      );
      cache.set(cacheKey, { until: Date.now() + 300_000, value });
      return reply(value);
    }
    const report = extractMarketplaceEngagement(html, finalUrl.toString(), validated.marketplace);
    const value = {
      ...report,
      policy: "Public page evidence only. Missing values are unknown, not zero; no account login, private API, or script execution is used.",
    };
    cache.set(cacheKey, { until: Date.now() + 300_000, value });
    return reply(value);
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "The marketplace took too long to expose public engagement metadata."
      : error instanceof Error ? error.message : "Public engagement inspection was unavailable.";
    const value = unavailableReport(validated.marketplace, validated.url.toString(), message);
    cache.set(cacheKey, { until: Date.now() + 180_000, value });
    return reply(value);
  }
}
