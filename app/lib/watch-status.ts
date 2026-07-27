function normalizeText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '\"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

export type WatchListingState = "active" | "sold" | "removed" | "unknown";

export type WatchStatusReport = {
  status: WatchListingState;
  checkedAt: string;
  sourceUrl: string;
  finalUrl: string;
  sourceTitle: string;
  currency: string;
  currentPrice?: number;
  soldPrice?: number;
  soldAt?: string;
  confidence: number;
  evidence: string[];
  caveats: string[];
  modelStatus?: WatchListingState;
  modelConfidence?: number;
  modelSummary?: string;
  modelReasons?: string[];
};

function decode(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function attrs(tag: string) {
  const output: Record<string, string> = {};
  for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    output[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return output;
}

function meta(html: string, names: string[]) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const record = attrs(tag);
    const key = (record.property || record.name || record.itemprop || "").toLowerCase();
    if (names.includes(key) && record.content) return normalizeText(record.content);
  }
  return "";
}

function flatten(value: unknown, depth = 0): Record<string, unknown>[] {
  if (depth > 12) return [];
  if (Array.isArray(value)) return value.flatMap((item) => flatten(item, depth + 1));
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  return [record, ...Object.values(record).flatMap((item) => flatten(item, depth + 1))];
}

function jsonRecords(html: string) {
  const records: Record<string, unknown>[] = [];
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*(?:"(?:application\/ld\+json|application\/json)"|'(?:application\/ld\+json|application\/json)')[^>]*>([\s\S]*?)<\\?\/script>/gi)) {
    const raw = match[1].trim();
    if (!raw || raw.length > 2_000_000) continue;
    try { records.push(...flatten(JSON.parse(raw))); } catch { /* metadata fallback below */ }
  }
  return records;
}

function keyValue(records: Record<string, unknown>[], keys: string[]) {
  const wanted = new Set(keys.map((key) => key.toLowerCase()));
  for (const record of records) {
    for (const [key, value] of Object.entries(record)) {
      if (wanted.has(key.toLowerCase()) && value !== undefined && value !== null && value !== "") return value;
    }
  }
  return undefined;
}

function numeric(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return undefined;
  const match = value.replaceAll(",", "").match(/(?:USD|US\$|\$|£|€|¥)?\s*(-?\d+(?:\.\d{1,2})?)/i);
  const parsed = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function dateValue(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return undefined;
  const year = parsed.getUTCFullYear();
  if (year < 2000 || year > new Date().getUTCFullYear() + 1) return undefined;
  return parsed.toISOString();
}

function stringValue(value: unknown) {
  return typeof value === "string" ? normalizeText(value) : "";
}

function unique(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

export function extractWatchStatus(input: {
  html: string;
  text: string;
  url: string;
  finalUrl: string;
  title: string;
  httpStatus: number;
}): WatchStatusReport {
  const { html, text, url, finalUrl, title, httpStatus } = input;
  const records = jsonRecords(html);
  const search = `${html.slice(0, 1_200_000)}\n${text}`;
  const evidence: string[] = [];
  const caveats: string[] = [];

  const explicitSold = keyValue(records, ["isSold", "sold", "is_sold", "soldOut", "sold_out"]);
  const rawStatus = stringValue(keyValue(records, ["status", "listingStatus", "listing_status", "availability", "state"])).toLowerCase();
  const soldByJson = explicitSold === true || explicitSold === 1 || explicitSold === "true" ||
    /(?:^|\b)(sold|sold_out|soldout|completed|purchased)(?:\b|$)/i.test(rawStatus) ||
    /schema\.org\/(?:SoldOut|OutOfStock)/i.test(rawStatus);
  const soldByText = /\b(?:this item|item|listing)\s+(?:has\s+)?(?:been\s+)?sold\b/i.test(text) ||
    /\b(?:sold|purchased)\s+(?:on|for)\b/i.test(text) ||
    /"(?:isSold|sold|sold_out)"\s*:\s*(?:true|1)/i.test(search);
  const activeByJson = /schema\.org\/InStock/i.test(rawStatus) || /(?:^|\b)(active|available|for_sale|on_sale|instock)(?:\b|$)/i.test(rawStatus);
  const activeByText = /\b(?:buy now|add to bag|add to cart|make an offer)\b/i.test(text);

  let status: WatchListingState = "unknown";
  if (httpStatus === 404 || httpStatus === 410) {
    status = "removed";
    evidence.push(`Source returned HTTP ${httpStatus}.`);
  } else if (soldByJson || soldByText) {
    status = "sold";
    evidence.push(soldByJson ? "Structured listing data marks the item sold or unavailable." : "The public listing page states that the item sold.");
  } else if (activeByJson || activeByText) {
    status = "active";
    evidence.push(activeByJson ? "Structured listing data marks the item active or in stock." : "The public page still exposes a purchase or offer action.");
  } else if (httpStatus >= 400) {
    status = "unknown";
    evidence.push(`Source returned HTTP ${httpStatus}; availability could not be confirmed.`);
  }

  const currency = stringValue(keyValue(records, ["priceCurrency", "currency", "currencyCode"])) ||
    meta(html, ["product:price:currency", "og:price:currency"]) || "USD";
  const currentPrice = numeric(keyValue(records, ["price", "currentPrice", "current_price", "salePrice", "sale_price"])) ??
    numeric(meta(html, ["product:price:amount", "og:price:amount"]));
  const directSoldPrice = numeric(keyValue(records, [
    "soldPrice", "sold_price", "transactionPrice", "transaction_price", "purchasePrice", "purchase_price", "finalPrice", "final_price",
  ]));
  const visibleSoldPrice = numeric(text.match(/\bsold\s+(?:for|at)\s+(?:USD\s*)?([$£€¥]?\s*[\d,.]+(?:\.\d{1,2})?)/i)?.[1]);
  const soldPrice = status === "sold" ? (directSoldPrice ?? visibleSoldPrice) : undefined;
  if (status === "sold" && soldPrice !== undefined) {
    evidence.push("A public sold-price field was found.");
  }

  const soldAt = dateValue(keyValue(records, [
    "soldAt", "sold_at", "purchasedAt", "purchased_at", "transactionDate", "transaction_date", "completedAt", "completed_at",
  ])) ?? dateValue(text.match(/\bsold\s+on\s+([A-Z][a-z]+\s+\d{1,2},?\s+20\d{2})/i)?.[1]);
  if (soldAt) evidence.push("A public sold/completed timestamp was found.");

  if (status === "unknown") caveats.push("The public page did not expose a reliable active, sold, or removed state.");
  if (status === "sold" && soldPrice === undefined) caveats.push("The listing appears sold, but no readable sold price was published.");
  if (status === "sold" && !soldAt) caveats.push("The listing appears sold, but no readable sold date was published.");
  if (httpStatus === 403 || httpStatus === 429) caveats.push("The source limited public access; no login or anti-bot bypass was attempted.");

  const confidence = status === "removed" ? 96
    : soldByJson ? 92
      : soldByText ? 78
        : activeByJson ? 86
          : activeByText ? 68
            : 20;

  return {
    status,
    checkedAt: new Date().toISOString(),
    sourceUrl: url,
    finalUrl,
    sourceTitle: title,
    currency,
    currentPrice,
    soldPrice,
    soldAt,
    confidence,
    evidence: unique(evidence),
    caveats: unique(caveats),
  };
}
