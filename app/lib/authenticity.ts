export type EvidenceStatus = "match" | "warning" | "unknown";
export type AuthenticityVerdict = "reference-consistent" | "inconclusive" | "high-risk";

export type AuthenticityEvidence = {
  label: string;
  status: EvidenceStatus;
  detail: string;
  sourceUrl?: string;
};

export type ReferenceProduct = {
  source: string;
  title: string;
  brand: string;
  url: string;
  image?: string;
  price?: number;
  currency?: string;
  season?: string;
  releaseDate?: string;
  colorways: string[];
  materials: string[];
  description?: string;
  similarity: number;
};

export type AuthenticitySource = {
  source: string;
  title: string;
  url: string;
  snippet: string;
  kind: "collection" | "product" | "search" | "page";
};

export type AuthenticityReport = {
  query: string;
  verdict: AuthenticityVerdict;
  confidence: number;
  summary: string;
  checks: AuthenticityEvidence[];
  references: ReferenceProduct[];
  sources: AuthenticitySource[];
  missingEvidence: string[];
  researchedAt: string;
  disclaimer: string;
};

export type ListingForAuthenticity = {
  title: string;
  brand?: string;
  description?: string;
  price?: number;
  condition?: string;
  size?: string;
  image?: string;
  url?: string;
};

export const RETAILER_KNOWLEDGE = [
  {
    id: "supremecommunity",
    name: "SupremeCommunity",
    domains: ["supremecommunity.com", "www.supremecommunity.com"],
    searchScope: "site:supremecommunity.com/season/itemdetails",
    role: "Supreme season, item, colorway, retail-price, and release reference",
    patterns: [
      "/season/{season}/",
      "/season/itemdetails/{id}/{slug}/",
      "/season/{season}/droplist/{date}/",
    ],
  },
  {
    id: "dover-street-market",
    name: "Dover Street Market",
    domains: ["shop-us.doverstreetmarket.com"],
    searchScope: "site:shop-us.doverstreetmarket.com/products",
    role: "Authorized-retailer product naming, color, material, SKU, and retail-price reference",
    patterns: ["/collections/{collection}", "/products/{product-handle}"],
  },
  {
    id: "end-clothing",
    name: "END.",
    domains: ["endclothing.com", "www.endclothing.com", "media.endclothing.com"],
    searchScope: "site:endclothing.com product",
    role: "Retailer product title, brand, image, color, style code, description, and price reference",
    patterns: ["/{locale}/brands/{brand}", "/{locale}/products/{product}"],
  },
  {
    id: "ssense",
    name: "SSENSE",
    domains: ["ssense.com", "www.ssense.com", "img.ssensemedia.com"],
    searchScope: "site:ssense.com product",
    role: "Retailer product title, designer, color, product ID, description, image, and price reference",
    patterns: ["/{locale}/{department}/designers/{brand}", "/{locale}/{department}/product/{brand}/{slug}/{id}"],
  },
] as const;

const COLOR_WORDS = [
  "black", "white", "red", "blue", "green", "olive", "navy", "royal", "gray", "grey",
  "brown", "tan", "beige", "cream", "yellow", "orange", "pink", "purple", "burgundy",
  "silver", "gold", "multicolor", "camo", "khaki", "natural", "clear",
];

const MATERIAL_WORDS = [
  "cotton", "wool", "polyester", "nylon", "leather", "suede", "silk", "linen", "denim",
  "cashmere", "viscose", "rayon", "canvas", "fleece", "rubber", "metal", "acrylic",
];

const STOP_WORDS = new Set([
  "the", "and", "with", "for", "from", "mens", "womens", "men", "women", "size", "new",
  "used", "authentic", "rare", "listing", "sale", "excellent", "good", "condition", "supreme",
]);

export function normalizeText(value: string) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string) {
  return new Set(
    value.toLowerCase().replace(/[^a-z0-9]+/g, " ").split(/\s+/)
      .filter((token) => token.length > 2 && !STOP_WORDS.has(token)),
  );
}

export function textSimilarity(left: string, right: string) {
  const a = tokenize(left);
  const b = tokenize(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const containment = shared / Math.min(a.size, b.size);
  const jaccard = shared / new Set([...a, ...b]).size;
  return Math.min(1, containment * 0.72 + jaccard * 0.28);
}

export function extractPrice(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function wordsFrom(text: string, dictionary: string[]) {
  const lower = text.toLowerCase();
  return dictionary.filter((word) => new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(lower));
}

function flattenJson(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJson);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const graph = Array.isArray(object["@graph"]) ? object["@graph"].flatMap(flattenJson) : [];
  const list = Array.isArray(object.itemListElement) ? object.itemListElement.flatMap(flattenJson) : [];
  const item = object.item && typeof object.item === "object" ? flattenJson(object.item) : [];
  return [object, ...graph, ...list, ...item];
}

function jsonLdRecords(html: string) {
  const records: Record<string, unknown>[] = [];
  const expression = /<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(expression)) {
    try {
      records.push(...flattenJson(JSON.parse(match[1].trim())));
    } catch {
      // Invalid blocks are ignored; metadata and page links remain usable.
    }
  }
  return records;
}

function metaMap(html: string) {
  const result: Record<string, string> = {};
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[match[1].toLowerCase()] = normalizeText(match[2] ?? match[3] ?? match[4] ?? "");
    }
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").toLowerCase();
    if (key && attrs.content && !result[key]) result[key] = attrs.content;
  }
  return result;
}

function titleFromHtml(html: string) {
  return normalizeText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
}

function absoluteUrl(value: string, baseUrl: string) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return "";
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? normalizeText(value) : "";
}

function productRecords(html: string) {
  return jsonLdRecords(html).filter((record) => {
    const type = Array.isArray(record["@type"]) ? record["@type"].join(" ") : String(record["@type"] ?? "");
    return /product/i.test(type) || (record.name && (record.offers || record.image));
  });
}

function readOffer(record: Record<string, unknown>) {
  const offers = Array.isArray(record.offers) ? record.offers[0] : record.offers;
  if (!offers || typeof offers !== "object") return {};
  const offer = offers as Record<string, unknown>;
  return {
    price: extractPrice(offer.price ?? offer.lowPrice ?? offer.highPrice),
    currency: stringValue(offer.priceCurrency),
  };
}

function readImage(value: unknown) {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return readImage(value[0]);
  if (value && typeof value === "object") return stringValue((value as Record<string, unknown>).url);
  return "";
}

function readBrand(value: unknown) {
  if (typeof value === "string") return normalizeText(value);
  if (value && typeof value === "object") {
    return stringValue((value as Record<string, unknown>).name);
  }
  return "";
}

export function extractReferenceProducts(
  html: string,
  pageUrl: string,
  sourceName: string,
  listingQuery: string,
): ReferenceProduct[] {
  const metadata = metaMap(html);
  const fallbackTitle = metadata["og:title"] || titleFromHtml(html);
  const fallbackDescription = metadata["og:description"] || metadata.description || "";
  const fallbackImage = metadata["og:image"] || metadata["twitter:image"] || "";
  const records = productRecords(html);
  const candidates: ReferenceProduct[] = records.map((record) => {
    const offer = readOffer(record);
    const name = stringValue(record.name) || fallbackTitle;
    const brand = readBrand(record.brand) || stringValue(record.manufacturer);
    const description = stringValue(record.description) || fallbackDescription;
    const url = absoluteUrl(stringValue(record.url) || pageUrl, pageUrl) || pageUrl;
    const text = `${name} ${brand} ${description}`;
    return {
      source: sourceName,
      title: name,
      brand,
      url,
      image: absoluteUrl(readImage(record.image) || fallbackImage, pageUrl),
      price: offer.price,
      currency: offer.currency || undefined,
      season: text.match(/\b(?:spring[- /]?summer|fall[- /]?winter|ss|fw|aw)\s*20\d{2}\b/i)?.[0],
      releaseDate: stringValue(record.releaseDate ?? record.datePublished) || undefined,
      colorways: unique(wordsFrom(text, COLOR_WORDS)),
      materials: unique(wordsFrom(text, MATERIAL_WORDS)),
      description: description || undefined,
      similarity: textSimilarity(listingQuery, `${brand} ${name}`),
    };
  });

  if (!candidates.length && fallbackTitle) {
    const visible = normalizeText(html.replace(/<script\b[\s\S]*?<\/script>/gi, " ").replace(/<style\b[\s\S]*?<\/style>/gi, " ")).slice(0, 20_000);
    const text = `${fallbackTitle} ${fallbackDescription} ${visible}`;
    const price = extractPrice(
      metadata["product:price:amount"] ||
      html.match(/(?:Regular price|Retail|Price)\s*\$?([\d,.]+)/i)?.[1] ||
      fallbackTitle.match(/\$([\d,.]+)/)?.[1],
    );
    candidates.push({
      source: sourceName,
      title: fallbackTitle.replace(/\s*[|–-]\s*(?:SSENSE|END\.|DSMNY E-SHOP).*$/i, "").trim(),
      brand: "",
      url: pageUrl,
      image: absoluteUrl(fallbackImage, pageUrl),
      price,
      currency: metadata["product:price:currency"] || (price ? "USD" : undefined),
      season: text.match(/\b(?:spring[- /]?summer|fall[- /]?winter|ss|fw|aw)\s*20\d{2}\b/i)?.[0],
      releaseDate: text.match(/(?:Release:\s*)?\b\d{1,2}(?:st|nd|rd|th)?\s+[A-Z][a-z]+\s+20\d{2}\b/)?.[0],
      colorways: unique(wordsFrom(text, COLOR_WORDS)),
      materials: unique(wordsFrom(text, MATERIAL_WORDS)),
      description: fallbackDescription || undefined,
      similarity: textSimilarity(listingQuery, fallbackTitle),
    });
  }

  return [...new Map(candidates
    .filter((item) => item.title && item.url)
    .sort((a, b) => b.similarity - a.similarity)
    .map((item) => [`${item.url}|${item.title}`, item])).values()]
    .slice(0, 12);
}

export function makeAuthenticityReport(
  listing: ListingForAuthenticity,
  references: ReferenceProduct[],
  sources: AuthenticitySource[],
): AuthenticityReport {
  const brand = normalizeText(listing.brand || "");
  const title = normalizeText(listing.title || "");
  const query = `${brand} ${title}`.trim();
  const best = references
    .map((reference) => ({
      ...reference,
      similarity: Math.max(reference.similarity, textSimilarity(query, `${reference.brand} ${reference.title}`)),
    }))
    .sort((a, b) => b.similarity - a.similarity);
  const close = best.filter((reference) => reference.similarity >= 0.36);
  const strongest = close[0];
  const listingText = `${title} ${listing.description || ""}`;
  const listingColors = wordsFrom(listingText, COLOR_WORDS);
  const listingMaterials = wordsFrom(listingText, MATERIAL_WORDS);
  const checks: AuthenticityEvidence[] = [];

  if (strongest) {
    checks.push({
      label: "Product identity",
      status: strongest.similarity >= 0.62 ? "match" : "unknown",
      detail: strongest.similarity >= 0.62
        ? `A close reference match was found: ${strongest.title}.`
        : `A possible reference was found, but the product-name match is only moderate: ${strongest.title}.`,
      sourceUrl: strongest.url,
    });
  } else {
    checks.push({
      label: "Product identity",
      status: "warning",
      detail: "No sufficiently close SupremeCommunity or authorized-retailer product reference was found.",
    });
  }

  if (brand) {
    const brandMatch = close.some((reference) =>
      !reference.brand || reference.brand.toLowerCase().includes(brand.toLowerCase()) ||
      reference.title.toLowerCase().includes(brand.toLowerCase()),
    );
    checks.push({
      label: "Brand alignment",
      status: brandMatch ? "match" : close.length ? "warning" : "unknown",
      detail: brandMatch
        ? `Reference naming is consistent with ${brand}.`
        : close.length
          ? `The closest references do not clearly confirm the stated brand ${brand}.`
          : "No close reference was available to compare brand naming.",
      sourceUrl: strongest?.url,
    });
  }

  const referenceColors = unique(close.flatMap((reference) => reference.colorways));
  if (listingColors.length || referenceColors.length) {
    const overlap = listingColors.filter((color) => referenceColors.includes(color));
    checks.push({
      label: "Colorway",
      status: !listingColors.length || !referenceColors.length ? "unknown" : overlap.length ? "match" : "warning",
      detail: overlap.length
        ? `Listing and reference share color language: ${overlap.join(", ")}.`
        : !listingColors.length
          ? `Reference colorways include ${referenceColors.slice(0, 8).join(", ")}; the listing description does not state a color clearly.`
          : !referenceColors.length
            ? `The listing states ${listingColors.join(", ")}, but the source page did not expose colorway text.`
            : `Listing color language (${listingColors.join(", ")}) does not match the extracted reference colors (${referenceColors.slice(0, 8).join(", ")}).`,
      sourceUrl: strongest?.url,
    });
  }

  const referenceMaterials = unique(close.flatMap((reference) => reference.materials));
  if (listingMaterials.length || referenceMaterials.length) {
    const overlap = listingMaterials.filter((material) => referenceMaterials.includes(material));
    checks.push({
      label: "Material description",
      status: !listingMaterials.length || !referenceMaterials.length ? "unknown" : overlap.length ? "match" : "warning",
      detail: overlap.length
        ? `Listing and retailer reference share material language: ${overlap.join(", ")}.`
        : !listingMaterials.length
          ? `Reference materials include ${referenceMaterials.slice(0, 6).join(", ")}; ask the seller for a clear care-label photo.`
          : !referenceMaterials.length
            ? `The listing states ${listingMaterials.join(", ")}, but source material text was unavailable.`
            : `Listing material language differs from the extracted reference description.`,
      sourceUrl: strongest?.url,
    });
  }

  const retailPrices = close.map((reference) => reference.price).filter((price): price is number => Boolean(price));
  if (listing.price && retailPrices.length) {
    const retail = retailPrices[0];
    const ratio = listing.price / retail;
    checks.push({
      label: "Price plausibility",
      status: ratio < 0.18 ? "warning" : "unknown",
      detail: ratio < 0.18
        ? `The listing price is about ${Math.round(ratio * 100)}% of the extracted retail reference. A low price is not proof of a fake, but it raises the verification burden.`
        : `The listing price is about ${Math.round(ratio * 100)}% of the extracted retail reference; price alone cannot establish authenticity.`,
      sourceUrl: strongest?.url,
    });
  }

  const description = (listing.description || "").toLowerCase();
  const photoSignals = [
    ["neck tag", /neck tag|collar tag/],
    ["wash/care tag", /wash tag|care tag|composition tag/],
    ["logo or graphic detail", /logo|print|graphic|embroidery/],
    ["hardware or construction", /zipper|hardware|stitch|seam|hem/],
    ["style code or product label", /style code|sku|product code|model code|barcode/],
  ] as const;
  const presentPhotoSignals = photoSignals.filter(([, expression]) => expression.test(description)).map(([label]) => label);
  checks.push({
    label: "Listing-photo coverage",
    status: presentPhotoSignals.length >= 3 ? "match" : presentPhotoSignals.length ? "unknown" : "warning",
    detail: presentPhotoSignals.length
      ? `The listing text mentions ${presentPhotoSignals.join(", ")}. Confirm the photos are sharp and belong to the offered item.`
      : "The listing description does not establish that key tags, construction details, and style identifiers are photographed.",
  });

  const warnings = checks.filter((check) => check.status === "warning").length;
  const matches = checks.filter((check) => check.status === "match").length;
  const closeQuality = strongest?.similarity ?? 0;
  const confidence = Math.max(5, Math.min(92, Math.round(
    closeQuality * 55 + Math.min(18, sources.length * 3) + matches * 7 - warnings * 8,
  )));
  const verdict: AuthenticityVerdict = warnings >= 3 || (!strongest && warnings >= 2)
    ? "high-risk"
    : strongest && closeQuality >= 0.56 && warnings <= 1
      ? "reference-consistent"
      : "inconclusive";
  const summary = verdict === "reference-consistent"
    ? "The listing is reasonably consistent with the product references that were found, but photos and physical details still require human verification."
    : verdict === "high-risk"
      ? "The available evidence contains multiple inconsistencies or lacks a reliable product reference. Treat the listing as high risk until stronger proof is supplied."
      : "The web evidence is not strong enough for a responsible authenticity conclusion. More item-specific photos or identifiers are needed.";
  const missingEvidence = [
    !/neck tag|collar tag/i.test(description) ? "Straight-on neck/collar tag photo" : "",
    !/wash tag|care tag|composition tag/i.test(description) ? "Front and back of every wash/care tag" : "",
    !/style code|sku|product code|model code|barcode/i.test(description) ? "Style code, SKU, barcode, or product-label photo" : "",
    !/stitch|seam|hem/i.test(description) ? "Close construction photos: stitching, seams, and hems" : "",
    !listing.image ? "At least one clear full-item image" : "",
  ].filter(Boolean);

  return {
    query,
    verdict,
    confidence,
    summary,
    checks,
    references: best.slice(0, 8),
    sources: sources.slice(0, 16),
    missingEvidence,
    researchedAt: new Date().toISOString(),
    disclaimer: "Reference matching is a research aid, not a certification. Counterfeits can copy public product details; inspect the physical item or use a qualified authentication service before purchase.",
  };
}
