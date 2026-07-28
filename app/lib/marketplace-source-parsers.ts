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

function canonicalDepopUrl(value: string) {
  try {
    const parsed = new URL(value, "https://www.depop.com/");
    if (!/(^|\.)depop\.com$/i.test(parsed.hostname)) return "";
    if (!/^\/products\/[^/]+\/?$/i.test(parsed.pathname)) return "";
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

/** Parse the image-wrapped numbered cards returned by Depop's readable page source. */
export function parseDepopReaderMarkdown(source: string): DepopReaderRecord[] {
  const text = source.replace(/\r\n?/g, "\n");
  const output = new Map<string, DepopReaderRecord>();
  const productLink = /\]\((https:\/\/(?:www\.)?depop\.com\/products\/[^)\s?#]+\/?(?:\?[^)\s]*)?)\)/gi;

  for (const match of text.matchAll(productLink)) {
    const rawUrl = match[1];
    const url = canonicalDepopUrl(rawUrl);
    if (!url || output.has(url)) continue;
    const matchIndex = match.index || 0;
    const start = lastItemMarker(text, matchIndex);
    const end = nextItemMarker(text, matchIndex + match[0].length);
    const block = text.slice(start, end);
    const image = bestDepopImage(block);
    if (!image) continue;

    const title = cleanText(
      block.match(/!\[(?:Image\s+\d+:\s*)?([^\]]{3,320})\]\(https:\/\/media-photos\.depop\.com\//i)?.[1]
        || block.match(/!\[([^\]]{3,320})\]\(https:\/\/media-photos\.depop\.com\//i)?.[1]
        || "Depop listing",
    );

    const tailStart = Math.max(0, block.indexOf(match[0]) + match[0].length);
    const tail = block.slice(tailStart);
    const lines = tail.split(/\n+/).map(cleanText).filter(Boolean);
    const prices = [...tail.matchAll(/(?:US\$|\$)\s*([\d,.]+)/gi)]
      .map((priceMatch) => Number.parseFloat(priceMatch[1].replaceAll(",", "")))
      .filter((value) => Number.isFinite(value) && value > 0);
    const price = prices.at(-1) || 0;
    const size = depopSize(lines);
    const brand = lines.find((line) => !/^(?:US\$|\$|\d+[,.]?\d*)/.test(line)
      && line !== size && line.length <= 80 && !/^(?:Loading|Filter|Sort|Feedback)$/i.test(line)) || "Unspecified";
    const description = cleanText(tail).slice(0, 900);

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
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function valueNumber(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function nestedRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/** Convert one Grailed Algolia hit into the generic record shape used by the frontend parser. */
export function grailedHitToRecord(hit: Record<string, unknown>, mode: "active" | "sold") {
  const id = valueText(hit.id) || valueText(hit.objectID);
  const slug = valueText(hit.slug);
  const prettyPath = valueText(hit.pretty_path) || valueText(hit.prettyPath);
  const rawUrl = valueText(hit.url) || valueText(hit.web_url) || prettyPath
    || (id ? `/listings/${id}${slug ? `-${slug.replace(new RegExp(`^${id}-?`), "")}` : ""}` : "");
  const title = valueText(hit.title) || valueText(hit.name) || valueText(hit.display_title);
  if (!rawUrl || !title) return null;

  const designers = Array.isArray(hit.designers)
    ? hit.designers.map((value) => valueText(nestedRecord(value)?.name) || valueText(value)).filter(Boolean).join(" × ")
    : "";
  const cover = nestedRecord(hit.cover_photo) || nestedRecord(hit.coverPhoto);
  const image = valueText(hit.image_url) || valueText(hit.image)
    || valueText(cover?.url) || valueText(cover?.original_url) || valueText(cover?.originalUrl);
  const price = mode === "sold"
    ? valueNumber(hit.sold_price) || valueNumber(hit.soldPrice) || valueNumber(hit.price)
    : valueNumber(hit.price) || valueNumber(hit.current_price) || valueNumber(hit.listing_price);

  return {
    ...hit,
    url: rawUrl,
    title,
    brand: designers || valueText(hit.designer_names) || valueText(hit.brand),
    price,
    currency: "USD",
    image,
    size: valueText(hit.size) || valueText(hit.display_size),
    condition: mode === "sold" ? "Sold" : valueText(hit.condition),
    shipping: valueNumber(hit.shipping_price),
    description: mode === "sold"
      ? "Historical sold-price evidence returned by Grailed's public listing index."
      : "Active listing returned by Grailed's public listing index.",
  };
}
