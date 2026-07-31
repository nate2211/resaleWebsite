export type DepopReaderRecord = {
  url: string;
  title: string;
  brand: string;
  size: string;
  price: number;
  currency: "USD";
  image: string;
  description: string;
};


export type DepopProductRecord = DepopReaderRecord & {
  condition: string;
  seller: string;
};

function htmlEntityText(value: string) {
  return cleanText(value)
    .replaceAll("&#36;", "$")
    .replaceAll("&pound;", "£")
    .replaceAll("&yen;", "¥");
}

/** Parse one normal Depop /products/ page or its readable page-source form. */
export function parseDepopProductPageSource(source: string, pageUrl: string): DepopProductRecord | null {
  const url = canonicalDepopUrl(pageUrl.replace(/^view-source:/i, ""));
  if (!url) return null;
  const normalized = source.replace(/\r\n?/g, "\n")
    .replaceAll("\u002F", "/")
    .replaceAll("\u0026", "&")
    .replaceAll("\/", "/")
    .replaceAll("&amp;", "&");
  const meta = (property: string) => normalized.match(new RegExp(`<meta[^>]+(?:property|name)=["']${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]+content=["']([^"']+)["']`, "i"))?.[1]
    || normalized.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["']`, "i"))?.[1] || "";
  const title = htmlEntityText(
    meta("og:title")
    || meta("twitter:title")
    || normalized.match(/^#\s+([^\n]{3,400})/m)?.[1]
    || normalized.match(/"(?:display_?title|product_?name|item_?name|title)"\s*:\s*"([^"\n]{3,400})"/i)?.[1]
    || "Depop listing",
  ).replace(/\s*[|·-]\s*Depop\s*$/i, "").trim();
  const image = bestDepopImage(normalized)
    || meta("og:image").replaceAll("&amp;", "&")
    || meta("twitter:image").replaceAll("&amp;", "&");
  const priceValues = [
    meta("product:price:amount"),
    ...[...normalized.matchAll(/(?:US\$|\$)\s*([\d,.]+)/gi)].map((match) => match[1]),
  ].map((value) => Number.parseFloat(String(value).replaceAll(",", "")))
    .filter((value) => Number.isFinite(value) && value > 0);
  const price = priceValues[0] || priceValues.at(-1) || 0;
  const size = htmlEntityText(
    normalized.match(/(?:^|\n)\s*Size\s+([^\n•]{1,40})/i)?.[1]
    || normalized.match(/"(?:display_?size|size_name|size)"\s*:\s*"([^"\n]{1,80})"/i)?.[1]
    || "Unknown",
  );
  const condition = htmlEntityText(
    normalized.match(/(?:^|\n)\s*(Excellent|Good|Fair|Brand new|Like new|Used)[^\n•]{0,40}condition/i)?.[0]
    || normalized.match(/"condition"\s*:\s*"([^"\n]{2,100})"/i)?.[1]
    || "Check listing",
  );
  const brand = htmlEntityText(
    normalized.match(/"(?:brand_name|brandName|brand)"\s*:\s*"([^"\n]{2,120})"/i)?.[1]
    || normalized.match(/(?:condition\s*\n?\s*•?\s*)([A-Z][^\n]{1,100})/i)?.[1]
    || "Unspecified",
  );
  const seller = htmlEntityText(
    normalized.match(/item listed by\s+([^\]\n<]{2,100})/i)?.[1]
    || normalized.match(/(?:^|\n)(@[a-z0-9_.-]{2,60}|_[a-z0-9_.-]{2,60})\s*(?:\n|$)/im)?.[1]
    || normalized.match(/"(?:username|seller_username|sellerName)"\s*:\s*"([^"\n]{2,100})"/i)?.[1]
    || "",
  );
  const description = htmlEntityText(
    meta("og:description")
    || meta("description")
    || normalized.match(/(?:Buyer Protection[^\n]*\n+[-*\s]*)([\s\S]{20,1600}?)(?:\n[-*\s]*Visit shop|\n## More from this seller)/i)?.[1]
    || normalized,
  ).slice(0, 1200);
  if (!isDepopListingImageUrl(image) || price <= 0
    || !title || /^(?:depop|depop listing|marketplace listing|untitled listing)$/i.test(title)) return null;
  return {
    url,
    title: title || "Depop listing",
    brand: brand || "Unspecified",
    size: size || "Unknown",
    price,
    currency: "USD",
    image,
    description: [description, seller ? `Seller ${seller}.` : ""].filter(Boolean).join(" "),
    condition: condition || "Check listing",
    seller,
  };
}

export type GrailedPublicConfig = {
  appId: string;
  apiKey: string;
  activeIndex: string;
  soldIndex: string;
};

export const GRAILED_PUBLIC_CONFIG_FALLBACK: GrailedPublicConfig = {
  appId: "MNRWEFSS2Q",
  apiKey: "c89dbaddf15fe70e1941a109bf7c2a3d",
  activeIndex: "Listing_production",
  soldIndex: "Listing_sold_production",
};

function cleanText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#x27;", "'")
    .replace(/\\([*_`#[\]()])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}


function isDepopProductSlug(slug: string) {
  const normalized = slug.trim().toLowerCase();
  return normalized.length >= 10
    && normalized.includes("-")
    && /-[a-z0-9]{4,12}$/.test(normalized)
    && !/^(?:create|login|signup|search)$/.test(normalized);
}

export function isDepopListingImageUrl(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:"
      && parsed.hostname.toLowerCase() === "media-photos.depop.com"
      && !/(?:placeholder|fallback|loading|logo|favicon|avatar|badge|qr[-_]?code)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function canonicalDepopUrl(value: string) {
  try {
    const parsed = new URL(value, "https://www.depop.com/");
    if (!/(^|\.)depop\.com$/i.test(parsed.hostname)) return "";
    const slug = parsed.pathname.match(/^\/products\/([^/]+)\/?$/i)?.[1] || "";
    if (!isDepopProductSlug(slug)) return "";
    parsed.search = "";
    parsed.hash = "";
    if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
    return parsed.toString();
  } catch {
    return "";
  }
}

function bestDepopImage(block: string) {
  const values = [...block.matchAll(/https:\/\/media-photos\.depop\.com\/[^)\s"'<>]+/gi)]
    .map((match) => match[0].replaceAll("&amp;", "&"));
  const unique = [...new Set(values)];
  unique.sort((a, b) => {
    const score = (value: string) => /\/P0\.(?:jpe?g|png|webp)(?:$|\?)/i.test(value) ? 3
      : /\/P10\.(?:jpe?g|png|webp)(?:$|\?)/i.test(value) ? 2 : 1;
    return score(b) - score(a);
  });
  return unique[0] || "";
}

function lastItemMarker(source: string, beforeIndex: number) {
  const start = Math.max(0, beforeIndex - 12_000);
  const segment = source.slice(start, beforeIndex);
  const marker = /(?:^|\n)\s*\d+\.\s+/g;
  let match: RegExpExecArray | null;
  let found = start;
  while ((match = marker.exec(segment))) found = start + match.index;
  return found;
}

function nextItemMarker(source: string, afterIndex: number) {
  const segment = source.slice(afterIndex, Math.min(source.length, afterIndex + 12_000));
  const match = segment.match(/\n\s*\d+\.\s+/);
  return match?.index === undefined ? Math.min(source.length, afterIndex + 4_000) : afterIndex + match.index;
}

function depopSize(lines: string[]) {
  const sizePattern = /^(?:XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|ONE SIZE|OS|O\/S|\d{1,3}(?:\.5)?(?:\s*(?:US|UK|EU))?)$/i;
  return lines.find((line) => sizePattern.test(line)) || "Unknown";
}

/** Parse Depop cards from readable Markdown, serialized React text, or plain page-source links. */
export function parseDepopReaderMarkdown(source: string): DepopReaderRecord[] {
  const text = source.replace(/\r\n?/g, "\n")
    .replaceAll("\\u002F", "/")
    .replaceAll("\\u0026", "&")
    .replaceAll("\\/", "/")
    .replaceAll("&amp;", "&");
  const output = new Map<string, DepopReaderRecord>();
  const candidates = [
    ...text.matchAll(/https?:\/\/(?:www\.)?depop\.com\/products\/[a-z0-9_-]+\/?(?:\?[^)\s"'<>]*)?/gi),
    ...text.matchAll(/(?<![a-z0-9])\/products\/[a-z0-9_-]+\/?/gi),
  ].sort((a, b) => (a.index || 0) - (b.index || 0));

  for (const match of candidates) {
    const rawUrl = match[0];
    const url = canonicalDepopUrl(rawUrl);
    if (!url || output.has(url) || /\/products\/create\//i.test(url)) continue;
    const matchIndex = match.index || 0;
    const markerStart = lastItemMarker(text, matchIndex);
    const markerEnd = nextItemMarker(text, matchIndex + match[0].length);
    const hasNearbyMarker = markerStart > 0 || /(?:^|\n)\s*\d+\.\s+/.test(text.slice(0, Math.min(text.length, matchIndex + 1)));
    const start = hasNearbyMarker ? markerStart : Math.max(0, matchIndex - 2_000);
    const end = hasNearbyMarker ? markerEnd : Math.min(text.length, matchIndex + 3_500);
    const block = text.slice(start, end);
    const image = bestDepopImage(block);

    const markdownLabel = block.match(new RegExp(`\\[([^\\]]{3,320})\\]\\([^)]*${url.split('/products/')[1].replace(/[.*+?^${}()|[\\]\\]/g, "\\$&").replace(/\/$/, "")}`, "i"))?.[1] || "";
    const title = cleanText(
      block.match(/!\[(?:Image\s+\d+:\s*)?([^\]]{3,320})\]\(https:\/\/media-photos\.depop\.com\//i)?.[1]
        || block.match(/!\[([^\]]{3,320})\]\(https:\/\/media-photos\.depop\.com\//i)?.[1]
        || block.match(/"(?:display_?title|product_?name|item_?name|title|name)"\s*:\s*"([^"\n]{3,320})"/i)?.[1]
        || block.match(/(?:aria-label|title|alt)\s*=\s*["']([^"']{3,320})["']/i)?.[1]
        || markdownLabel
        || "Depop listing",
    );

    const afterLink = block.slice(Math.max(0, block.indexOf(rawUrl) + rawUrl.length));
    const lines = afterLink.split(/\n+/).map(cleanText).filter(Boolean);
    const prices = [...block.matchAll(/(?:US\$|\$)\s*([\d,.]+)/gi)]
      .map((priceMatch) => Number.parseFloat(priceMatch[1].replaceAll(",", "")))
      .filter((value) => Number.isFinite(value) && value > 0);
    const price = prices.at(-1) || 0;
    const size = depopSize(lines);
    const brandCandidate = lines.find((line) => !/^(?:US\$|\$|\d+[,.]?\d*)/.test(line)
      && line !== size && line.length <= 80
      && !/^(?:Loading|Filter|Sort|Feedback|Buy now|Make offer|Add to bag)$/i.test(line)) || "Unspecified";
    const brand = brandCandidate.replace(/^[)\]}>.,;:\-–—\s]+/, "").trim() || "Unspecified";
    const description = cleanText(block).slice(0, 900);

    output.set(url, {
      url,
      title: title || "Depop listing",
      brand,
      size,
      price,
      currency: "USD",
      image,
      description,
    });
  }
  return [...output.values()];
}

function firstMatch(source: string, patterns: RegExp[]) {
  for (const pattern of patterns) {
    const value = source.match(pattern)?.[1]?.trim();
    if (value) return value;
  }
  return "";
}

/** Read Grailed's public Algolia configuration from its official page source. */
export function parseGrailedPublicConfig(source: string): GrailedPublicConfig | null {
  const appId = firstMatch(source, [
    /"app_id"\s*:\s*"([A-Z0-9]+)"/i,
    /"appId"\s*:\s*"([A-Z0-9]+)"/i,
  ]);
  const apiKey = firstMatch(source, [
    /"public_search_key"\s*:\s*"([a-z0-9]+)"/i,
    /"publicSearchKey"\s*:\s*"([a-z0-9]+)"/i,
    /"public_query_key"\s*:\s*"([a-z0-9]+)"/i,
    /"publicQueryKey"\s*:\s*"([a-z0-9]+)"/i,
  ]);
  if (!appId || !apiKey) return null;
  const activeIndex = /"value"\s*:\s*"(Listing_production)"/i.test(source)
    ? "Listing_production" : GRAILED_PUBLIC_CONFIG_FALLBACK.activeIndex;
  const soldIndex = /"value"\s*:\s*"(Listing_sold_production)"/i.test(source)
    ? "Listing_sold_production" : GRAILED_PUBLIC_CONFIG_FALLBACK.soldIndex;
  return { appId, apiKey, activeIndex, soldIndex };
}

function valueText(value: unknown) {
  return typeof value === "string" ? value.trim()
    : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function valueNumber(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function nestedRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

function grailedCanonicalUrl(value: string, fallback = "") {
  try {
    const parsed = new URL(value || fallback, fallback || "https://www.grailed.com/");
    if (parsed.protocol !== "https:" || !/(^|\.)grailed\.com$/i.test(parsed.hostname)) return "";
    if (!/^\/listings\/\d+(?:-[^/?#]+)?\/?$/i.test(parsed.pathname)) return "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

/** True only for a first-party Grailed listing photo, never measurement/site artwork. */
export function isGrailedListingImageUrl(value: string) {
  try {
    const parsed = new URL(value, "https://www.grailed.com/");
    if (parsed.protocol !== "https:") return false;
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const allowedHost = [
      "media-assets.grailed.com", "media.grailed.com", "cdn-images.grailed.com",
      "images.grailed.com", "process.fs.grailed.com",
    ].some((domain) => host === domain || host.endsWith(`.${domain}`));
    if (!allowedHost) return false;
    if (/(?:measurement(?:-type)?|size[-_ ]?chart|how-to-measure|placeholder|default|fallback|loading|empty|logo|favicon|avatar|badge|misc)/i.test(path)) {
      return false;
    }
    // Current first-party listing photos use /prd/listing/<listing id>/<asset id>.
    // Older hosts are accepted only when their path still contains /listing/.
    return /\/prd\/listing\/(?:\d+|temp)\/[a-z0-9_-]+/i.test(path)
      || /\/listing\/\d+\/[a-z0-9_-]+/i.test(path);
  } catch {
    return false;
  }
}

function firstGrailedListingImage(value: unknown, depth = 0): string {
  if (depth > 6 || value === null || value === undefined) return "";
  if (typeof value === "string") {
    const text = value.trim().replaceAll("&amp;", "&");
    return isGrailedListingImageUrl(text) ? text : "";
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = firstGrailedListingImage(item, depth + 1);
      if (found) return found;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of [
    "original_url", "originalUrl", "large_url", "largeUrl", "retina_url", "retinaUrl",
    "url", "src", "image_url", "imageUrl", "secure_url", "secureUrl", "large", "original",
  ]) {
    const found = firstGrailedListingImage(record[key], depth + 1);
    if (found) return found;
  }
  for (const key of Object.keys(record)) {
    if (!/(?:photo|image|cover|picture|thumbnail)/i.test(key)) continue;
    const found = firstGrailedListingImage(record[key], depth + 1);
    if (found) return found;
  }
  return "";
}

function grailedRecordUrl(record: Record<string, unknown>) {
  return valueText(record.url) || valueText(record.web_url) || valueText(record.webUrl)
    || valueText(record.pretty_path) || valueText(record.prettyPath) || valueText(record.path);
}

function grailedTitle(record: Record<string, unknown>) {
  return valueText(record.title) || valueText(record.display_title) || valueText(record.displayTitle)
    || valueText(record.name);
}

function grailedPrice(record: Record<string, unknown>) {
  return valueNumber(record.sold_price) || valueNumber(record.soldPrice)
    || valueNumber(record.price) || valueNumber(record.current_price)
    || valueNumber(record.currentPrice) || valueNumber(record.listing_price);
}

/** Guard used by generic JSON walking so config/measurement objects cannot become cards. */
export function isGrailedListingRecord(record: Record<string, unknown>) {
  const image = firstGrailedListingImage(record.image_url) || firstGrailedListingImage(record.image)
    || firstGrailedListingImage(record.cover_photo) || firstGrailedListingImage(record.coverPhoto)
    || firstGrailedListingImage(record.photos) || firstGrailedListingImage(record.images);
  if (!image) return false;

  const serialized = JSON.stringify(record).slice(0, 80_000);
  if (/measurement(?:Type|_type|-type)|buyerDescription|buyer_description|sellerDescription|seller_description/i.test(serialized)
      && !/(?:prettyPath|pretty_path|\/listings\/\d+)/i.test(serialized)) return false;

  const title = grailedTitle(record);
  if (!title || title.length < 3 || /^(?:chest|length|shoulders|sleeve length|waist|rise|inseam|hem|knee|chain length)$/i.test(title)) {
    return false;
  }

  const explicitUrl = grailedRecordUrl(record);
  if (explicitUrl && grailedCanonicalUrl(explicitUrl, "https://www.grailed.com/")) return true;

  const id = valueText(record.id) || valueText(record.objectID);
  if (!/^\d+$/.test(id)) return false;
  const strongSignals = [
    grailedPrice(record) > 0,
    Boolean(record.designers || record.designer_names || record.designerNames || record.brand),
    Boolean(record.category || record.category_path || record.categoryPath || record.subcategory),
    Boolean(record.created_at || record.createdAt || record.trueCreatedAt || record.sold_at || record.soldAt),
    Boolean(record.slug || record.pretty_size || record.prettySize || record.display_size),
  ].filter(Boolean).length;
  return strongSignals >= 2;
}

function grailedBrand(record: Record<string, unknown>) {
  if (typeof record.designerNames === "string") return record.designerNames.trim();
  if (typeof record.designer_names === "string") return record.designer_names.trim();
  if (Array.isArray(record.designers)) {
    return record.designers.map((value) => valueText(nestedRecord(value)?.name) || valueText(value))
      .filter(Boolean).join(" × ");
  }
  return valueText(record.brand) || valueText(nestedRecord(record.designer)?.name);
}

function grailedShipping(record: Record<string, unknown>) {
  const direct = valueNumber(record.shipping_price) || valueNumber(record.shippingPrice)
    || valueNumber(record.soldShippingPrice);
  if (direct) return direct;
  const shipping = nestedRecord(record.shipping);
  if (!shipping) return 0;
  const us = nestedRecord(shipping.us);
  return valueNumber(us?.amount);
}

function grailedCondition(record: Record<string, unknown>, sold: boolean) {
  if (sold) return "Sold";
  const raw = valueText(record.condition) || valueText(record.condition_name) || valueText(record.conditionName);
  if (!raw) return "Check listing";
  return raw.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/** Parse a normal Grailed product page from __NEXT_DATA__ or Product JSON-LD. */
export function parseGrailedProductPageSource(source: string, pageUrl: string) {
  const normalized = source.replace(/\r\n?/g, "\n")
    .replaceAll("\\u002F", "/").replaceAll("\\/", "/").replaceAll("&amp;", "&");
  const canonicalFromPage = grailedCanonicalUrl(pageUrl.replace(/^view-source:/i, ""));
  let listing: Record<string, unknown> | undefined;

  const nextMatch = normalized.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
  if (nextMatch?.[1]) {
    try {
      const payload = JSON.parse(nextMatch[1].trim()) as Record<string, unknown>;
      const props = nestedRecord(payload.props);
      const pageProps = nestedRecord(props?.pageProps);
      listing = nestedRecord(pageProps?.listing);
    } catch {
      // Fall through to JSON-LD/meta extraction.
    }
  }

  if (listing && isGrailedListingRecord(listing)) {
    const id = valueText(listing.id);
    const slug = valueText(listing.slug);
    const prettyPath = valueText(listing.prettyPath) || valueText(listing.pretty_path);
    const rawUrl = prettyPath || (id ? `/listings/${id}${slug ? `-${slug}` : ""}` : canonicalFromPage);
    const url = grailedCanonicalUrl(rawUrl, canonicalFromPage || "https://www.grailed.com/");
    const sold = listing.sold === true || Boolean(valueText(listing.soldAt) || valueText(listing.sold_at));
    const image = firstGrailedListingImage(listing.photos) || firstGrailedListingImage(listing.coverPhoto)
      || firstGrailedListingImage(listing.cover_photo) || firstGrailedListingImage(listing.image);
    const price = sold
      ? valueNumber(listing.soldPrice) || valueNumber(listing.sold_price) || valueNumber(listing.price)
      : valueNumber(listing.price);
    if (url && image && price > 0) {
      return {
        ...listing,
        url,
        title: grailedTitle(listing),
        brand: grailedBrand(listing) || "Unspecified",
        price,
        currency: "USD",
        image,
        size: valueText(listing.prettySize) || valueText(listing.pretty_size)
          || valueText(listing.displaySize) || valueText(listing.size),
        condition: grailedCondition(listing, sold),
        shipping: grailedShipping(listing),
        description: valueText(listing.description) || "Grailed product listing.",
      };
    }
  }

  for (const match of normalized.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const payload = JSON.parse(match[1].trim()) as Record<string, unknown>;
      const type = valueText(payload["@type"]);
      if (!/Product/i.test(type)) continue;
      const offers = nestedRecord(payload.offers);
      const brand = nestedRecord(payload.brand);
      const url = grailedCanonicalUrl(valueText(offers?.url) || valueText(payload.url), canonicalFromPage);
      const image = firstGrailedListingImage(payload.image);
      const price = valueNumber(offers?.price);
      const title = valueText(payload.name);
      if (!url || !image || !price || !title) continue;
      const sold = /OutOfStock/i.test(valueText(offers?.availability));
      return {
        url,
        title,
        brand: valueText(brand?.name) || "Unspecified",
        price,
        currency: valueText(offers?.priceCurrency) || "USD",
        image,
        size: "Unknown",
        condition: sold ? "Sold" : "Check listing",
        shipping: 0,
        description: valueText(payload.description) || "Grailed product listing.",
      };
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return null;
}

/** Convert one Grailed Algolia hit into a strict product-listing record. */
export function grailedHitToRecord(hit: Record<string, unknown>, mode: "active" | "sold") {
  if (!isGrailedListingRecord(hit)) return null;
  const id = valueText(hit.id) || valueText(hit.objectID);
  const slug = valueText(hit.slug);
  const prettyPath = valueText(hit.pretty_path) || valueText(hit.prettyPath);
  const rawUrl = grailedRecordUrl(hit) || prettyPath
    || (id ? `/listings/${id}${slug ? `-${slug.replace(new RegExp(`^${id}-?`), "")}` : ""}` : "");
  const url = grailedCanonicalUrl(rawUrl, "https://www.grailed.com/");
  const title = grailedTitle(hit);
  const image = firstGrailedListingImage(hit.image_url) || firstGrailedListingImage(hit.image)
    || firstGrailedListingImage(hit.cover_photo) || firstGrailedListingImage(hit.coverPhoto)
    || firstGrailedListingImage(hit.photos) || firstGrailedListingImage(hit.images);
  const price = mode === "sold"
    ? valueNumber(hit.sold_price) || valueNumber(hit.soldPrice) || valueNumber(hit.price)
    : valueNumber(hit.price) || valueNumber(hit.current_price) || valueNumber(hit.listing_price);
  if (!url || !title || !image || price <= 0) return null;

  return {
    ...hit,
    url,
    title,
    brand: grailedBrand(hit) || "Unspecified",
    price,
    currency: "USD",
    image,
    size: valueText(hit.pretty_size) || valueText(hit.prettySize)
      || valueText(hit.display_size) || valueText(hit.displaySize) || valueText(hit.size),
    condition: grailedCondition(hit, mode === "sold"),
    shipping: grailedShipping(hit),
    description: mode === "sold"
      ? "Historical sold-price evidence returned by Grailed's public listing index."
      : "Active listing returned by Grailed's public listing index.",
  };
}
