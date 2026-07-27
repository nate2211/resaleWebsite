import { createHash } from "node:crypto";
import { extractMarketplaceEngagement, type EngagementMarketplace, type EngagementReport } from "../../lib/engagement";
import { apparelSearchTerm, inferApparelType, type ApparelType } from "../../lib/apparel";
import { normalizePublicListingRecord, priceFromPublicText } from "../../lib/public-listing-record";

type Marketplace =
  | "Depop" | "Grailed" | "Poshmark" | "Mercari Japan"
  | "JDirectItems Auction" | "Rakuten" | "Rakuten Rakuma"
  | "Bunjang" | "Goofish";
type ImportCosts = {
  proxyFee: number; domesticShipping: number; internationalShipping: number;
  customsReserve: number; currencyConversion: number; total: number;
  origin: "Japan" | "South Korea" | "China"; note: string;
};
type Card = {
  id: string; marketplace: Marketplace; title: string; brand: string;
  price: number; shipping: number; condition: string; size: string; articleType?: ApparelType;
  image: string; url: string; description: string;
  sellerRating?: number; sellerSales?: number; likes?: number; ageDays?: number;
  listedAt?: string; dateSource?: string;
  engagement?: EngagementReport;
  importCosts?: ImportCosts;
  proxyUrl?: string;
};

type DiscoveredItem = {
  url: string;
  title: string;
  description: string;
  publicPrice?: number;
  publicCurrency?: string;
  image?: string;
};

type BrowserRunBinding = {
  quickAction(action: "content" | "links", options: Record<string, unknown>): Promise<Response>;
};

type BrowserRenderedBatch = {
  url: string;
  items: DiscoveredItem[];
};

declare global {
  // Test-only injection point. Production and Cloudflare-enabled development
  // read the binding from the native `cloudflare:workers` environment below.
  // eslint-disable-next-line no-var
  var __RML_BROWSER__: BrowserRunBinding | undefined;
}

const MARKETS: Marketplace[] = [
  "Depop", "Grailed", "Poshmark", "Mercari Japan", "JDirectItems Auction",
  "Rakuten", "Rakuten Rakuma", "Bunjang", "Goofish",
];
const ZENMARKET_MARKETS = ["JDirectItems Auction", "Rakuten", "Rakuten Rakuma"] as const;
const ZENMARKET_ADAPTER = {
  "JDirectItems Auction": { storeCode: "28", route: "yahoo.aspx" },
  Rakuten: { storeCode: "0", route: "search.aspx" },
  "Rakuten Rakuma": { storeCode: "25", route: "rakuma.aspx" },
} as const;
const cache = new Map<string, { until: number; value: unknown }>();
let zenMarketBrowserActive = 0;
const zenMarketBrowserWaiters: Array<() => void> = [];

async function withZenMarketBrowserSlot<T>(task: () => Promise<T>) {
  if (zenMarketBrowserActive >= 2) {
    await new Promise<void>((resolve) => zenMarketBrowserWaiters.push(resolve));
  }
  zenMarketBrowserActive += 1;
  try {
    return await task();
  } finally {
    zenMarketBrowserActive -= 1;
    zenMarketBrowserWaiters.shift()?.();
  }
}
const MAX_HTML = 4_500_000;
let grailedSearchConfig: {
  until: number; appId: string; apiKey: string;
} | null = null;
// Public browser-search values exposed by Grailed's __NEXT_DATA__. They are
// refreshed from the live page first; this snapshot keeps research working
// when the initial HTML is a bot-check shell. It is not an account credential.
const GRAILED_PUBLIC_SEARCH_FALLBACK = {
  appId: "MNRWEFSS2Q",
  apiKey: "c89dbaddf15fe70e1941a109bf7c2a3d",
};


function engagementFields(report?: EngagementReport) {
  if (!report) return {};
  return {
    engagement: report,
    ...(report.metrics.likes !== undefined ? { likes: report.metrics.likes } : {}),
    ...(report.ageDays !== undefined ? { ageDays: report.ageDays } : {}),
    ...(report.seller.rating !== undefined ? { sellerRating: report.seller.rating } : {}),
    ...(report.seller.itemsSold !== undefined ? { sellerSales: report.seller.itemsSold } : {}),
  };
}

function recordEngagement(record: Record<string, unknown>, marketplace: Marketplace, url: string) {
  if (!["Depop", "Grailed", "Poshmark"].includes(marketplace)) return undefined;
  try {
    return extractMarketplaceEngagement(
      JSON.stringify(record),
      url,
      marketplace as EngagementMarketplace,
    );
  } catch {
    return undefined;
  }
}

function reply(value: unknown, status = 200) {
  // Marketplace availability changes quickly, and an empty response must never
  // be cached by the browser or Cloudflare for minutes after a source recovers.
  // Keep the small in-process cache below, but force every client request to
  // revalidate against this route.
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "cdn-cache-control": "no-store",
      "cloudflare-cdn-cache-control": "no-store",
    },
  });
}

/**
 * Public marketplace search pages change more often than product pages. Keep
 * multiple official entry points for sources that render their catalog with
 * client-side JavaScript, then merge and hydrate the product URLs we find.
 */
function slugifySearch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

type SuperbuySearchVariant = "catalog" | "fleamarket";

/**
 * Superbuy's current search page uses the same URL contract exposed by its
 * homepage search control: `nTag=Home-search`, `from=search-input`, and the
 * user's text in `keyword`. The HTML source does not expose `_search`,
 * `position`, or a `platform` selector, so do not manufacture those values.
 *
 * The catalog route is the real keyword-results page. The second-hand route is
 * retained as a bounded Xianyu-aware fallback because Superbuy identifies it
 * as the official entry point for used-item purchasing.
 */
function superbuySearchUrl(
  query: string,
  page = 0,
  variant: SuperbuySearchVariant = "catalog",
) {
  const params = new URLSearchParams({
    nTag: "Home-search",
    from: "search-input",
    keyword: query,
  });
  if (page > 0) params.set("page", String(page + 1));
  const route = variant === "fleamarket" ? "fleamarket" : "search";
  return `https://www.superbuy.com/en/page/${route}/?${params.toString()}`;
}

function superbuySearchUrls(query: string, page = 0) {
  return [
    // Goofish/Xianyu is a second-hand marketplace, so give Superbuy's
    // dedicated second-hand entry point the first opportunity to render cards.
    superbuySearchUrl(query, page, "fleamarket"),
    superbuySearchUrl(query, page, "catalog"),
  ];
}

function superbuyProxyUrl(sourceUrl: string) {
  const params = new URLSearchParams({
    from: "search-input",
    nTag: "Home-search",
    url: sourceUrl,
  });
  return `https://www.superbuy.com/en/page/buy/selfservice/?${params.toString()}`;
}

function sourceSearchCandidates(
  marketplace: Marketplace,
  query: string,
  mode: "active" | "sold" = "active",
  page = 0,
) {
  const q = encodeURIComponent(query);
  const p = String(page + 1);
  if (marketplace === "Depop") {
    const slug = slugifySearch(query);
    return [
      `https://www.depop.com/search/?q=${q}&page=${p}`,
      ...(slug ? [`https://www.depop.com/brands/${slug}/?page=${p}`] : []),
      ...(slug ? [`https://www.depop.com/theme/${slug}/?page=${p}`] : []),
    ];
  }
  if (marketplace === "Grailed" && mode === "sold") return [`https://www.grailed.com/sold?query=${q}&page=${p}`];
  if (marketplace === "Grailed") return [`https://www.grailed.com/shop?query=${q}&page=${p}`];
  if (marketplace === "Poshmark") return [`https://poshmark.com/search?query=${q}&type=listings&src=ac&page=${p}`];
  if (marketplace === "Mercari Japan") {
    const status = mode === "sold" ? "sold_out" : "on_sale";
    return [
      `https://jp.mercari.com/en/search?keyword=${q}&status=${status}&page=${p}`,
      `https://jp.mercari.com/search?keyword=${q}&status=${status}&page=${p}`,
      `https://jp.mercari.com/en/search?keyword=${q}&status=${status}`,
    ];
  }
  if (marketplace === "JDirectItems Auction") {
    return [
      `https://zenmarket.jp/en/yahoo.aspx?q=${q}&p=${p}`,
      `https://zenmarket.jp/en/search.aspx?q=${q}&p=${p}&searchMode=custom&stores=28`,
      `https://auctions.yahoo.co.jp/search/search?p=${q}&b=${page * 50 + 1}&n=50`,
    ];
  }
  if (marketplace === "Rakuten") {
    return [
      // ZenMarket's current Rakuten search source declares this exact canonical
      // query and store selector. Keep it first so proxy links and prices come
      // from the route the user sees in ZenMarket.
      `https://zenmarket.jp/en/search.aspx?q=${q}&p=${p}&searchMode=custom&stores=0`,
      // Rakuten's public search remains a useful original-market fallback and
      // exposes canonical item.rakuten.co.jp product links in rendered cards.
      `https://search.rakuten.co.jp/search/mall/${q}/?p=${p}`,
    ];
  }
  if (marketplace === "Rakuten Rakuma") {
    return [
      `https://zenmarket.jp/en/rakuma.aspx?q=${q}&p=${p}`,
      `https://zenmarket.jp/en/search.aspx?q=${q}&p=${p}&searchMode=custom&stores=25`,
      `https://fril.jp/s?query=${q}&page=${p}`,
    ];
  }
  if (marketplace === "Bunjang") return [`https://globalbunjang.com/search?q=${q}&page=${p}`];
  return [
    // Exhaust Superbuy's verified catalog and second-hand query routes before
    // touching Goofish directly. This keeps Superbuy as the primary discovery
    // path while retaining a bounded public fallback.
    ...superbuySearchUrls(query, page),
    `https://www.goofish.com/search?q=${q}&page=${p}`,
  ];
}

function sourceSearch(marketplace: Marketplace, query: string, mode: "active" | "sold" = "active") {
  return sourceSearchCandidates(marketplace, query, mode, 0)[0];
}

function listingPath(marketplace: Marketplace) {
  if (marketplace === "Depop") return "depop.com/products/";
  if (marketplace === "Grailed") return "grailed.com/listings/";
  if (marketplace === "Poshmark") return "poshmark.com/listing/";
  if (marketplace === "Mercari Japan") return "jp.mercari.com/item/";
  if (marketplace === "Bunjang") return "globalbunjang.com/product/";
  if (marketplace === "Goofish") return "goofish.com/item";
  return "zenmarket.jp";
}

function cleanUrl(value: string, marketplace: Marketplace): string {
  try {
    const url = new URL(value.replaceAll("&amp;", "&"));
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (url.protocol !== "https:") return "";
    if (marketplace === "Depop") {
      if (!host.endsWith("depop.com") || !/^\/products\/[^/]+\/?$/i.test(path)) return "";
      if (/^\/products\/(?:create|manage)\/?$/i.test(path)) return "";
      url.search = "";
      if (!url.pathname.endsWith("/")) url.pathname += "/";
    }
    if (marketplace === "Grailed" && (!host.endsWith("grailed.com") || !path.includes("/listings/"))) return "";
    if (marketplace === "Poshmark" && (!host.endsWith("poshmark.com") || !path.includes("/listing/"))) return "";
    if (marketplace === "Mercari Japan" && (host !== "jp.mercari.com" || !path.includes("/item/"))) return "";
    if (marketplace === "Bunjang" && (!host.endsWith("globalbunjang.com") || !path.includes("/product/"))) return "";
    if (marketplace === "Goofish") {
      if (host.endsWith("superbuy.com")) {
        for (const key of [
          "url", "itemUrl", "item_url", "goodsUrl", "goods_url", "productUrl",
          "product_url", "originUrl", "origin_url", "sourceUrl", "source_url", "link",
        ]) {
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
          const unwrapped: string = cleanUrl(decoded.replaceAll("\\/", "/"), marketplace);
          if (unwrapped) return unwrapped;
        }
        // Some Superbuy routes embed the original marketplace URL in a hash,
        // serialized state, or another encoded query value instead of a stable
        // `url=` parameter. Recover that canonical Xianyu/Goofish link before
        // rejecting the wrapper.
        let serialized = url.toString().replaceAll("&amp;", "&").replaceAll("\\/", "/");
        for (let pass = 0; pass < 3; pass += 1) {
          try {
            const next = decodeURIComponent(serialized);
            if (next === serialized) break;
            serialized = next;
          } catch { break; }
        }
        const embedded = serialized.match(/https?:\/\/(?:www\.)?goofish\.com\/item\?[^#"'\s<>]*\bid=\d{6,}/i)?.[0]
          || serialized.match(/https?:\/\/2\.taobao\.com\/item\.htm\?[^#"'\s<>]*\bid=\d{6,}/i)?.[0];
        if (embedded) {
          const unwrapped: string = cleanUrl(embedded, marketplace);
          if (unwrapped) return unwrapped;
        }
        const platform = [
          url.searchParams.get("platform"), url.searchParams.get("source"),
          url.searchParams.get("site"), url.searchParams.get("channel"),
          path.includes("fleamarket") ? "xianyu" : "",
        ].filter(Boolean).join(" ").toLowerCase();
        const wrappedId = [
          "itemId", "item_id", "itemIdStr", "item_id_str", "numIid", "num_iid",
          "goodsId", "goods_id", "productId", "product_id", "offerId", "offer_id", "id",
        ]
          .map((key) => url.searchParams.get(key))
          .find((value) => /^\d{6,}$/.test(value || ""));
        if (wrappedId && /(?:^|\b)(?:xy|xianyu|goofish)(?:\b|$)/i.test(platform)) {
          return `https://www.goofish.com/item?id=${wrappedId}`;
        }
        return "";
      }
      const goofishItem = host.endsWith("goofish.com") && path === "/item" && Boolean(url.searchParams.get("id"));
      const legacyXianyu = host === "2.taobao.com" && path.endsWith("/item.htm") && Boolean(url.searchParams.get("id"));
      if (!goofishItem && !legacyXianyu) return "";
      if (legacyXianyu) {
        const id = url.searchParams.get("id");
        url.hostname = "www.goofish.com";
        url.pathname = "/item";
        url.search = "";
        if (id) url.searchParams.set("id", id);
      }
    }
    if (["JDirectItems Auction", "Rakuten", "Rakuten Rakuma"].includes(marketplace)) {
      const zenHost = host.endsWith("zenmarket.jp");
      const itemParameter = ["itemCode", "itemcode", "auctionid", "auctionId", "productid", "productId", "id"]
        .some((key) => url.searchParams.has(key));
      // Keep each ZenMarket adapter on its own product-detail route. The search
      // shell contains hundreds of category/navigation URLs (including
      // mercari.aspx?c=...), which must never count as Rakuten listing cards.
      const zenProduct = zenHost && itemParameter && (
        marketplace === "JDirectItems Auction"
          ? path.includes("/auction.aspx")
          : marketplace === "Rakuten"
            ? path.includes("/rakutenproduct.aspx")
            : path.includes("/rakumaproduct.aspx")
      );
      const originalProduct = marketplace === "JDirectItems Auction"
        ? (host.endsWith("auctions.yahoo.co.jp") && /\/auction\//.test(path))
        : marketplace === "Rakuten"
          ? host === "item.rakuten.co.jp"
          : host === "item.fril.jp" || (host.endsWith("fril.jp") && /\/item\//.test(path));
      if (!zenProduct && !originalProduct) return "";
      if (marketplace === "Rakuten" && host === "item.rakuten.co.jp") {
        const segments = url.pathname.split("/").filter(Boolean);
        // Canonical Rakuten product URLs contain both a shop and item segment.
        // Search snippets such as /un or /atlanti are truncated evidence and
        // must not become cards because they cannot hydrate an image or detail.
        if (segments.length < 2 || segments.some((segment) => segment.length < 2)) return "";
      }
    }
    url.hash = "";
    url.searchParams.delete("srsltid");
    return url.toString();
  } catch {
    return "";
  }
}

function text(value: unknown) {
  return typeof value === "string"
    ? value.replace(/<[^>]*>/g, " ").replaceAll("&amp;", "&").replaceAll("&quot;", '"')
      .replaceAll("&#x27;", "'").replaceAll("&#39;", "'").replaceAll("&apos;", "'")
      .replaceAll("&lt;", "<").replaceAll("&gt;", ">")
      .replaceAll("&yen;", "¥").replaceAll("&#165;", "¥").replaceAll("&#xA5;", "¥")
      .replaceAll("&euro;", "€").replaceAll("&pound;", "£")
      .replace(/\s+/g, " ").trim()
    : "";
}

function number(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function money(value: unknown): { amount: number; currency: string } {
  const record = objectRecord(value);
  if (!record) return { amount: number(value), currency: "" };
  const currency = text(record.currency) || text(record.currencyCode) || text(record.priceCurrency);
  const cents = number(record.cents) || number(record.minorUnits) || number(record.minor_units);
  if (cents) return { amount: cents / 100, currency };
  return {
    amount: number(record.amount) || number(record.value) || number(record.price)
      || number(record.current) || number(record.formatted),
    currency,
  };
}

function nestedText(value: unknown, ...keys: string[]) {
  const record = objectRecord(value);
  if (!record) return text(value);
  for (const key of keys) {
    const found = text(record[key]);
    if (found) return found;
  }
  return "";
}

function normalizedRecordKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Marketplace JSON changes casing and separators frequently (`itemId`,
 * `item_id`, `ItemID`, etc.). Resolve aliases case-insensitively so a source
 * deployment does not silently erase otherwise valid listing records.
 */
function recordValue(record: Record<string, unknown>, aliases: string[]) {
  const wanted = new Set(aliases.map(normalizedRecordKey));
  for (const [key, value] of Object.entries(record)) {
    if (wanted.has(normalizedRecordKey(key)) && value !== null && value !== undefined && value !== "") {
      return value;
    }
  }
  return undefined;
}

function recordText(record: Record<string, unknown>, aliases: string[]) {
  return text(recordValue(record, aliases));
}

function recordNumber(record: Record<string, unknown>, aliases: string[]) {
  return number(recordValue(record, aliases));
}

function imageFromValue(value: unknown, base: string): string {
  if (typeof value === "string") return absolute(value, base);
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = imageFromValue(child, base);
      if (found) return found;
    }
    return "";
  }
  const record = objectRecord(value);
  if (!record) return "";
  for (const key of ["url", "src", "imageUrl", "image_url", "full", "large", "medium", "original"]) {
    const found = imageFromValue(record[key], base);
    if (found) return found;
  }
  return "";
}

function toUsd(amount: number, currency: string) {
  const code = currency.toUpperCase();
  if (code === "JPY" || code === "¥") return amount / 155;
  if (code === "KRW" || code === "₩") return amount / 1380;
  if (code === "CNY" || code === "RMB" || code === "CN¥") return amount / 7.2;
  return amount;
}

function landedImportCosts(marketplace: Marketplace, itemPrice: number): ImportCosts | undefined {
  if (["Depop", "Grailed", "Poshmark"].includes(marketplace)) return undefined;
  const japan = ["Mercari Japan", "JDirectItems Auction", "Rakuten", "Rakuten Rakuma"].includes(marketplace);
  const korea = marketplace === "Bunjang";
  const origin = japan ? "Japan" : korea ? "South Korea" : "China";
  const proxyFee = ["JDirectItems Auction", "Rakuten", "Rakuten Rakuma"].includes(marketplace)
    ? 500 / 155 : marketplace === "Goofish" ? 20 / 7.2 : 0;
  const domesticShipping = japan ? 7 : korea ? 6 : 4;
  const internationalShipping = japan ? 24 : korea ? 26 : 28;
  const customsRate = japan || korea ? 0.10 : 0.20;
  const customsReserve = itemPrice * customsRate;
  const currencyConversion = itemPrice * 0.03;
  const total = proxyFee + domesticShipping + internationalShipping + customsReserve + currencyConversion;
  return {
    proxyFee, domesticShipping, internationalShipping, customsReserve,
    currencyConversion, total, origin,
    note: "Planning estimate only. Actual carrier charges and U.S. duty depend on parcel weight, origin, material, and HTS classification; duty-free de minimis treatment is not assumed.",
  };
}

function absolute(value: unknown, base: string) {
  if (typeof value !== "string" || !value) return "";
  try { return new URL(value.replaceAll("&amp;", "&"), base).toString(); } catch { return ""; }
}

async function fetchText(url: string, accept: string, timeout = 9_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: accept,
        "Accept-Language": "en-US,en;q=0.9",
        Referer: `${new URL(url).origin}/`,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.text()).slice(0, MAX_HTML);
  } finally {
    clearTimeout(timer);
  }
}

async function browserRunBinding() {
  // Keep the injectable binding for deterministic Node-based adapter tests.
  if (globalThis.__RML_BROWSER__) return globalThis.__RML_BROWSER__;

  // Vinext's supported Cloudflare integration exposes bindings directly from
  // `cloudflare:workers`; a custom Worker entry is neither needed nor used.
  try {
    const runtime = await import("cloudflare:workers");
    const binding = (runtime.env as { BROWSER?: BrowserRunBinding }).BROWSER;
    return binding;
  } catch {
    // Node-only development can continue with ordinary public fetches.
    return undefined;
  }
}

function browserLoadOptions(url: string) {
  const host = new URL(url).hostname.toLowerCase();
  const selector = host.endsWith("depop.com")
    ? 'a[href*="/products/"]'
    : host.endsWith("goofish.com")
      ? 'a[href*="/item?id="],a[href*="goofish.com/item"]'
      : host === "search.rakuten.co.jp"
        ? 'a[href*="item.rakuten.co.jp"]'
        : host.endsWith("zenmarket.jp")
          ? '#productsContainer a.product-item.product-link,#productsContainer a[href*="rakutenproduct.aspx"],#productsContainer a[href*="auction.aspx"],#productsContainer a[href*="rakumaproduct.aspx"],#productsContainer a[href*="item.rakuten.co.jp"]'
          : "";
  const base = {
    url,
    gotoOptions: { waitUntil: "networkidle2", timeout: 30_000 },
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
    rejectResourceTypes: ["font", "media"],
  };
  // Superbuy's 2026 search source is a prerender shell. Its useful product
  // state appears only after client-side requests, and Xianyu cards are not
  // guaranteed to expose one stable selector. A bounded settle delay is more
  // reliable than timing out while waiting for a guessed class name.
  if (host.endsWith("superbuy.com")) return { ...base, waitForTimeout: 9_000 };
  return {
    ...base,
    ...(selector
      ? { waitForSelector: { selector, visible: true, timeout: 22_000 } }
      : { waitForTimeout: 6_000 }),
  };
}

function browserFallbackLoadOptions(url: string) {
  const options = browserLoadOptions(url) as Record<string, unknown>;
  const { waitForSelector: _waitForSelector, ...rest } = options;
  return { ...rest, waitForTimeout: 10_000 };
}

async function browserQuickAction(action: "content" | "links", url: string) {
  const browser = await browserRunBinding();
  if (!browser) return undefined;
  const primaryOptions = {
    ...browserLoadOptions(url),
    ...(action === "links" ? { excludeExternalLinks: false } : {}),
  };
  const fallbackOptions = {
    ...browserFallbackLoadOptions(url),
    ...(action === "links" ? { excludeExternalLinks: false } : {}),
  };
  try {
    return action === "content"
      ? await browser.quickAction("content", primaryOptions)
      : await browser.quickAction("links", primaryOptions);
  } catch {
    // ZenMarket and Rakuten can finish loading even when a product selector is
    // renamed or the query returns zero cards. Retry once after a fixed settle
    // delay so source markup and links can still be inspected.
    return action === "content"
      ? browser.quickAction("content", fallbackOptions)
      : browser.quickAction("links", fallbackOptions);
  }
}

async function fetchRenderedText(url: string) {
  const response = await browserQuickAction("content", url);
  if (!response) return "";
  if (!response.ok) throw new Error(`Browser Run content HTTP ${response.status}`);
  return (await response.text()).slice(0, MAX_HTML);
}

async function fetchRenderedLinks(url: string) {
  const response = await browserQuickAction("links", url);
  if (!response) return [] as string[];
  if (!response.ok) throw new Error(`Browser Run links HTTP ${response.status}`);
  try {
    return [...new Set(renderedLinkValues(await response.json()))];
  } catch {
    return [] as string[];
  }
}

function renderedLinkValues(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) return value.flatMap(renderedLinkValues);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [record.href, record.url, record.link, record.result, record.results]
    .flatMap(renderedLinkValues);
}

function renderedLinksToItems(links: string[], marketplace: Marketplace, sourceUrl: string) {
  const found = new Map<string, DiscoveredItem>();
  for (const candidate of links) {
    const url = cleanUrl(decodeSearchRedirect(candidate, sourceUrl), marketplace);
    if (!url) continue;
    found.set(url, {
      url,
      title: `${marketplace} marketplace listing`,
      description: `Public product link discovered from the fully rendered marketplace results at ${sourceUrl}.`,
    });
  }
  return [...found.values()];
}

function base64UrlBytes(value: Uint8Array) {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlJson(value: unknown) {
  return base64UrlBytes(new TextEncoder().encode(JSON.stringify(value)));
}

/**
 * Mercari's current public web client sends its search request to
 * api.mercari.jp with a short-lived DPoP proof. This proof authenticates the
 * request key, not a Mercari account, and is generated fresh for every search.
 */
async function mercariDpop(url: string, method: string, uuid: string) {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const publicJwk = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
  const header = {
    typ: "dpop+jwt",
    alg: "ES256",
    jwk: { kty: publicJwk.kty, crv: publicJwk.crv, x: publicJwk.x, y: publicJwk.y },
  };
  const payload = {
    iat: Math.floor(Date.now() / 1000),
    jti: crypto.randomUUID(),
    htu: url,
    htm: method.toUpperCase(),
    uuid,
  };
  const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    keyPair.privateKey,
    new TextEncoder().encode(signingInput),
  ));
  return `${signingInput}.${base64UrlBytes(signature)}`;
}

function mercariSearchBody(query: string, mode: "active" | "sold") {
  const status = mode === "sold"
    ? ["STATUS_SOLD_OUT", "STATUS_TRADING"]
    : ["STATUS_ON_SALE"];
  return {
    userId: "",
    pageSize: 120,
    pageToken: "",
    searchSessionId: crypto.randomUUID().replaceAll("-", ""),
    indexRouting: "INDEX_ROUTING_UNSPECIFIED",
    thumbnailTypes: [],
    searchCondition: {
      keyword: query,
      sort: "SORT_SCORE",
      order: "ORDER_DESC",
      status,
      sizeId: [],
      categoryId: [],
      brandId: [],
      sellerId: [],
      priceMin: 0,
      priceMax: 0,
      itemConditionId: [],
      shippingPayerId: [],
      shippingFromArea: [],
      shippingMethod: [],
      colorId: [],
      hasCoupon: false,
      attributes: [],
      itemTypes: [],
      skuIds: [],
      excludeKeyword: "",
    },
    defaultDatasets: [],
    serviceFrom: "suruga",
  };
}

function mercariItemsFromResponse(value: unknown, page: number) {
  const pageUrl = "https://jp.mercari.com/en/search";
  const found = new Map<string, DiscoveredItem>();
  walk(value, (record) => {
    const normalized = normalizePublicListingRecord(record, "Mercari Japan", pageUrl);
    if (!normalized) return;
    const url = cleanUrl(normalized.rawUrl, "Mercari Japan");
    if (!url) return;
    const item: DiscoveredItem = {
      url,
      title: normalized.title,
      description: normalized.description || [normalized.brand, normalized.condition, normalized.size].filter(Boolean).join(" · "),
      publicPrice: normalized.amount,
      publicCurrency: normalized.currency || "JPY",
      image: normalized.image,
    };
    found.set(url, mergeDiscovered(found.get(url), item));
  });
  const all = [...found.values()];
  const start = page * 24;
  return {
    items: all.slice(start, start + 24),
    total: all.length,
    hasMore: all.length > start + 24,
  };
}

async function mercariApiItems(query: string, mode: "active" | "sold", page: number) {
  const endpoint = "https://api.mercari.jp/v2/entities:search";
  const uuid = crypto.randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "application/json",
        "Accept-Language": "en-US,en;q=0.9,ja;q=0.7",
        "Content-Type": "application/json",
        Origin: "https://jp.mercari.com",
        Referer: "https://jp.mercari.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
        "X-Platform": "web",
        DPoP: await mercariDpop(endpoint, "POST", uuid),
      },
      body: JSON.stringify(mercariSearchBody(query, mode)),
    });
    if (!response.ok) throw new Error(`Mercari API HTTP ${response.status}`);
    return mercariItemsFromResponse(await response.json(), page);
  } finally {
    clearTimeout(timer);
  }
}

async function grailedConfig() {
  if (grailedSearchConfig && grailedSearchConfig.until > Date.now()) {
    return grailedSearchConfig;
  }
  try {
    const html = await fetchText("https://www.grailed.com/sold?query=supreme", "text/html,application/xhtml+xml");
    const appId = html.match(/"appId":"([^"]+)"/)?.[1] ?? "";
    const apiKey = html.match(/"publicSearchKey":"([^"]+)"/)?.[1]
      || html.match(/"publicQueryKey":"([^"]+)"/)?.[1]
      || html.match(/"publicBrowseKey":"([^"]+)"/)?.[1] || "";
    if (!appId || !apiKey) {
      grailedSearchConfig = {
        ...GRAILED_PUBLIC_SEARCH_FALLBACK,
        until: Date.now() + 600_000,
      };
      return grailedSearchConfig;
    }
    grailedSearchConfig = { appId, apiKey, until: Date.now() + 3_600_000 };
    return grailedSearchConfig;
  } catch {
    grailedSearchConfig = {
      ...GRAILED_PUBLIC_SEARCH_FALLBACK,
      until: Date.now() + 600_000,
    };
    return grailedSearchConfig;
  }
}


function dateValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  const source = String(value).trim();
  if (typeof value === "number" || /^\d{10,13}$/.test(source)) {
    const raw = Number(value);
    const millis = raw < 10_000_000_000 ? raw * 1000 : raw;
    const parsed = new Date(millis);
    return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
  }
  const relative = source.match(/(\d+)\s*(minute|hour|day|week|month|year)s?\s+ago/i);
  if (relative) {
    const count = Number(relative[1]);
    const unitDays: Record<string, number> = {
      minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30.44, year: 365.25,
    };
    return new Date(Date.now() - count * unitDays[relative[2].toLowerCase()] * 86_400_000).toISOString();
  }
  if (/^today$/i.test(source)) return new Date().toISOString();
  if (/^yesterday$/i.test(source)) return new Date(Date.now() - 86_400_000).toISOString();
  const parsed = new Date(source);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function listingDateFromRecord(record: Record<string, unknown>) {
  const fields: [string, unknown][] = [
    ["created_at", record.created_at], ["createdAt", record.createdAt],
    ["dateCreated", record.dateCreated], ["date_created", record.date_created],
    ["listed_at", record.listed_at], ["listedAt", record.listedAt],
    ["published_at", record.published_at], ["publishedAt", record.publishedAt],
    ["datePublished", record.datePublished], ["publication_date", record.publication_date],
    ["creationDate", record.creationDate], ["creation_date", record.creation_date],
    ["onlineSince", record.onlineSince], ["timestamp", record.timestamp],
  ];
  for (const [source, value] of fields) {
    const listedAt = dateValue(value);
    if (listedAt) return { listedAt, dateSource: `public ${source}` };
  }
  return {};
}

function listingDateFromHtml(html: string, ageDays?: number) {
  const metaDate = meta(html, [
    "article:published_time", "product:release_date", "date", "datepublished",
    "og:published_time", "listing:published_time",
  ]);
  const listedAt = dateValue(metaDate);
  if (listedAt) return { listedAt, dateSource: "public page metadata" };
  const visibleDate = html.match(/(?:Online\s+since|Listed\s+on|Posted\s+on)\s*:?\s*([12]\d{3}-\d{2}-\d{2}|[A-Z][a-z]+\s+\d{1,2},\s+[12]\d{3})/i)?.[1];
  const visibleListedAt = dateValue(visibleDate);
  if (visibleListedAt) return { listedAt: visibleListedAt, dateSource: "public listing details" };
  if (Number.isFinite(ageDays) && Number(ageDays) >= 0) {
    return {
      listedAt: new Date(Date.now() - Number(ageDays) * 86_400_000).toISOString(),
      dateSource: "derived from public listing age",
    };
  }
  return {};
}

function grailedHitCard(record: Record<string, unknown>, mode: "active" | "sold") {
  const id = String(record.id || record.objectID || "");
  const slug = text(record.slug) || text(record.pretty_path).split("/").at(-1) || "";
  const candidateUrl = record.url || record.web_url || record.pretty_path ||
    (id ? `/listings/${id}${slug && !slug.startsWith(id) ? `-${slug}` : slug ? `-${slug.replace(`${id}-`, "")}` : ""}` : "");
  const url = cleanUrl(absolute(candidateUrl, "https://www.grailed.com"), "Grailed");
  const price = mode === "sold"
    ? number(record.sold_price) || number(record.soldPrice) || number(record.price)
    : number(record.price) || number(record.current_price) || number(record.listing_price);
  const title = text(record.title) || text(record.name) || text(record.display_title);
  if (!url || !price || !title) return null;
  const designers = Array.isArray(record.designers)
    ? record.designers.map((value) =>
        typeof value === "object" && value ? text((value as Record<string, unknown>).name) : text(value),
      ).filter(Boolean).join(" × ")
    : "";
  const imageRecord = record.cover_photo && typeof record.cover_photo === "object"
    ? record.cover_photo as Record<string, unknown>
    : null;
  const image = absolute(
    record.image_url || record.image || imageRecord?.url || imageRecord?.original_url,
    url,
  );
  const engagement = recordEngagement(record, "Grailed", url);
  return {
    id: `${mode}-${createHash("sha1").update(url).digest("hex").slice(0, 14)}`,
    marketplace: "Grailed",
    title: title.slice(0, 180),
    brand: designers || text(record.designer_names) || text(record.brand) || "Unspecified",
    price,
    shipping: number(record.shipping_price),
    condition: mode === "sold" ? "Sold" : text(record.condition) || "Check listing",
    size: text(record.size) || text(record.display_size) || "Unknown",
    image,
    url,
    description: mode === "sold"
      ? "Historical sold-price evidence returned by Grailed's public search index."
      : "Active listing returned by Grailed's public search index.",
    ...listingDateFromRecord(record),
    ...engagementFields(engagement),
  } satisfies Card;
}

async function grailedIndexCards(query: string, page: number, mode: "active" | "sold") {
  const config = await grailedConfig();
  if (!config) return [] as Card[];
  const index = mode === "sold" ? "Listing_sold_production" : "Listing_production";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9_000);
  try {
    const response = await fetch(
      `https://${config.appId.toLowerCase()}-dsn.algolia.net/1/indexes/${index}/query`,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-algolia-application-id": config.appId,
          "x-algolia-api-key": config.apiKey,
        },
        body: JSON.stringify({
          query,
          page,
          hitsPerPage: 24,
          typoTolerance: true,
          distinct: true,
          getRankingInfo: true,
        }),
      },
    );
    if (!response.ok) return [];
    const value = await response.json() as { hits?: Record<string, unknown>[] };
    return (value.hits ?? [])
      .map((hit) => grailedHitCard(hit, mode))
      .filter(Boolean) as Card[];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function rssItems(xml: string, marketplace: Marketplace) {
  const found = new Map<string, DiscoveredItem>();
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
    const body = match[1];
    const rawLink = body.match(/<link>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i)?.[1] ?? "";
    const url = cleanUrl(text(rawLink), marketplace);
    if (!url) continue;
    const title = text(body.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i)?.[1]);
    const description = text(body.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/i)?.[1]);
    const publicPrice = priceFromPublicText(`${title} ${description}`);
    const item: DiscoveredItem = {
      url,
      title,
      description,
      ...(publicPrice.amount ? { publicPrice: publicPrice.amount, publicCurrency: publicPrice.currency } : {}),
    };
    found.set(url, mergeDiscovered(found.get(url), item));
  }
  return [...found.values()];
}

function decodeSearchRedirect(value: string, baseUrl: string) {
  let absoluteValue = absolute(decodeEntities(value), baseUrl);
  if (!absoluteValue) return "";
  try {
    const parsed = new URL(absoluteValue);
    for (const key of ["uddg", "url", "u", "target", "dest", "destination"]) {
      const wrapped = parsed.searchParams.get(key);
      if (!wrapped) continue;
      let decoded = wrapped;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
          const next = decodeURIComponent(decoded);
          if (next === decoded) break;
          decoded = next;
        } catch { break; }
      }
      if (/^https?:\/\//i.test(decoded)) return decoded;
    }
  } catch { /* preserve the original absolute URL */ }
  return absoluteValue;
}

/**
 * Public search engines often retain marketplace item links even when a source
 * returns a JavaScript-only shell to Workers. These results are discovery
 * evidence only: product pages are still hydrated when possible and prices are
 * never invented.
 */
function searchResultContext(html: string, index: number) {
  const starts = [
    html.lastIndexOf('<div class="result', index),
    html.lastIndexOf('<div class="web-result', index),
    html.lastIndexOf('<li class="b_algo', index),
    html.lastIndexOf('<div class="b_algo', index),
  ].filter((value) => value >= 0);
  const start = starts.length ? Math.max(...starts) : -1;
  if (start >= 0 && index - start < 8_000) {
    const boundaries = [
      html.indexOf('<div class="result', index + 1),
      html.indexOf('<div class="web-result', index + 1),
      html.indexOf('<li class="b_algo', index + 1),
      html.indexOf('<div class="b_algo', index + 1),
    ].filter((value) => value > index);
    const end = boundaries.length ? Math.min(...boundaries) : Math.min(html.length, start + 12_000);
    return html.slice(start, end);
  }
  return contextForUrl(html, index);
}

function searchHtmlItems(html: string, marketplace: Marketplace, baseUrl: string) {
  const found = new Map<string, DiscoveredItem>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    const rawHref = match[1] || match[2] || "";
    const target = decodeSearchRedirect(rawHref, baseUrl);
    const url = cleanUrl(target, marketplace);
    if (!url) continue;
    const context = searchResultContext(html, match.index ?? 0);
    const title = text(match[3])
      || text(context.match(/(?:aria-label|title|alt)\s*=\s*(?:"([^"]{4,220})"|'([^']{4,220})')/i)?.[1])
      || text(context.match(/(?:aria-label|title|alt)\s*=\s*(?:"([^"]{4,220})"|'([^']{4,220})')/i)?.[2])
      || "Marketplace listing";
    const description = text(context).slice(0, 700);
    const publicPrice = priceFromPublicText(`${title} ${description}`);
    const imageMatch = context.match(/<img\b[^>]*(?:src|data-src)\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    const image = absolute(imageMatch?.[1] || imageMatch?.[2] || "", baseUrl);
    const item: DiscoveredItem = {
      url,
      title,
      description: description || "Indexed public marketplace result.",
      ...(publicPrice.amount ? { publicPrice: publicPrice.amount, publicCurrency: publicPrice.currency } : {}),
      ...(image ? { image } : {}),
    };
    found.set(url, mergeDiscovered(found.get(url), item));
  }
  return [...found.values()];
}

function publicSearchRequestUrls(query: string, page: number) {
  const first = page * 30;
  return [
    {
      kind: "rss" as const,
      url: `https://www.bing.com/search?format=rss&count=30&first=${first + 1}&q=${encodeURIComponent(query)}`,
    },
    {
      kind: "html" as const,
      url: `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}&s=${first}`,
    },
    {
      kind: "html" as const,
      url: `https://www.bing.com/search?count=30&first=${first + 1}&q=${encodeURIComponent(query)}`,
    },
  ];
}

function discoveryQueries(marketplace: Marketplace, query: string, mode: "active" | "sold") {
  const sold = mode === "sold" ? " sold" : "";
  if (marketplace === "Depop") {
    return [
      `site:depop.com/products ${query}${sold}`,
      `site:www.depop.com/products "${query}"${sold}`,
      `site:depop.com/theme ${query}`,
    ];
  }
  if (marketplace === "Mercari Japan") {
    return [
      `site:jp.mercari.com/en/item ${query}${sold}`,
      `site:jp.mercari.com/item ${query}${sold}`,
      `site:jp.mercari.com/search ${query}${sold}`,
    ];
  }
  if (marketplace === "Goofish") {
    return [
      `site:goofish.com/item ${query}`,
      `site:www.goofish.com/item "${query}"`,
      `site:2.taobao.com/item.htm ${query}`,
    ];
  }
  if (marketplace === "JDirectItems Auction") {
    return [
      `site:zenmarket.jp/en/auction.aspx ${query}`,
      `site:zenmarket.jp/en/yahoo.aspx ${query}`,
      `site:zenmarket.jp "${query}" JDirectItems Auction`,
      `site:auctions.yahoo.co.jp/auction ${query}`,
    ];
  }
  if (marketplace === "Rakuten") {
    return [
      `site:zenmarket.jp/en/rakutenproduct.aspx ${query}`,
      `site:zenmarket.jp/en/search.aspx ${query}`,
      `site:zenmarket.jp "${query}" Rakuten`,
      `site:item.rakuten.co.jp ${query}`,
    ];
  }
  if (marketplace === "Rakuten Rakuma") {
    return [
      `site:zenmarket.jp/en/mercari.aspx ${query} Rakuma`,
      `site:zenmarket.jp/en/rakuma.aspx ${query}`,
      `site:zenmarket.jp "${query}" Rakuma`,
      `site:item.fril.jp ${query}`,
    ];
  }
  const site = listingPath(marketplace);
  return [
    `site:${site} ${query}${sold}`,
    `site:${site} "${query}"${sold}`,
    `site:${site} ${query} "$"${sold}`,
  ];
}

function mergeDiscovered(previous: DiscoveredItem | undefined, incoming: DiscoveredItem) {
  if (!previous) return incoming;
  return {
    url: incoming.url,
    title: incoming.title && incoming.title !== "Marketplace listing" ? incoming.title : previous.title,
    description: incoming.description.length > previous.description.length ? incoming.description : previous.description,
    publicPrice: incoming.publicPrice || previous.publicPrice,
    publicCurrency: incoming.publicCurrency || previous.publicCurrency,
    image: incoming.image || previous.image,
  } satisfies DiscoveredItem;
}

async function browserRenderedItems(
  marketplace: Marketplace,
  directUrls: string[],
): Promise<{ batches: BrowserRenderedBatch[]; successful: number; failed: number }> {
  const browser = await browserRunBinding();
  const zenMarketBacked = ZENMARKET_MARKETS.includes(marketplace as typeof ZENMARKET_MARKETS[number]);
  if (!browser || !["Depop", "Goofish", ...ZENMARKET_MARKETS].includes(marketplace as never)) {
    return { batches: [], successful: 0, failed: 0 };
  }
  const execute = async () => {
  const batches: BrowserRenderedBatch[] = [];
  let successful = 0;
  let failed = 0;
  // Browser time is finite, so render official routes sequentially and stop as
  // soon as a page yields canonical products. Goofish gets a links-only second
  // pass because its result cards may be painted without useful outer HTML.
  const renderLimit = marketplace === "Depop" ? 2 : zenMarketBacked ? 3 : 4;
  for (const directUrl of directUrls.slice(0, renderLimit)) {
    try {
      const html = await fetchRenderedText(directUrl);
      let items = directItems(html, marketplace, directUrl);
      successful += 1;
      if (!items.length && (marketplace === "Goofish" || zenMarketBacked)) {
        try {
          const links = await fetchRenderedLinks(directUrl);
          items = renderedLinksToItems(links, marketplace, directUrl);
          successful += 1;
        } catch {
          failed += 1;
        }
      }
      batches.push({ url: directUrl, items });
      if (items.length) break;
    } catch {
      failed += 1;
    }
  }
  return { batches, successful, failed };
  };
  return zenMarketBacked ? withZenMarketBrowserSlot(execute) : execute();
}

async function discover(marketplace: Marketplace, query: string, page: number, mode: "active" | "sold") {
  const directUrls = sourceSearchCandidates(marketplace, query, mode, page);
  const directRequest = async (directUrl: string) =>
    directItems(
      await fetchText(directUrl, "text/html,application/xhtml+xml"),
      marketplace,
      directUrl,
    );
  const mercariApiRequest = marketplace === "Mercari Japan"
    ? mercariApiItems(query, mode, page)
    : Promise.resolve({ items: [] as DiscoveredItem[], total: 0, hasMore: false });

  const items = new Map<string, DiscoveredItem>();
  const mergeItems = (values: DiscoveredItem[]) => {
    for (const item of values) items.set(item.url, mergeDiscovered(items.get(item.url), item));
  };
  const directSettled: PromiseSettledResult<DiscoveredItem[]>[] = [];
  let browserBatches = { batches: [] as BrowserRenderedBatch[], successful: 0, failed: 0 };
  const mergeBrowserBatches = (incoming: typeof browserBatches) => {
    browserBatches = {
      batches: [...browserBatches.batches, ...incoming.batches],
      successful: browserBatches.successful + incoming.successful,
      failed: browserBatches.failed + incoming.failed,
    };
    for (const batch of incoming.batches) mergeItems(batch.items);
  };
  const fetchStatic = async (urls: string[], stopOnFirstListing = false) => {
    if (!stopOnFirstListing) {
      const batches = await Promise.allSettled(urls.map(directRequest));
      directSettled.push(...batches);
      for (const batch of batches) if (batch.status === "fulfilled") mergeItems(batch.value);
      return;
    }
    for (const url of urls) {
      const [batch] = await Promise.allSettled([directRequest(url)]);
      directSettled.push(batch);
      if (batch.status === "fulfilled") mergeItems(batch.value);
      if (items.size) break;
    }
  };

  const preferredUrls = marketplace === "Goofish"
    ? directUrls.filter((value) => {
        try { return new URL(value).hostname.toLowerCase().endsWith("superbuy.com"); }
        catch { return false; }
      })
    : ZENMARKET_MARKETS.includes(marketplace as typeof ZENMARKET_MARKETS[number])
      ? directUrls.filter((value) => {
          try { return new URL(value).hostname.toLowerCase().endsWith("zenmarket.jp"); }
          catch { return false; }
        })
      : [];
  const fallbackUrls = preferredUrls.length
    ? directUrls.filter((value) => !preferredUrls.includes(value))
    : directUrls;

  if (preferredUrls.length) {
    // Superbuy and all three ZenMarket storefronts return JavaScript shells on
    // their search routes. Give each proxy adapter both a static parse and a
    // fully rendered attempt before its original-market fallback can win.
    await fetchStatic(preferredUrls, true);
    if (items.size === 0) mergeBrowserBatches(await browserRenderedItems(marketplace, preferredUrls));
    if (items.size === 0 && fallbackUrls.length) await fetchStatic(fallbackUrls);
    if (items.size === 0 && fallbackUrls.length) {
      mergeBrowserBatches(await browserRenderedItems(marketplace, fallbackUrls));
    }
  } else {
    await fetchStatic(fallbackUrls);
    if (items.size === 0) mergeBrowserBatches(await browserRenderedItems(marketplace, fallbackUrls));
  }

  const [mercariApi] = await Promise.allSettled([mercariApiRequest]);
  if (mercariApi.status === "fulfilled") mergeItems(mercariApi.value.items);

  const variants = discoveryQueries(marketplace, query, mode);
  const indexedRequests = items.size
    ? []
    : variants.flatMap((variant) =>
        publicSearchRequestUrls(variant, page).map(async ({ kind, url }) => {
          const body = await fetchText(
            url,
            kind === "rss" ? "application/rss+xml,text/xml" : "text/html,application/xhtml+xml",
          );
          return kind === "rss" ? rssItems(body, marketplace) : searchHtmlItems(body, marketplace, url);
        }),
      );
  const indexedSettled = await Promise.allSettled(indexedRequests);
  for (const batch of indexedSettled) if (batch.status === "fulfilled") mergeItems(batch.value);

  const allBatches = [...directSettled, ...indexedSettled];
  const browserBindingAvailable = Boolean(await browserRunBinding());
  return {
    items: [...items.values()].slice(0, 36),
    directUrls,
    successfulBatches: allBatches.filter((batch) => batch.status === "fulfilled").length
      + (mercariApi.status === "fulfilled" ? 1 : 0) + browserBatches.successful,
    failedBatches: allBatches.filter((batch) => batch.status === "rejected").length
      + (mercariApi.status === "rejected" ? 1 : 0) + browserBatches.failed,
    mercariApiItems: mercariApi.status === "fulfilled" ? mercariApi.value.items.length : 0,
    indexedSearchBatches: indexedRequests.length,
    browserRenderedBatches: browserBatches.successful,
    browserRenderedUrls: browserBatches.batches.map((batch) => batch.url),
    browserBindingAvailable,
    hasMoreHint: (mercariApi.status === "fulfilled" && mercariApi.value.hasMore)
      || items.size >= 24,
  };
}

function contextForUrl(html: string, index: number) {
  const start = Math.max(0, index - 1_200);
  const end = Math.min(html.length, index + 1_800);
  return html.slice(start, end);
}

function anchorTextAt(html: string, index: number) {
  const open = html.lastIndexOf("<a", index);
  const close = html.indexOf("</a>", index);
  if (open < 0 || close < 0 || index - open > 1_400 || close - index > 2_600) return "";
  const anchor = html.slice(open, close + 4);
  return text(anchor).slice(0, 240);
}

function depopSearchItems(html: string, baseUrl: string) {
  const found = new Map<string, DiscoveredItem>();
  const blocks = html.match(/<li\b[^>]*class="[^"]*styles_listItem__[^"]*"[^>]*>[\s\S]*?<\/li>/gi) ?? [];
  for (const block of blocks) {
    const anchor = block.match(/<a\b[^>]*href="([^"]*\/products\/[^"?#]+\/?(?:\?[^"#]*)?)"[^>]*>/i);
    if (!anchor) continue;
    const url = cleanUrl(absolute(anchor[1], baseUrl), "Depop");
    if (!url) continue;
    const anchorTag = anchor[0];
    const title = text(
      anchorTag.match(/aria-label="([^"]+)"/i)?.[1]
      || block.match(/<img\b[^>]*alt="([^"]+)"/i)?.[1]
      || "Depop listing",
    );
    const brand = text(block.match(/styles_brandName__[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]);
    const size = text(block.match(/styles_sizeAttributeText__[^"']*["'][^>]*>([\s\S]*?)<\/p>/i)?.[1]);
    const priceMatches = [...block.matchAll(/<p\b[^>]*styles_price__[^>]*>([\s\S]*?)<\/p>/gi)]
      .map((match) => priceFromPublicText(text(match[1])))
      .filter((price) => price.amount > 0);
    const currentPrice = priceMatches.at(-1) ?? { amount: 0, currency: "" };
    const imageTag = block.match(/<img\b[^>]*class="[^"]*_mainImage_[^"]*"[^>]*>/i)?.[0]
      || block.match(/<img\b[^>]*>/i)?.[0]
      || "";
    const image = absolute(
      imageTag.match(/\bsrc="([^"]+)"/i)?.[1]
      || imageTag.match(/\bdata-src="([^"]+)"/i)?.[1]
      || "",
      baseUrl,
    );
    const boosted = /styles_boostedTag__|>\s*Boosted\s*</i.test(block);
    const description = [brand, size ? `Size ${size}` : "", boosted ? "Boosted listing" : ""]
      .filter(Boolean)
      .join(" · ");
    const item: DiscoveredItem = {
      url,
      title,
      description,
      ...(currentPrice.amount ? { publicPrice: currentPrice.amount, publicCurrency: currentPrice.currency || "USD" } : {}),
      ...(image ? { image } : {}),
    };
    found.set(url, mergeDiscovered(found.get(url), item));
  }
  return [...found.values()];
}


function attribute(tag: string, name: string) {
  const match = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return decodeEntities(match?.[1] || match?.[2] || "");
}

function nearestProductBlock(html: string, index: number) {
  // Product grids normally wrap the image link, title and price in an li or
  // article. Prefer those outer cards over a nested image div so fields from
  // neighboring products cannot bleed into one another.
  for (const tag of ["li", "article", "section", "div"]) {
    const start = html.lastIndexOf(`<${tag}`, index);
    if (start < 0 || index - start >= 8_000) continue;
    const close = html.indexOf(`</${tag}>`, index);
    if (close >= 0 && close - index < 12_000) return html.slice(start, close + tag.length + 3);
  }
  return html.slice(Math.max(0, index - 1_600), Math.min(html.length, index + 4_000));
}

/** Parse Rakuten's product-level JSON-LD without allowing fields from
 * neighboring cards to bleed together. The current Rakuten results page emits
 * an ItemList whose ListItem.item Product contains the canonical URL, title,
 * image and Offer price as one record. */
function rakutenJsonLdItems(html: string, baseUrl: string) {
  const found = new Map<string, DiscoveredItem>();

  const offerPrice = (value: unknown): { amount: number; currency: string } => {
    if (Array.isArray(value)) {
      for (const child of value) {
        const parsed = offerPrice(child);
        if (parsed.amount) return parsed;
      }
      return { amount: 0, currency: "" };
    }
    const record = objectRecord(value);
    if (!record) return money(value);
    const direct = money(record);
    const nested = [record.priceSpecification, record.price_specification, record.offers]
      .map(offerPrice).find((entry) => entry.amount);
    return {
      amount: direct.amount || nested?.amount || recordNumber(record, ["lowPrice", "highPrice"]),
      currency: direct.currency || nested?.currency
        || recordText(record, ["priceCurrency", "currency", "currencyCode"]),
    };
  };

  const addRecord = (record: Record<string, unknown>) => {
    const nestedItem = objectRecord(record.item);
    const product = nestedItem || record;
    const type = recordText(product, ["@type", "type"]);
    const explicitUrl = recordText(product, ["url", "itemUrl", "productUrl", "offersUrl"])
      || recordText(record, ["url"]);
    if (!explicitUrl || (!/product/i.test(type) && !/item\.rakuten\.co\.jp/i.test(explicitUrl))) return;
    const url = cleanUrl(absolute(explicitUrl, baseUrl), "Rakuten");
    if (!url) return;

    const title = recordText(product, ["name", "title", "headline"])
      || recordText(record, ["name", "title"])
      || "Rakuten listing";
    const offers = recordValue(product, ["offers", "offer", "priceSpecification", "price_specification"]);
    const price = offerPrice(offers);
    const image = imageFromValue(recordValue(product, [
      "image", "images", "imageUrl", "image_url", "thumbnail", "thumbnailUrl",
    ]), baseUrl);
    const condition = recordText(product, ["itemCondition", "condition"]);
    const brand = nestedText(product.brand, "name") || text(product.brand);
    const description = [brand, condition, recordText(product, ["description"])].filter(Boolean).join(" · ");
    const item: DiscoveredItem = {
      url,
      title: title.slice(0, 240),
      description: description.slice(0, 650),
      ...(price.amount ? { publicPrice: price.amount, publicCurrency: price.currency || "JPY" } : {}),
      ...(image ? { image } : {}),
    };
    found.set(url, mergeDiscovered(found.get(url), item));
  };

  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const attributes = script[1] || "";
    const body = script[2] || "";
    if (!/application\/ld\+json/i.test(attributes)
      && !/(?:itemListElement|item\.rakuten\.co\.jp|schema\.org)/i.test(body)) continue;
    for (const payload of jsonPayloadsFromScript(body)) walk(payload, addRecord);
  }

  // Rakuten also places the ItemList JSON directly inside its search-results
  // component instead of a script element. Extract balanced schema.org objects
  // from the full page so rendered HTML keeps each product image paired with
  // its own title, offer and canonical URL.
  const extractInline = (source: string) => {
    const seenStarts = new Set<number>();
    for (const marker of source.matchAll(/\{\s*"@(?:context|type)"\s*:\s*"(?:https?:\/\/schema\.org\/?|ItemList)"/gi)) {
      const start = marker.index ?? -1;
      if (start < 0 || seenStarts.has(start)) continue;
      seenStarts.add(start);
      let depth = 0;
      let quoted = false;
      let escaped = false;
      for (let index = start; index < source.length; index += 1) {
        const char = source[index];
        if (quoted) {
          if (escaped) escaped = false;
          else if (char === "\\") escaped = true;
          else if (char === '"') quoted = false;
          continue;
        }
        if (char === '"') { quoted = true; continue; }
        if (char === "{") depth += 1;
        if (char === "}") {
          depth -= 1;
          if (depth === 0) {
            const candidate = source.slice(start, index + 1);
            try { walk(JSON.parse(candidate), addRecord); } catch { /* malformed inline state */ }
            break;
          }
        }
      }
    }
  };
  const normalizedHtml = decodeEntities(html).replaceAll("\\u002F", "/").replaceAll("\\/", "/");
  extractInline(normalizedHtml);
  if (/\\"@(?:context|type)\\"/.test(normalizedHtml)) {
    extractInline(normalizedHtml.replaceAll('\\"', '"'));
  }
  return [...found.values()];
}

/** Parse the actual server-rendered cards on search.rakuten.co.jp. */
function rakutenSearchItems(html: string, baseUrl: string) {
  const found = new Map<string, DiscoveredItem>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*(?:"([^"]*item\.rakuten\.co\.jp[^"]*)"|'([^']*item\.rakuten\.co\.jp[^']*)')[^>]*>/gi)) {
    const tag = match[0];
    const url = cleanUrl(absolute(match[1] || match[2] || "", baseUrl), "Rakuten");
    if (!url) continue;
    const block = nearestProductBlock(html, match.index ?? 0);
    const imageTag = block.match(/<img\b[^>]*>/i)?.[0] || "";
    const anchorClose = html.indexOf("</a>", match.index ?? 0);
    const anchorBody = anchorClose >= 0 && anchorClose - (match.index ?? 0) < 5_000
      ? html.slice((match.index ?? 0) + tag.length, anchorClose)
      : "";
    const title = text(
      attribute(tag, "title") || attribute(tag, "aria-label")
      || attribute(imageTag, "alt") || anchorBody || block.match(/<h[2-4]\b[^>]*>([\s\S]*?)<\/h[2-4]>/i)?.[1]
      || "Rakuten listing",
    ).slice(0, 220);
    const price = priceFromPublicText(text(block));
    const image = absolute(
      attribute(imageTag, "src") || attribute(imageTag, "data-src")
      || attribute(imageTag, "data-original") || attribute(imageTag, "data-lazy-src"),
      baseUrl,
    );
    const condition = /(?:中古|used)/i.test(text(block)) ? "Used" : /(?:新品|new)/i.test(text(block)) ? "New" : "";
    const description = [condition, text(block).slice(0, 520)].filter(Boolean).join(" · ");
    const item: DiscoveredItem = {
      url, title, description,
      ...(price.amount ? { publicPrice: price.amount, publicCurrency: price.currency || "JPY" } : {}),
      ...(image ? { image } : {}),
    };
    found.set(url, mergeDiscovered(found.get(url), item));
  }
  return [...found.values()];
}

/** Parse fully rendered ZenMarket doT cards after their AJAX catalog loads. */
function zenMarketCardItems(html: string, marketplace: Marketplace, baseUrl: string) {
  const found = new Map<string, DiscoveredItem>();
  for (const match of html.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/gi)) {
    const block = match[0];
    const openEnd = block.indexOf(">");
    if (openEnd < 0) continue;
    const tag = block.slice(0, openEnd + 1);
    const className = attribute(tag, "class");
    if (!/(?:^|\s)product-item(?:\s|$)/i.test(className) || !/(?:^|\s)product-link(?:\s|$)/i.test(className)) continue;
    const rawHref = attribute(tag, "href");
    if (!rawHref || /\{\{[?=!]/.test(rawHref)) continue;
    const url = cleanUrl(absolute(rawHref, baseUrl), marketplace);
    if (!url) continue;
    const title = text(
      block.match(/<h3\b[^>]*class=(?:"[^"]*item-title[^"]*"|'[^']*item-title[^']*')[^>]*>([\s\S]*?)<\/h3>/i)?.[1]
      || attribute(tag, "title") || attribute(tag, "aria-label")
      || attribute(block.match(/<img\b[^>]*>/i)?.[0] || "", "alt")
      || `${marketplace} listing`,
    );
    const priceSource = block.match(/<span\b[^>]*class=(?:"[^"]*current-price[^"]*"|'[^']*current-price[^']*')[^>]*>([\s\S]*?)<\/span>/i)?.[1]
      || block.match(/<div\b[^>]*class=(?:"[^"]*price[^"]*"|'[^']*price[^']*')[^>]*>([\s\S]*?)<\/div>/i)?.[1]
      || block;
    const price = priceFromPublicText(text(priceSource));
    const imageTag = block.match(/<img\b[^>]*>/i)?.[0] || "";
    const image = absolute(
      attribute(imageTag, "src") || attribute(imageTag, "data-src")
      || attribute(imageTag, "data-original") || attribute(imageTag, "data-lazy-src"),
      baseUrl,
    );
    const storeName = text(block.match(/product-badge-store[^>]*>([\s\S]*?)<\/div>/i)?.[1]);
    const condition = text(block.match(/product-badge-condition-[^>]*>([\s\S]*?)<\/div>/i)?.[1]);
    const description = [storeName, condition, text(block).slice(0, 600)].filter(Boolean).join(" · ");
    found.set(url, mergeDiscovered(found.get(url), {
      url, title, description,
      ...(price.amount ? { publicPrice: price.amount, publicCurrency: price.currency || "JPY" } : {}),
      ...(image ? { image } : {}),
    }));
  }
  return [...found.values()];
}

/** Parse ZenMarket's JSON/AJAX result objects when cards are serialized in
 * scripts or returned by a browser-rendered search response. */
function zenMarketStructuredItems(html: string, marketplace: Marketplace, baseUrl: string) {
  const found = new Map<string, DiscoveredItem>();
  const addRecord = (record: Record<string, unknown>) => {
    const serialized = JSON.stringify(record);
    const storeId = recordText(record, ["storeId", "store_id", "shopId", "shop_id"]);
    const storeName = recordText(record, ["storeName", "store_name", "store", "marketplace", "source"]);
    const explicitUrl = recordText(record, [
      "url", "itemUrl", "item_url", "productUrl", "product_url", "detailUrl", "detail_url",
      "goodsUrl", "goods_url", "link", "href", "targetUrl", "target_url",
    ]);
    const code = recordText(record, [
      "itemCode", "item_code", "productCode", "product_code", "code", "watchCode",
      "watch_code", "auctionId", "auction_id", "productId", "product_id", "id",
    ]);
    const rakutenMarker = marketplace === "Rakuten" && (
      storeId === "0" || /\brakuten\b/i.test(storeName)
      || /(?:rakutenproduct\.aspx|item\.rakuten\.co\.jp)/i.test(explicitUrl)
      || /(?:\"storeId\"\s*:\s*0|\"storeName\"\s*:\s*\"Rakuten\")/i.test(serialized)
    );
    const auctionMarker = marketplace === "JDirectItems Auction" && (
      storeId === "28" || /(?:auction|jdirectitems|yahoo)/i.test(`${storeName} ${explicitUrl}`)
    );
    const rakumaMarker = marketplace === "Rakuten Rakuma" && (
      storeId === "25" || /(?:rakuma|fril)/i.test(`${storeName} ${explicitUrl}`)
    );
    if (!rakutenMarker && !auctionMarker && !rakumaMarker) return;

    let rawUrl = explicitUrl;
    if (!rawUrl && code) {
      if (marketplace === "Rakuten") {
        rawUrl = `https://zenmarket.jp/en/rakutenproduct.aspx?itemCode=${encodeURIComponent(code)}`;
      } else if (marketplace === "JDirectItems Auction") {
        rawUrl = `https://zenmarket.jp/en/auction.aspx?itemCode=${encodeURIComponent(code)}`;
      } else if (marketplace === "Rakuten Rakuma") {
        rawUrl = `https://zenmarket.jp/en/rakumaproduct.aspx?itemCode=${encodeURIComponent(code)}`;
      }
    }
    const url = cleanUrl(absolute(rawUrl, baseUrl), marketplace);
    if (!url) return;

    const title = recordText(record, [
      "title", "itemTitle", "item_title", "productTitle", "product_title", "name",
      "productName", "product_name", "goodsName", "goods_name", "watchTitle", "watch_title",
    ]) || `${marketplace} listing`;
    const nestedPrice = [
      money(recordValue(record, ["price", "currentPrice", "current_price", "priceInfo", "price_info"])),
      money(recordValue(record, ["buyoutPrice", "buyout_price", "watchPrice", "watch_price"])),
    ].find((entry) => entry.amount);
    const explicitAmount = nestedPrice?.amount || recordNumber(record, [
      "price", "currentPrice", "current_price", "priceValue", "price_value", "amount",
      "watchPrice", "watch_price", "buyoutPrice", "buyout_price",
    ]);
    const explicitCurrency = recordText(record, [
      "currency", "currencyCode", "currency_code", "priceCurrency", "price_currency",
    ]) || nestedPrice?.currency;
    const publicPrice = explicitAmount
      ? { amount: explicitAmount, currency: explicitCurrency || "JPY" }
      : priceFromPublicText(serialized);
    const image = imageFromValue(recordValue(record, [
      "image", "imageUrl", "image_url", "itemImage", "item_image", "productImage",
      "product_image", "thumbnail", "thumbnailUrl", "thumbnail_url", "images",
    ]), baseUrl);
    const condition = recordText(record, ["condition", "itemCondition", "item_condition"]);
    const description = [storeName, condition, text(serialized).slice(0, 520)].filter(Boolean).join(" · ");
    found.set(url, mergeDiscovered(found.get(url), {
      url,
      title,
      description,
      ...(publicPrice.amount ? { publicPrice: publicPrice.amount, publicCurrency: publicPrice.currency || "JPY" } : {}),
      ...(image ? { image } : {}),
    }));
  };

  const trimmed = decodeEntities(html).trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try { walk(JSON.parse(trimmed), addRecord); } catch { /* not a JSON response */ }
  }
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const payload of jsonPayloadsFromScript(script[1])) walk(payload, addRecord);
  }
  return [...found.values()];
}

function jsonPayloadsFromScript(source: string) {
  const payloads: unknown[] = [];
  const seen = new Set<string>();
  const normalized = decodeEntities(source)
    .replaceAll("\\u002F", "/")
    .replaceAll("\\/", "/")
    .trim();
  const candidates: string[] = [];
  const addCandidate = (value: string) => {
    const clean = value.trim().replace(/;\s*$/, "");
    if (clean.length < 2 || clean.length > MAX_HTML || seen.has(clean)) return;
    seen.add(clean);
    candidates.push(clean);
  };
  addCandidate(normalized);
  addCandidate(normalized.replace(/^[\s\S]*?=\s*(?=[{[])/, ""));

  // Extract balanced JSON objects/arrays from assignment scripts, React flight
  // payloads, and serialized bootstrap state without executing page JavaScript.
  for (let start = 0; start < normalized.length && candidates.length < 80; start += 1) {
    const opener = normalized[start];
    if (opener !== "{" && opener !== "[") continue;
    const stack = [opener];
    let quote = "";
    let escaped = false;
    for (let index = start + 1; index < normalized.length; index += 1) {
      const char = normalized[index];
      if (quote) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'") { quote = char; continue; }
      if (char === "{" || char === "[") stack.push(char);
      if (char === "}" || char === "]") {
        const expected = char === "}" ? "{" : "[";
        if (stack.at(-1) !== expected) break;
        stack.pop();
        if (!stack.length) {
          addCandidate(normalized.slice(start, index + 1));
          start = index;
          break;
        }
      }
    }
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      payloads.push(parsed);
      // Next/React flight data frequently wraps useful JSON in strings nested
      // inside an outer array. Recursively unwrap only product-shaped strings.
      const unwrapStrings = (value: unknown) => {
        if (typeof value === "string") {
          if (/(?:item|goods|product|xianyu|goofish|闲鱼)/i.test(value)) {
            for (const nested of jsonPayloadsFromScript(value).slice(0, 20)) payloads.push(nested);
          }
          return;
        }
        if (Array.isArray(value)) { for (const child of value) unwrapStrings(child); return; }
        if (!value || typeof value !== "object") return;
        for (const child of Object.values(value as Record<string, unknown>)) unwrapStrings(child);
      };
      unwrapStrings(parsed);
    } catch { /* executable JavaScript or a non-JSON balanced block */ }
  }
  return payloads;
}

function goofishStructuredItems(html: string, baseUrl: string) {
  const found = new Map<string, DiscoveredItem>();
  let baseIsSuperbuy = false;
  let baseIsXianyuSearch = false;
  try {
    const base = new URL(baseUrl);
    baseIsSuperbuy = base.hostname.toLowerCase().endsWith("superbuy.com");
    const platform = `${base.searchParams.get("platform") || ""} ${base.searchParams.get("source") || ""}`;
    baseIsXianyuSearch = baseIsSuperbuy && (
      base.pathname.toLowerCase().includes("/fleamarket/")
      || /(?:^|\s)(?:xy|xianyu|goofish)(?:\s|$)/i.test(platform)
    );
  } catch { /* invalid base */ }
  const addRecord = (record: Record<string, unknown>) => {
    const serialized = JSON.stringify(record);
    const sourceMarker = [
      text(record.platform), text(record.platformCode), text(record.platform_code),
      text(record.source), text(record.sourcePlatform), text(record.source_platform),
      text(record.site), text(record.marketplace), serialized,
    ].join(" ");
    const xianyuRecord = baseIsXianyuSearch
      || /(?:\bxy\b|xianyu|goofish|闲鱼|2\.taobao\.com)/i.test(sourceMarker);
    const id = text(record.itemId) || text(record.item_id) || text(record.itemIdStr)
      || text(record.item_id_str) || text(record.productId) || text(record.product_id)
      || text(record.goodsId) || text(record.goods_id) || text(record.numIid)
      || text(record.num_iid) || text(record.offerId) || text(record.offer_id)
      || text(record.auctionId) || text(record.auction_id) || text(record.goodsNo)
      || text(record.goods_no) || text(record.itemCode) || text(record.item_code)
      || recordText(record, ["itemId", "itemIdStr", "productId", "goodsId", "numIid", "offerId", "auctionId", "goodsNo", "itemCode"]);
    const explicitUrl = text(record.url) || text(record.itemUrl) || text(record.item_url)
      || text(record.detailUrl) || text(record.detail_url) || text(record.goodsUrl)
      || text(record.goods_url) || text(record.productUrl) || text(record.product_url)
      || text(record.originUrl) || text(record.origin_url) || text(record.sourceUrl)
      || text(record.source_url) || text(record.originalUrl) || text(record.original_url)
      || text(record.goodsLink) || text(record.goods_link) || text(record.jumpUrl)
      || text(record.jump_url) || text(record.targetUrl) || text(record.target_url)
      || text(record.thirdPartyUrl) || text(record.third_party_url) || text(record.link)
      || recordText(record, ["url", "itemUrl", "detailUrl", "goodsUrl", "productUrl", "originUrl", "sourceUrl", "originalUrl", "goodsLink", "jumpUrl", "targetUrl", "thirdPartyUrl", "link", "href"]);
    const rawUrl = explicitUrl
      || (id && /^\d{6,}$/.test(id) && (!baseIsSuperbuy || xianyuRecord)
        ? `https://www.goofish.com/item?id=${id}` : "");
    const url = cleanUrl(absolute(rawUrl, baseUrl), "Goofish");
    if (!url) return;
    const title = text(record.itemTitle) || text(record.item_title) || text(record.title)
      || text(record.name) || text(record.goodsName) || text(record.goods_name)
      || text(record.productName) || text(record.product_name) || text(record.subject)
      || text(record.goodsTitle) || text(record.goods_title) || text(record.productTitle)
      || text(record.product_title) || text(record.itemName) || text(record.item_name)
      || text(record.shortTitle) || text(record.short_title)
      || recordText(record, ["itemTitle", "title", "name", "goodsName", "productName", "subject", "goodsTitle", "productTitle", "itemName", "shortTitle"])
      || "Goofish marketplace listing";
    const nestedPrice = [
      money(record.price), money(record.priceInfo), money(record.price_info),
      money(record.currentPrice), money(record.current_price), money(record.salePrice), money(record.sale_price),
    ].find((value) => value.amount);
    const explicitAmount = nestedPrice?.amount || number(record.price) || number(record.currentPrice) || number(record.current_price)
      || number(record.soldPrice) || number(record.sold_price) || number(record.amount)
      || number(record.goodsPrice) || number(record.goods_price) || number(record.salePrice)
      || number(record.sale_price) || number(record.priceValue) || number(record.price_value)
      || recordNumber(record, ["price", "currentPrice", "soldPrice", "amount", "goodsPrice", "salePrice", "priceValue"]);
    const explicitCurrency = text(record.currency) || text(record.currencyCode) || text(record.priceCurrency)
      || text(record.currency_code) || nestedPrice?.currency || text(record.currencySymbol)
      || recordText(record, ["currency", "currencyCode", "priceCurrency", "currencySymbol"]);
    const parsedPrice = priceFromPublicText(serialized);
    const price = explicitAmount
      ? { amount: explicitAmount, currency: explicitCurrency || parsedPrice.currency || "CNY" }
      : parsedPrice;
    const imageMatch = imageFromValue(
      record.image || record.imageUrl || record.image_url || record.picUrl || record.pic_url
      || record.goodsImage || record.goods_image || record.mainImage || record.main_image
      || record.cover || record.pictures || record.images
      || recordValue(record, ["image", "imageUrl", "picUrl", "goodsImage", "mainImage", "cover", "pictures", "images", "thumbnail"]),
      baseUrl,
    ) || serialized.match(/https?:\\?\/\\?\/[^"'\\s]+\.(?:jpe?g|png|webp)(?:\?[^"'\\s]*)?/i)?.[0]
      ?.replaceAll("\\/", "/") || "";
    const item: DiscoveredItem = {
      url, title, description: text(serialized).slice(0, 650),
      ...(price.amount ? { publicPrice: price.amount, publicCurrency: price.currency || "CNY" } : {}),
      ...(imageMatch ? { image: imageMatch } : {}),
    };
    found.set(url, mergeDiscovered(found.get(url), item));
  };
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    for (const payload of jsonPayloadsFromScript(script[1])) walk(payload, addRecord);
  }
  // Rendered Superbuy and Goofish payloads can expose IDs in executable state
  // or data attributes rather than a standalone JSON script.
  for (const match of html.matchAll(/(?:itemId|item_id|itemIdStr|goodsId|goods_id|numIid|num_iid)["']?\s*[:=]\s*["']?(\d{6,})/gi)) {
    const context = contextForUrl(html, match.index ?? 0);
    addRecord({
      itemId: match[1],
      platform: /(?:xianyu|goofish|闲鱼|platform["']?\s*[:=]\s*["']?xy)/i.test(context) ? "xy" : "",
      itemTitle: text(context.match(/(?:itemTitle|item_title|goodsName|goods_name|title|name)["']?\s*[:=]\s*["']([^"']{3,220})/i)?.[1]),
      price: context.match(/(?:price|soldPrice|currentPrice|goodsPrice|salePrice)["']?\s*[:=]\s*["']?([\d,.]+)/i)?.[1],
      currency: /(?:CNY|RMB|CN¥|CN￥|元)/i.test(context) ? "CNY" : "",
    });
  }
  for (const match of html.matchAll(/data-(?:item-id|itemid|goods-id|product-id|num-iid)\s*=\s*(?:"(\d{6,})"|'(\d{6,})')/gi)) {
    const context = nearestProductBlock(html, match.index ?? 0);
    const xianyuContext = baseIsXianyuSearch || /(?:xianyu|goofish|闲鱼|2\.taobao\.com|platform\s*[=:]\s*["']?xy)/i.test(context);
    // A regular Superbuy catalog card can use the same numeric data attributes
    // for Taobao/1688 products. Do not relabel those as Goofish listings.
    if (baseIsSuperbuy && !xianyuContext) continue;
    const id = match[1] || match[2];
    const title = text(
      context.match(/(?:aria-label|title|alt)\s*=\s*(?:"([^"]{3,220})"|'([^']{3,220})')/i)?.[1]
      || context.match(/(?:aria-label|title|alt)\s*=\s*(?:"([^"]{3,220})"|'([^']{3,220})')/i)?.[2]
      || context.match(/>([^<>]{3,220})<\/(?:a|h2|h3|p|span)>/i)?.[1],
    );
    const parsed = priceFromPublicText(text(context));
    const imageTag = context.match(/<img\b[^>]*>/i)?.[0] || "";
    addRecord({
      itemId: id,
      platform: xianyuContext ? "xy" : "",
      itemTitle: title,
      price: parsed.amount,
      currency: parsed.currency || "CNY",
      imageUrl: attribute(imageTag, "src") || attribute(imageTag, "data-src")
        || attribute(imageTag, "data-original") || attribute(imageTag, "data-lazy-src"),
    });
  }
  for (const match of html.matchAll(/data-(?:item-url|goods-url|product-url|source-url|origin-url|target-url|href|link|url)\s*=\s*(?:"([^"]+)"|'([^']+)')/gi)) {
    const rawUrl = decodeEntities(match[1] || match[2] || "").replaceAll("\\/", "/");
    const context = nearestProductBlock(html, match.index ?? 0);
    addRecord({
      url: rawUrl,
      platform: /(?:xianyu|goofish|闲鱼|2\.taobao\.com|platform\s*[=:]\s*["']?xy)/i.test(context) ? "xy" : "",
      itemTitle: text(
        context.match(/(?:aria-label|title|alt)\s*=\s*(?:"([^"]{3,220})"|'([^']{3,220})')/i)?.[1]
        || context.match(/>([^<>]{3,220})<\/(?:a|h2|h3|p|span)>/i)?.[1],
      ),
      price: priceFromPublicText(text(context)).amount,
      currency: /(?:CNY|RMB|CN¥|CN￥|元)/i.test(context) ? "CNY" : "",
    });
  }
  return [...found.values()];
}

function directItems(html: string, marketplace: Marketplace, baseUrl = sourceSearch(marketplace, "")) {
  if (marketplace === "Depop") {
    const cards = depopSearchItems(html, baseUrl);
    if (cards.length) return cards;
  }
  if (marketplace === "Rakuten") {
    // Prefer ZenMarket card/state records even when the rendered proxy page also
    // contains an original Rakuten source link in a footer or detail control.
    const proxy = zenMarketCardItems(html, marketplace, baseUrl);
    if (proxy.length) return proxy;
    const structured = zenMarketStructuredItems(html, marketplace, baseUrl);
    if (structured.length) return structured;
    const jsonLd = rakutenJsonLdItems(html, baseUrl);
    if (jsonLd.length) return jsonLd;
    const official = rakutenSearchItems(html, baseUrl);
    if (official.length) return official;
  }
  if (marketplace === "Goofish") {
    const structured = goofishStructuredItems(html, baseUrl);
    if (structured.length) return structured;
  }
  if (["JDirectItems Auction", "Rakuten Rakuma"].includes(marketplace)) {
    const proxy = zenMarketCardItems(html, marketplace, baseUrl);
    if (proxy.length) return proxy;
    const structured = zenMarketStructuredItems(html, marketplace, baseUrl);
    if (structured.length) return structured;
  }
  const found = new Map<string, DiscoveredItem>();
  const candidates = [
    ...html.matchAll(/href\s*=\s*(?:"([^"]+)"|'([^']+)')/gi),
    ...html.matchAll(/(?:url|href|path|link)\s*["']?\s*:\s*(?:"([^"]+)"|'([^']+)')/gi),
    ...html.matchAll(/https:\\?\/\\?\/[^"'\\s<>]+/gi),
    // Next/React payloads may store relative product paths with escaped slashes.
    ...html.matchAll(/(?:\\?\/)+(?:men|women)-clothing(?:\\?\/)+[^"'\s<>]+?\.shtml/gi),
  ];
  for (const match of candidates) {
    const raw = (match[1] ?? match[2] ?? match[0])
      .replaceAll("\\u002F", "/")
      .replaceAll("\\/", "/")
      .replace(/^href\s*=\s*["']?/i, "")
      .replace(/^(?:url|href|path|link)\s*["']?\s*:\s*["']?/i, "")
      .replace(/["']$/, "");
    const absoluteUrl = absolute(raw, baseUrl);
    const url = cleanUrl(absoluteUrl, marketplace);
    if (!url) continue;
    const context = contextForUrl(html, match.index ?? 0);
    const title = text(
      anchorTextAt(html, match.index ?? 0)
      || context.match(/(?:aria-label|title|alt)\s*=\s*(?:"([^"]{4,220})"|'([^']{4,220})')/i)?.[1]
      || context.match(/(?:aria-label|title|alt)\s*=\s*(?:"([^"]{4,220})"|'([^']{4,220})')/i)?.[2]
      || context.match(/>([^<>]{4,220})<\/(?:a|h2|h3|p|span)>/i)?.[1]
      || "Marketplace listing",
    );
    const description = text(context).slice(0, 700) || "Discovered from the marketplace search results.";
    const publicPrice = priceFromPublicText(`${title} ${description}`);
    const imageRaw = context.match(/<img\b[^>]*(?:src|data-src)\s*=\s*(?:"([^"]+)"|'([^']+)')/i);
    const image = absolute(imageRaw?.[1] || imageRaw?.[2] || "", baseUrl);
    const item: DiscoveredItem = {
      url,
      title,
      description,
      ...(publicPrice.amount ? { publicPrice: publicPrice.amount, publicCurrency: publicPrice.currency } : {}),
      ...(image ? { image } : {}),
    };
    found.set(url, mergeDiscovered(found.get(url), item));
  }
  return [...found.values()];
}

function decodeEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&yen;", "¥")
    .replaceAll("&#165;", "¥")
    .replaceAll("&#xA5;", "¥");
}

/**
 * Grailed's sold feed renders complete cards in the search HTML. Those cards
 * carry the historical "Sold For" amount, while the individual listing page
 * may only expose an old asking price. Read the feed card itself first.
 */
function grailedSoldCards(html: string) {
  const cards: Card[] = [];
  const blocks = html.split(/<div class="UserItem_root__/i).slice(1);
  for (const block of blocks) {
    const href = block.match(/href="([^"]*\/listings\/[^"]+)"/i)?.[1];
    const price = number(block.match(/Sold For<\/span>\s*<span[^>]*>\s*\$?([\d,.]+)/i)?.[1]);
    if (!href || !price) continue;
    const url = cleanUrl(absolute(decodeEntities(href), "https://www.grailed.com"), "Grailed");
    if (!url) continue;
    const imageTag = block.match(/<img\b[^>]*class="[^"]*UserItem_sold[^"]*"[^>]*>/i)?.[0]
      ?? block.match(/<img\b[^>]*>/i)?.[0] ?? "";
    const alt = decodeEntities(imageTag.match(/\balt="([^"]*)"/i)?.[1] ?? "");
    const src = decodeEntities(imageTag.match(/\bsrc="([^"]*)"/i)?.[1] ?? "");
    const designer = text(block.match(/UserItem_designer__[^"]*">([\s\S]*?)<\/p>/i)?.[1]);
    const title = text(block.match(/UserItem_title__[^"]*">([\s\S]*?)<\/span>/i)?.[1]) || alt;
    const size = text(block.match(/UserItem_size__[^"]*">([\s\S]*?)<\/p>/i)?.[1]);
    const soldAgo = text(block.match(/Timestamp_date__[^"]*">([\s\S]*?)<\/p>/i)?.[1]);
    if (!title) continue;
    cards.push({
      id: `sold-${createHash("sha1").update(url).digest("hex").slice(0, 14)}`,
      marketplace: "Grailed",
      title: title.slice(0, 180),
      brand: designer || "Unspecified",
      price,
      shipping: 0,
      condition: "Sold",
      size: size || "Unknown",
      image: absolute(src, url),
      url,
      description: `${soldAgo || "Historical Grailed sale"}. Sold-price evidence parsed from Grailed's sold-results card.`,
      ...listingDateFromRecord({ sold_at: soldAgo }),
    });
  }
  return [...new Map(cards.map((card) => [card.url, card])).values()];
}

function meta(html: string, keys: string[]) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? "";
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").toLowerCase();
    if (keys.includes(key) && attrs.content) return text(attrs.content);
  }
  return "";
}

function walk(value: unknown, visit: (record: Record<string, unknown>) => void) {
  if (Array.isArray(value)) { for (const child of value) walk(child, visit); return; }
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  visit(record);
  for (const child of Object.values(record)) if (child && typeof child === "object") walk(child, visit);
}

function fromRecord(record: Record<string, unknown>, marketplace: Marketplace, pageUrl: string): Card | null {
  const normalized = normalizePublicListingRecord(record, marketplace, pageUrl);
  if (!normalized) return null;
  const url = cleanUrl(normalized.rawUrl, marketplace);
  if (!url) return null;
  const price = toUsd(normalized.amount, normalized.currency);
  if (!price) return null;
  const articleType = inferApparelType(normalized.category, normalized.title, normalized.description);
  const importCosts = landedImportCosts(marketplace, price);
  const engagement = recordEngagement(record, marketplace, url);
  const listedAt = normalized.listedAtField
    ? listingDateFromRecord({ [normalized.listedAtField]: normalized.listedAtValue })
    : {};
  return {
    id: `live-${createHash("sha1").update(url).digest("hex").slice(0, 14)}`,
    marketplace,
    title: normalized.title.slice(0, 180),
    brand: normalized.brand || "Unspecified",
    price,
    shipping: number(record.shipping_price) + (importCosts?.total ?? 0),
    condition: normalized.condition.split("/").at(-1) || (record.sold === true ? "Sold" : "Check listing"),
    size: normalized.size || "Unknown",
    articleType,
    image: normalized.image,
    url,
    description: normalized.description.slice(0, 500) || "Live public marketplace listing. Verify all details on the source page.",
    importCosts,
    ...(marketplace === "Goofish" ? { proxyUrl: superbuyProxyUrl(url) } : {}),
    ...listedAt,
    ...engagementFields(engagement),
  };
}

async function hydrate(marketplace: Marketplace, item: DiscoveredItem) {
  try {
    const html = await fetchText(item.url, "text/html,application/xhtml+xml");
    let card: Card | null = null;
    for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      const body = match[1].trim();
      if (!body.startsWith("{") && !body.startsWith("[")) continue;
      try {
        walk(JSON.parse(body), (record) => { if (!card) card = fromRecord(record, marketplace, item.url); });
      } catch { /* executable or malformed script */ }
      if (card) break;
    }
    if (card) {
      const pageEngagement = ["Depop", "Grailed", "Poshmark"].includes(marketplace)
        ? extractMarketplaceEngagement(html, item.url, marketplace as EngagementMarketplace)
        : undefined;
      return Object.assign(
        {},
        card as Card,
        { image: (card as Card).image || item.image || absolute(meta(html, ["og:image", "twitter:image"]), item.url) },
        !(card as Card).listedAt ? listingDateFromHtml(html, pageEngagement?.ageDays) : {},
        engagementFields(pageEngagement),
      );
    }
    const title = meta(html, ["og:title", "twitter:title"]) || item.title;
    const description = meta(html, ["og:description", "description"]) || item.description;
    const textPrice = priceFromPublicText(`${title} ${description}`);
    const rawPrice = number(meta(html, ["product:price:amount", "og:price:amount", "twitter:data1"]))
      || textPrice.amount || item.publicPrice || 0;
    const currency = meta(html, ["product:price:currency", "og:price:currency"])
      || textPrice.currency || item.publicCurrency
      || (marketplace === "Mercari Japan" || marketplace.includes("Rakuten") || marketplace === "JDirectItems Auction" ? "JPY"
        : marketplace === "Bunjang" ? "KRW" : marketplace === "Goofish" ? "CNY" : "USD");
    const price = toUsd(rawPrice, currency);
    if (!title || (!price && marketplace !== "Goofish")) return null;
    const importCosts = price ? landedImportCosts(marketplace, price) : undefined;
    const pageEngagement = ["Depop", "Grailed", "Poshmark"].includes(marketplace)
      ? extractMarketplaceEngagement(html, item.url, marketplace as EngagementMarketplace)
      : undefined;
    return {
      id: `live-${createHash("sha1").update(item.url).digest("hex").slice(0, 14)}`,
      marketplace, title: title.replace(/\s*[|·-]\s*(Depop|Grailed|Poshmark|Mercari|ZenMarket|Bunjang|Superbuy).*$/i, ""), brand: "Unspecified",
      price, shipping: importCosts?.total ?? 0,
      condition: price ? "Check listing" : "Price unavailable — open source",
      size: "Unknown",
      articleType: inferApparelType(title, description),
      image: absolute(meta(html, ["og:image", "twitter:image"]), item.url) || item.image || "", url: item.url,
      description: description.slice(0, 500), importCosts,
      ...(marketplace === "Goofish" ? { proxyUrl: superbuyProxyUrl(item.url) } : {}),
      ...listingDateFromHtml(html, pageEngagement?.ageDays),
      ...engagementFields(pageEngagement),
    } satisfies Card;
  } catch {
    const publicPrice = item.publicPrice
      ? { amount: item.publicPrice, currency: item.publicCurrency || "" }
      : priceFromPublicText(`${item.title} ${item.description}`);
    const currency = publicPrice.currency
      || (["Mercari Japan", "JDirectItems Auction", "Rakuten", "Rakuten Rakuma"].includes(marketplace) ? "JPY"
        : marketplace === "Bunjang" ? "KRW" : marketplace === "Goofish" ? "CNY" : "USD");
    const price = toUsd(publicPrice.amount, currency);
    if ((!price && marketplace !== "Goofish") || !item.title || !item.url) return null;
    const importCosts = price ? landedImportCosts(marketplace, price) : undefined;
    return {
      id: `live-${createHash("sha1").update(item.url).digest("hex").slice(0, 14)}`,
      marketplace,
      title: item.title,
      brand: "Unspecified",
      price,
      shipping: importCosts?.total ?? 0,
      condition: price ? "Check listing" : "Price unavailable — open source",
      size: "Unknown",
      articleType: inferApparelType(item.title, item.description),
      image: item.image || "",
      url: item.url,
      description: `${item.description.slice(0, 430)} Public search evidence was used because the product page could not be read. ${price ? "Verify price and availability" : "Open the original listing to view its current price and availability"} before buying.`,
      importCosts,
      ...(marketplace === "Goofish" ? { proxyUrl: superbuyProxyUrl(item.url) } : {}),
    } satisfies Card;
  }
}

async function concurrent<T, R>(values: T[], limit: number, task: (value: T) => Promise<R>) {
  const output = new Array<R | undefined>(values.length);
  let cursor = 0;
  async function worker() {
    while (cursor < values.length) {
      const index = cursor++;
      const [attempt] = await Promise.allSettled([task(values[index])]);
      output[index] = attempt.status === "fulfilled" ? attempt.value : undefined;
    }
  }
  await Promise.allSettled(Array.from({ length: Math.min(limit, values.length) }, worker));
  return output;
}

export const __marketSourceTest = {
  sourceSearchCandidates,
  discoveryQueries,
  cleanUrl,
  directItems,
  depopSearchItems,
  rakutenSearchItems,
  rakutenJsonLdItems,
  zenMarketCardItems,
  zenMarketStructuredItems,
  goofishStructuredItems,
  searchHtmlItems,
  decodeSearchRedirect,
  publicSearchRequestUrls,
  superbuySearchUrl,
  superbuyProxyUrl,
  browserRenderedItems,
  ZENMARKET_MARKETS,
  ZENMARKET_ADAPTER,
  withZenMarketBrowserSlot,
  fetchRenderedText,
  fetchRenderedLinks,
  renderedLinksToItems,
  mercariDpop,
  mercariSearchBody,
  mercariItemsFromResponse,
  mercariApiItems,
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const marketplace = url.searchParams.get("marketplace") as Marketplace | null;
  if (!marketplace || !MARKETS.includes(marketplace)) return reply({ error: "Unknown marketplace." }, 400);
  const category = (url.searchParams.get("category") || "All").slice(0, 40);
  const term = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const page = Math.min(4, Math.max(0, Number(url.searchParams.get("page")) || 0));
  const mode = url.searchParams.get("mode") === "sold" ? "sold" : "active";
  if (mode === "sold" && marketplace !== "Grailed" && marketplace !== "Mercari Japan") {
    return reply({ error: "Sold-result discovery is supported for Grailed and Mercari Japan." }, 400);
  }
  const query = [term, apparelSearchTerm(category)].filter(Boolean).join(" ") || "trending streetwear";
  const key = `${mode}:${marketplace}:${query}:${page}`.toLowerCase();
  const cached = cache.get(key);
  if (cached && cached.until > Date.now()) return reply(cached.value);
  try {
    const soldFeedPromise = mode === "sold" && marketplace === "Grailed"
      ? (() => {
          const directUrl = new URL(sourceSearch("Grailed", query, "sold"));
          if (page > 0) directUrl.searchParams.set("page", String(page + 1));
          return fetchText(directUrl.toString(), "text/html,application/xhtml+xml")
            .then(grailedSoldCards)
            .catch(() => [] as Card[]);
        })()
      : Promise.resolve([] as Card[]);
    const grailedIndexPromise = marketplace === "Grailed"
      ? grailedIndexCards(query, page, mode)
      : Promise.resolve([] as Card[]);
    const [discoveryAttempt, soldFeedAttempt, grailedIndexAttempt] = await Promise.allSettled([
      discover(marketplace, query, page, mode),
      soldFeedPromise,
      grailedIndexPromise,
    ]);
    const discovery = discoveryAttempt.status === "fulfilled"
      ? discoveryAttempt.value
      : {
          items: [] as DiscoveredItem[],
          directUrls: sourceSearchCandidates(marketplace, query, mode, page),
          successfulBatches: 0,
          failedBatches: 1,
          mercariApiItems: 0,
          indexedSearchBatches: 0,
          browserRenderedBatches: 0,
          browserRenderedUrls: [] as string[],
          browserBindingAvailable: Boolean(await browserRunBinding()),
          hasMoreHint: false,
        };
    const soldFeedCards = soldFeedAttempt.status === "fulfilled" ? soldFeedAttempt.value : [];
    const grailedIndex = grailedIndexAttempt.status === "fulfilled" ? grailedIndexAttempt.value : [];
    const discovered = discovery.items;
    const hydrated = await concurrent(discovered, 6, (item) => hydrate(marketplace, item));
    // Prefer sold-feed cards, then Grailed's public index, because both retain
    // actual historical sold amounts rather than an archived asking price.
    const combined = [
      ...soldFeedCards,
      ...grailedIndex,
      ...(hydrated.filter(Boolean) as Card[]),
    ];
    const listings = [...new Map(combined.map((item) => [item.url, item])).values()].slice(0, 24);
    const value = {
      marketplace, mode, sourceUrl: sourceSearch(marketplace, query, mode),
      status: listings.length ? "live" : "unavailable",
      message: listings.length
        ? `Loaded ${listings.length} ${mode === "sold" ? "sold comparables" : "indexed public listings"} from ${[
            soldFeedCards.length ? "Grailed page cards" : "",
            grailedIndex.length ? "Grailed public search" : "",
            hydrated.some(Boolean) ? "public page/index discovery" : "",
          ].filter(Boolean).join(", ")}.`
        : `No public ${mode === "sold" ? "sold comparables" : "listing cards"} were available. Open the marketplace results directly.`,
      diagnostics: {
        sourceProvider: ZENMARKET_MARKETS.includes(marketplace as typeof ZENMARKET_MARKETS[number]) ? "ZenMarket" : marketplace,
        providerMarket: ZENMARKET_MARKETS.includes(marketplace as typeof ZENMARKET_MARKETS[number])
          ? ZENMARKET_ADAPTER[marketplace as keyof typeof ZENMARKET_ADAPTER]
          : undefined,
        providerBatchSize: Number(url.searchParams.get("providerBatchSize") || 1),
        grailedPageCards: soldFeedCards.length,
        grailedPublicSearch: grailedIndex.length,
        directSearchUrls: discovery.directUrls,
        successfulDiscoveryBatches: discovery.successfulBatches,
        failedDiscoveryBatches: discovery.failedBatches,
        mercariApiItems: discovery.mercariApiItems,
        indexedSearchBatches: discovery.indexedSearchBatches,
        browserBindingAvailable: discovery.browserBindingAvailable,
        browserRenderedBatches: discovery.browserRenderedBatches,
        browserRenderedUrls: discovery.browserRenderedUrls,
        discoveredUrls: discovered.length,
        hydratedCards: hydrated.filter(Boolean).length,
      },
      listings, page, hasMore: discovery.hasMoreHint || discovered.length >= 8 || soldFeedCards.length >= 8 || grailedIndex.length >= 8,
    };
    cache.set(key, { until: Date.now() + (listings.length ? 120_000 : 15_000), value });
    return reply(value);
  } catch {
    return reply({ marketplace, mode, sourceUrl: sourceSearch(marketplace, query, mode), status: "error", message: "Public listing discovery could not be reached.", listings: [], page, hasMore: false });
  }
}
