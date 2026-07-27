import {
  RETAILER_KNOWLEDGE,
  extractReferenceProducts,
  makeAuthenticityReport,
  normalizeText,
  textSimilarity,
  type AuthenticitySource,
  type ListingForAuthenticity,
  type ReferenceProduct,
} from "../../lib/authenticity";
import { readPublicWebPage } from "../../lib/safe-web";

type AuthenticityCache = typeof globalThis & {
  __flipScopeAuthenticityCache?: Map<string, { expires: number; payload: Record<string, unknown> }>;
};

const authCacheStore = globalThis as AuthenticityCache;
const authenticityCache = authCacheStore.__flipScopeAuthenticityCache ?? new Map();
authCacheStore.__flipScopeAuthenticityCache = authenticityCache;
const AUTH_CACHE_TTL = 10 * 60 * 1_000;

function reply(payload: Record<string, unknown>, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "public, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}

function cleanRss(value: string) {
  return normalizeText(value.replace(/<!\[CDATA\[|\]\]>/g, ""));
}

async function webSearch(query: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_500);
  try {
    const url = `https://www.bing.com/search?format=rss&count=8&q=${encodeURIComponent(query)}`;
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/rss+xml,text/xml",
        "User-Agent": "ResaleMasterLab/2.0 authenticity-reference-search",
      },
    });
    const xml = response.ok ? await response.text() : "";
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8).map((match) => {
      const item = match[1];
      return {
        title: cleanRss(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || ""),
        url: cleanRss(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || ""),
        snippet: cleanRss(item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || ""),
      };
    }).filter((item) => item.url.startsWith("https://"));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

function sourceForUrl(value: string) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return RETAILER_KNOWLEDGE.find((source) =>
      source.domains.some((domain) => host === domain || host.endsWith(`.${domain}`)),
    );
  } catch {
    return undefined;
  }
}

async function readReferencePage(
  url: string,
  query: string,
  fallbackTitle = "",
  fallbackSnippet = "",
) {
  const source = sourceForUrl(url);
  if (!source) return { products: [] as ReferenceProduct[], source: null as AuthenticitySource | null };
  try {
    const page = await readPublicWebPage(url, true);
    if (page.status < 200 || page.status >= 400 || !page.raw) {
      return { products: [], source: null };
    }
    const products = extractReferenceProducts(page.raw, page.finalUrl, source.name, query);
    const record: AuthenticitySource = {
      source: source.name,
      title: page.title || fallbackTitle || source.name,
      url: page.finalUrl,
      snippet: (page.description || fallbackSnippet || page.text).slice(0, 420),
      kind: /\/product|\/itemdetails\//i.test(page.finalUrl) ? "product" : /\/collection|\/season\//i.test(page.finalUrl) ? "collection" : "page",
    };
    return { products, source: record };
  } catch {
    return { products: [], source: null };
  }
}

async function supremeCollectionReferences(query: string) {
  const pages: { products: ReferenceProduct[]; source: AuthenticitySource | null }[] = [];
  try {
    const root = await readPublicWebPage("https://www.supremecommunity.com/season/");
    const seasonLinks = root.links
      .filter((link) => /^https:\/\/www\.supremecommunity\.com\/season\/(?:spring-summer|fall-winter)\d{4}\/?$/i.test(link.url))
      .slice(0, 2);
    const seasons = await Promise.all(seasonLinks.map((link) => readPublicWebPage(link.url).catch(() => null)));
    const itemLinks = seasons.flatMap((season) => season?.links ?? [])
      .filter((link) => link.url.includes("/season/itemdetails/"))
      .map((link) => ({ ...link, score: textSimilarity(query, link.text) }))
      .filter((link) => link.score >= 0.22)
      .sort((left, right) => right.score - left.score)
      .slice(0, 3);
    pages.push(...await Promise.all(itemLinks.map((link) => readReferencePage(link.url, query, link.text))));
  } catch {
    // Site-scoped search below remains the fallback when collection navigation is unavailable.
  }
  return pages;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as Partial<ListingForAuthenticity>;
  const listing: ListingForAuthenticity = {
    title: normalizeText(String(body.title || "")).slice(0, 180),
    brand: normalizeText(String(body.brand || "")).toLowerCase() === "unspecified"
      ? ""
      : normalizeText(String(body.brand || "")).slice(0, 80),
    description: normalizeText(String(body.description || "")).slice(0, 4_000),
    price: Number(body.price) || 0,
    condition: normalizeText(String(body.condition || "")).slice(0, 80),
    size: normalizeText(String(body.size || "")).slice(0, 40),
    image: String(body.image || "").slice(0, 1_000),
    url: String(body.url || "").slice(0, 1_000),
  };
  if (!listing.title) return reply({ error: "A listing title is required." }, 400);
  const query = `${listing.brand || ""} ${listing.title}`.trim();
  const cacheKey = JSON.stringify({
    query: query.toLowerCase(),
    description: listing.description?.toLowerCase().slice(0, 1_000),
    price: listing.price,
  });
  const cached = authenticityCache.get(cacheKey);
  if (cached && cached.expires > Date.now()) {
    return reply({ ...cached.payload, cached: true });
  }
  if (cached) authenticityCache.delete(cacheKey);

  const supremeDirect = /\bsupreme\b/i.test(query)
    ? supremeCollectionReferences(query)
    : Promise.resolve([]);
  const scopedSearches = RETAILER_KNOWLEDGE.map(async (source) => {
    const searchQuery = `${source.searchScope} "${query}" fashion`;
    const results = await webSearch(searchQuery);
    const filtered = results
      .filter((result) => sourceForUrl(result.url)?.id === source.id)
      .map((result) => ({ ...result, score: textSimilarity(query, result.title) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, source.id === "supremecommunity" ? 2 : 1);
    const pages = await Promise.all(filtered.map((result) =>
      readReferencePage(result.url, query, result.title, result.snippet),
    ));
    return {
      searchSources: filtered.map((result) => ({
        source: source.name,
        title: result.title,
        url: result.url,
        snippet: result.snippet,
        kind: "search" as const,
      })),
      pages,
    };
  });

  const [supremePages, searchGroups] = await Promise.all([
    supremeDirect,
    Promise.all(scopedSearches),
  ]);
  const pageResults = [
    ...supremePages,
    ...searchGroups.flatMap((group) => group.pages),
  ];
  const references = [...new Map(pageResults.flatMap((page) => page.products)
    .sort((left, right) => right.similarity - left.similarity)
    .map((reference) => [`${reference.url}|${reference.title}`, reference])).values()];
  const sources = [...new Map([
    ...pageResults.map((page) => page.source).filter((source): source is AuthenticitySource => Boolean(source)),
    ...searchGroups.flatMap((group) => group.searchSources),
  ].map((source) => [source.url, source])).values()];
  const report = makeAuthenticityReport(listing, references, sources);
  const payload = {
    ...report,
    knowledgeSources: RETAILER_KNOWLEDGE.map(({ id, name, role, patterns }) => ({ id, name, role, patterns })),
  };
  authenticityCache.set(cacheKey, { expires: Date.now() + AUTH_CACHE_TTL, payload });
  if (authenticityCache.size > 120) {
    for (const [key, value] of authenticityCache) {
      if (value.expires <= Date.now() || authenticityCache.size > 100) authenticityCache.delete(key);
    }
  }
  return reply(payload);
}
