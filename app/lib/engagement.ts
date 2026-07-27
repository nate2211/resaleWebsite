export type EngagementMarketplace = "Depop" | "Grailed" | "Poshmark";
export type DemandLevel = "very-high" | "high" | "moderate" | "low" | "unknown";

export type EngagementMetrics = {
  likes?: number;
  views?: number;
  clicks?: number;
  shares?: number;
  comments?: number;
  offers?: number;
};

export type EngagementSeller = {
  username?: string;
  followers?: number;
  itemsSold?: number;
  rating?: number;
  ratingCount?: number;
  verified?: boolean;
  trusted?: boolean;
  activity?: string;
};

export type EngagementEvidence = {
  label: string;
  value: string;
  source: string;
};

export type EngagementReport = {
  marketplace: EngagementMarketplace;
  url: string;
  metrics: EngagementMetrics;
  seller: EngagementSeller;
  listedAt?: string;
  ageDays?: number;
  sold?: boolean;
  boosted?: boolean;
  popularityScore: number;
  demandLevel: DemandLevel;
  confidence: number;
  completeness: number;
  engagementRate?: number;
  likesPerDay?: number;
  viewsPerDay?: number;
  scoreDrivers: string[];
  caveats: string[];
  evidence: EngagementEvidence[];
  readMethods: string[];
  inspectedAt: string;
};

type UnknownRecord = Record<string, unknown>;
type ParsedEngagement = {
  metrics: EngagementMetrics;
  seller: EngagementSeller;
  listedAt?: string;
  sold?: boolean;
  boosted?: boolean;
  extraCaveats: string[];
  source: string;
  readMethods: string[];
};

const METRIC_LABELS: Record<keyof EngagementMetrics, string> = {
  likes: "likes / favorites",
  views: "views",
  clicks: "clicks",
  shares: "shares",
  comments: "comments",
  offers: "offers",
};

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  const normalized = String(value ?? "").replaceAll(",", "").trim();
  const match = normalized.match(/(-?\d+(?:\.\d+)?)\s*([kmb])?/i);
  if (!match) return undefined;
  const base = Number.parseFloat(match[1]);
  if (!Number.isFinite(base) || base < 0) return undefined;
  const multiplier = match[2]?.toLowerCase() === "k" ? 1_000
    : match[2]?.toLowerCase() === "m" ? 1_000_000
      : match[2]?.toLowerCase() === "b" ? 1_000_000_000 : 1;
  return Math.round(base * multiplier * 100) / 100;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return undefined;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function ageInDays(value?: string) {
  if (!value) return undefined;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return undefined;
  return Math.max(0, (Date.now() - time) / 86_400_000);
}

function decodeEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function visibleText(html: string) {
  return decodeEntities(html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--([\s\S]*?)-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " "));
}

function findNumber(text: string, keys: string[]): number | undefined {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expressions = [
      new RegExp(`(?:"|\\\\")${escaped}(?:"|\\\\")\\s*:\\s*(?:"|\\\\")?(-?[\\d,.]+(?:\\.\\d+)?\\s*[kmb]?)`, "i"),
      new RegExp(`\\b${escaped}\\b\\s*[=:]\\s*["']?(-?[\\d,.]+(?:\\.\\d+)?\\s*[kmb]?)`, "i"),
    ];
    for (const expression of expressions) {
      const parsed = numberValue(expression.exec(text)?.[1]);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

function findString(text: string, keys: string[]): string | undefined {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(`(?:"|\\\\")${escaped}(?:"|\\\\")\\s*:\\s*(?:"|\\\\")([^"\\n]{1,240})(?:"|\\\\")`, "i");
    const value = expression.exec(text)?.[1]
      ?.replaceAll("\\u0026", "&")
      .replaceAll("\\/", "/")
      .replace(/\\+$/, "");
    if (value) return value;
  }
  return undefined;
}

function findBoolean(text: string, keys: string[]): boolean | undefined {
  for (const key of keys) {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const expression = new RegExp(`(?:"|\\\\")${escaped}(?:"|\\\\")\\s*:\\s*(true|false|0|1)`, "i");
    const parsed = booleanValue(expression.exec(text)?.[1]);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function findLabeledNumber(text: string, labels: string[]): number | undefined {
  for (const label of labels) {
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const patterns = [
      new RegExp(`([\\d,.]+(?:\\.\\d+)?\\s*[kmb]?)\\s+(?:public\\s+)?${escaped}\\b`, "i"),
      new RegExp(`\\b${escaped}\\b\\s*(?:count)?\\s*[:·-]?\\s*([\\d,.]+(?:\\.\\d+)?\\s*[kmb]?)`, "i"),
    ];
    for (const pattern of patterns) {
      const parsed = numberValue(pattern.exec(text)?.[1]);
      if (parsed !== undefined) return parsed;
    }
    if (new RegExp(`\\bone\\s+${escaped.replace(/s\?$/, "")}\\b`, "i").test(text)) return 1;
    if (new RegExp(`\\bno\\s+${escaped}\\b`, "i").test(text)) return 0;
  }
  return undefined;
}

function findMetaContent(html: string, keys: string[]) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs: Record<string, string> = {};
    for (const match of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
      attrs[match[1].toLowerCase()] = decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
    }
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").toLowerCase();
    if (keys.includes(key) && attrs.content) return attrs.content.trim();
  }
  return undefined;
}

function balancedJsonAt(text: string, start: number): unknown {
  const opener = text[start];
  if (opener !== "{" && opener !== "[") return undefined;
  const closer = opener === "{" ? "}" : "]";
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === opener) depth += 1;
    else if (character === closer) {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function extractJsonValueAfter(text: string, marker: string): unknown {
  const markerIndex = text.indexOf(marker);
  if (markerIndex < 0) return undefined;
  let start = markerIndex + marker.length;
  while (start < text.length && text[start] !== "{" && text[start] !== "[") start += 1;
  return balancedJsonAt(text, start);
}

function extractAssignedJson(text: string, names: string[]) {
  for (const name of names) {
    const expression = new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*=`, "g");
    for (const match of text.matchAll(expression)) {
      let start = (match.index ?? 0) + match[0].length;
      while (start < text.length && text[start] !== "{" && text[start] !== "[") start += 1;
      const parsed = balancedJsonAt(text, start);
      if (parsed !== undefined) return parsed;
    }
  }
  return undefined;
}

function decodeNextFlight(html: string) {
  const pieces: string[] = [];
  const expression = /self\.__next_f\.push\(\[1,("(?:\\.|[^"\\])*")\]\)/g;
  for (const match of html.matchAll(expression)) {
    try {
      pieces.push(JSON.parse(match[1]) as string);
    } catch {
      // Ignore malformed framework transport segments.
    }
  }
  return pieces.join("\n");
}

function jsonDocuments(html: string) {
  const values: unknown[] = [];
  const nextRaw = html.match(/<script\b[^>]*id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (nextRaw) {
    try { values.push(JSON.parse(nextRaw)); } catch { /* use fallbacks */ }
  }
  const assigned = extractAssignedJson(html, [
    "window.__INITIAL_STATE__", "window.__PRELOADED_STATE__", "window.__APOLLO_STATE__",
    "window.__NUXT__", "globalThis.__INITIAL_STATE__",
  ]);
  if (assigned !== undefined) values.push(assigned);
  for (const match of html.matchAll(/<script\b[^>]*type=["'](?:application\/ld\+json|application\/json)["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { values.push(JSON.parse(match[1].trim())); } catch { /* malformed public block */ }
  }
  return values;
}

function asRecord(value: unknown): UnknownRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : {};
}

function walk(value: unknown, callback: (key: string, value: unknown, parent: UnknownRecord) => unknown): unknown {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = walk(child, callback);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const parent = value as UnknownRecord;
  for (const [key, child] of Object.entries(parent)) {
    const found = callback(key, child, parent);
    if (found !== undefined) return found;
  }
  for (const child of Object.values(parent)) {
    const found = walk(child, callback);
    if (found !== undefined) return found;
  }
  return undefined;
}

function deepNumber(documents: unknown[], keys: string[]) {
  const wanted = new Set(keys.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, "")));
  for (const document of documents) {
    const value = walk(document, (key, child) => {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      return wanted.has(normalized) ? numberValue(child) : undefined;
    });
    if (typeof value === "number") return value;
  }
  return undefined;
}

function deepString(documents: unknown[], keys: string[]) {
  const wanted = new Set(keys.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, "")));
  for (const document of documents) {
    const value = walk(document, (key, child) => {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      return wanted.has(normalized) ? stringValue(child) : undefined;
    });
    if (typeof value === "string") return value;
  }
  return undefined;
}

function deepBoolean(documents: unknown[], keys: string[]) {
  const wanted = new Set(keys.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, "")));
  for (const document of documents) {
    const value = walk(document, (key, child) => {
      const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
      return wanted.has(normalized) ? booleanValue(child) : undefined;
    });
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function listedAtFromVisibleText(text: string) {
  const relative = text.match(/\b(?:listed|posted|published)\s+(?:about\s+)?([\d.]+)\s+(minute|hour|day|week|month|year)s?\s+ago\b/i);
  if (relative) {
    const amount = Number(relative[1]);
    const unit = relative[2].toLowerCase();
    const days = unit === "minute" ? amount / 1_440
      : unit === "hour" ? amount / 24
        : unit === "day" ? amount
          : unit === "week" ? amount * 7
            : unit === "month" ? amount * 30.4375 : amount * 365.25;
    return new Date(Date.now() - days * 86_400_000).toISOString();
  }
  if (/\b(?:listed|posted|published)\s+today\b/i.test(text)) return new Date().toISOString();
  if (/\b(?:listed|posted|published)\s+yesterday\b/i.test(text)) {
    return new Date(Date.now() - 86_400_000).toISOString();
  }
  return undefined;
}

function firstDate(html: string, documents: unknown[], keys: string[], text: string) {
  const time = html.match(/<time\b[^>]*datetime=["']([^"']+)["']/i)?.[1];
  return deepString(documents, keys)
    ?? findString(html, keys)
    ?? findMetaContent(html, ["article:published_time", "date", "datepublished", "datecreated"])
    ?? stringValue(time)
    ?? listedAtFromVisibleText(text);
}

function evidence(label: string, value: unknown, source: string): EngagementEvidence | null {
  if (value === undefined || value === null || value === "") return null;
  return { label, value: String(value), source };
}

function parsePoshmark(html: string): ParsedEngagement {
  const documents = jsonDocuments(html);
  const state = asRecord(extractAssignedJson(html, ["window.__INITIAL_STATE__"]));
  const details = asRecord(state.$_listing_details);
  const listing = asRecord(details.listingDetails);
  const listingMetrics = asRecord(details.listingMetrics);
  const metricsRecord = asRecord(listingMetrics.metrics);
  const lister = asRecord(details.listerData);
  const sellerAggregates = asRecord(lister.aggregates);
  const inventory = asRecord(listing.inventory);
  const quantities = Array.isArray(inventory.size_quantities)
    ? inventory.size_quantities.map(asRecord)
    : [];
  const text = visibleText(html);

  const likes = numberValue(metricsRecord.likes) ?? numberValue(listing.like_count)
    ?? deepNumber(documents, ["like_count", "likes_count", "likeCount", "favorite_count"])
    ?? findNumber(html, ["like_count", "likes_count", "likeCount", "favorite_count"])
    ?? findLabeledNumber(text, ["likes?", "favorites?"]);
  const views = numberValue(metricsRecord.views)
    ?? deepNumber(documents, ["view_count", "views_count", "page_views", "views"])
    ?? findNumber(html, ["view_count", "views_count", "page_views", "views"])
    ?? findLabeledNumber(text, ["views?"]);
  const clicks = numberValue(metricsRecord.clicks)
    ?? deepNumber(documents, ["click_count", "clicks_count", "clicks"])
    ?? findNumber(html, ["click_count", "clicks_count", "clicks"])
    ?? findLabeledNumber(text, ["clicks?"]);
  const shares = numberValue(listing.share_count)
    ?? deepNumber(documents, ["share_count", "shares_count", "shares"])
    ?? findNumber(html, ["share_count", "shares_count", "shares"])
    ?? findLabeledNumber(text, ["shares?"]);
  const comments = numberValue(listing.comment_count)
    ?? deepNumber(documents, ["comment_count", "comments_count", "comments"])
    ?? findNumber(html, ["comment_count", "comments_count", "comments"])
    ?? findLabeledNumber(text, ["comments?"]);
  const offers = numberValue(metricsRecord.buyer_offers) ?? numberValue(listing.active_buyer_offer_count)
    ?? deepNumber(documents, ["active_buyer_offer_count", "buyer_offers", "offer_count", "offers_count"])
    ?? findNumber(html, ["active_buyer_offer_count", "buyer_offers", "offer_count", "offers_count"])
    ?? findLabeledNumber(text, ["offers?"]);
  const listedAt = stringValue(listing.first_published_at) ?? stringValue(listing.created_at)
    ?? firstDate(html, documents, ["first_published_at", "created_at", "datePosted", "datePublished"], text);
  const quantitySold = quantities.reduce((sum, row) => sum + (numberValue(row.quantity_sold) ?? 0), 0);
  const inventoryStatus = stringValue(inventory.status)?.toLowerCase();
  const availability = findMetaContent(html, ["product:availability"])?.toLowerCase();
  const sold = quantitySold > 0 || inventoryStatus === "sold" || inventoryStatus === "not_available"
    || listing.active_item === false || availability === "outofstock"
    || /\b(?:this item|this listing|item)\s+(?:has been\s+)?sold\b|\bsold out\b/i.test(text);
  const ratingCount = numberValue(sellerAggregates.seller_rating_count)
    ?? deepNumber(documents, ["seller_rating_count", "ratingCount"]);
  const ratingValue = numberValue(sellerAggregates.seller_rating_value);

  return {
    metrics: { likes, views, clicks, shares, comments, offers },
    seller: {
      username: stringValue(lister.username) ?? stringValue(listing.creator_username),
      followers: numberValue(sellerAggregates.followers) ?? deepNumber(documents, ["followers_count", "followerCount"]),
      itemsSold: numberValue(sellerAggregates.seller_orders) ?? numberValue(sellerAggregates.items_sold_display)
        ?? deepNumber(documents, ["seller_orders", "items_sold_display", "itemsSold"]),
      rating: ratingCount && ratingValue !== undefined ? ratingValue / ratingCount
        : deepNumber(documents, ["ratingAverage", "seller_rating"]),
      ratingCount,
      activity: stringValue(sellerAggregates.last_active_date) ? "Recently active"
        : text.match(/\bActive\s+(?:today|this week|this month|recently)\b/i)?.[0],
    },
    listedAt,
    sold,
    boosted: false,
    extraCaveats: shares !== undefined
      ? ["Poshmark shares mainly measure closet recirculation, so they receive less weight than likes, views, clicks, and offers."]
      : [],
    source: "Poshmark embedded listing state, JSON-LD, and visible public counters",
    readMethods: ["embedded listing state", "JSON-LD and meta tags", "visible public counters"],
  };
}

function parseGrailed(html: string): ParsedEngagement {
  const documents = jsonDocuments(html);
  const next = asRecord(documents[0]);
  const props = asRecord(next.props);
  const pageProps = asRecord(props.pageProps);
  const listing = asRecord(pageProps.listing);
  const seller = asRecord(listing.seller);
  const sellerScore = asRecord(seller.sellerScore);
  const text = visibleText(html);
  const likes = numberValue(listing.followerCount)
    ?? findNumber(html, ["followerCount", "follower_count", "followerno"])
    ?? findLabeledNumber(text, ["followers?", "favorites?", "saves?"]);
  const views = numberValue(listing.viewCount)
    ?? findNumber(html, ["viewCount", "view_count", "views"])
    ?? findLabeledNumber(text, ["views?"]);
  const clicks = numberValue(listing.clickCount)
    ?? findNumber(html, ["clickCount", "click_count", "clicks"])
    ?? findLabeledNumber(text, ["clicks?"]);
  const comments = numberValue(listing.commentCount)
    ?? findNumber(html, ["commentCount", "comment_count", "comments"])
    ?? findLabeledNumber(text, ["comments?"]);
  const offers = numberValue(listing.offerCount)
    ?? findNumber(html, ["offerCount", "offer_count", "offers"])
    ?? findLabeledNumber(text, ["offers?"]);
  const shares = numberValue(listing.shareCount)
    ?? findNumber(html, ["shareCount", "share_count", "shares"])
    ?? findLabeledNumber(text, ["shares?"]);
  const listedAt = stringValue(listing.trueCreatedAt) ?? stringValue(listing.createdAt)
    ?? firstDate(html, documents, ["trueCreatedAt", "createdAt", "created_at", "datePosted"], text);
  const sold = booleanValue(listing.sold) ?? findBoolean(html, ["sold", "isSold", "is_sold"])
    ?? (/\b(?:listing|item)\s+(?:has been\s+)?sold\b|\bsold listing\b|\bsold out\b/i.test(text) ? true : undefined);
  return {
    metrics: { likes, views, clicks, shares, comments, offers },
    seller: {
      username: stringValue(seller.username),
      followers: numberValue(seller.followerCount),
      itemsSold: numberValue(sellerScore.soldCount),
      rating: numberValue(sellerScore.ratingAverage),
      ratingCount: numberValue(sellerScore.ratingCount),
      verified: booleanValue(seller.isVerified),
      trusted: booleanValue(seller.isTrustedSeller),
      activity: text.match(/\bActive\s+(?:today|this week|this month|recently)\b/i)?.[0],
    },
    listedAt,
    sold,
    boosted: booleanValue(listing.dropped),
    extraCaveats: ["Grailed calls listing saves/favorites followers; this is treated as the item-like signal."],
    source: "Grailed __NEXT_DATA__, listing record, and visible public counters",
    readMethods: ["__NEXT_DATA__ listing record", "JSON-LD and meta tags", "visible public counters"],
  };
}

function parseDepop(html: string): ParsedEngagement {
  const decoded = decodeNextFlight(html);
  const searchable = `${html}\n${decoded}`;
  const documents = jsonDocuments(html);
  const text = visibleText(html);
  const likes = findNumber(searchable, ["like_count", "likes_count", "likeCount", "likes", "favourites", "favorite_count"])
    ?? deepNumber(documents, ["like_count", "likes_count", "likeCount", "favorite_count"])
    ?? findLabeledNumber(text, ["likes?", "favorites?"]);
  const views = findNumber(searchable, ["view_count", "views_count", "viewCount", "views"])
    ?? deepNumber(documents, ["view_count", "views_count", "viewCount"])
    ?? findLabeledNumber(text, ["views?"]);
  const clicks = findNumber(searchable, ["click_count", "clicks_count", "clickCount", "clicks"])
    ?? deepNumber(documents, ["click_count", "clicks_count", "clickCount"])
    ?? findLabeledNumber(text, ["clicks?"]);
  const comments = findNumber(searchable, ["comment_count", "comments_count", "commentCount", "comments"])
    ?? deepNumber(documents, ["comment_count", "comments_count", "commentCount"])
    ?? findLabeledNumber(text, ["comments?"]);
  const offers = findNumber(searchable, ["offer_count", "offers_count", "offerCount", "offers"])
    ?? deepNumber(documents, ["offer_count", "offers_count", "offerCount"])
    ?? findLabeledNumber(text, ["offers?"]);
  const shares = findNumber(searchable, ["share_count", "shares_count", "shareCount", "shares"])
    ?? deepNumber(documents, ["share_count", "shares_count", "shareCount"])
    ?? findLabeledNumber(text, ["shares?"]);
  const listedAt = firstDate(html, documents, ["created_at", "published_at", "listed_at", "datePosted", "datePublished"], text);
  const status = findString(searchable, ["status", "active_status", "availability"])?.toUpperCase();
  const sold = status ? /SOLD|PURCHASED|UNAVAILABLE|OUT_OF_STOCK/.test(status)
    : /\bThis product has been sold\b|\bSold out from this seller\b/i.test(text) ? true : undefined;
  const boosted = findBoolean(searchable, ["is_boosted", "boosted"]);
  const ratingMatch = searchable.match(/"rating"\s*:\s*([\d.]+)\s*,\s*"count"\s*:\s*([\d,.]+)\s*,\s*"sellerUsername"\s*:\s*"([^"]+)"/i);
  const soldMatch = searchable.match(/"children"\s*:\s*"([\d,.]+)\s+sold"/i)
    ?? html.match(/>\s*([\d,.]+)\s+sold\s*</i);
  const activity = text.match(/\b(Active today|Active this week|Active this month|Active over a week ago|Active recently)\b/i)?.[1];
  return {
    metrics: { likes, views, clicks, shares, comments, offers },
    seller: {
      username: ratingMatch?.[3] ?? findString(searchable, ["username"]),
      followers: findNumber(searchable, ["followers_count", "follower_count", "followerCount"]),
      itemsSold: numberValue(soldMatch?.[1]),
      rating: numberValue(ratingMatch?.[1]),
      ratingCount: numberValue(ratingMatch?.[2]),
      verified: findBoolean(searchable, ["verified", "is_verified"]),
      trusted: findBoolean(searchable, ["trusted", "is_trusted"]),
      activity,
    },
    listedAt,
    sold,
    boosted,
    extraCaveats: likes === undefined
      ? ["Depop does not expose a public like count on every page variant. Missing likes are reported as unknown, not zero."]
      : [],
    source: "Depop React Flight state, JSON-LD, meta tags, and visible public counters",
    readMethods: ["React Flight / Next hydration state", "JSON-LD and meta tags", "visible public counters"],
  };
}


function scoreReport(
  marketplace: EngagementMarketplace,
  input: ParsedEngagement,
  url: string,
): EngagementReport {
  const metrics = input.metrics;
  const ageDays = ageInDays(input.listedAt);
  const dayBase = Math.max(1, ageDays ?? 7);
  const likesPerDay = metrics.likes !== undefined ? metrics.likes / dayBase : undefined;
  const viewsPerDay = metrics.views !== undefined ? metrics.views / dayBase : undefined;
  const shareInteractionWeight = marketplace === "Poshmark" ? 0.01 : 0.08;
  const interactions = (metrics.likes ?? 0) + (metrics.comments ?? 0) * 2.5
    + (metrics.offers ?? 0) * 4 + (metrics.clicks ?? 0) * 0.8
    + (metrics.shares ?? 0) * shareInteractionWeight;
  const engagementRate = metrics.views && metrics.views > 0 ? interactions / metrics.views : undefined;

  const components: { name: string; score: number; weight: number; driver?: string }[] = [];
  if (metrics.likes !== undefined) {
    const countScore = 100 * (1 - Math.exp(-metrics.likes / 24));
    const velocityScore = 100 * (1 - Math.exp(-(likesPerDay ?? 0) / 3.5));
    components.push({
      name: "likes",
      score: countScore * 0.58 + velocityScore * 0.42,
      weight: 0.38,
      driver: `${metrics.likes} like${metrics.likes === 1 ? "" : "s"}${ageDays !== undefined ? ` across ${Math.max(1, Math.round(ageDays))} days` : ""}`,
    });
  }
  if (metrics.views !== undefined) {
    const countScore = 100 * (1 - Math.exp(-metrics.views / 650));
    const velocityScore = 100 * (1 - Math.exp(-(viewsPerDay ?? 0) / 90));
    components.push({ name: "views", score: countScore * 0.55 + velocityScore * 0.45, weight: 0.23,
      driver: `${metrics.views} public view${metrics.views === 1 ? "" : "s"}` });
  }
  if (engagementRate !== undefined) {
    components.push({ name: "rate", score: 100 * (1 - Math.exp(-engagementRate * 15)), weight: 0.16,
      driver: `${(engagementRate * 100).toFixed(1)}% weighted interaction-to-view rate` });
  }
  if (metrics.offers !== undefined) {
    components.push({ name: "offers", score: 100 * (1 - Math.exp(-metrics.offers / 4)), weight: 0.12,
      driver: `${metrics.offers} active buyer offer${metrics.offers === 1 ? "" : "s"}` });
  }
  if (metrics.comments !== undefined) {
    components.push({ name: "comments", score: 100 * (1 - Math.exp(-metrics.comments / 7)), weight: 0.06,
      driver: `${metrics.comments} public comment${metrics.comments === 1 ? "" : "s"}` });
  }
  if (metrics.shares !== undefined) {
    components.push({ name: "shares", score: 100 * (1 - Math.exp(-metrics.shares / 600)), weight: marketplace === "Poshmark" ? 0.03 : 0.07,
      driver: `${metrics.shares} share${metrics.shares === 1 ? "" : "s"}` });
  }
  if (input.sold !== undefined) {
    components.push({ name: "sold", score: input.sold ? 96 : 35, weight: 0.12,
      driver: input.sold ? "The listing is marked sold" : undefined });
  }

  const totalWeight = components.reduce((sum, component) => sum + component.weight, 0);
  let popularityScore = totalWeight
    ? components.reduce((sum, component) => sum + component.score * component.weight, 0) / totalWeight
    : 0;
  if (input.boosted) popularityScore = Math.max(0, popularityScore - 4);
  popularityScore = Math.round(clamp(popularityScore));

  const metricAvailability = Object.values(metrics).filter((value) => value !== undefined).length;
  const sellerAvailability = [input.seller.followers, input.seller.itemsSold, input.seller.rating]
    .filter((value) => value !== undefined).length;
  const completeness = Math.round(clamp(metricAvailability / 6 * 72 + (input.listedAt ? 12 : 0)
    + (input.sold !== undefined ? 8 : 0) + sellerAvailability / 3 * 8));
  const confidence = Math.round(clamp(25 + completeness * 0.68 + (metrics.views !== undefined ? 7 : 0)
    + (metrics.likes !== undefined ? 5 : 0) - (input.boosted ? 4 : 0), 20, 96));
  const hasItemSignal = metricAvailability > 0 || input.sold === true;
  const demandLevel: DemandLevel = !hasItemSignal ? "unknown"
    : popularityScore >= 78 ? "very-high"
      : popularityScore >= 58 ? "high"
        : popularityScore >= 34 ? "moderate" : "low";

  const scoreDrivers = components
    .filter((component) => component.driver)
    .sort((left, right) => right.weight - left.weight)
    .slice(0, 5)
    .map((component) => component.driver as string);
  if (input.boosted) scoreDrivers.push("The listing is boosted, so some visibility may be paid rather than organic");

  const caveats = [...input.extraCaveats];
  const missingMetrics = (Object.keys(METRIC_LABELS) as (keyof EngagementMetrics)[])
    .filter((key) => metrics[key] === undefined)
    .map((key) => METRIC_LABELS[key]);
  if (missingMetrics.length) {
    caveats.push(`The fetched public page did not publish readable ${missingMetrics.join(", ")}; those fields remain unknown.`);
  }
  if (metricAvailability < 2) caveats.push("The popularity estimate has limited item-level engagement evidence.");
  if (ageDays === undefined) caveats.push("Listing age was unavailable after checking embedded state, dates, meta tags, and visible text.");
  caveats.push("Marketplace engagement can indicate attention, not guaranteed demand, authenticity, or a profitable resale price.");

  const evidenceRows = [
    evidence("Likes / favorites", metrics.likes, input.source),
    evidence("Views", metrics.views, input.source),
    evidence("Clicks", metrics.clicks, input.source),
    evidence("Shares", metrics.shares, input.source),
    evidence("Comments", metrics.comments, input.source),
    evidence("Offers", metrics.offers, input.source),
    evidence("Listed at", input.listedAt, input.source),
    evidence("Sold", input.sold, input.source),
    evidence("Boosted", input.boosted, input.source),
    evidence("Seller followers", input.seller.followers, input.source),
    evidence("Seller items sold", input.seller.itemsSold, input.source),
    evidence("Seller rating", input.seller.rating, input.source),
  ].filter((row): row is EngagementEvidence => Boolean(row));

  return {
    marketplace,
    url,
    metrics,
    seller: input.seller,
    listedAt: input.listedAt,
    ageDays,
    sold: input.sold,
    boosted: input.boosted,
    popularityScore,
    demandLevel,
    confidence,
    completeness,
    engagementRate,
    likesPerDay,
    viewsPerDay,
    scoreDrivers,
    caveats: [...new Set(caveats)],
    evidence: evidenceRows,
    readMethods: [...new Set(input.readMethods)],
    inspectedAt: new Date().toISOString(),
  };
}

export function marketplaceFromUrl(value: string): EngagementMarketplace | null {
  try {
    const host = new URL(value).hostname.toLowerCase();
    if (host === "depop.com" || host.endsWith(".depop.com")) return "Depop";
    if (host === "grailed.com" || host.endsWith(".grailed.com")) return "Grailed";
    if (host === "poshmark.com" || host.endsWith(".poshmark.com")) return "Poshmark";
    return null;
  } catch {
    return null;
  }
}

export function extractMarketplaceEngagement(
  html: string,
  pageUrl: string,
  marketplace: EngagementMarketplace = marketplaceFromUrl(pageUrl) ?? "Depop",
): EngagementReport {
  const parsed = marketplace === "Poshmark"
    ? parsePoshmark(html)
    : marketplace === "Grailed"
      ? parseGrailed(html)
      : parseDepop(html);
  return scoreReport(marketplace, parsed, pageUrl);
}
