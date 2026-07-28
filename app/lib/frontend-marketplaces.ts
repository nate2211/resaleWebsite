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
  transport: "direct" | "extension" | "reader";
};

type BridgeResponse = {
  ok?: boolean;
  status?: number;
  url?: string;
  contentType?: string;
  body?: string;
  error?: string;
};

const MAX_RESPONSE_CHARS = 3_000_000;
const BRIDGE_TIMEOUT_MS = 18_000;
const DIRECT_TIMEOUT_MS = 12_000;
const READER_TIMEOUT_MS = 20_000;
const JINA_KEY_STORAGE = "rml:jina-reader-key";

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
      `https://webapi.depop.com/api/v3/search/products/?what=${q}&itemsPerPage=24&country=us&currency=USD&sort=relevance&page=${page}`,
      `https://webapi.depop.com/api/v2/search/products/?what=${q}&itemsPerPage=24&country=us&currency=USD&sort=relevance&page=${page}`,
      `https://www.depop.com/search/?q=${q}&page=${p}`,
      ...(slug ? [`https://www.depop.com/brands/${slug}/?page=${p}`] : []),
    ];
  }
  if (marketplace === "Grailed") return [mode === "sold"
    ? `https://www.grailed.com/sold?query=${q}&page=${p}`
    : `https://www.grailed.com/shop?query=${q}&page=${p}`];
  if (marketplace === "Poshmark") return [`https://poshmark.com/search?query=${q}&type=listings&src=ac&page=${p}`];
  if (marketplace === "Mercari Japan") {
    const status = mode === "sold" ? "sold_out" : "on_sale";
    return [
      `https://jp.mercari.com/en/search?keyword=${q}&status=${status}&page=${p}`,
      `https://jp.mercari.com/search?keyword=${q}&status=${status}&page=${p}`,
    ];
  }
  if (marketplace === "JDirectItems Auction") return [
    `https://zenmarket.jp/en/search.aspx?q=${q}&p=${p}&searchMode=custom&stores=28`,
    `https://zenmarket.jp/en/yahoo.aspx?q=${q}&p=${p}`,
  ];
  if (marketplace === "Rakuten") return [
    `https://zenmarket.jp/en/search.aspx?q=${q}&p=${p}&searchMode=custom&stores=0`,
    `https://search.rakuten.co.jp/search/mall/${q}/?p=${p}`,
  ];
  if (marketplace === "Rakuten Rakuma") return [
    `https://zenmarket.jp/en/search.aspx?q=${q}&p=${p}&searchMode=custom&stores=25`,
    `https://zenmarket.jp/en/rakuma.aspx?q=${q}&p=${p}`,
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

  const id = `rml-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return await new Promise<TextResponse>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      signal?.removeEventListener("abort", onAbort);
      callback();
    };
    const onAbort = () => finish(() => reject(new DOMException("Request cancelled.", "AbortError")));
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window) return;
      const data = event.data as { type?: string; id?: string; response?: BridgeResponse };
      if (data?.type !== "RML_FETCH_RESPONSE" || data.id !== id) return;
      const value = data.response;
      finish(() => {
        if (!value || value.error) {
          reject(new Error(value?.error || "Browser bridge request failed."));
          return;
        }
        resolve({
          ok: Boolean(value.ok),
          status: Number(value.status) || 0,
          url: value.url || url,
          contentType: value.contentType || "",
          text: (value.body || "").slice(0, MAX_RESPONSE_CHARS),
          transport: "extension",
        });
      });
    };
    const timer = window.setTimeout(
      () => finish(() => reject(new Error("Browser bridge is not installed or did not respond."))),
      BRIDGE_TIMEOUT_MS,
    );
    window.addEventListener("message", onMessage);
    signal?.addEventListener("abort", onAbort, { once: true });
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
  try {
    const direct = await directFetchText(url, signal);
    if (direct.ok && direct.text.trim()) return direct;
    failures.push(`direct HTTP ${direct.status}`);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "direct fetch blocked");
  }

  try {
    const bridged = await extensionFetchText(url, signal);
    if (bridged.ok && bridged.text.trim()) return bridged;
    failures.push(`extension HTTP ${bridged.status}`);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "extension bridge unavailable");
  }

  try {
    const reader = await readerFetchText(url, signal);
    if (reader.ok && reader.text.trim()) return reader;
    failures.push(`reader HTTP ${reader.status}`);
  } catch (error) {
    failures.push(error instanceof Error ? error.message : "reader unavailable");
  }

  throw new Error(failures.filter(Boolean).join("; ") || "No browser-readable transport succeeded.");
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

function partialFromRecord(record: Record<string, unknown>, marketplace: Marketplace, base: string) {
  const normalized = normalizePublicListingRecord(record, marketplace, base);
  if (!normalized) return null;
  const image = safeImage(normalized.image, base);
  const price = toUsd(normalized.amount, normalized.currency);
  return {
    id: `${marketplace}-${normalized.rawUrl}`,
    marketplace,
    title: normalized.title,
    brand: normalized.brand || "Unspecified",
    price,
    shipping: 0,
    condition: normalized.condition || "Check listing",
    size: normalized.size || "Unknown",
    articleType: inferApparelType(normalized.title, `${normalized.category} ${normalized.description}`),
    image,
    url: normalized.rawUrl,
    description: [
      normalized.description,
      normalized.currency && normalized.currency !== "USD"
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

function parseJsonScripts(document: Document, marketplace: Marketplace, base: string) {
  const output: Partial<Listing>[] = [];
  for (const script of document.querySelectorAll('script[type="application/ld+json"],script#__NEXT_DATA__,script[type="application/json"]')) {
    const content = script.textContent?.trim();
    if (!content || content.length > 2_000_000) continue;
    try {
      output.push(...recordsFromJson(JSON.parse(content), marketplace, base));
    } catch {
      // Some stores emit multiple JSON fragments; anchors are parsed below.
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

function bestImageFromElement(root: Element, base: string) {
  const image = root.querySelector("img");
  if (!image) return "";
  const srcset = image.getAttribute("srcset") || image.getAttribute("data-srcset") || "";
  const largest = srcset.split(",").map((entry) => entry.trim().split(/\s+/)[0]).filter(Boolean).at(-1) || "";
  return safeImage(
    largest || image.getAttribute("src") || image.getAttribute("data-src") || image.getAttribute("data-original") || "",
    base,
  );
}

function listingFromAnchor(anchor: HTMLAnchorElement, marketplace: Marketplace, base: string) {
  const url = absoluteUrl(anchor.getAttribute("href") || "", base);
  if (!url || !marketplaceHrefPattern(marketplace).test(url)) return null;
  const container = anchor.closest("article,li,[data-testid],[data-item-id],[class*='card'],[class*='item'],[class*='product']") || anchor;
  const visibleText = (container.textContent || anchor.textContent || "").replace(/\s+/g, " ").trim();
  const title = (
    anchor.getAttribute("aria-label") || anchor.getAttribute("title") ||
    container.querySelector("h1,h2,h3,h4,[data-testid*='title'],[class*='title']")?.textContent ||
    visibleText
  ).replace(/\s+/g, " ").trim().slice(0, 320);
  if (!title || title.length < 3) return null;
  const publicPrice = priceFromPublicText(visibleText);
  const price = toUsd(publicPrice.amount, publicPrice.currency || (marketplace === "Rakuten" ? "JPY" : "USD"));
  const image = bestImageFromElement(container, base);
  return {
    id: `${marketplace}-${url}`,
    marketplace,
    title,
    brand: "Unspecified",
    price,
    shipping: 0,
    condition: price > 0 ? "Check listing" : `Price unavailable — open ${marketplace}`,
    size: "Unknown",
    articleType: inferApparelType(title, visibleText),
    image,
    url,
    description: visibleText.slice(0, 900) || "Public listing link discovered in the browser.",
    live: true,
  } satisfies Partial<Listing>;
}

function parseHtml(text: string, marketplace: Marketplace, base: string) {
  const document = new DOMParser().parseFromString(text, "text/html");
  const output = parseJsonScripts(document, marketplace, base);
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    const listing = listingFromAnchor(anchor, marketplace, base);
    if (listing) output.push(listing);
  }

  if (!output.length) {
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href || base;
    const title = document.querySelector<HTMLMetaElement>('meta[property="og:title"]')?.content
      || document.querySelector("h1")?.textContent || document.title;
    const image = safeImage(document.querySelector<HTMLMetaElement>('meta[property="og:image"]')?.content || "", canonical);
    const priceText = document.querySelector<HTMLMetaElement>('meta[property="product:price:amount"]')?.content
      || document.body.textContent || "";
    const publicPrice = priceFromPublicText(priceText);
    if (title && marketplaceHrefPattern(marketplace).test(canonical)) {
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
        description: document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content || "Public product page.",
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
    .map((match) => ({ index: match.index || 0, url: safeImage(match[1], base) }))
    .filter((entry) => entry.url);
  for (const match of text.matchAll(linkPattern)) {
    const url = absoluteUrl(match[2], base);
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
      image: safeImage(String(listing.image || previous.image || ""), key),
      price: Number(listing.price) > 0 ? Number(listing.price) : Number(previous.price) || 0,
      description: String(listing.description || previous.description || ""),
    });
  }
  return [...output.values()].slice(0, limit);
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
  const attempts = await Promise.allSettled(urls.slice(0, marketplace === "Depop" ? 4 : 2).map(async (url) => {
    const response = await fetchReadableText(url, signal);
    return { response, listings: parseResponse(response, marketplace) };
  }));

  const values = attempts.flatMap((attempt) => attempt.status === "fulfilled" ? [attempt.value] : []);
  const listings = dedupeListings(values.flatMap((entry) => entry.listings));
  const transport = [...new Set(values.map((entry) => entry.response.transport))];
  const readerFallbackUsed = transport.includes("reader");
  const sourceUrl = urls[0] || MARKETPLACE_INFO[marketplace].search(query);
  if (listings.length) {
    return {
      marketplace,
      status: "live",
      message: `Loaded ${listings.length} browser-side listing${listings.length === 1 ? "" : "s"} using ${transport.join(" + ")}. Cloudflare did not fetch or parse the marketplace.`,
      sourceUrl,
      listings,
      hasMore: listings.length >= 20,
      diagnostics: {
        transport,
        attemptedUrls: urls,
        readableResponses: values.length,
        extensionBridgeAvailable: extensionBridgeAvailable(),
        readerFallbackUsed,
      },
    };
  }

  const rejected = attempts.flatMap((attempt) => attempt.status === "rejected"
    ? [attempt.reason instanceof Error ? attempt.reason.message : "Request blocked"]
    : []);
  return {
    marketplace,
    status: rejected.length === attempts.length ? "unavailable" : "unavailable",
    message: `The browser could not read ${marketplace}'s cross-origin listing data. Open the live search page directly${extensionBridgeAvailable() ? "; the browser bridge responded but no product cards were readable" : ", or install the included browser bridge for CORS-blocked marketplaces"}.`,
    sourceUrl,
    listings: [],
    hasMore: false,
    diagnostics: {
      transport,
      attemptedUrls: urls,
      readableResponses: values.length,
      extensionBridgeAvailable: extensionBridgeAvailable(),
      readerFallbackUsed,
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
