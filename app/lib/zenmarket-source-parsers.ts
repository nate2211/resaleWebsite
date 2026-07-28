export type ZenMarketName = "Mercari Japan" | "JDirectItems Auction" | "Rakuten" | "Rakuten Rakuma";

const ZENMARKET_PRODUCT_PATH: Record<ZenMarketName, string> = {
  "Mercari Japan": "mercariproduct.aspx",
  "JDirectItems Auction": "auction.aspx",
  Rakuten: "rakutenproduct.aspx",
  "Rakuten Rakuma": "rakumaproduct.aspx",
};

function objectRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function valueOf(record: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (record[key] !== undefined && record[key] !== null) return record[key];
  const lower = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    const value = lower.get(key.toLowerCase());
    if (value !== undefined && value !== null) return value;
  }
  return undefined;
}

function textOf(record: Record<string, unknown>, keys: string[]) {
  const value = valueOf(record, keys);
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function priceFromControl(value: string) {
  const patterns: Array<[string, RegExp]> = [
    ["JPY", /data-(?:jpy|yen)=["']([\d,.]+)["']/i],
    ["USD", /data-(?:usd|dollar)=["']([\d,.]+)["']/i],
    ["EUR", /data-eur=["']([\d,.]+)["']/i],
    ["JPY", /(?:JPY|JP¥|¥|￥)\s*([\d,.]+)/i],
    ["JPY", /([\d,.]+)\s*(?:JPY|円)/i],
    ["USD", /(?:USD|US\$|\$)\s*([\d,.]+)/i],
    ["EUR", /(?:EUR|€)\s*([\d,.]+)/i],
  ];
  for (const [currency, pattern] of patterns) {
    const amount = Number.parseFloat(value.match(pattern)?.[1]?.replaceAll(",", "") || "0");
    if (Number.isFinite(amount) && amount > 0) return { amount, currency };
  }
  return { amount: 0, currency: "JPY" };
}

export function unwrapZenMarketPayload(value: unknown): unknown {
  let current = value;
  for (let index = 0; index < 5; index += 1) {
    if (typeof current === "string") {
      const clean = current.trim();
      if (!/^[\[{]/.test(clean)) break;
      try { current = JSON.parse(clean); continue; } catch { break; }
    }
    const record = objectRecord(current);
    if (!record) break;
    const wrapped = valueOf(record, ["d"]);
    if (wrapped !== undefined) { current = wrapped; continue; }
    if (Object.keys(record).length <= 5) {
      const data = valueOf(record, ["data", "result", "payload"]);
      if (data !== undefined) { current = data; continue; }
    }
    break;
  }
  return current;
}

export function zenMarketCanonicalUrl(
  marketplace: ZenMarketName,
  itemCode: string,
  context: { query?: string; page?: number; position?: number; cs?: number } = {},
) {
  const params = new URLSearchParams({ itemCode });
  if (context.cs !== undefined) params.set("cs", String(context.cs));
  if (context.query) params.set("q", context.query);
  if (context.page) params.set("p", String(context.page));
  if (context.position) params.set("pos", String(context.position));
  return `https://zenmarket.jp/${ZENMARKET_PRODUCT_PATH[marketplace]}?${params.toString()}`;
}

function canonicalUrl(marketplace: ZenMarketName, itemCode: string) {
  return zenMarketCanonicalUrl(marketplace, itemCode);
}

function cleanMarkup(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replace(/\\u([0-9a-f]{4})/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function productPathMatches(marketplace: ZenMarketName, pathname: string) {
  return pathname.toLowerCase().endsWith(`/${ZENMARKET_PRODUCT_PATH[marketplace]}`);
}

/** Parse ZenMarket's normal search-page source and embedded product links. */
export function parseZenMarketPageSource(source: string, marketplace: ZenMarketName, sourceUrl: string) {
  const normalized = source
    .replaceAll("\\u002F", "/")
    .replaceAll("\\u0026", "&")
    .replaceAll("\\/", "/")
    .replaceAll("&amp;", "&")
    .replaceAll('\\"', '"');
  const output = new Map<string, Record<string, unknown>>();
  let sourceQuery = "";
  let sourcePage = 1;
  try {
    const parsedSource = new URL(sourceUrl);
    sourceQuery = parsedSource.searchParams.get("q") || "";
    sourcePage = Math.max(1, Number(parsedSource.searchParams.get("p") || "1") || 1);
  } catch { /* fixture text may not include an absolute source URL */ }

  const escapedPath = ZENMARKET_PRODUCT_PATH[marketplace].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const linkPattern = new RegExp(
    `(?:https?:\\/\\/(?:www\\.)?zenmarket\\.jp)?\\/(?:en\\/)?${escapedPath}\\?[^\\s"'<>\\)]+`,
    "gi",
  );
  let position = 0;
  for (const match of normalized.matchAll(linkPattern)) {
    if (output.size >= 100) break;
    let parsed: URL;
    try { parsed = new URL(match[0], "https://zenmarket.jp/"); } catch { continue; }
    if (!productPathMatches(marketplace, parsed.pathname)) continue;
    const itemCode = parsed.searchParams.get("itemCode") || parsed.searchParams.get("itemcode") || "";
    if (!itemCode) continue;
    position += 1;
    const index = match.index || 0;
    const context = normalized.slice(Math.max(0, index - 1800), Math.min(normalized.length, index + 3000));
    const title = cleanMarkup(
      context.match(/<(?:h2|h3|h4)[^>]*class=["'][^"']*(?:item-title|product-title|translate)[^"']*["'][^>]*>([\s\S]{3,500}?)<\/(?:h2|h3|h4)>/i)?.[1]
      || context.match(/(?:aria-label|title|alt)=["']([^"']{3,500})["']/i)?.[1]
      || context.match(/"(?:ClearTitle|ItemTitle|ProductTitle|TranslatedTitle|title|name)"\s*:\s*"([^"\n]{3,500})"/i)?.[1]
      || `${marketplace} listing ${itemCode}`,
    );
    const imageUrl = (
      context.match(/<(?:img|source)[^>]*(?:data-original|data-src|src)=["'](https?:\/\/[^"']+)["']/i)?.[1]
      || context.match(/"(?:PreviewImageUrl|ImageUrl|imageUrl|ThumbnailUrl|thumbnail|image)"\s*:\s*"(https?:\/\/[^"\s]+)"/i)?.[1]
      || ""
    ).replaceAll("\\/", "/");
    const parsedPrice = priceFromControl(context);
    const cs = Number(parsed.searchParams.get("cs") || "") || undefined;
    const page = Number(parsed.searchParams.get("p") || sourcePage) || sourcePage;
    const pos = Number(parsed.searchParams.get("pos") || position) || position;
    const query = parsed.searchParams.get("q") || sourceQuery;
    output.set(itemCode, {
      itemCode,
      title,
      url: zenMarketCanonicalUrl(marketplace, itemCode, { query, page, position: pos, cs }),
      imageUrl,
      price: parsedPrice.amount,
      currency: parsedPrice.currency || "JPY",
      description: cleanMarkup(context).slice(0, 900),
      storeName: marketplace,
    });
  }

  // Some ZenMarket responses serialize item records without anchors. Recover
  // those records and rebuild the normal product route for the selected store.
  for (const match of normalized.matchAll(/"(?:ItemCode|itemCode|item_code)"\s*:\s*"([^"\n]+)"/gi)) {
    if (output.size >= 100) break;
    const itemCode = match[1].replaceAll("\\/", "/").trim();
    if (!itemCode || output.has(itemCode)) continue;
    position += 1;
    const index = match.index || 0;
    const context = normalized.slice(Math.max(0, index - 1200), Math.min(normalized.length, index + 2600));
    const title = cleanMarkup(
      context.match(/"(?:ClearTitle|ItemTitle|ProductTitle|TranslatedTitle|title|name)"\s*:\s*"([^"\n]{3,500})"/i)?.[1]
      || `${marketplace} listing ${itemCode}`,
    );
    const imageUrl = (
      context.match(/"(?:PreviewImageUrl|ImageUrl|imageUrl|ThumbnailUrl|thumbnail|image)"\s*:\s*"(https?:\/\/[^"\s]+)"/i)?.[1]
      || ""
    ).replaceAll("\\/", "/");
    const parsedPrice = priceFromControl(context);
    output.set(itemCode, {
      itemCode,
      title,
      url: zenMarketCanonicalUrl(marketplace, itemCode, { query: sourceQuery, page: sourcePage, position }),
      imageUrl,
      price: parsedPrice.amount,
      currency: parsedPrice.currency || "JPY",
      description: cleanMarkup(context).slice(0, 900),
      storeName: marketplace,
    });
  }
  return [...output.values()];
}

export function zenMarketCatalogRecords(value: unknown, marketplace: ZenMarketName) {
  const root = unwrapZenMarketPayload(value);
  const queue: unknown[] = [root];
  const seen = new Set<object>();
  const output = new Map<string, Record<string, unknown>>();
  let scanned = 0;
  while (queue.length && scanned < 10_000 && output.size < 120) {
    const current = queue.shift();
    scanned += 1;
    if (!current || typeof current !== "object") continue;
    if (seen.has(current as object)) continue;
    seen.add(current as object);
    if (Array.isArray(current)) {
      queue.push(...current.slice(0, 2_000));
      continue;
    }
    const record = current as Record<string, unknown>;
    queue.push(...Object.values(record).slice(0, 400));
    const itemCode = textOf(record, ["ItemCode", "itemCode", "item_code", "ProductCode", "AuctionId", "id"]);
    const title = textOf(record, ["ClearTitle", "title", "ItemTitle", "ProductTitle", "TranslatedTitle", "Name"]);
    if (!itemCode || !title) continue;
    const priceControl = textOf(record, ["PriceTextControl", "priceTextControl", "PriceHtml"]);
    const parsedPrice = priceFromControl(priceControl);
    const numericPrice = Number.parseFloat(textOf(record, ["Price", "price", "CurrentPrice", "priceValue"]).replace(/[^\d.]/g, ""));
    const price = Number.isFinite(numericPrice) && numericPrice > 0 ? numericPrice : parsedPrice.amount;
    const currency = textOf(record, ["Currency", "currency", "CurrencyCode"]) || parsedPrice.currency || "JPY";
    const imageUrl = textOf(record, ["PreviewImageUrl", "ImageUrl", "imageUrl", "ThumbnailUrl", "ItemImage"]);
    const explicitUrl = textOf(record, ["Url", "url", "ItemUrl", "ProductUrl", "DetailUrl", "href"]);
    let context: { query?: string; page?: number; position?: number; cs?: number } = {};
    if (explicitUrl) {
      try {
        const parsed = new URL(explicitUrl, "https://zenmarket.jp/");
        context = {
          query: parsed.searchParams.get("q") || undefined,
          page: Number(parsed.searchParams.get("p") || "") || undefined,
          position: Number(parsed.searchParams.get("pos") || "") || undefined,
          cs: Number(parsed.searchParams.get("cs") || "") || undefined,
        };
      } catch { /* rebuild without optional context */ }
    }
    output.set(itemCode, {
      ...record,
      itemCode,
      title,
      url: zenMarketCanonicalUrl(marketplace, itemCode, context),
      imageUrl,
      price,
      currency,
      description: textOf(record, ["Description", "ItemDescription", "StoreName"]) || `${marketplace} listing ${itemCode}`,
      storeId: textOf(record, ["StoreId", "storeId"]),
      storeName: textOf(record, ["StoreName", "storeName"]) || marketplace,
    });
  }
  return [...output.values()];
}
