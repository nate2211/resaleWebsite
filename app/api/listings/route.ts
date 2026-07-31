export const runtime = "edge";
export const dynamic = "force-dynamic";

const WORKER_REVISION = "market-search-zenmarket-grailed-posts-v24";
const MAX_BODY_BYTES = 5_500_000;
const UPSTREAM_TIMEOUT_MS = 15_000;
const DEPOP_ORIGIN_TIMEOUT_MS = 9_000;
const DEPOP_API_TIMEOUT_MS = 7_000;
const READER_TIMEOUT_MS = 20_000;
const INDEX_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const MAX_INDEXED_DEPOP_LINKS = 24;

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

type RecoveryTransport =
  | "official"
  | "depop-api"
  | "depop-reader"
  | "depop-index"
  | "depop-empty";

function hostnameMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isDepopUrl(url: URL) {
  return hostnameMatches(url.hostname.toLowerCase(), "depop.com");
}

function isDepopProductUrl(url: URL) {
  return isDepopUrl(url) && /^\/(?:[a-z]{2}\/)?products\/[a-z0-9_-]+\/?$/i.test(url.pathname);
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

function depopSourceFromRequest(requestUrl: URL) {
  const marketplace = (requestUrl.searchParams.get("marketplace") || "").trim().toLowerCase();
  if (marketplace !== "depop") return "";
  const query = (requestUrl.searchParams.get("q") || requestUrl.searchParams.get("query") || "").trim();
  if (!query) return "";
  const page = Math.max(0, Number.parseInt(requestUrl.searchParams.get("page") || "0", 10) || 0) + 1;
  return `https://www.depop.com/us/search/?q=${encodeURIComponent(query)}&page=${page}`;
}

function errorJson(message: string, status: number) {
  return Response.json({ error: message, workerRevision: WORKER_REVISION }, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "x-rml-worker-revision": WORKER_REVISION,
      "x-rml-marketplace-mode": "frontend-api-depop-parallel-recovery",
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

async function fetchMarketplacePage(initialUrl: URL, requestSignal: AbortSignal, timeoutMs = UPSTREAM_TIMEOUT_MS) {
  let current = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const response = await timedFetch(current, timeoutMs, requestSignal, {
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

function normalizeEscapedText(body: string) {
  return body
    .replaceAll("\\u002F", "/")
    .replaceAll("\\u0026", "&")
    .replaceAll("\\/", "/")
    .replaceAll("&amp;", "&")
    .replaceAll("&#x2F;", "/")
    .replaceAll("&#47;", "/");
}

function depopChallenge(status: number, body: string) {
  if ([401, 403, 429].includes(status)) return true;
  const sample = body.slice(0, 180_000);
  return /sorry,? not authorized|403 forbidden|you (?:have been|were) blocked|cf-chl-|cloudflare ray id|checking your browser|verify you are human|access denied/i.test(sample);
}

function depopProductUrls(body: string) {
  const normalized = normalizeEscapedText(body);
  const links = normalized.match(/(?:https?:\/\/(?:www\.)?depop\.com)?\/(?:[a-z]{2}\/)?products\/[a-z0-9_-]+\/?/gi) || [];
  const output = new Set<string>();
  for (const value of links) {
    const url = canonicalDepopProduct(value);
    if (url && !/\/products\/create\//i.test(url)) output.add(url);
  }
  return [...output];
}

function depopProductCount(body: string) {
  return depopProductUrls(body).length;
}

function depopProductPageEvidence(body: string) {
  const sample = normalizeEscapedText(body).slice(0, 1_500_000);
  return /(?:property|name)=["'](?:og:title|og:image|product:price:amount)["']|media-photos\.depop\.com|self\.__next_f\.push|"(?:product|item|listing|price|seller|username)"\s*:|(?:^|\n)Size\s+[^\n]+|(?:US\$|\$)\s*\d/im.test(sample);
}

function depopReaderUrl(url: URL) {
  return `https://r.jina.ai/${url.toString()}`;
}

function readerPayloadText(raw: string) {
  const normalized = normalizeEscapedText(raw);
  try {
    const payload = JSON.parse(raw) as Record<string, unknown>;
    const root = payload.data && typeof payload.data === "object"
      ? payload.data as Record<string, unknown>
      : payload;
    const sections: string[] = [];
    for (const key of ["title", "description", "content", "text", "markdown"]) {
      const value = root[key];
      if (typeof value === "string" && value.trim()) sections.push(value.trim());
    }
    for (const key of ["links", "images"]) {
      const value = root[key];
      if (value !== undefined) sections.push(JSON.stringify(value));
    }
    if (sections.length) return normalizeEscapedText(`${sections.join("\n\n")}\n\n${normalized}`);
  } catch {
    // Plain Markdown/text responses remain valid reader output.
  }
  return normalized;
}

async function fetchDepopReader(url: URL, requestSignal: AbortSignal) {
  const response = await timedFetch(depopReaderUrl(url), READER_TIMEOUT_MS, requestSignal, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
    headers: {
      accept: "application/json,text/plain,text/markdown;q=0.9,*/*;q=0.5",
      "x-return-format": "markdown",
      "x-with-links-summary": "all",
      "x-retain-images": "all",
      "x-timeout": "18",
      "x-locale": "en-US",
      "user-agent": "ResaleMasterLab/2.1 public Depop page reader",
    },
  });
  const { body: rawBody, truncated } = await readLimitedText(response);
  return { response, body: readerPayloadText(rawBody), truncated };
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
  const match = url.pathname.match(/^\/(?:[a-z]{2}\/)?(?:brands|theme)\/([^/]+)/i);
  return match ? decodeURIComponent(match[1]).replace(/[-_]+/g, " ").trim() : "";
}

function canonicalDepopProduct(value: string) {
  try {
    const decoded = decodeXml(value).replace(/^view-source:/i, "");
    const parsed = new URL(decoded, "https://www.depop.com/");
    if (!isDepopProductUrl(parsed)) return "";
    const slug = parsed.pathname.match(/\/products\/([a-z0-9_-]+)/i)?.[1] || "";
    if (!slug || slug.toLowerCase() === "create") return "";
    parsed.protocol = "https:";
    parsed.hostname = "www.depop.com";
    parsed.pathname = `/products/${slug}/`;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function depopSearchApiUrls(sourceUrl: URL) {
  const term = depopSearchTerm(sourceUrl);
  if (!term) return [];
  const query = new URLSearchParams({
    what: term,
    itemsPerPage: "24",
    country: "us",
    currency: "USD",
    sort: "relevance",
  });
  return [
    `https://webapi.depop.com/api/v3/search/products/?${query}`,
    `https://webapi.depop.com/api/v2/search/products/?${query}`,
  ];
}

function usableDepopApiBody(status: number, body: string) {
  if (status < 200 || status >= 300 || depopChallenge(status, body)) return false;
  try {
    const payload = JSON.parse(body) as { products?: unknown; data?: { products?: unknown } };
    const products = Array.isArray(payload.products) ? payload.products : payload.data?.products;
    return Array.isArray(products) && products.length > 0;
  } catch {
    return false;
  }
}

async function fetchDepopApi(sourceUrl: URL, requestSignal: AbortSignal) {
  for (const apiUrl of depopSearchApiUrls(sourceUrl)) {
    const response = await timedFetch(apiUrl, DEPOP_API_TIMEOUT_MS, requestSignal, {
      method: "GET",
      redirect: "follow",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "accept-language": "en-US,en;q=0.9",
        origin: "https://www.depop.com",
        referer: sourceUrl.toString(),
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      },
    });
    const { body, truncated } = await readLimitedText(response);
    if (usableDepopApiBody(response.status, body)) {
      return { response, body, truncated, apiUrl };
    }
  }
  throw new Error("Depop catalog API did not return public products.");
}

function decodeMaybe(value: string) {
  let current = decodeXml(value);
  for (let index = 0; index < 2; index += 1) {
    try {
      const decoded = decodeURIComponent(current);
      if (decoded === current) break;
      current = decoded;
    } catch {
      break;
    }
  }
  return current;
}

function decodeBingTarget(value: string) {
  const decoded = decodeMaybe(value);
  if (/^https?:\/\//i.test(decoded)) return decoded;
  const encoded = decoded.startsWith("a1") ? decoded.slice(2) : decoded;
  if (!/^[A-Za-z0-9+/_=-]{16,}$/.test(encoded)) return "";
  try {
    const normalized = encoded.replaceAll("-", "+").replaceAll("_", "/");
    return atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  } catch {
    return "";
  }
}

function candidateUrlsFromIndexBody(body: string) {
  const normalized = normalizeEscapedText(body);
  const values = new Set<string>();
  const add = (value: string) => {
    const canonical = canonicalDepopProduct(decodeMaybe(value));
    if (canonical) values.add(canonical);
  };

  for (const match of normalized.matchAll(/https?:\/\/(?:www\.)?depop\.com\/(?:[a-z]{2}\/)?products\/[a-z0-9_-]+\/?(?:\?[^\s"'<>)]*)?/gi)) add(match[0]);
  for (const match of normalized.matchAll(/https?%3A%2F%2F(?:www\.)?depop\.com%2F(?:[a-z]{2}%2F)?products%2F[a-z0-9_-]+/gi)) add(match[0]);
  for (const match of normalized.matchAll(/(?:href|url|uddg|target|q)=["']?([^"'&<>\s]+)/gi)) add(match[1]);

  for (const match of normalized.matchAll(/[?&]u=([^&"'<>\s]+)/gi)) {
    const target = decodeBingTarget(match[1]);
    if (target) add(target);
  }
  for (const match of normalized.matchAll(/[?&](?:url|uddg|target)=([^&"'<>\s]+)/gi)) add(match[1]);
  return [...values].slice(0, MAX_INDEXED_DEPOP_LINKS);
}

function titleFromDepopUrl(url: string) {
  try {
    const slug = new URL(url).pathname.match(/\/products\/([^/]+)/i)?.[1] || "Depop listing";
    return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 180);
  } catch {
    return "Depop listing";
  }
}

function indexedDepopMarkdown(urls: string[], sourceLabel: string) {
  return urls.map((url, index) =>
    `${index + 1}. [${titleFromDepopUrl(url)}](${url})\nIndexed public Depop product link discovered through ${sourceLabel}.`,
  ).join("\n\n");
}

async function fetchIndexBody(url: string, requestSignal: AbortSignal, accept: string) {
  const response = await timedFetch(url, INDEX_TIMEOUT_MS, requestSignal, {
    method: "GET",
    redirect: "follow",
    cache: "no-store",
    headers: {
      accept,
      "accept-language": "en-US,en;q=0.9",
      "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    },
  });
  if (!response.ok) throw new Error(`Index HTTP ${response.status}`);
  return readLimitedText(response);
}

async function fetchIndexedDepopLinks(sourceUrl: URL, requestSignal: AbortSignal) {
  const term = depopSearchTerm(sourceUrl);
  if (!term) throw new Error("Depop index recovery requires a search term.");
  const searchQuery = `site:depop.com/products/ ${term}`;
  const sources = [
    {
      label: "Bing RSS",
      url: `https://www.bing.com/search?format=rss&count=30&q=${encodeURIComponent(searchQuery)}`,
      accept: "application/rss+xml,application/xml,text/xml;q=0.9,*/*;q=0.5",
    },
    {
      label: "Bing web index",
      url: `https://www.bing.com/search?count=30&setlang=en-US&q=${encodeURIComponent(searchQuery)}`,
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    },
    {
      label: "DuckDuckGo web index",
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(searchQuery)}`,
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.5",
    },
  ];

  const found = new Set<string>();
  const used: string[] = [];
  for (const source of sources) {
    try {
      const { body } = await fetchIndexBody(source.url, requestSignal, source.accept);
      const urls = candidateUrlsFromIndexBody(body);
      if (urls.length) used.push(source.label);
      for (const url of urls) found.add(url);
      if (found.size >= MAX_INDEXED_DEPOP_LINKS) break;
    } catch {
      // Continue to the next bounded public index source.
    }
  }
  const urls = [...found].slice(0, MAX_INDEXED_DEPOP_LINKS);
  if (!urls.length) throw new Error("No indexed Depop product links were found.");
  return {
    body: indexedDepopMarkdown(urls, used.join(" + ") || "public search index"),
    count: urls.length,
  };
}

function depopSourceVariants(sourceUrl: URL) {
  const values = new Map<string, URL>();
  const add = (url: URL) => values.set(url.toString(), url);
  add(sourceUrl);
  if (!/^\/[a-z]{2}\//i.test(sourceUrl.pathname)) {
    const us = new URL(sourceUrl);
    us.pathname = `/us${sourceUrl.pathname.startsWith("/") ? sourceUrl.pathname : `/${sourceUrl.pathname}`}`;
    add(us);
  }
  return [...values.values()];
}

function relayResponse(body: string, options: {
  finalUrl: URL;
  contentType: string;
  upstreamStatus: number;
  truncated?: boolean;
  recovery: RecoveryTransport;
  originalStatus?: number;
}) {
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": options.contentType || "text/plain; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "cdn-cache-control": "no-store",
      "x-rml-worker-revision": WORKER_REVISION,
      "x-rml-marketplace-mode": "frontend-api-depop-parallel-recovery",
      "x-rml-upstream-status": String(options.upstreamStatus),
      "x-rml-original-upstream-status": String(options.originalStatus ?? options.upstreamStatus),
      "x-rml-final-url": options.finalUrl.toString(),
      "x-rml-upstream-content-type": options.contentType || "",
      "x-rml-recovery-transport": options.recovery,
      "x-rml-truncated": options.truncated ? "1" : "0",
    },
  });
}

async function officialDepopResponse(sourceUrl: URL, requestSignal: AbortSignal) {
  let lastStatus = 0;
  for (const variant of depopSourceVariants(sourceUrl)) {
    const { response, url } = await fetchMarketplacePage(variant, requestSignal, DEPOP_ORIGIN_TIMEOUT_MS);
    lastStatus = response.status;
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
  }
  throw new Error(`Depop origin did not expose usable cards (${lastStatus || "network"}).`);
}

async function apiDepopResponse(sourceUrl: URL, requestSignal: AbortSignal) {
  if (isDepopProductUrl(sourceUrl)) throw new Error("Search API is not used for product pages.");
  const api = await fetchDepopApi(sourceUrl, requestSignal);
  return relayResponse(api.body, {
    finalUrl: sourceUrl,
    contentType: api.response.headers.get("content-type") || "application/json; charset=utf-8",
    upstreamStatus: 200,
    originalStatus: api.response.status,
    truncated: api.truncated,
    recovery: "depop-api",
  });
}

async function readerDepopResponse(sourceUrl: URL, requestSignal: AbortSignal) {
  let lastStatus = 0;
  for (const variant of depopSourceVariants(sourceUrl)) {
    const reader = await fetchDepopReader(variant, requestSignal);
    lastStatus = reader.response.status;
    const cards = depopProductCount(reader.body);
    const usableProductPage = isDepopProductUrl(variant) && reader.response.ok
      && reader.body.trim().length > 200 && depopProductPageEvidence(reader.body);
    if ((cards > 0 || usableProductPage) && !depopChallenge(reader.response.status, reader.body)) {
      return relayResponse(reader.body, {
        finalUrl: variant,
        contentType: "text/markdown; charset=utf-8",
        upstreamStatus: 200,
        originalStatus: lastStatus,
        truncated: reader.truncated,
        recovery: "depop-reader",
      });
    }
  }
  throw new Error(`Depop readable source did not expose product links (${lastStatus || "network"}).`);
}

async function indexDepopResponse(sourceUrl: URL, requestSignal: AbortSignal) {
  if (isDepopProductUrl(sourceUrl)) throw new Error("Index recovery is not used for one product page.");
  const indexed = await fetchIndexedDepopLinks(sourceUrl, requestSignal);
  return relayResponse(indexed.body, {
    finalUrl: sourceUrl,
    contentType: "text/markdown; charset=utf-8",
    upstreamStatus: 200,
    originalStatus: 403,
    recovery: "depop-index",
  });
}

async function relayDepop(sourceUrl: URL, request: Request) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  if (request.signal.aborted) controller.abort();
  else request.signal.addEventListener("abort", abort, { once: true });

  try {
    const tasks: Array<Promise<Response>> = [
      officialDepopResponse(sourceUrl, controller.signal),
      readerDepopResponse(sourceUrl, controller.signal),
    ];
    if (!isDepopProductUrl(sourceUrl)) {
      tasks.push(apiDepopResponse(sourceUrl, controller.signal));
      tasks.push(indexDepopResponse(sourceUrl, controller.signal));
    }
    try {
      const result = await Promise.any(tasks);
      controller.abort();
      return result;
    } catch {
      const empty = JSON.stringify({
        products: [],
        meta: { hasMore: false, resultCount: 0 },
        recovery: "depop-empty",
      });
      return relayResponse(empty, {
        finalUrl: sourceUrl,
        contentType: "application/json; charset=utf-8",
        upstreamStatus: 200,
        originalStatus: 403,
        recovery: "depop-empty",
      });
    }
  } finally {
    request.signal.removeEventListener("abort", abort);
  }
}

async function relay(request: Request) {
  const requestUrl = new URL(request.url);
  let source = requestUrl.searchParams.get("source") || depopSourceFromRequest(requestUrl);
  if (request.method === "POST") {
    try {
      const payload = await request.json() as { source?: unknown; url?: unknown; marketplace?: unknown; query?: unknown; q?: unknown; page?: unknown };
      source = typeof payload.source === "string" ? payload.source : typeof payload.url === "string" ? payload.url : source;
      if (!source && String(payload.marketplace || "").toLowerCase() === "depop") {
        const query = String(payload.query || payload.q || "").trim();
        const page = Math.max(0, Number(payload.page) || 0) + 1;
        if (query) source = `https://www.depop.com/us/search/?q=${encodeURIComponent(query)}&page=${page}`;
      }
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
