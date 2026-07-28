export type PublicMarketplace =
  | "Depop" | "Grailed" | "Poshmark" | "Mercari Japan"
  | "JDirectItems Auction" | "Rakuten" | "Rakuten Rakuma"
  | "Bunjang" | "Goofish";

export type PublicPrice = {
  amount: number;
  currency: string;
};

export type NormalizedPublicRecord = {
  title: string;
  brand: string;
  amount: number;
  currency: string;
  rawUrl: string;
  category: string;
  description: string;
  image: string;
  condition: string;
  size: string;
  listedAtValue?: unknown;
  listedAtField?: string;
};

function text(value: unknown) {
  return typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, " ")
        .replaceAll("&amp;", "&")
        .replaceAll("&quot;", '"')
        .replaceAll("&#x27;", "'")
        .replaceAll("&yen;", "¥")
        .replaceAll("&#165;", "¥")
        .replaceAll("&#xA5;", "¥")
        .replaceAll("&euro;", "€")
        .replaceAll("&pound;", "£")
        .replace(/\s+/g, " ")
        .trim()
    : "";
}

function positiveNumber(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function objectRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
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

function absolute(value: unknown, base: string) {
  if (typeof value !== "string" || !value) return "";
  try {
    return new URL(value.replaceAll("&amp;", "&").replaceAll("\\/", "/"), base).toString();
  } catch {
    return "";
  }
}

function money(value: unknown): PublicPrice {
  const record = objectRecord(value);
  if (!record) return { amount: positiveNumber(value), currency: "" };
  const currency = text(record.currency) || text(record.currencyCode) || text(record.priceCurrency)
    || text(record.currency_code) || text(record.currencyName) || text(record.currency_name);
  const cents = positiveNumber(record.cents) || positiveNumber(record.minorUnits)
    || positiveNumber(record.minor_units);
  if (cents) return { amount: cents / 100, currency };
  return {
    amount: positiveNumber(record.amount) || positiveNumber(record.value)
      || positiveNumber(record.price) || positiveNumber(record.current)
      || positiveNumber(record.priceAmount) || positiveNumber(record.price_amount)
      || positiveNumber(record.formatted) || positiveNumber(record.display),
    currency,
  };
}

function firstMoney(values: unknown[]) {
  for (const value of values) {
    const candidate = money(value);
    if (candidate.amount > 0) return candidate;
  }
  return { amount: 0, currency: "" } satisfies PublicPrice;
}

function genericImage(value: unknown, base: string): string {
  if (typeof value === "string") return absolute(value, base);
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = genericImage(child, base);
      if (found) return found;
    }
    return "";
  }
  const record = objectRecord(value);
  if (!record) return "";
  for (const key of ["url", "src", "imageUrl", "image_url", "full", "large", "medium", "original",
    "original_url", "originalUrl", "large_url", "largeUrl", "medium_url", "mediumUrl", "path"]) {
    const found = genericImage(record[key], base);
    if (found) return found;
  }
  // Depop preview/picture objects use numeric width keys such as 320, 640,
  // 960 and 1280. Prefer the largest public rendition for analysis cards.
  for (const key of Object.keys(record).filter((key) => /^\d{2,4}$/.test(key)).sort((a, b) => Number(b) - Number(a))) {
    const found = genericImage(record[key], base);
    if (found) return found;
  }
  return "";
}

export function priceFromPublicText(value: string): PublicPrice {
  const source = text(value);
  const patterns: Array<[string, RegExp]> = [
    // Match explicit Chinese-yuan prefixes before the generic yen symbol.
    ["CNY", /(?:CNY|RMB|CN¥|CN￥|元)\s*([\d,.]+)/i],
    ["JPY", /(?:JPY|JP¥|JP￥|(?<!CN)[¥￥])\s*([\d,.]+)/i],
    ["JPY", /([\d,.]+)\s*(?:JPY|円)/i],
    ["KRW", /(?:KRW|₩)\s*([\d,.]+)/i],
    ["KRW", /([\d,.]+)\s*(?:KRW|원)/i],
    ["EUR", /(?:EUR|€)\s*([\d,.]+)/i],
    ["GBP", /(?:GBP|£)\s*([\d,.]+)/i],
    ["USD", /(?:USD|US\$|\$)\s*([\d,.]+)/i],
  ];
  for (const [currency, pattern] of patterns) {
    const amount = positiveNumber(source.match(pattern)?.[1]);
    if (amount) return { amount, currency };
  }
  return { amount: 0, currency: "" };
}

function listedField(record: Record<string, unknown>) {
  for (const key of [
    "created_at", "createdAt", "dateCreated", "date_created", "listed_at", "listedAt",
    "published_at", "publishedAt", "datePublished", "publication_date", "creationDate",
    "creation_date", "onlineSince", "startTime", "start_time", "timestamp",
  ]) {
    if (record[key] !== undefined && record[key] !== null && record[key] !== "") {
      return { listedAtValue: record[key], listedAtField: key };
    }
  }
  return {};
}

export function normalizePublicListingRecord(
  record: Record<string, unknown>,
  marketplace: PublicMarketplace,
  pageUrl: string,
): NormalizedPublicRecord | null {
  const offerRaw = record.offers;
  const offer = offerRaw && typeof offerRaw === "object"
    ? (Array.isArray(offerRaw) ? objectRecord(offerRaw[0]) : objectRecord(offerRaw))
    : undefined;
  const pricingBreakdown = objectRecord(record.pricingBreakdown) || objectRecord(record.pricing_breakdown);
  const chosen = firstMoney([
    record.sold_price, record.soldPrice, record.currentPrice, record.current_price,
    record.buyoutPrice, record.buyout_price, record.buyNowPrice, record.buy_now_price,
    record.itemPrice, record.item_price, record.priceYen, record.price_yen,
    record.soldAmount, record.sold_amount, record.currentAmount, record.current_amount,
    record.startPrice, record.start_price, record.price, record.listing_price,
    record.original_price, offer?.price, offer?.lowPrice,
    pricingBreakdown?.fullPrice, pricingBreakdown?.sellerPrice,
  ]);
  const currency = chosen.currency || text(record.currency) || text(record.priceCurrency)
    || text(record.currencyCode) || text(offer?.priceCurrency)
    || (["Mercari Japan", "JDirectItems Auction", "Rakuten", "Rakuten Rakuma"].includes(marketplace) ? "JPY"
      : marketplace === "Bunjang" ? "KRW" : marketplace === "Goofish" ? "CNY" : "USD");
  const title = text(record.name) || text(record.title) || text(record.display_title)
    || text(record.ClearTitle) || text(record.clearTitle) || text(record.TranslatedTitle)
    || text(record.product_name) || text(record.productName) || text(record.itemName)
    || text(record.ItemTitle) || text(record.item_name) || text(record.auctionTitle) || text(record.productTitle)
    || text(record.itemTitle) || text(record.subject);
  const recordId = text(record.itemId) || text(record.ItemCode) || text(record.itemCode)
    || text(record.item_id) || text(record.productId) || text(record.ProductCode)
    || text(record.product_id) || text(record.objectID) || text(record.id);
  const generatedUrl = marketplace === "Goofish" && recordId
    ? `https://www.goofish.com/item?id=${encodeURIComponent(recordId)}`
    : marketplace === "Mercari Japan" && /^m\d+$/i.test(recordId)
      ? `https://jp.mercari.com/en/item/${recordId}`
      : marketplace === "Depop" && text(record.slug)
        ? `https://www.depop.com/products/${text(record.slug).replace(/^\/+|\/+$/g, "")}/`
        : "";
  const explicitUrl = record.url || record.web_url || record.path || record.pretty_path || record.prettyPath
    || record.productUrl || record.product_url
    || record.itemUrl || record.item_url || record.detailUrl || record.detail_url
    || record.shareUrl || record.share_url || generatedUrl;
  const rawUrl = absolute(explicitUrl, pageUrl);
  // Search-page state frequently contains useful product records before a price
  // is hydrated. Keep those real records so the frontend can merge card HTML
  // and, when needed, fetch the canonical listing page for the missing fields.
  // Never turn an arbitrary state object into a listing by falling back to the
  // search-page URL itself.
  if (!title || !rawUrl) return null;

  const brandRaw = record.brand;
  const brand = text(brandRaw) || nestedText(brandRaw, "name", "localizedName", "label");
  const category = [
    nestedText(record.category, "localizedName", "name", "label"),
    nestedText(record.subcategory, "localizedName", "name", "label"),
    nestedText(record.product_type, "localizedName", "name", "label"),
    text(record.productType), text(record.item_type), text(record.itemType),
    text(record.department), text(record.taxonomy),
  ].filter(Boolean).join(" ");
  const description = text(record.description) || text(record.localizedDescription)
    || text(record.originalDescription) || text(record.shortDescription)
    || text(record.itemDescription) || text(record.item_description);
  const imageRaw = record.image || record.imageUrl || record.ImageUrl || record.PreviewImageUrl
    || record.image_url || record.cover_image || record.cover_photo || record.coverPhoto
    || record.thumbnail || record.thumbnailUrl || record.ThumbnailUrl || record.thumbnail_url || record.imagePath
    || record.thumbnails || record.pictures || record.images || record.photos;
  const image = genericImage(imageRaw, pageUrl);
  const displayTitle = title;
  return {
    title: displayTitle,
    brand,
    amount: chosen.amount,
    currency,
    rawUrl,
    category,
    description,
    image,
    condition: nestedText(record.condition, "description", "localizedName", "name", "label")
      || text(record.itemCondition) || text(record.item_condition),
    size: text(record.measurementFormatted)
      || nestedText(record.size, "measurementFormatted", "size", "localizedName", "name", "label")
      || text(record.display_size) || text(record.itemSize),
    ...listedField(record),
  };
}
