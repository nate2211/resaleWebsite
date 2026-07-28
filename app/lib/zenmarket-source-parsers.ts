export type ZenMarketName = "Mercari Japan" | "JDirectItems Auction" | "Rakuten" | "Rakuten Rakuma";

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

function canonicalUrl(marketplace: ZenMarketName, itemCode: string) {
  const encoded = encodeURIComponent(itemCode);
  if (marketplace === "Mercari Japan") return `https://zenmarket.jp/en/mercariproduct.aspx?itemCode=${encoded}`;
  if (marketplace === "Rakuten") return `https://zenmarket.jp/en/rakutenproduct.aspx?itemCode=${encoded}`;
  if (marketplace === "Rakuten Rakuma") return `https://zenmarket.jp/en/rakumaproduct.aspx?itemCode=${encoded}`;
  return `https://zenmarket.jp/en/auction.aspx?itemCode=${encoded}`;
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
    output.set(itemCode, {
      ...record,
      itemCode,
      title,
      url: explicitUrl || canonicalUrl(marketplace, itemCode),
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
