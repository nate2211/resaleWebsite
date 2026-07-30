export const runtime = "edge";
export const dynamic = "force-dynamic";

const WORKER_REVISION = "market-search-frontend-api-depop-recovery-v20";
const MAX_BODY_BYTES = 5_500_000;
const UPSTREAM_TIMEOUT_MS = 15_000;
const READER_TIMEOUT_MS = 20_000;
const INDEX_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;
const MAX_INDEXED_DEPOP_LINKS = 12;

const ALLOWED_MARKETPLACE_HOSTS = [
  "depop.com",
  "grailed.com",
  "poshmark.com",
  "jp.mercari.com",
  "zenmarket.jp",
  "rakuten.co.jp",
  "auctions.yahoo.co.jp",
  "fril.jp",
  "globalbunjang.com",
  "ebay.com",
  "mercari.com",
  "facebook.com",
  "superbuy.com",
  "goofish.com",
  "2.taobao.com",
] as const;

function hostnameMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isDepopUrl(url: URL) {
  return hostnameMatches(url.hostname.toLowerCase(), "depop.com");
}

function isDepopProductUrl(url: URL) {
  return isDepopUrl(url) && /^\/products\/[a-z0-9_-]+\/?$/i.test(url.pathname);
}

function parseAllowedUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("A valid marketplace URL is required.");
  }
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS marketplace URLs are allowed.");
  if (parsed.username || parsed.password || parsed.port) {
    throw new Error("Marketplace URLs cannot contain credentials or custom ports.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_MARKETPLACE_HOSTS.some((domain) => hostnameMatches(hostname, domain))) {
    throw new Error("That marketplace host is not allowed by the page-source relay.");
  }
  return parsed;
}

function errorJson(message: string, status: number) {
  return Response.json({ error: message, workerRevision: WORKER_REVISION }, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "x-rml-worker-revision": WORKER_REVISION,
      "x-rml-marketplace-mode": "frontend-api-page-source-recovery",
      "x-rml-relay-error": "1",
    },
  });
}

async function readLimitedText(response: Response) {
  if (!response.body) return { body: "", truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const remaining = MAX_BODY_BYTES - size;
      if (remaining <= 0) {
        truncated = true;
        await reader.cancel("Marketplace page-source limit reached.");
        break;
      }
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      size += chunk.byteLength;
      body += decoder.decode(chunk, { stream: true });
      if (value.byteLength > remaining) {
        truncated = true;
        await reader.cancel("Marketplace page-source limit reached.");
        break;
      }
    }
    body += decoder.decode();
    return { body, truncated };
  } finally {
    reader.releaseLock();
  }
}

function browserHeaders(url: URL) {
  const headers: Record<string, string> = {
    accept: "text/html,application/xhtml+xml,application/json;q=0.9,text/plain;q=0.8,*/*;q=0.6",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "upgrade-insecure-requests": "1",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
  };
  if (isDepopUrl(url)) {
    headers.referer = "https://www.depop.com/";
  } else if (hostnameMatches(url.hostname.toLowerCase(), "zenmarket.jp")) {
    headers.referer = "https://zenmarket.jp/en/";
  }
  return headers;
}

async function timedFetch(url: string | URL, timeoutMs: number, requestSignal: AbortSignal, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const abort = () => controller.abort();
  if (requestSignal.aborted) controller.abort();
  else requestSignal.addEventListener("abort", abort, { once: true });
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener("abort", abort);
  }
}

async function fetchMarketplacePage(initialUrl: URL, requestSignal: AbortSignal) {
  let current = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await timedFetch(current, UPSTREAM_TIMEOUT_MS, requestSignal, {
      method: "GET",
      redirect: "manual",
      cache: "no-store",
      headers: browserHeaders(current),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirectCount >= MAX_REDIRECTS) return { response, url: current };
      current = parseAllowedUrl(new URL(location, current).toString());
      continue;
    }
    return { response, url: new URL(response.url || current.toString()) };
  }
  throw new Error("Marketplace redirect limit exceeded.");
}

function depopChallenge(status: number, body: string) {
  if ([401, 403, 429].includes(status)) return true;
  const sample = body.slice(0, 180_000);
  return /sorry,? not authorized|403 forbidden|you (?:have been|were) blocked|cf-chl-|cloudflare ray id|checking your browser|verify you are human|access denied/i.test(sample);
}

function depopProductCount(body: string) {
  const links = body.match(/(?:https?:\/\/(?:www\.)?depop\.com)?\/products\/[a-z0-9_-]+\/?/gi) || [];
  return new Set(links.map((value) => value.toLowerCase().replace(/[?#].*$/, ""))).size;
}

function depopProductPageEvidence(body: string) {
  const sample = body.slice(0, 1_200_000);
  return /(?:property|name)=["'](?:og:title|og:image|product:price:amount)["']|media-photos\.depop\.com|self\.__next_f\.push|"(?:product|item|listing|price|seller|username)"\s*:/i.test(sample);
}

function depopReaderUrl(url: URL) {
  return `https://r.jina.ai/${url.toString()}`;
}

async function fetchDepopReader(url: URL, requestSignal: AbortSignal) {
  const response = await timedFetch(depopReaderUrl(url), READER_TIMEOUT_MS, requestSignal, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
    headers: {
      accept: "text/plain,text/markdown;q=0.9,*/*;q=0.5",
      "x-return-format": "markdown",
      "user-agent": "ResaleMasterLab/2.0 public Depop page reader",
    },
  });
  const { body, truncated } = await readLimitedText(response);
  return { response, body, truncated };
}

function decodeXml(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
}

function depopSearchTerm(url: URL) {
  const explicit = url.searchParams.get("q") || url.searchParams.get("query") || "";
  if (explicit.trim()) return explicit.trim();
  const match = url.pathname.match(/^\/(?:brands|theme)\/([^/]+)/i);
  return match ? decodeURIComponent(match[1]).replace(/[-_]+/g, " ").trim() : "";
}

function canonicalDepopProduct(value: string) {
  try {
    const parsed = new URL(decodeXml(value), "https://www.depop.com/");
    if (!isDepopProductUrl(parsed)) return "";
    parsed.search = "";
    parsed.hash = "";
    if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
    return parsed.toString();
  } catch {
    return "";
  }
}

async function fetchIndexedDepopLinks(sourceUrl: URL, requestSignal: AbortSignal) {
  const term = depopSearchTerm(sourceUrl);
  if (!term) return { body: "", count: 0 };
  const query = `site:depop.com/products/ ${term}`;
  const rssUrl = `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`;
  const response = await timedFetch(rssUrl, INDEX_TIMEOUT_MS, requestSignal, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
    headers: {
      accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (compatible; ResaleMasterLab/2.0; public listing index recovery)",
    },
  });
  if (!response.ok) return { body: "", count: 0 };
  const { body: xml } = await readLimitedText(response);
  const records: Array<{ title: string; url: string; description: string }> = [];
  for (const item of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const chunk = item[1];
    const url = canonicalDepopProduct(chunk.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || "");
    if (!url || records.some((record) => record.url === url)) continue;
    const title = decodeXml(chunk.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || "Depop listing")
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const description = decodeXml(chunk.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || "")
      .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    records.push({ title, url, description });
    if (records.length >= MAX_INDEXED_DEPOP_LINKS) break;
  }
  const markdown = records.map((record, index) =>
    `${index + 1}. [${record.title || "Depop listing"}](${record.url})\n${record.description}`,
  ).join("\n\n");
  return { body: markdown, count: records.length };
}

function relayResponse(body: string, options: {
  finalUrl: URL;
  contentType: string;
  upstreamStatus: number;
  truncated?: boolean;
  recovery: "official" | "depop-reader" | "depop-index" | "depop-empty";
  originalStatus?: number;
}) {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": options.contentType || "text/plain; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "cdn-cache-control": "no-store",
      "x-rml-worker-revision": WORKER_REVISION,
      "x-rml-marketplace-mode": "frontend-api-page-source-recovery",
      "x-rml-upstream-status": String(options.upstreamStatus),
      "x-rml-original-upstream-status": String(options.originalStatus ?? options.upstreamStatus),
      "x-rml-final-url": options.finalUrl.toString(),
      "x-rml-upstream-content-type": options.contentType || "",
      "x-rml-recovery-transport": options.recovery,
      "x-rml-truncated": options.truncated ? "1" : "0",
    },
  });
}

async function relayDepop(sourceUrl: URL, request: Request) {
  let officialStatus = 0;
  try {
    const { response, url } = await fetchMarketplacePage(sourceUrl, request.signal);
    officialStatus = response.status;
    const { body, truncated } = await readLimitedText(response);
    const cards = depopProductCount(body);
    const challenge = depopChallenge(response.status, body);
    const usableProductPage = isDepopProductUrl(url) && response.ok && !challenge
      && body.trim().length > 500 && depopProductPageEvidence(body);
    if ((!isDepopProductUrl(url) && response.ok && !challenge && cards > 0) || usableProductPage) {
      return relayResponse(body, {
        finalUrl: url,
        contentType: response.headers.get("content-type") || "text/html; charset=utf-8",
        upstreamStatus: response.status,
        originalStatus: response.status,
        truncated,
        recovery: "official",
      });
    }
  } catch {
    // Continue to the readable page source. The frontend receives one bounded
    // response instead of the raw origin exception or forbidden HTML.
  }

  try {
    const reader = await fetchDepopReader(sourceUrl, request.signal);
    const cards = depopProductCount(reader.body);
    const usableProductPage = isDepopProductUrl(sourceUrl) && reader.response.ok
      && reader.body.trim().length > 200 && depopProductPageEvidence(reader.body);
    if ((cards > 0 || usableProductPage) && !depopChallenge(reader.response.status, reader.body)) {
      return relayResponse(reader.body, {
        finalUrl: sourceUrl,
        contentType: reader.response.headers.get("content-type") || "text/plain; charset=utf-8",
        upstreamStatus: 200,
        originalStatus: officialStatus || reader.response.status,
        truncated: reader.truncated,
        recovery: "depop-reader",
      });
    }
  } catch {
    // Search-result index recovery below is intentionally limited to Depop
    // search/brand/theme pages; product pages simply return an empty recovery.
  }

  if (!isDepopProductUrl(sourceUrl)) {
    try {
      const indexed = await fetchIndexedDepopLinks(sourceUrl, request.signal);
      if (indexed.count > 0) {
        return relayResponse(indexed.body, {
          finalUrl: sourceUrl,
          contentType: "text/markdown; charset=utf-8",
          upstreamStatus: 200,
          originalStatus: officialStatus || 403,
          recovery: "depop-index",
        });
      }
    } catch {
      // Return a clean empty source below. Never expose the raw forbidden page.
    }
  }

  return relayResponse("Depop public page source was unavailable for this request.", {
    finalUrl: sourceUrl,
    contentType: "text/plain; charset=utf-8",
    upstreamStatus: 200,
    originalStatus: officialStatus || 403,
    recovery: "depop-empty",
  });
}

async function relay(request: Request) {
  const requestUrl = new URL(request.url);
  let source = requestUrl.searchParams.get("source") || "";
  if (request.method === "POST") {
    try {
      const payload = await request.json() as { source?: unknown; url?: unknown };
      source = typeof payload.source === "string" ? payload.source : typeof payload.url === "string" ? payload.url : "";
    } catch {
      return errorJson("The request body must be valid JSON.", 400);
    }
  }

  let sourceUrl: URL;
  try {
    sourceUrl = parseAllowedUrl(source);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Marketplace URL rejected.", 400);
  }

  if (isDepopUrl(sourceUrl)) return relayDepop(sourceUrl, request);

  try {
    const { response, url } = await fetchMarketplacePage(sourceUrl, request.signal);
    const { body, truncated } = await readLimitedText(response);
    return relayResponse(body, {
      finalUrl: url,
      contentType: response.headers.get("content-type") || "text/plain; charset=utf-8",
      upstreamStatus: response.status,
      originalStatus: response.status,
      truncated,
      recovery: "official",
    });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Marketplace request failed.", 200);
  }
}

export async function GET(request: Request) {
  return relay(request);
}

export async function POST(request: Request) {
  return relay(request);
}
