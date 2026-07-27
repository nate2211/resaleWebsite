import { createHash } from "node:crypto";
import {
  extractPrice,
  extractReferenceProducts,
  normalizeText,
  type ReferenceProduct,
} from "../../lib/authenticity";
import {
  assertPublicHttpsUrl,
  parseWebDocument,
  readPublicWebPage,
  type WebReadResult,
} from "../../lib/safe-web";
import type { Listing, Marketplace } from "../../lib/analysis";

const MAX_RESULTS = 30;
const MAX_READS = 18;
const MAX_RENDERED_BYTES = 1_600_000;

type SearchHit = { title: string; url: string; snippet: string };
type BrowserRunBinding = {
  quickAction(action: "content" | "links", options: Record<string, unknown>): Promise<Response>;
};

const SEARCH_DOMAINS = ["bing.com", "duckduckgo.com", "html.duckduckgo.com", "search.brave.com"] as const;
const SUPPORTED_MARKETPLACE_DOMAINS = [
  "depop.com", "grailed.com", "poshmark.com", "jp.mercari.com",
  "globalbunjang.com", "bunjang.co.kr", "rakuten.co.jp", "rakuma.rakuten.co.jp",
  "zenmarket.jp", "superbuy.com", "goofish.com", "2.taobao.com",
] as const;
const NON_LISTING_DOMAINS = [
  "wikipedia.org", "youtube.com", "youtu.be", "instagram.com",
  "tiktok.com", "pinterest.com", "reddit.com", "x.com", "twitter.com",
] as const;
const AI_SECONDHAND_SOURCES = [
  {
    name: "eBay",
    domain: "ebay.com",
    search: (query: string) => `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(query)}&_sacat=0`,
    itemPath: /^\/(?:itm|p)\//i,
  },
  {
    name: "Mercari US",
    domain: "mercari.com",
    search: (query: string) => `https://www.mercari.com/search/?keyword=${encodeURIComponent(query)}`,
    itemPath: /^\/us\/item\//i,
  },
  {
    name: "Facebook Marketplace",
    domain: "facebook.com",
    search: (query: string) => `https://www.facebook.com/marketplace/category/search/?query=${encodeURIComponent(query)}`,
    itemPath: /^\/marketplace\/item\//i,
  },
] as const;
const NEGATIVE_SUPPORTED_SITES = SUPPORTED_MARKETPLACE_DOMAINS
  .map((domain) => `-site:${domain}`)
  .join(" ");

function hostname(value: string) {
  try { return new URL(value).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return ""; }
}

function hostMatches(host: string, domains: readonly string[]) {
  return domains.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

function supportedMarketplaceUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    // Mercari US is intentionally an AI Search target. Only the dedicated
    // Japanese host belongs to the built-in Mercari Japan adapter.
    if (host === "jp.mercari.com") return true;
    return hostMatches(host, SUPPORTED_MARKETPLACE_DOMAINS);
  } catch { return false; }
}

function aiSecondhandSource(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return AI_SECONDHAND_SOURCES.find((source) =>
      (host === source.domain || host.endsWith(`.${source.domain}`)) &&
      (source.name !== "Facebook Marketplace" || url.pathname.toLowerCase().startsWith("/marketplace/"))
    );
  } catch { return undefined; }
}

function aiSecondhandItemUrl(value: string) {
  try {
    const url = new URL(value);
    const source = aiSecondhandSource(value);
    return Boolean(source && source.itemPath.test(url.pathname));
  } catch { return false; }
}

function sourceDisplayName(value: string) {
  return aiSecondhandSource(value)?.name || hostname(value);
}

function nonListingUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (host === "facebook.com" || host.endsWith(".facebook.com")) {
      // Permit only public Marketplace search/item URLs. Profiles, groups,
      // posts, and the rest of Facebook remain outside AI listing discovery.
      return !url.pathname.toLowerCase().startsWith("/marketplace/");
    }
    return hostMatches(host, NON_LISTING_DOMAINS);
  } catch { return true; }
}

function likelyProductUrl(value: string) {
  try {
    const url = new URL(value);
    const path = `${url.pathname}${url.search}`.toLowerCase();
    if (aiSecondhandItemUrl(value)) return true;
    if (/\/(?:blog|blogs|news|article|articles|editorial|guide|help|search)(?:\/|$|\?)/.test(path)) return false;
    return /\/(?:products?|items?|listing|listings|shop|store|p|dp|itm)\//.test(path) ||
      /(?:sku|product|item|variant|pid|id)=/.test(path) ||
      path.split("/").filter(Boolean).length >= 2;
  } catch { return false; }
}

declare global {
  // Deterministic test injection. Production reads the native BROWSER binding.
  // eslint-disable-next-line no-var
  var __RML_WEB_BROWSER__: BrowserRunBinding | undefined;
}

function response(payload: Record<string, unknown>, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function cleanText(value: string) {
  return normalizeText(value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " "));
}

function dedupeSearchHits(values: SearchHit[]) {
  const found = new Map<string, SearchHit>();
  const score = (item: SearchHit) =>
    (fallbackPrice(`${item.title} ${item.snippet}`) ? 1_000 : 0) +
    item.title.length + item.snippet.length;
  for (const item of values) {
    const current = found.get(item.url);
    if (!current || score(item) > score(current)) found.set(item.url, item);
  }
  return [...found.values()];
}

function decodeEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function absolute(value: string, base: string) {
  try { return new URL(decodeEntities(value), base).toString(); } catch { return ""; }
}

function marketplaceForUrl(value: string): Marketplace {
  let url: URL;
  try { url = new URL(value); } catch { return "Depop"; }
  const host = url.hostname.toLowerCase();
  const path = url.pathname.toLowerCase();
  const stores = url.searchParams.get("stores");
  if (host.endsWith("grailed.com")) return "Grailed";
  if (host.endsWith("poshmark.com")) return "Poshmark";
  if (host.endsWith("depop.com")) return "Depop";
  if (host === "jp.mercari.com") return "Mercari Japan";
  if (host.endsWith("globalbunjang.com") || host.endsWith("bunjang.co.kr")) return "Bunjang";
  if (host.endsWith("rakuten.co.jp")) return "Rakuten";
  if (host.includes("rakuma") || path.includes("rakuma") || stores === "25") return "Rakuten Rakuma";
  if (host.endsWith("zenmarket.jp")) {
    if (path.includes("rakutenproduct") || stores === "0") return "Rakuten";
    if (path.includes("rakuma")) return "Rakuten Rakuma";
    return "JDirectItems Auction";
  }
  if (host.endsWith("superbuy.com") || host.endsWith("goofish.com") || host.includes("2.taobao.com")) return "Goofish";
  // Unknown shops remain web-discovered sources; Depop is only the internal
  // fee-schedule fallback while sourceName/sourceHost expose the real origin.
  return "Depop";
}

function searchHost(value: string) {
  const host = hostname(value);
  return !host || hostMatches(host, SEARCH_DOMAINS);
}

function decodeBase64Url(value: string) {
  try {
    const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
    return atob(padded);
  } catch { return ""; }
}

function unwrapSearchUrl(value: string, baseUrl: string) {
  let candidate = absolute(value, baseUrl);
  if (!candidate) return "";
  try {
    const url = new URL(candidate);
    for (const key of ["uddg", "url", "target", "dest", "destination", "u"]) {
      const wrapped = url.searchParams.get(key);
      if (!wrapped) continue;
      let decoded = wrapped;
      for (let pass = 0; pass < 3; pass += 1) {
        try {
          const next = decodeURIComponent(decoded);
          if (next === decoded) break;
          decoded = next;
        } catch { break; }
      }
      if (key === "u" && decoded.startsWith("a1")) decoded = decodeBase64Url(decoded.slice(2)) || decoded;
      if (/^https:\/\//i.test(decoded)) return decoded;
    }
  } catch { /* retain direct candidate */ }
  return candidate;
}

function searchHtmlHits(html: string, baseUrl: string) {
  const found = new Map<string, SearchHit>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    const raw = match[1] || match[2] || "";
    const url = unwrapSearchUrl(raw, baseUrl);
    if (!url.startsWith("https://") || searchHost(url)) continue;
    try { assertPublicHttpsUrl(url); } catch { continue; }
    const title = cleanText(match[3]).slice(0, 220);
    if (!title || /^(cached|translate|feedback|sign in)$/i.test(title)) continue;
    const index = match.index ?? 0;
    const context = cleanText(html.slice(Math.max(0, index - 400), Math.min(html.length, index + 1_800))).slice(0, 600);
    found.set(url, { title, url, snippet: context });
  }
  return [...found.values()];
}

async function fetchSearchText(url: string, accept: string) {
  const delays = [250, 700] as const;
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const result = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: accept,
          "Accept-Language": "en-US,en;q=0.8",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
        },
      });
      if ([408, 425, 429, 500, 502, 503, 504].includes(result.status) && attempt < delays.length) {
        await result.body?.cancel().catch(() => undefined);
        await new Promise<void>((resolve) => setTimeout(resolve, delays[attempt]));
        continue;
      }
      if (!result.ok) return "";
      return (await result.text()).slice(0, MAX_RENDERED_BYTES);
    } catch {
      if (attempt >= delays.length) return "";
      await new Promise<void>((resolve) => setTimeout(resolve, delays[attempt]));
    } finally {
      clearTimeout(timer);
    }
  }
  return "";
}

async function browserRunBinding() {
  if (globalThis.__RML_WEB_BROWSER__) return globalThis.__RML_WEB_BROWSER__;
  try {
    const runtime = await import("cloudflare:workers");
    return (runtime.env as { BROWSER?: BrowserRunBinding }).BROWSER;
  } catch {
    return undefined;
  }
}

async function renderedHtml(url: string, waitForSelector?: string) {
  assertPublicHttpsUrl(url);
  const browser = await browserRunBinding();
  if (!browser) return "";
  const baseOptions = {
    url,
    gotoOptions: { waitUntil: "networkidle2", timeout: 30_000 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
    rejectResourceTypes: ["font", "media"],
  };
  try {
    const result = await browser.quickAction("content", {
      ...baseOptions,
      ...(waitForSelector
        ? { waitForSelector: { selector: waitForSelector, visible: true, timeout: 18_000 } }
        : { waitForTimeout: 4_000 }),
    });
    if (!result.ok) return "";
    return (await result.text()).slice(0, MAX_RENDERED_BYTES);
  } catch {
    const result = await browser.quickAction("content", { ...baseOptions, waitForTimeout: 8_000 });
    if (!result.ok) return "";
    return (await result.text()).slice(0, MAX_RENDERED_BYTES);
  }
}

async function renderedLinks(url: string) {
  assertPublicHttpsUrl(url);
  const browser = await browserRunBinding();
  if (!browser) return [] as string[];
  try {
    const response = await browser.quickAction("links", {
      url,
      gotoOptions: { waitUntil: "networkidle2", timeout: 30_000 },
      waitForTimeout: 3_000,
      visibleLinksOnly: false,
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
    });
    if (!response.ok) return [];
    const value = await response.json().catch(() => [] as unknown);
    const links = Array.isArray(value)
      ? value
      : value && typeof value === "object" && Array.isArray((value as { result?: unknown[] }).result)
        ? (value as { result: unknown[] }).result
        : [];
    return links.map(String).filter((candidate) => candidate.startsWith("https://"));
  } catch {
    return [];
  }
}

async function staticSearch(query: string) {
  const encoded = encodeURIComponent(query);
  const requests = [
    (async () => {
      const xml = await fetchSearchText(
        `https://www.bing.com/search?format=rss&count=25&q=${encoded}`,
        "application/rss+xml,text/xml",
      );
      return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].map((match) => {
        const item = match[1];
        return {
          title: cleanText(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || ""),
          url: cleanText(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || ""),
          snippet: cleanText(item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || ""),
        };
      });
    })(),
    (async () => {
      const url = `https://www.bing.com/search?q=${encoded}&count=25`;
      return searchHtmlHits(await fetchSearchText(url, "text/html"), url);
    })(),
    (async () => {
      const url = `https://html.duckduckgo.com/html/?q=${encoded}`;
      return searchHtmlHits(await fetchSearchText(url, "text/html"), url);
    })(),
    (async () => {
      const url = `https://search.brave.com/search?q=${encoded}&source=web`;
      return searchHtmlHits(await fetchSearchText(url, "text/html"), url);
    })(),
  ];
  const settled = await Promise.allSettled(requests);
  return settled.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
}

async function renderedSearch(query: string) {
  if (!await browserRunBinding()) return [] as SearchHit[];
  const encoded = encodeURIComponent(query);
  const urls = [
    `https://www.bing.com/search?q=${encoded}&count=25`,
    `https://html.duckduckgo.com/html/?q=${encoded}`,
  ];
  const settled = await Promise.allSettled(urls.map(async (url) => {
    const [html, links] = await Promise.all([
      renderedHtml(url),
      renderedLinks(url),
    ]);
    const htmlHits = searchHtmlHits(html, url);
    const linkHits = links
      .map((candidate) => unwrapSearchUrl(candidate, url))
      .filter((candidate) => candidate.startsWith("https://") && !searchHost(candidate))
      .map((candidate) => ({
        title: hostname(candidate),
        url: candidate,
        snippet: "Public product link discovered from a fully rendered search page.",
      }));
    return [...new Map([...htmlHits, ...linkHits].map((item) => [item.url, item])).values()];
  }));
  return settled.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
}

async function directSecondhandSearch(query: string) {
  const settled = await Promise.allSettled(AI_SECONDHAND_SOURCES.map(async (source) => {
    const searchUrl = source.search(query);
    const [staticHtml, browserHtml, browserLinks] = await Promise.all([
      fetchSearchText(searchUrl, "text/html"),
      renderedHtml(searchUrl),
      renderedLinks(searchUrl),
    ]);
    const candidates = [
      ...searchHtmlHits(staticHtml, searchUrl),
      ...searchHtmlHits(browserHtml, searchUrl),
      ...browserLinks.map((url) => ({
        title: `${source.name} public listing`,
        url: unwrapSearchUrl(url, searchUrl),
        snippet: `Public product link discovered from the rendered ${source.name} search page.`,
      })),
    ];
    return candidates.filter((item) => {
      try {
        const parsed = new URL(item.url);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
        return (host === source.domain || host.endsWith(`.${source.domain}`)) && source.itemPath.test(parsed.pathname);
      } catch { return false; }
    });
  }));
  return dedupeSearchHits(settled
    .flatMap((entry) => entry.status === "fulfilled" ? entry.value : []));
}

async function searchPublicWeb(query: string) {
  const discoveryQuery = `${query} product price buy shop ${NEGATIVE_SUPPORTED_SITES}`;
  const targetedQueries = [
    `site:ebay.com/itm ${query}`,
    `site:mercari.com/us/item ${query}`,
    `site:facebook.com/marketplace/item ${query}`,
  ];
  const [directSecondhand, staticHits, targetedGroups] = await Promise.all([
    directSecondhandSearch(query),
    staticSearch(discoveryQuery),
    Promise.all(targetedQueries.map((targeted) => staticSearch(targeted))),
  ]);
  const combinedStatic = [...staticHits, ...targetedGroups.flat()];
  const browserHits = combinedStatic.length >= 14 ? [] : await renderedSearch(discoveryQuery);
  // Direct secondhand links are first so eBay, Mercari US, and public Facebook
  // Marketplace items are not crowded out by generic retail results.
  return dedupeSearchHits([...directSecondhand, ...combinedStatic, ...browserHits]
    .filter((item) => item.url.startsWith("https://"))
    .filter((item) => !searchHost(item.url) && !supportedMarketplaceUrl(item.url) && !nonListingUrl(item.url)));
}

function fallbackPrice(text: string) {
  const patterns = [
    /(?:US\s*)?\$\s*([\d,]+(?:\.\d{1,2})?)/g,
    /(?:USD)\s*([\d,]+(?:\.\d{1,2})?)/gi,
  ];
  const matches = patterns.flatMap((pattern) => [...text.matchAll(pattern)])
    .map((match) => extractPrice(match[1]))
    .filter((value): value is number => Boolean(value));
  return matches.find((value) => value >= 3 && value <= 100_000);
}

function toUsd(amount: number, currency = "USD") {
  const code = currency.toUpperCase();
  if (code === "JPY" || code === "¥") return amount / 155;
  if (code === "KRW" || code === "₩") return amount / 1380;
  if (code === "CNY" || code === "RMB" || code === "CN¥") return amount / 7.2;
  if (code === "GBP" || code === "£") return amount * 1.29;
  if (code === "EUR" || code === "€") return amount * 1.17;
  if (code === "CAD" || code === "CA$") return amount * 0.73;
  if (code === "AUD" || code === "A$") return amount * 0.66;
  return amount;
}

function inferBrand(title: string, query: string) {
  const queryWords = query.split(/\s+/).filter((word) => word.length > 2);
  const titleWords = title.split(/\s+/).filter((word) => word.length > 2);
  return queryWords.find((word) => titleWords.some((titleWord) =>
    titleWord.toLowerCase() === word.toLowerCase())) || titleWords[0] || "Unspecified";
}

function publicListingDate(raw: string) {
  const patterns: [string, RegExp][] = [
    ["dateCreated", /["']dateCreated["']\s*:\s*["']([^"']+)["']/i],
    ["datePublished", /["']datePublished["']\s*:\s*["']([^"']+)["']/i],
    ["created_at", /["']created_at["']\s*:\s*(?:["']([^"']+)["']|(\d{10,13}))/i],
    ["listed_at", /["']listed_at["']\s*:\s*(?:["']([^"']+)["']|(\d{10,13}))/i],
    ["article:published_time", /property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i],
  ];
  for (const [source, pattern] of patterns) {
    const match = raw.match(pattern);
    const value = match?.[1] || match?.[2];
    if (!value) continue;
    const numeric = /^\d{10,13}$/.test(value) ? Number(value) : Number.NaN;
    const date = Number.isFinite(numeric)
      ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
      : new Date(value);
    if (!Number.isNaN(date.getTime())) return { listedAt: date.toISOString(), dateSource: `public ${source}` };
  }
  return {};
}

function listingId(url: string) {
  return `web-${createHash("sha1").update(url).digest("hex").slice(0, 16)}`;
}

function likelyJavascriptShop(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return [
      "depop.com", "grailed.com", "poshmark.com", "mercari.com", "ebay.com", "facebook.com",
      "rakuten.co.jp", "zenmarket.jp", "globalbunjang.com", "bunjang.co.kr",
    ].some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch { return false; }
}

async function readCandidatePage(item: SearchHit) {
  const url = item.url;
  if (supportedMarketplaceUrl(url) || nonListingUrl(url)) return null;
  let page: WebReadResult | null = null;
  try { page = await readPublicWebPage(item.url, true); } catch { page = null; }
  if (page && (supportedMarketplaceUrl(page.finalUrl) || nonListingUrl(page.finalUrl))) return null;
  const staticReferences = page
    ? extractReferenceProducts(page.raw || "", page.finalUrl, new URL(page.finalUrl).hostname, "")
    : [];
  const staticPrice = staticReferences.some((item) => Boolean(item.price))
    || Boolean(page && fallbackPrice(`${page.description} ${page.text.slice(0, 8_000)}`));
  if (!page || likelyJavascriptShop(url) || !staticPrice) {
    try {
      const html = await renderedHtml(url);
      if (html) {
        const finalUrl = page?.finalUrl || url;
        const parsed = parseWebDocument(html, finalUrl);
        const renderedPage: WebReadResult = {
          url,
          finalUrl,
          status: 200,
          contentType: "text/html; rendered=browser-run",
          ...parsed,
          raw: html,
        };
        const renderedReferences = extractReferenceProducts(
          html,
          finalUrl,
          new URL(finalUrl).hostname,
          "",
        );
        if (!page || renderedReferences.length > staticReferences.length ||
          renderedReferences.some((item) => Boolean(item.price))) return renderedPage;
      }
    } catch { /* retain static page */ }
  }
  return page;
}

function referenceListing(
  reference: ReferenceProduct,
  page: WebReadResult,
  query: string,
): Partial<Listing> | null {
  const title = reference.title.trim();
  const rawPrice = reference.price || 0;
  const price = toUsd(rawPrice, reference.currency || "USD");
  if (!title || !price || !reference.url.startsWith("https://")) return null;
  if (supportedMarketplaceUrl(reference.url) || nonListingUrl(reference.url)) return null;
  try { assertPublicHttpsUrl(reference.url); } catch { return null; }
  const sourceHost = new URL(reference.url).hostname.toLowerCase().replace(/^www\./, "");
  const sourceName = sourceDisplayName(reference.url);
  return {
    id: listingId(reference.url),
    title: title.slice(0, 180),
    brand: (reference.brand || inferBrand(title, query)).slice(0, 80),
    marketplace: marketplaceForUrl(reference.url),
    url: reference.url,
    price,
    shipping: 0,
    condition: "Verify on source",
    size: "Unknown",
    sellerRating: 0,
    sellerSales: 0,
    likes: 0,
    ageDays: 0,
    ...publicListingDate(page.raw || ""),
    image: reference.image || "",
    description: (reference.description || page.description || page.text.slice(0, 700)).slice(0, 900),
    compPrices: {},
    authenticitySignals: ["Original public source URL retained", "Structured product metadata read when available"],
    riskSignals: ["Verify seller, condition, shipping, returns, and current availability on the source page"],
    live: true,
    sourceName,
    sourceHost,
    webDiscovered: true,
  };
}

function searchEvidenceListing(item: SearchHit, query: string): Partial<Listing> | null {
  if (!aiSecondhandItemUrl(item.url)) return null;
  const price = fallbackPrice(`${item.title} ${item.snippet}`) || 0;
  const title = cleanText(item.title)
    .replace(/(?:US\s*)?\$\s*[\d,]+(?:\.\d{1,2})?.*$/i, "")
    .replace(/\s*[|–—-]\s*(?:eBay|Mercari|Facebook Marketplace).*$/i, "")
    .trim();
  if (!title || !price) return null;
  const sourceHost = hostname(item.url);
  return {
    id: listingId(item.url),
    title: title.slice(0, 180),
    brand: inferBrand(title, query).slice(0, 80),
    marketplace: marketplaceForUrl(item.url),
    url: item.url,
    price,
    shipping: 0,
    condition: "Verify on source",
    size: "Unknown",
    sellerRating: 0,
    sellerSales: 0,
    likes: 0,
    ageDays: 0,
    image: "",
    description: item.snippet.slice(0, 900),
    compPrices: {},
    authenticitySignals: ["Canonical public marketplace item URL retained", "Price observed on the public search result"],
    riskSignals: ["The item detail page did not expose complete public metadata; verify price, availability, seller, shipping, and condition"],
    live: true,
    sourceName: sourceDisplayName(item.url),
    sourceHost,
    webDiscovered: true,
  };
}

async function readHit(item: SearchHit, query: string) {
  try {
    const page = await readCandidatePage(item);
    if (!page || supportedMarketplaceUrl(page.finalUrl) || nonListingUrl(page.finalUrl)) {
      const fallback = searchEvidenceListing(item, query);
      return fallback ? [fallback] : [] as Partial<Listing>[];
    }
    const pageHost = new URL(page.finalUrl).hostname.toLowerCase().replace(/^www\./, "");
    const references = extractReferenceProducts(page.raw || "", page.finalUrl, pageHost, query)
      .sort((left, right) => right.similarity - left.similarity);
    const structured = references
      .map((reference) => referenceListing(reference, page, query))
      .filter((listing): listing is Partial<Listing> => Boolean(listing));
    if (structured.length) return structured.slice(0, 6);

    const title = (page.title || item.title).replace(/\s*[|–—-]\s*[^|–—-]{2,40}$/, "").trim();
    const description = page.description || item.snippet || page.text.slice(0, 500);
    const pageIsAccessShell = /(?:log in|sign up|login to continue|create new account)/i.test(
      `${page.title} ${page.description} ${page.text.slice(0, 1_000)}`,
    );
    if (pageIsAccessShell && aiSecondhandItemUrl(item.url)) {
      const fallback = searchEvidenceListing(item, query);
      if (fallback) return [fallback];
    }
    const price = fallbackPrice(`${page.description} ${page.text.slice(0, 8_000)} ${item.title} ${item.snippet}`) || 0;
    if (!title || !price || !likelyProductUrl(page.finalUrl)) {
      const fallback = searchEvidenceListing(item, query);
      return fallback ? [fallback] : [];
    }
    const listing: Partial<Listing> = {
      id: listingId(page.finalUrl),
      title: title.slice(0, 180),
      brand: inferBrand(title, query).slice(0, 80),
      marketplace: marketplaceForUrl(page.finalUrl),
      url: page.finalUrl,
      price,
      shipping: 0,
      condition: "Verify on source",
      size: "Unknown",
      sellerRating: 0,
      sellerSales: 0,
      likes: 0,
      ageDays: 0,
      ...publicListingDate(page.raw || ""),
      image: "",
      description: description.slice(0, 900),
      compPrices: {},
      authenticitySignals: ["Original public source URL retained"],
      riskSignals: ["Verify seller, condition, shipping, returns, and current availability on the source page"],
      live: true,
      sourceName: sourceDisplayName(page.finalUrl),
      sourceHost: pageHost,
      webDiscovered: true,
    };
    return [listing];
  } catch {
    const fallback = searchEvidenceListing(item, query);
    return fallback ? [fallback] : [] as Partial<Listing>[];
  }
}

function diversifyListings(listings: Partial<Listing>[], maximum = 24) {
  const perHost = new Map<string, number>();
  const output: Partial<Listing>[] = [];
  for (const listing of listings) {
    const url = String(listing.url || "");
    const host = hostname(url);
    if (!url || !host || supportedMarketplaceUrl(url) || nonListingUrl(url)) continue;
    const current = perHost.get(host) || 0;
    if (current >= 4) continue;
    perHost.set(host, current + 1);
    output.push(listing);
    if (output.length >= maximum) break;
  }
  return output;
}

async function mapWithConcurrency<T, R>(
  values: readonly T[],
  concurrency: number,
  worker: (value: T, index: number) => Promise<R>,
) {
  const output = new Array<R>(values.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await worker(values[index], index);
    }
  });
  await Promise.all(runners);
  return output;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    query?: string;
    queries?: string[];
  };
  try {
    const query = String(body.query || "").trim().slice(0, 160);
    if (!query) return response({ error: "A listing search query is required." }, 400);
    const modelQueries = Array.isArray(body.queries)
      ? body.queries.map((value) => String(value).trim().slice(0, 160)).filter(Boolean)
      : [];
    const searches = [...new Set([
      query,
      ...modelQueries,
      `${query} buy listing price`,
      `${query} shop sale`,
      `"${query}" resale listing`,
    ].map((value) => value.replace(/\s+/g, " ").trim()))].slice(0, 5);

    const groups = await mapWithConcurrency(searches, 2, async (search) => {
      try { return await searchPublicWeb(search); }
      catch { return [] as SearchHit[]; }
    });
    const discovered = [...new Map(groups
      .flatMap((entry) => entry)
      .map((item) => [item.url, item])).values()]
      .filter((item) => {
        try {
          assertPublicHttpsUrl(item.url);
          return !searchHost(item.url) && !supportedMarketplaceUrl(item.url) && !nonListingUrl(item.url);
        } catch {
          return false;
        }
      })
      .slice(0, MAX_RESULTS);

    const reads = await mapWithConcurrency(
      discovered.slice(0, MAX_READS),
      4,
      (item) => readHit(item, query),
    );
    const unique = [...new Map(reads.flat()
      .filter((item) => item.url && item.price && !supportedMarketplaceUrl(String(item.url)))
      .map((item) => [String(item.url), item])).values()];
    const listings = diversifyListings(unique, 24);
    const browserBindingAvailable = Boolean(await browserRunBinding());

    return response({
      query,
      searches,
      listings,
      discoveredCount: discovered.length,
      readCount: listings.length,
      sourceCount: new Set(listings.map((item) => item.sourceHost || hostname(String(item.url || "")))).size,
      excludedSupportedDomains: [...SUPPORTED_MARKETPLACE_DOMAINS],
      targetedSecondhandSources: AI_SECONDHAND_SOURCES.map((source) => source.name),
      browserBindingAvailable,
      discoveryMode: browserBindingAvailable
        ? "static search plus Cloudflare Browser Run rendered discovery"
        : "static public search and HTML reading",
      policy: "Public HTTPS pages only. AI Search returns priced public pages from outside stores plus eBay, Mercari US, and public Facebook Marketplace items. No login, private-network access, CAPTCHA bypass, or authentication circumvention.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The public listing search failed.";
    return response({ error: message }, /required|public|HTTPS|blocked|domain|credential/i.test(message) ? 400 : 502);
  }
}
