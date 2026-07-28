"use client";

import {
  MARKETPLACE_INFO,
  MARKETPLACES,
  type Listing,
  type Marketplace,
} from "./analysis";
import {
  normalizePublicListingRecord,
  priceFromPublicText,
} from "./public-listing-record";
import { inferApparelType } from "./apparel";

export type FrontendMarketplaceResult = {
  marketplace: Marketplace;
  status: "live" | "unavailable" | "error";
  message: string;
  sourceUrl: string;
  listings: Partial<Listing>[];
  hasMore: boolean;
  diagnostics: {
    transport: string[];
    attemptedUrls: string[];
    readableResponses: number;
    extensionBridgeAvailable: boolean;
    readerFallbackUsed: boolean;
    hydratedListings: number;
  };
};

export type FrontendAiSearchResult = {
  searches: string[];
  listings: Partial<Listing>[];
  discoveredCount: number;
  discoveryMode: string;
  targetedSecondhandSources: string[];
};

type TextResponse = {
  ok: boolean;
  status: number;
  url: string;
  contentType: string;
  text: string;
  transport: "frontend-api" | "direct" | "extension" | "reader";
};

type BridgeResponse = {
  ok?: boolean;
  status?: number;
  url?: string;
  contentType?: string;
  body?: string;
  error?: string;
};

const MAX_RESPONSE_CHARS = 5_500_000;
const BRIDGE_TIMEOUT_MS = 18_000;
const DIRECT_TIMEOUT_MS = 12_000;
const READER_TIMEOUT_MS = 20_000;
const JINA_KEY_STORAGE = "rml:jina-reader-key";

const CORS_BLOCKED_MARKETPLACE_HOSTS = [
  "depop.com",
  "grailed.com",
  "poshmark.com",
  "jp.mercari.com",
  "zenmarket.jp",
  "rakuten.co.jp",
  "fril.jp",
  "globalbunjang.com",
  "ebay.com",
  "mercari.com",
  "facebook.com",
] as const;

function hostnameMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function directBrowserFetchAllowed(url: string) {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return !CORS_BLOCKED_MARKETPLACE_HOSTS.some((domain) => hostnameMatches(hostname, domain));
  } catch {
    return false;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function absoluteUrl(value: string, base: string) {
  if (!value) return "";
  try {
    return new URL(value.replaceAll("&amp;", "&").replaceAll("\\/", "/"), base).toString();
  } catch {
    return "";
  }
}

function safeImage(value: string, base: string) {
  const url = absoluteUrl(value, base);
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const lower = `${parsed.hostname}${parsed.pathname}`.toLowerCase();
    if (/favicon|\.ico(?:$|\?)|logo|sprite|avatar|qr[-_]?code|duckduckgo\.com\/ip3\//.test(lower)) return "";
    if (!/^https?:$/.test(parsed.protocol)) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function numberValue(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toUsd(amount: number, currency: string) {
  const normalized = currency.toUpperCase();
  if (!amount) return 0;
  if (normalized === "JPY") return amount / 155;
  if (normalized === "KRW") return amount / 1_390;
  if (normalized === "CNY" || normalized === "RMB") return amount / 7.2;
  if (normalized === "EUR") return amount * 1.08;
  if (normalized === "GBP") return amount * 1.28;
  return amount;
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function frontendMarketplaceUrls(
  marketplace: Marketplace,
  query: string,
  page = 0,
  mode: "active" | "sold" = "active",
) {
  const q = encodeURIComponent(query);
  const p = String(page + 1);
  if (marketplace === "Depop") {
    const slug = slugify(query);
    return [
      // Use Depop's real public search pages. Their server-rendered/React page
      // source contains product links, prices, sizes and photo records.
      `https://www.depop.com/search/?q=${q}&page=${p}`,
      ...(slug ? [`https://www.depop.com/brands/${slug}/?page=${p}`] : []),
      ...(slug ? [`https://www.depop.com/theme/${slug}/?page=${p}`] : []),
    ];
  }
  if (marketplace === "Grailed") return [mode === "sold"
    ? `https://www.grailed.com/sold?query=${q}&page=${p}`
    : `https://www.grailed.com/shop?query=${q}&page=${p}`];
  if (marketplace === "Poshmark") return [`https://poshmark.com/search?query=${q}&type=listings&src=ac&page=${p}`];
  if (marketplace === "Mercari Japan") {
    const status = mode === "sold" ? "sold_out" : "on_sale";
    return [
      `https://jp.mercari.com/search?keyword=${q}&status=${status}&page=${p}`,
      `https://jp.mercari.com/en/search?keyword=${q}&status=${status}&page=${p}`,
      `https://jp.mercari.com/search?keyword=${q}&status=${status}`,
    ];
  }
  if (marketplace === "JDirectItems Auction") return [
    `https://zenmarket.jp/en/search.aspx?q=${q}&p=${p}&searchMode=custom&stores=28`,
    `https://zenmarket.jp/en/yahoo.aspx?q=${q}&p=${p}`,
    `https://auctions.yahoo.co.jp/search/search?p=${q}&b=${page * 50 + 1}&n=50`,
  ];
  if (marketplace === "Rakuten") return [
    `https://zenmarket.jp/en/search.aspx?q=${q}&p=${p}&searchMode=custom&stores=0`,
    `https://search.rakuten.co.jp/search/mall/${q}/?p=${p}`,
  ];
  if (marketplace === "Rakuten Rakuma") return [
    `https://zenmarket.jp/en/search.aspx?q=${q}&p=${p}&searchMode=custom&stores=25`,
    `https://zenmarket.jp/en/rakuma.aspx?q=${q}&p=${p}`,
    `https://fril.jp/s?query=${q}&page=${p}`,
  ];
  if (marketplace === "Bunjang") return [`https://globalbunjang.com/search?q=${q}&page=${p}`];
  return [MARKETPLACE_INFO[marketplace].search(query)];
}

function mergeAbortSignals(primary: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  primary?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: controller.signal,
    cleanup() {
      window.clearTimeout(timer);
      primary?.removeEventListener("abort", onAbort);
    },
  };
}


async function frontendApiFetchText(url: string, signal?: AbortSignal): Promise<TextResponse> {
  const merged = mergeAbortSignals(signal, DIRECT_TIMEOUT_MS + 5_000);
  try {
    const response = await fetch(`/api/listings?source=${encodeURIComponent(url)}`, {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: merged.signal,
      headers: { Accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.6" },
    });
    const relayError = response.headers.get("x-rml-relay-error") === "1";
    const text = (await response.text()).slice(0, MAX_RESPONSE_CHARS);
    if (!response.ok || relayError) {
      let message = `Marketplace page-source relay HTTP ${response.status}`;
      try {
        const payload = JSON.parse(text) as { error?: unknown };
        if (typeof payload.error === "string" && payload.error) message = payload.error;
      } catch { /* raw error text */ }
      throw new Error(message);
    }
    const upstreamStatus = Number(response.headers.get("x-rml-upstream-status") || "200") || 0;
    return {
      ok: upstreamStatus >= 200 && upstreamStatus < 400,
      status: upstreamStatus,
      url: response.headers.get("x-rml-final-url") || url,
      contentType: response.headers.get("x-rml-upstream-content-type")
        || response.headers.get("content-type") || "",
      text,
      transport: "frontend-api",
    };
  } finally {
    merged.cleanup();
  }
}

async function directFetchText(url: string, signal?: AbortSignal): Promise<TextResponse> {
  const merged = mergeAbortSignals(signal, DIRECT_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      redirect: "follow",
      cache: "no-store",
      signal: merged.signal,
      headers: {
        Accept: "application/json,text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.7",
      },
    });
    const text = (await response.text()).slice(0, MAX_RESPONSE_CHARS);
    return {
      ok: response.ok,
      status: response.status,
      url: response.url || url,
      contentType: response.headers.get("content-type") || "",
      text,
      transport: "direct",
    };
  } finally {
    merged.cleanup();
  }
}

function extensionBridgeAvailable() {
  return typeof window !== "undefined" && (
    typeof (window as Window & { __RML_EXTENSION_FETCH__?: unknown }).__RML_EXTENSION_FETCH__ === "function" ||
    document.documentElement.dataset.rmlBridge === "ready"
  );
}

type PendingBridgeRequest = {
  resolve: (value: TextResponse) => void;
  reject: (reason: Error | DOMException) => void;
  url: string;
  timer: number;
  signal?: AbortSignal;
  onAbort?: () => void;
};

const pendingBridgeRequests = new Map<string, PendingBridgeRequest>();
let bridgeResponseListenerInstalled = false;

function settleBridgeRequest(id: string, callback: (pending: PendingBridgeRequest) => void) {
  const pending = pendingBridgeRequests.get(id);
  if (!pending) return;
  pendingBridgeRequests.delete(id);
  window.clearTimeout(pending.timer);
  if (pending.onAbort) pending.signal?.removeEventListener("abort", pending.onAbort);
  callback(pending);
}

function ensureBridgeResponseListener() {
  if (bridgeResponseListenerInstalled || typeof window === "undefined") return;
  bridgeResponseListenerInstalled = true;
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data as { type?: string; id?: string; source?: string; response?: BridgeResponse };
    if (data?.type !== "RML_FETCH_RESPONSE" || typeof data.id !== "string") return;
    const value = data.response;
    settleBridgeRequest(data.id, (pending) => {
      if (!value || value.error) {
        pending.reject(new Error(value?.error || "Browser bridge request failed."));
        return;
      }
      pending.resolve({
        ok: Boolean(value.ok),
        status: Number(value.status) || 0,
        url: value.url || pending.url,
        contentType: value.contentType || "",
        text: (value.body || "").slice(0, MAX_RESPONSE_CHARS),
        transport: "extension",
      });
    });
  });
}

async function extensionFetchText(url: string, signal?: AbortSignal): Promise<TextResponse> {
  const injected = (window as Window & {
    __RML_EXTENSION_FETCH__?: (input: { url: string }) => Promise<BridgeResponse>;
  }).__RML_EXTENSION_FETCH__;
  if (typeof injected === "function") {
    const value = await injected({ url });
    if (!value || value.error) throw new Error(value?.error || "Browser bridge request failed.");
    return {
      ok: Boolean(value.ok),
      status: Number(value.status) || 0,
      url: value.url || url,
      contentType: value.contentType || "",
      text: (value.body || "").slice(0, MAX_RESPONSE_CHARS),
      transport: "extension",
    };
  }

  if (!extensionBridgeAvailable()) {
    throw new Error("Browser bridge is not installed or not ready.");
  }

  ensureBridgeResponseListener();
  const id = `rml-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return await new Promise<TextResponse>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      settleBridgeRequest(id, (pending) => pending.reject(new Error("Browser bridge request timed out.")));
    }, BRIDGE_TIMEOUT_MS);
    const pending: PendingBridgeRequest = { resolve, reject, url, timer, signal };
    if (signal) {
      pending.onAbort = () => {
        settleBridgeRequest(id, (request) => request.reject(new DOMException("Request cancelled.", "AbortError")));
      };
      signal.addEventListener("abort", pending.onAbort, { once: true });
    }
    pendingBridgeRequests.set(id, pending);
    window.postMessage({ type: "RML_FETCH_REQUEST", id, request: { url } }, "*");
  });
}

function jinaApiKey() {
  try {
    return localStorage.getItem(JINA_KEY_STORAGE)?.trim() || "";
  } catch {
    return "";
  }
}

async function readerFetchText(url: string, signal?: AbortSignal): Promise<TextResponse> {
  const merged = mergeAbortSignals(signal, READER_TIMEOUT_MS);
  const readerUrl = `https://r.jina.ai/${url}`;
  const key = jinaApiKey();
  try {
    const response = await fetch(readerUrl, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
      signal: merged.signal,
      headers: {
        Accept: "text/plain,application/json;q=0.9,*/*;q=0.5",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
        "X-Return-Format": "markdown",
      },
    });
    const text = (await response.text()).slice(0, MAX_RESPONSE_CHARS);
    return {
      ok: response.ok,
      status: response.status,
      url,
      contentType: response.headers.get("content-type") || "text/plain",
      text,
      transport: "reader",
    };
  } finally {
    merged.cleanup();
  }
}

async function fetchReadableText(url: string, signal?: AbortSignal): Promise<TextResponse> {
  const failures: string[] = [];
  const bridgeReady = extensionBridgeAvailable();

  // Restore the earlier frontend API marketplace-results flow. The same-origin
  // route performs one bounded upstream fetch and returns the raw response; all
  // JSON/HTML/markdown parsing remains here in the browser.
  try {
    const relayed = await frontendApiFetchText(url, signal);
    if (relayed.ok && relayed.text.trim()) return relayed;
    failures.push(`frontend API upstream HTTP ${relayed.status}`);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "frontend marketplace API unavailable");
  }

  // Keep the bridge as an optional fallback for marketplaces that block
  // Cloudflare egress, but never add one listener per request.
  if (bridgeReady) {
    try {
      const bridged = await extensionFetchText(url, signal);
      if (bridged.ok && bridged.text.trim()) return bridged;
      failures.push(`extension HTTP ${bridged.status}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "extension bridge unavailable");
    }
  }

  // Only attempt page-origin fetches for hosts known to permit CORS.
  if (directBrowserFetchAllowed(url)) {
    try {
      const direct = await directFetchText(url, signal);
      if (direct.ok && direct.text.trim()) return direct;
      failures.push(`direct HTTP ${direct.status}`);
    } catch (error) {
      failures.push(error instanceof Error ? error.message : "direct fetch blocked");
    }
  }

  try {
    const reader = await readerFetchText(url, signal);
    if (reader.ok && reader.text.trim()) return reader;
    failures.push(`reader HTTP ${reader.status}`);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "reader unavailable");
  }

  throw new Error(failures.filter(Boolean).join("; ") || "No marketplace-results transport succeeded.");
}

function walkJson(value: unknown, visit: (record: Record<string, unknown>) => void) {
  const queue: unknown[] = [value];
  const seen = new Set<object>();
  let count = 0;
  while (queue.length && count < 12_000) {
    const current = queue.shift();
    count += 1;
    if (!current || typeof current !== "object") continue;
    if (seen.has(current as object)) continue;
    seen.add(current as object);
    if (Array.isArray(current)) {
      queue.push(...current.slice(0, 2_000));
      continue;
    }
    const record = current as Record<string, unknown>;
    visit(record);
    queue.push(...Object.values(record).slice(0, 400));
  }
}

function recordText(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return "";
}

function marketplaceRecordWithUrl(
  record: Record<string, unknown>,
  marketplace: Marketplace,
) {
  const enriched = { ...record };
  const existing = recordText(enriched, [
    "url", "web_url", "path", "productUrl", "product_url", "itemUrl", "item_url",
    "detailUrl", "detail_url", "shareUrl", "share_url", "href", "link", "targetUrl",
  ]);
  if (existing) return enriched;

  const id = recordText(enriched, [
    "itemCode", "item_code", "auctionId", "auction_id", "productId", "product_id",
    "itemId", "item_id", "objectID", "id",
  ]);
  const storeId = recordText(enriched, ["storeId", "store_id", "shopId", "shop_id"]);
  const storeName = recordText(enriched, ["storeName", "store_name", "store", "source", "marketplace"]);
  if (!id) return enriched;

  if (marketplace === "Rakuten" && (storeId === "0" || /rakuten/i.test(storeName))) {
    enriched.url = `https://zenmarket.jp/en/rakutenproduct.aspx?itemCode=${encodeURIComponent(id)}`;
  } else if (marketplace === "JDirectItems Auction" && (storeId === "28" || /auction|yahoo|jdirect/i.test(storeName))) {
    enriched.url = `https://zenmarket.jp/en/auction.aspx?itemCode=${encodeURIComponent(id)}`;
  } else if (marketplace === "Rakuten Rakuma" && (storeId === "25" || /rakuma|fril/i.test(storeName))) {
    enriched.url = `https://zenmarket.jp/en/rakumaproduct.aspx?itemCode=${encodeURIComponent(id)}`;
  }
  return enriched;
}

function canonicalListingUrl(value: string, marketplace: Marketplace, base: string) {
  const absolute = absoluteUrl(value, base);
  if (!absolute) return "";
  try {
    const parsed = new URL(absolute);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname;
    if (parsed.protocol !== "https:") return "";
    const hostMatches = (domain: string) => host === domain || host.endsWith(`.${domain}`);

    if (marketplace === "Depop") {
      if (!hostMatches("depop.com") || !/^\/products\/[^/]+\/?$/i.test(path)) return "";
      parsed.search = "";
      parsed.hash = "";
      if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
    } else if (marketplace === "Grailed") {
      if (!hostMatches("grailed.com") || !/\/listings\//i.test(path)) return "";
    } else if (marketplace === "Poshmark") {
      if (!hostMatches("poshmark.com") || !/\/listing\//i.test(path)) return "";
    } else if (marketplace === "Mercari Japan") {
      if (host !== "jp.mercari.com" || !/(?:\/en)?\/item\/m\d+/i.test(path)) return "";
      parsed.search = "";
    } else if (marketplace === "Rakuten") {
      const valid = (hostMatches("zenmarket.jp") && /rakutenproduct\.aspx/i.test(path))
        || (host === "item.rakuten.co.jp" && path.split("/").filter(Boolean).length >= 2);
      if (!valid) return "";
    } else if (marketplace === "JDirectItems Auction") {
      const valid = (hostMatches("zenmarket.jp") && /(?:auction|yahoo).*\.aspx/i.test(path))
        || (hostMatches("auctions.yahoo.co.jp") && /\/auction\//i.test(path));
      if (!valid) return "";
    } else if (marketplace === "Rakuten Rakuma") {
      const valid = (hostMatches("zenmarket.jp") && /rakuma.*\.aspx/i.test(path))
        || (host === "item.fril.jp" && path.length > 1)
        || (hostMatches("fril.jp") && /\/(?:shop|item)\//i.test(path));
      if (!valid) return "";
    } else if (marketplace === "Bunjang") {
      if (!hostMatches("globalbunjang.com") || !/(?:product|products|item)\//i.test(path)) return "";
    }

    for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content", "scid", "ref", "source"]) {
      parsed.searchParams.delete(key);
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function marketplaceImage(value: string, marketplace: Marketplace, base: string) {
  const image = safeImage(value, base);
  if (!image) return "";
  try {
    const parsed = new URL(image);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    if (marketplace === "Depop") {
      if (/assets\.depop\.com/.test(host) || /(?:logo|favicon|qr|avatar|badge)/.test(path)) return "";
      if (!/(?:media-photos|media|images)\.depop\.com$/.test(host) && !host.endsWith(".depop.com")) return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function partialFromRecord(record: Record<string, unknown>, marketplace: Marketplace, base: string) {
  const enriched = marketplaceRecordWithUrl(record, marketplace);
  const normalized = normalizePublicListingRecord(enriched, marketplace, base);
  if (!normalized) return null;
  const url = canonicalListingUrl(normalized.rawUrl, marketplace, base);
  if (!url) return null;
  const image = marketplaceImage(normalized.image, marketplace, base);
  const price = toUsd(normalized.amount, normalized.currency);
  return {
    id: `${marketplace}-${url}`,
    marketplace,
    title: normalized.title,
    brand: normalized.brand || "Unspecified",
    price,
    shipping: 0,
    condition: normalized.condition || (price > 0 ? "Check listing" : `Price unavailable — open ${marketplace}`),
    size: normalized.size || "Unknown",
    articleType: inferApparelType(normalized.title, `${normalized.category} ${normalized.description}`),
    image,
    url,
    description: [
      normalized.description,
      normalized.amount > 0 && normalized.currency && normalized.currency !== "USD"
        ? `Original price ${normalized.amount.toLocaleString("en-US")} ${normalized.currency}; displayed USD value is an estimate.`
        : "",
    ].filter(Boolean).join(" "),
    live: true,
  } satisfies Partial<Listing>;
}

function recordsFromJson(value: unknown, marketplace: Marketplace, base: string) {
  const output: Partial<Listing>[] = [];
  walkJson(value, (record) => {
    const item = partialFromRecord(record, marketplace, base);
    if (item) output.push(item);
  });
  return output;
}

function balancedJsonAt(source: string, start: number) {
  const opening = source[start];
  const closing = opening === "{" ? "}" : opening === "[" ? "]" : "";
  if (!closing) return "";
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length && index - start < 1_800_000; index += 1) {
    const char = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === opening) depth += 1;
    else if (char === closing) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return "";
}

function jsonPayloadsFromScript(content: string) {
  const payloads: unknown[] = [];
  const tryParse = (candidate: string) => {
    try { payloads.push(JSON.parse(candidate)); } catch { /* not standalone JSON */ }
  };
  tryParse(content.trim());

  for (const match of content.matchAll(/(?:window\.)?(?:__NEXT_DATA__|__INITIAL_STATE__|__APOLLO_STATE__|__PRELOADED_STATE__)\s*=\s*/g)) {
    const from = (match.index || 0) + match[0].length;
    const start = content.slice(from).search(/[\[{]/);
    if (start >= 0) {
      const candidate = balancedJsonAt(content, from + start);
      if (candidate) tryParse(candidate);
    }
  }

  const decodedFlight: string[] = [];
  for (const match of content.matchAll(/self\.__next_f\.push\(\[\d+,\s*("(?:\\.|[^"\\])*")\s*\]\)/g)) {
    try { decodedFlight.push(JSON.parse(match[1])); } catch { /* malformed flight line */ }
  }
  for (const source of decodedFlight) {
    const normalized = source.replaceAll("\\u002F", "/").replaceAll("\\/", "/");
    for (let index = 0, found = 0; index < normalized.length && found < 80; index += 1) {
      if (normalized[index] !== "{" && normalized[index] !== "[") continue;
      const candidate = balancedJsonAt(normalized, index);
      if (!candidate || !/(?:\/products\/|\/listings\/|\/listing\/|item\.rakuten|rakutenproduct|itemCode|productId|itemId)/i.test(candidate)) continue;
      tryParse(candidate);
      index += candidate.length - 1;
      found += 1;
    }
  }
  return payloads;
}

function parseJsonScripts(document: Document, marketplace: Marketplace, base: string) {
  const output: Partial<Listing>[] = [];
  for (const script of document.querySelectorAll("script")) {
    const content = script.textContent?.trim();
    if (!content || content.length > 2_000_000) continue;
    const type = script.getAttribute("type") || "";
    if (!/json/i.test(type) && script.id !== "__NEXT_DATA__"
      && !/(?:__next_f|__INITIAL_STATE__|__APOLLO_STATE__|itemListElement|\/products\/|\/listings\/|\/listing\/|item\.rakuten)/i.test(content)) continue;
    for (const payload of jsonPayloadsFromScript(content)) {
      output.push(...recordsFromJson(payload, marketplace, base));
    }
  }
  return output;
}

function marketplaceHrefPattern(marketplace: Marketplace) {
  if (marketplace === "Depop") return /\/products\//i;
  if (marketplace === "Grailed") return /\/listings\//i;
  if (marketplace === "Poshmark") return /\/listing\//i;
  if (marketplace === "Mercari Japan") return /\/item\//i;
  if (marketplace === "JDirectItems Auction") return /(?:auction|yahoo|product\.aspx|auctionproduct\.aspx)/i;
  if (marketplace === "Rakuten") return /(?:rakutenproduct\.aspx|item\.rakuten\.co\.jp)/i;
  if (marketplace === "Rakuten Rakuma") return /(?:rakuma|fril\.jp\/shop|fril\.jp\/item)/i;
  if (marketplace === "Bunjang") return /(?:product|products|item)\//i;
  return /./;
}

function bestImageFromElement(root: Element, marketplace: Marketplace, base: string) {
  const candidates: string[] = [];
  for (const image of root.querySelectorAll("img")) {
    const srcset = image.getAttribute("srcset") || image.getAttribute("data-srcset") || "";
    candidates.push(...srcset.split(",").map((entry) => entry.trim().split(/\s+/)[0]).filter(Boolean));
    candidates.push(
      image.getAttribute("src") || "",
      image.getAttribute("data-src") || "",
      image.getAttribute("data-original") || "",
      image.getAttribute("data-lazy-src") || "",
    );
  }
  for (const candidate of candidates.reverse()) {
    const image = marketplaceImage(candidate, marketplace, base);
    if (image) return image;
  }
  return "";
}

function textFromSelector(root: Element, selectors: string) {
  return (root.querySelector(selectors)?.textContent || "").replace(/\s+/g, " ").trim();
}

function listingFromAnchor(anchor: HTMLAnchorElement, marketplace: Marketplace, base: string) {
  const url = canonicalListingUrl(anchor.getAttribute("href") || "", marketplace, base);
  if (!url || !marketplaceHrefPattern(marketplace).test(url)) return null;
  const container = anchor.closest("article,li,[data-testid],[data-item-id],[data-product-id],[class*='card'],[class*='item'],[class*='product']") || anchor;
  const visibleText = (container.textContent || anchor.textContent || "").replace(/\s+/g, " ").trim();
  const title = (
    anchor.getAttribute("aria-label") || anchor.getAttribute("title") ||
    textFromSelector(container, "h1,h2,h3,h4,[data-testid*='title'],[class*='title'],[class*='name']") ||
    container.querySelector("img")?.getAttribute("alt") || visibleText
  ).replace(/\s+/g, " ").trim().slice(0, 320);
  if (!title || title.length < 3) return null;
  const publicPrice = priceFromPublicText(visibleText);
  const defaultCurrency = ["Rakuten", "Rakuten Rakuma", "JDirectItems Auction", "Mercari Japan"].includes(marketplace)
    ? "JPY" : marketplace === "Bunjang" ? "KRW" : "USD";
  const price = toUsd(publicPrice.amount, publicPrice.currency || defaultCurrency);
  const image = bestImageFromElement(container, marketplace, base);
  const brand = textFromSelector(container, "[class*='brand'],[data-testid*='brand']") || "Unspecified";
  const size = textFromSelector(container, "[class*='size'],[data-testid*='size']") || "Unknown";
  const conditionText = textFromSelector(container, "[class*='condition'],[data-testid*='condition']");
  return {
    id: `${marketplace}-${url}`,
    marketplace,
    title,
    brand,
    price,
    shipping: 0,
    condition: conditionText || (price > 0 ? "Check listing" : `Price unavailable — open ${marketplace}`),
    size,
    articleType: inferApparelType(title, visibleText),
    image,
    url,
    description: visibleText.slice(0, 900) || "Public listing link discovered in the marketplace page source.",
    live: true,
  } satisfies Partial<Listing>;
}


function embeddedListingPathPattern(marketplace: Marketplace) {
  if (marketplace === "Depop") return /(?:https?:\/\/[^"'\s<>]+)?\/products\/[a-z0-9_-]+\/?/gi;
  if (marketplace === "Grailed") return /(?:https?:\/\/[^"'\s<>]+)?\/listings\/\d+[^"'\s<>]*/gi;
  if (marketplace === "Poshmark") return /(?:https?:\/\/[^"'\s<>]+)?\/listing\/[a-z0-9_-]+[^"'\s<>]*/gi;
  if (marketplace === "Mercari Japan") return /(?:https?:\/\/jp\.mercari\.com)?\/(?:en\/)?item\/m\d+/gi;
  if (marketplace === "Rakuten") return /https?:\/\/(?:item\.rakuten\.co\.jp\/[^"'\s<>]+|zenmarket\.jp\/[^"'\s<>]*rakutenproduct\.aspx\?[^"'\s<>]+)/gi;
  if (marketplace === "JDirectItems Auction") return /https?:\/\/(?:auctions\.yahoo\.co\.jp\/auction\/[^"'\s<>]+|zenmarket\.jp\/[^"'\s<>]*(?:auction|yahoo)[^"'\s<>]*\.aspx\?[^"'\s<>]+)/gi;
  if (marketplace === "Rakuten Rakuma") return /https?:\/\/(?:item\.fril\.jp\/[^"'\s<>]+|fril\.jp\/(?:shop|item)\/[^"'\s<>]+|zenmarket\.jp\/[^"'\s<>]*rakuma[^"'\s<>]*\.aspx\?[^"'\s<>]+)/gi;
  if (marketplace === "Bunjang") return /(?:https?:\/\/[^"'\s<>]+)?\/(?:product|products|item)\/[a-z0-9_-]+/gi;
  return /$a/gi;
}

function parseEmbeddedSourceLinks(source: string, marketplace: Marketplace, base: string) {
  const normalized = source
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/")
    .replaceAll("&amp;", "&")
    .replaceAll('\\"', '"');
  const output: Partial<Listing>[] = [];
  const pattern = embeddedListingPathPattern(marketplace);
  let count = 0;
  for (const match of normalized.matchAll(pattern)) {
    if (count >= 120) break;
    const url = canonicalListingUrl(match[0], marketplace, base);
    if (!url) continue;
    const index = match.index || 0;
    const context = normalized.slice(Math.max(0, index - 1_500), Math.min(normalized.length, index + 2_500));
    const title = (
      context.match(/"(?:display_?title|product_?name|item_?name|itemTitle|productTitle|title|name)"\s*:\s*"([^"\n]{3,320})"/i)?.[1]
      || context.match(/(?:aria-label|title|alt)\s*=\s*"([^"]{3,320})"/i)?.[1]
      || `${marketplace} listing`
    ).replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
      .replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
    const priceInfo = priceFromPublicText(context);
    const currency = priceInfo.currency || (["Rakuten", "Rakuten Rakuma", "JDirectItems Auction", "Mercari Japan"].includes(marketplace)
      ? "JPY" : marketplace === "Bunjang" ? "KRW" : "USD");
    const imageRaw = context.match(/"(?:imageUrl|image_url|thumbnailUrl|thumbnail_url|cover_image|image|thumbnail|src)"\s*:\s*"(https?:\/\/[^"\s]+)"/i)?.[1]
      || context.match(/<img\b[^>]*(?:src|data-src|data-original)\s*=\s*"([^"]+)"/i)?.[1]
      || "";
    const image = marketplaceImage(imageRaw, marketplace, base);
    output.push({
      id: `${marketplace}-${url}`,
      marketplace,
      title,
      brand: "Unspecified",
      price: toUsd(priceInfo.amount, currency),
      shipping: 0,
      condition: priceInfo.amount ? "Check listing" : `Price unavailable — open ${marketplace}`,
      size: "Unknown",
      articleType: inferApparelType(title, context),
      image,
      url,
      description: context.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 900),
      live: true,
    });
    count += 1;
  }
  return output;
}

function parseHtml(text: string, marketplace: Marketplace, base: string) {
  const document = new DOMParser().parseFromString(text, "text/html");
  const output = parseJsonScripts(document, marketplace, base);
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const listing = listingFromAnchor(anchor, marketplace, base);
    if (listing) output.push(listing);
  }
  output.push(...parseEmbeddedSourceLinks(text, marketplace, base));

  if (!output.length) {
    const rawCanonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href
      || document.querySelector<HTMLMetaElement>('meta[property="og:url"]')?.content || base;
    const canonical = canonicalListingUrl(rawCanonical, marketplace, base);
    const title = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content
      || document.querySelector<HTMLMetaElement>('meta[name="twitter:title"]')?.content
      || document.querySelector("h1")?.textContent || document.title;
    const image = marketplaceImage(
      document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content
        || document.querySelector<HTMLMetaElement>('meta[name="twitter:image"]')?.content || "",
      marketplace, canonical || base,
    );
    const priceAmount = document.querySelector<HTMLMetaElement>('meta[property="product:price:amount"]')?.content || "";
    const priceCurrency = document.querySelector<HTMLMetaElement>('meta[property="product:price:currency"]')?.content || "";
    const priceText = `${priceCurrency} ${priceAmount} ${document.body.textContent || ""}`;
    const publicPrice = priceFromPublicText(priceText);
    if (title && canonical) {
      output.push({
        id: `${marketplace}-${canonical}`,
        marketplace,
        title: title.replace(/\s+/g, " ").trim(),
        brand: "Unspecified",
        price: toUsd(publicPrice.amount, publicPrice.currency),
        shipping: 0,
        condition: publicPrice.amount ? "Check listing" : `Price unavailable — open ${marketplace}`,
        size: "Unknown",
        articleType: inferApparelType(title, document.body.textContent || ""),
        image,
        url: canonical,
        description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content
          || document.querySelector<HTMLMetaElement>('meta[property="og:description"]')?.content || "Public product page.",
        live: true,
      });
    }
  }
  return output;
}

function parseMarkdown(text: string, marketplace: Marketplace, base: string) {
  const output: Partial<Listing>[] = [];
  const linkPattern = /\[([^\]]{3,300})\]\((https?:\/\/[^)\s]+)\)/g;
  const images = [...text.matchAll(/!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/g)]
    .map((match) => ({ index: match.index || 0, url: marketplaceImage(match[1], marketplace, base) }))
    .filter((entry) => entry.url);
  for (const match of text.matchAll(linkPattern)) {
    const url = canonicalListingUrl(match[2], marketplace, base);
    if (!url || !marketplaceHrefPattern(marketplace).test(url)) continue;
    const start = Math.max(0, (match.index || 0) - 250);
    const end = Math.min(text.length, (match.index || 0) + match[0].length + 500);
    const context = text.slice(start, end).replace(/\s+/g, " ").trim();
    const publicPrice = priceFromPublicText(context);
    const nearestImage = images
      .map((entry) => ({ ...entry, distance: Math.abs(entry.index - (match.index || 0)) }))
      .sort((a, b) => a.distance - b.distance)[0]?.url || "";
    output.push({
      id: `${marketplace}-${url}`,
      marketplace,
      title: match[1].replace(/\s+/g, " ").trim(),
      brand: "Unspecified",
      price: toUsd(publicPrice.amount, publicPrice.currency),
      shipping: 0,
      condition: publicPrice.amount ? "Check listing" : `Price unavailable — open ${marketplace}`,
      size: "Unknown",
      articleType: inferApparelType(match[1], context),
      image: nearestImage,
      url,
      description: context.slice(0, 900),
      live: true,
    });
  }
  return output;
}

function parseResponse(response: TextResponse, marketplace: Marketplace) {
  const source = response.text.trim();
  if (!source) return [];
  const output: Partial<Listing>[] = [];
  if (/json/i.test(response.contentType) || /^[\[{]/.test(source)) {
    try {
      output.push(...recordsFromJson(JSON.parse(source), marketplace, response.url));
    } catch {
      // Continue with HTML/markdown parsing.
    }
  }
  if (/<(?:!doctype|html|body|script|a)\b/i.test(source)) {
    output.push(...parseHtml(source, marketplace, response.url));
  } else {
    output.push(...parseMarkdown(source, marketplace, response.url));
    output.push(...parseEmbeddedSourceLinks(source, marketplace, response.url));
  }
  return output;
}

function dedupeListings(values: Partial<Listing>[], limit = 40) {
  const output = new Map<string, Partial<Listing>>();
  for (const listing of values) {
    const key = String(listing.url || listing.id || "").trim();
    if (!key) continue;
    const previous = output.get(key);
    if (!previous) {
      output.set(key, listing);
      continue;
    }
    output.set(key, {
      ...previous,
      ...listing,
      title: String(listing.title || previous.title || "Untitled listing"),
      image: marketplaceImage(String(listing.image || previous.image || ""), String(listing.marketplace || previous.marketplace) as Marketplace, key),
      price: Number(listing.price) > 0 ? Number(listing.price) : Number(previous.price) || 0,
      description: String(listing.description || previous.description || ""),
    });
  }
  return [...output.values()].slice(0, limit);
}


function mergeListingDetails(baseListing: Partial<Listing>, detail: Partial<Listing>) {
  const chooseText = (primary: unknown, fallback: unknown, emptyValues: string[] = []) => {
    const first = String(primary || "").trim();
    if (first && !emptyValues.includes(first)) return first;
    return String(fallback || "").trim();
  };
  return {
    ...baseListing,
    ...detail,
    id: baseListing.id || detail.id,
    marketplace: baseListing.marketplace || detail.marketplace,
    url: baseListing.url || detail.url,
    title: chooseText(detail.title, baseListing.title, ["Marketplace listing", "Untitled listing"]),
    brand: chooseText(detail.brand, baseListing.brand, ["Unspecified"]),
    price: Number(detail.price) > 0 ? Number(detail.price) : Number(baseListing.price) || 0,
    shipping: Number(detail.shipping) > 0 ? Number(detail.shipping) : Number(baseListing.shipping) || 0,
    image: marketplaceImage(
      String(detail.image || baseListing.image || ""),
      String(baseListing.marketplace || detail.marketplace) as Marketplace,
      String(baseListing.url || detail.url || ""),
    ),
    condition: chooseText(detail.condition, baseListing.condition, ["Check listing", `Price unavailable — open ${baseListing.marketplace}`]),
    size: chooseText(detail.size, baseListing.size, ["Unknown"]),
    description: chooseText(detail.description, baseListing.description, ["Public product page."]),
  } satisfies Partial<Listing>;
}

async function hydrateListingPages(
  listings: Partial<Listing>[],
  marketplace: Marketplace,
  signal?: AbortSignal,
) {
  const candidates = listings.filter((listing) => listing.url && (
    !listing.image || Number(listing.price) <= 0 || !listing.description
    || listing.brand === "Unspecified" || listing.size === "Unknown"
  )).slice(0, 8);
  if (!candidates.length) return { listings, hydrated: 0, transports: [] as string[] };

  const updates = new Map<string, Partial<Listing>>();
  const transports = new Set<string>();
  let cursor = 0;
  const workers = Array.from({ length: Math.min(3, candidates.length) }, async () => {
    while (cursor < candidates.length) {
      const index = cursor;
      cursor += 1;
      const listing = candidates[index];
      const url = String(listing.url || "");
      try {
        const response = await fetchReadableText(url, signal);
        transports.add(response.transport);
        const parsed = dedupeListings(parseResponse(response, marketplace), 12);
        const detail = parsed.find((item) => String(item.url || "") === url) || parsed[0];
        if (detail) updates.set(url, detail);
      } catch {
        // Search-page data remains usable when a product page blocks hydration.
      }
    }
  });
  await Promise.allSettled(workers);
  let hydrated = 0;
  const merged = listings.map((listing) => {
    const update = updates.get(String(listing.url || ""));
    if (!update) return listing;
    hydrated += 1;
    return mergeListingDetails(listing, update);
  });
  return { listings: merged, hydrated, transports: [...transports] };
}

export async function searchMarketplaceFrontend(input: {
  marketplace: Marketplace;
  query: string;
  page?: number;
  mode?: "active" | "sold";
  signal?: AbortSignal;
}): Promise<FrontendMarketplaceResult> {
  const { marketplace, query, page = 0, mode = "active", signal } = input;
  const urls = frontendMarketplaceUrls(marketplace, query, page, mode);
  const requestLimit = ["Depop", "Mercari Japan", "JDirectItems Auction", "Rakuten Rakuma"].includes(marketplace) ? 3 : 2;
  const attempts = await Promise.allSettled(urls.slice(0, requestLimit).map(async (url) => {
    const response = await fetchReadableText(url, signal);
    return { response, listings: parseResponse(response, marketplace) };
  }));

  const values = attempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
  const searchListings = dedupeListings(values.flatMap((entry) => entry.listings));
  const hydrated = await hydrateListingPages(searchListings, marketplace, signal);
  const listings = dedupeListings(hydrated.listings);
  const transport = [...new Set([
    ...values.map((entry) => entry.response.transport),
    ...hydrated.transports,
  ])];
  const readerFallbackUsed = transport.includes("reader");
  const sourceUrl = urls[0] || MARKETPLACE_INFO[marketplace].search(query);
  if (listings.length) {
    return {
      marketplace,
      status: "live",
      message: `Loaded ${listings.length} real listing${listings.length === 1 ? "" : "s"} from official marketplace page sources${hydrated.hydrated ? ` and enriched ${hydrated.hydrated} product page${hydrated.hydrated === 1 ? "" : "s"}` : ""}.`,
      sourceUrl,
      listings,
      hasMore: listings.length >= 20,
      diagnostics: {
        transport,
        attemptedUrls: urls,
        readableResponses: values.length,
        extensionBridgeAvailable: extensionBridgeAvailable(),
        readerFallbackUsed,
        hydratedListings: hydrated.hydrated,
      },
    };
  }

  const rejected = attempts.flatMap((attempt) => attempt.status === "rejected"
    ? [attempt.reason instanceof Error ? attempt.reason.message : "Request blocked"]
    : []);
  return {
    marketplace,
    status: rejected.length === attempts.length ? "unavailable" : "unavailable",
    message: `The frontend marketplace-results API and browser fallbacks could not read ${marketplace}'s listing data. Open the live search page directly${extensionBridgeAvailable() ? "; the browser bridge responded but no product cards were readable" : ", or install the included browser bridge for CORS-blocked marketplaces"}.`,
    sourceUrl,
    listings: [],
    hasMore: false,
    diagnostics: {
      transport,
      attemptedUrls: urls,
      readableResponses: values.length,
      extensionBridgeAvailable: extensionBridgeAvailable(),
      readerFallbackUsed,
      hydratedListings: 0,
    },
  };
}

function outsideSource(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    if (host.endsWith("ebay.com")) return "eBay";
    if (host.endsWith("mercari.com")) return "Mercari US";
    if (host.endsWith("facebook.com")) return "Facebook Marketplace";
    return host;
  } catch {
    return "Outside marketplace";
  }
}

function supportedHost(url: string) {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return [
      "depop.com", "grailed.com", "poshmark.com", "jp.mercari.com", "zenmarket.jp",
      "rakuten.co.jp", "fril.jp", "globalbunjang.com", "superbuy.com", "goofish.com",
    ].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function searchJina(query: string, signal?: AbortSignal) {
  const key = jinaApiKey();
  const merged = mergeAbortSignals(signal, READER_TIMEOUT_MS);
  try {
    const response = await fetch(`https://s.jina.ai/?q=${encodeURIComponent(query)}`, {
      mode: "cors",
      credentials: "omit",
      cache: "no-store",
      signal: merged.signal,
      headers: {
        Accept: "application/json,text/plain;q=0.9,*/*;q=0.5",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
    });
    const text = (await response.text()).slice(0, MAX_RESPONSE_CHARS);
    if (!response.ok) throw new Error(`Search reader HTTP ${response.status}`);
    const results: Array<{ title: string; url: string; description: string; image: string }> = [];
    try {
      const value = JSON.parse(text) as unknown;
      walkJson(value, (record) => {
        const url = stringValue(record.url) || stringValue(record.link);
        const title = stringValue(record.title) || stringValue(record.name);
        if (!url || !title) return;
        results.push({
          title,
          url,
          description: stringValue(record.description) || stringValue(record.content) || stringValue(record.snippet),
          image: safeImage(stringValue(record.image) || stringValue(record.thumbnail), url),
        });
      });
    } catch {
      for (const match of text.matchAll(/\[([^\]]{3,300})\]\((https?:\/\/[^)\s]+)\)/g)) {
        results.push({ title: match[1], url: match[2], description: "", image: "" });
      }
    }
    return [...new Map(results.map((item) => [item.url, item])).values()].slice(0, 12);
  } finally {
    merged.cleanup();
  }
}

export async function searchAiWebFrontend(input: {
  query: string;
  queries?: string[];
  signal?: AbortSignal;
}): Promise<FrontendAiSearchResult> {
  const literal = input.query.trim();
  const queries = [...new Set([literal, ...(input.queries || [])].map((value) => value.trim()).filter(Boolean))].slice(0, 5);
  const targets = [
    { name: "eBay", url: (q: string) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(q)}&_sop=10` },
    { name: "Mercari US", url: (q: string) => `https://www.mercari.com/search/?keyword=${encodeURIComponent(q)}` },
    { name: "Facebook Marketplace", url: (q: string) => `https://www.facebook.com/marketplace/search/?query=${encodeURIComponent(q)}` },
  ];

  const candidates: Array<{ title: string; url: string; description: string; image: string }> = [];
  const targetedAttempts = await Promise.allSettled(targets.flatMap((target) => queries.slice(0, 2).map(async (query) => {
    const url = target.url(query);
    const response = await fetchReadableText(url, input.signal);
    const text = response.text;
    const document = /<html|<body|<a\b/i.test(text) ? new DOMParser().parseFromString(text, "text/html") : null;
    if (document) {
      for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        const href = absoluteUrl(anchor.getAttribute("href") || "", response.url);
        if (!href) continue;
        const allowed = target.name === "eBay" ? /\/itm\//.test(href)
          : target.name === "Mercari US" ? /\/us\/item\//.test(href)
            : /\/marketplace\/item\//.test(href);
        if (!allowed) continue;
        const container = anchor.closest("article,li,[class*='item'],[class*='card'],[class*='product']") || anchor;
        candidates.push({
          title: (anchor.getAttribute("title") || anchor.getAttribute("aria-label") || container.textContent || "Listing").replace(/\s+/g, " ").trim().slice(0, 300),
          url: href,
          description: (container.textContent || "").replace(/\s+/g, " ").trim().slice(0, 900),
          image: bestImageFromElement(container, response.url),
        });
      }
    }
    for (const match of text.matchAll(/\[([^\]]{3,300})\]\((https?:\/\/[^)\s]+)\)/g)) {
      const href = absoluteUrl(match[2], response.url);
      if (!href) continue;
      const allowed = target.name === "eBay" ? /\/itm\//.test(href)
        : target.name === "Mercari US" ? /\/us\/item\//.test(href)
          : /\/marketplace\/item\//.test(href);
      if (!allowed) continue;
      const start = Math.max(0, (match.index || 0) - 180);
      const end = Math.min(text.length, (match.index || 0) + match[0].length + 420);
      candidates.push({
        title: match[1].replace(/\s+/g, " ").trim(),
        url: href,
        description: text.slice(start, end).replace(/\s+/g, " ").trim(),
        image: "",
      });
    }
  })));
  void targetedAttempts;

  const jinaAttempts = await Promise.allSettled(queries.slice(0, 3).map((query) =>
    searchJina(`${query} (site:ebay.com/itm OR site:mercari.com/us/item OR site:facebook.com/marketplace/item)`, input.signal),
  ));
  for (const attempt of jinaAttempts) {
    if (attempt.status === "fulfilled") candidates.push(...attempt.value);
  }

  const unique = [...new Map(candidates
    .filter((item) => item.url && !supportedHost(item.url))
    .map((item) => [item.url, item])).values()].slice(0, 18);
  const hydrated = await Promise.allSettled(unique.map(async (item) => {
    let title = item.title;
    let description = item.description;
    let image = item.image;
    let price = priceFromPublicText(`${title} ${description}`).amount;
    try {
      const response = await fetchReadableText(item.url, input.signal);
      const sourceName = outsideSource(item.url);
      const generic = parseHtml(response.text, "Depop", response.url)[0];
      title = String(generic?.title || title);
      description = String(generic?.description || description);
      image = safeImage(String(generic?.image || image), item.url);
      price = Number(generic?.price) || priceFromPublicText(response.text).amount || price;
      return {
        id: `web-${item.url}`,
        marketplace: "Depop" as Marketplace,
        sourceName,
        sourceHost: new URL(item.url).hostname,
        webDiscovered: true,
        title,
        brand: "Unspecified",
        price,
        shipping: 0,
        condition: price > 0 ? "Check listing" : "Price unavailable — open source",
        size: "Unknown",
        articleType: inferApparelType(title, description),
        image,
        url: item.url,
        description,
        live: true,
      } satisfies Partial<Listing>;
    } catch {
      return {
        id: `web-${item.url}`,
        marketplace: "Depop" as Marketplace,
        sourceName: outsideSource(item.url),
        sourceHost: new URL(item.url).hostname,
        webDiscovered: true,
        title,
        brand: "Unspecified",
        price,
        shipping: 0,
        condition: price > 0 ? "Check listing" : "Price unavailable — open source",
        size: "Unknown",
        articleType: inferApparelType(title, description),
        image: safeImage(image, item.url),
        url: item.url,
        description,
        live: true,
      } satisfies Partial<Listing>;
    }
  }));

  const listings = dedupeListings(hydrated.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []), 18);
  return {
    searches: queries,
    listings,
    discoveredCount: unique.length,
    discoveryMode: "browser-side direct fetch + optional extension/Jina reader",
    targetedSecondhandSources: targets.map((target) => target.name),
  };
}
