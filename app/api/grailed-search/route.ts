import { grailedHitToRecord } from "../../lib/marketplace-source-parsers";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const WORKER_REVISION = "live-source-ranking-v26";
const TOTAL_TIMEOUT_MS = 11_000;
const PER_HOST_TIMEOUT_MS = 3_500;
const MAX_RESPONSE_BYTES = 2_000_000;
const GRAILED_PAGE_SIZE = 40;
const MAX_GRAILED_PAGE = 49;
const ACTIVE_QUALITY_INDEX = "Listing_by_listing_quality_production";
const ACTIVE_INDEXES = new Set([
  ACTIVE_QUALITY_INDEX,
  "Listing_by_heat_recency_production",
  "Listing_by_date_added_production",
  "Listing_production",
]);
const SOLD_INDEX = "Listing_sold_production";
const ACTIVE_STALE_AFTER_MS = 1000 * 60 * 60 * 24 * 365 * 3;

// This list removes only search-language filler. Brand/designer words remain.
const QUERY_STOP_WORDS = new Set(["a", "an", "and", "for", "in", "of", "on", "or", "the", "to", "with", "x"]);

type GrailedSearchBody = {
  query?: unknown;
  page?: unknown;
  mode?: unknown;
  appId?: unknown;
  apiKey?: unknown;
  index?: unknown;
};

type RequestFormat = "batch" | "single";

function json(value: unknown, headers: Record<string, string> = {}) {
  return Response.json(value, {
    status: 200,
    headers: {
      "cache-control": "no-store, max-age=0",
      "x-rml-worker-revision": WORKER_REVISION,
      ...headers,
    },
  });
}

function invalid(message: string, status = 400) {
  return Response.json({ error: message, workerRevision: WORKER_REVISION }, {
    status,
    headers: { "cache-control": "no-store", "x-rml-worker-revision": WORKER_REVISION },
  });
}

async function limitedText(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const remaining = MAX_RESPONSE_BYTES - size;
      if (remaining <= 0) { await reader.cancel(); break; }
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      size += chunk.byteLength;
      body += decoder.decode(chunk, { stream: true });
      if (value.byteLength > remaining) { await reader.cancel(); break; }
    }
    body += decoder.decode();
    return body;
  } finally {
    reader.releaseLock();
  }
}

/** Standard Algolia DNS names. */
function candidateHosts(appId: string) {
  const normalized = appId.toLowerCase();
  return [
    `${normalized}-dsn.algolia.net`,
    `${normalized}.algolia.net`,
    `${normalized}-1.algolianet.com`,
    `${normalized}-2.algolianet.com`,
    `${normalized}-3.algolianet.com`,
  ];
}

function valueText(value: unknown) {
  return typeof value === "string" ? value.trim()
    : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function valueNumber(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function flattenText(value: unknown, depth = 0): string {
  if (depth > 3 || value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.slice(0, 20).map((entry) => flattenText(entry, depth + 1)).join(" ");
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>).slice(0, 30)
      .map((entry) => flattenText(entry, depth + 1)).join(" ");
  }
  return "";
}

function normalizedWords(value: string) {
  return value.toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function queryTokens(query: string) {
  return [...new Set(normalizedWords(query).split(/\s+/)
    .filter((token) => token.length >= 2 && !QUERY_STOP_WORDS.has(token)))];
}

function hitSearchText(hit: Record<string, unknown>) {
  return normalizedWords([
    hit.title, hit.display_title, hit.displayTitle, hit.name,
    hit.designers, hit.designer_names, hit.designerNames, hit.brand,
    hit.description, hit.category, hit.category_path, hit.categoryPath, hit.subcategory,
  ].map((value) => flattenText(value)).join(" "));
}

function queryRelevanceScore(hit: Record<string, unknown>, query: string) {
  const words = queryTokens(query);
  if (!words.length) return 0;
  const haystack = hitSearchText(hit);
  if (!words.every((word) => haystack.includes(word))) return -1;
  const phrase = normalizedWords(query);
  let score = words.length * 20;
  if (phrase && haystack.includes(phrase)) score += 100;
  const title = normalizedWords(candidateTitle(hit));
  if (phrase && title.includes(phrase)) score += 150;
  for (const word of words) if (title.includes(word)) score += 20;
  return score;
}

function dateValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const milliseconds = value < 10_000_000_000 ? value * 1000 : value;
    return milliseconds > 0 ? milliseconds : 0;
  }
  if (typeof value !== "string" || !value.trim()) return 0;
  if (/^\d{10,13}$/.test(value.trim())) {
    const numeric = Number(value.trim());
    return numeric < 10_000_000_000 ? numeric * 1000 : numeric;
  }
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function latestActivity(hit: Record<string, unknown>) {
  return Math.max(
    dateValue(hit.updated_at), dateValue(hit.updatedAt),
    dateValue(hit.price_updated_at), dateValue(hit.priceUpdatedAt),
    dateValue(hit.created_at), dateValue(hit.createdAt),
    dateValue(hit.listed_at), dateValue(hit.listedAt),
  );
}

function activeHitIsCurrent(hit: Record<string, unknown>) {
  if (hit.sold === true || hit.deleted === true || hit.archived === true || hit.hidden === true) return false;
  if (hit.sold_at || hit.soldAt || hit.deleted_at || hit.deletedAt) return false;
  const status = normalizedWords(valueText(hit.status) || valueText(hit.state));
  if (status && /sold|deleted|removed|archived|expired|inactive/.test(status)) return false;
  const activity = latestActivity(hit);
  return !activity || Date.now() - activity <= ACTIVE_STALE_AFTER_MS;
}

function candidateUrl(hit: Record<string, unknown>) {
  const id = valueText(hit.id) || valueText(hit.objectID);
  if (!/^\d+$/.test(id)) return "";
  const explicit = valueText(hit.url) || valueText(hit.web_url) || valueText(hit.webUrl)
    || valueText(hit.pretty_path) || valueText(hit.prettyPath) || valueText(hit.path);
  const slug = valueText(hit.slug).replace(new RegExp(`^${id}-?`), "");
  const raw = explicit || `/listings/${id}${slug ? `-${slug}` : ""}`;
  try {
    const parsed = new URL(raw, "https://www.grailed.com/");
    if (!/(^|\.)grailed\.com$/i.test(parsed.hostname) || !/^\/listings\/\d+(?:-[^/?#]+)?\/?$/i.test(parsed.pathname)) return "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function candidateTitle(hit: Record<string, unknown>) {
  return valueText(hit.title) || valueText(hit.display_title) || valueText(hit.displayTitle) || valueText(hit.name);
}

function grailedHydrationCandidate(hit: Record<string, unknown>) {
  const url = candidateUrl(hit);
  const title = candidateTitle(hit);
  const id = valueText(hit.id) || valueText(hit.objectID);
  if (!url || title.length < 3 || /^(?:grailed|listing|untitled listing|marketplace listing)$/i.test(title)) return null;
  const strongSignals = [
    valueNumber(hit.price) > 0 || valueNumber(hit.sold_price) > 0,
    Boolean(hit.designers || hit.designer_names || hit.designerNames || hit.brand),
    Boolean(hit.category || hit.category_path || hit.categoryPath || hit.subcategory),
    Boolean(hit.created_at || hit.createdAt || hit.sold_at || hit.soldAt),
    Boolean(hit.pretty_path || hit.prettyPath || hit.slug),
  ].filter(Boolean).length;
  if (strongSignals < 2) return null;
  return { id, objectID: id, title, url };
}

function payloadRoot(text: string) {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const batchResults = Array.isArray(parsed.results) ? parsed.results : [];
  return batchResults[0] && typeof batchResults[0] === "object"
    ? batchResults[0] as Record<string, unknown>
    : parsed;
}

function sanitizeGrailedPayload(text: string, mode: "active" | "sold", query: string, index: string) {
  const payload = payloadRoot(text);
  const rawHits = (Array.isArray(payload.hits) ? payload.hits : [])
    .filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value));

  const seen = new Set<string>();
  const ranked = rawHits.flatMap((hit) => {
    const id = valueText(hit.id) || valueText(hit.objectID) || candidateUrl(hit);
    if (!id || seen.has(id)) return [];
    const relevance = queryRelevanceScore(hit, query);
    if (relevance < 0) return [];
    if (mode === "active" && !activeHitIsCurrent(hit)) return [];
    seen.add(id);
    const activity = mode === "sold"
      ? Math.max(dateValue(hit.sold_at), dateValue(hit.soldAt), latestActivity(hit))
      : latestActivity(hit);
    return [{ hit, relevance, activity }];
  }).sort((a, b) => b.relevance - a.relevance || b.activity - a.activity)
    .slice(0, GRAILED_PAGE_SIZE);

  const relevantHits = ranked.map((entry) => entry.hit);
  const hits = relevantHits.map((hit) => grailedHitToRecord(hit, mode)).filter(Boolean);
  const loadedUrls = new Set(hits.map((hit) => valueText((hit as Record<string, unknown>).url)).filter(Boolean));
  const candidates = relevantHits.map(grailedHydrationCandidate)
    .filter((value): value is NonNullable<typeof value> => value !== null && !loadedUrls.has(value.url))
    .slice(0, 16);
  const originalTotal = Math.max(0, Number(payload.nbHits) || 0);
  const page = Math.max(0, Number(payload.page) || 0);
  const nbPages = Math.max(0, Number(payload.nbPages) || 0);
  const validatedPosts = hits.length;
  const validatedTotal = page * GRAILED_PAGE_SIZE + validatedPosts;
  const hasMore = validatedPosts > 0 && page + 1 < nbPages;

  return JSON.stringify({
    ...payload,
    hits,
    candidates,
    // Do not surface Grailed's broad historical index count as current inventory.
    nbHits: validatedTotal,
    rawNbHits: originalTotal,
    validatedPosts,
    returnedPosts: hits.length,
    page,
    nbPages,
    pageSize: GRAILED_PAGE_SIZE,
    hasMore,
    nextPage: hasMore ? page + 1 : null,
    hydrationCandidates: candidates.length,
    filteredIrrelevantOrStaleHits: Math.max(0, rawHits.length - relevantHits.length),
    filteredInvalidHits: Math.max(0, relevantHits.length - hits.length - candidates.length),
    query,
    index,
    totalIsValidatedFloor: true,
    partial: false,
  });
}

function exactSearchQuery(query: string) {
  const clean = query.replace(/["\\]/g, " ").replace(/\s+/g, " ").trim();
  return clean.includes(" ") ? `"${clean}"` : clean;
}

function algoliaParams(query: string, page: number) {
  return new URLSearchParams({
    query: exactSearchQuery(query),
    page: String(page),
    hitsPerPage: String(GRAILED_PAGE_SIZE),
    typoTolerance: "min",
    advancedSyntax: "true",
    removeWordsIfNoResults: "none",
    queryType: "prefixLast",
    distinct: "true",
    getRankingInfo: "true",
    attributesToRetrieve: "*",
  }).toString();
}

async function requestHost(input: {
  host: string;
  appId: string;
  apiKey: string;
  index: string;
  query: string;
  page: number;
  format: RequestFormat;
  parentSignal: AbortSignal;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PER_HOST_TIMEOUT_MS);
  const abort = () => controller.abort();
  input.parentSignal.addEventListener("abort", abort, { once: true });
  const batch = input.format === "batch";
  const endpoint = batch
    ? `https://${input.host}/1/indexes/*/queries`
    : `https://${input.host}/1/indexes/${encodeURIComponent(input.index)}/query`;
  const body = batch
    ? { requests: [{ indexName: input.index, params: algoliaParams(input.query, input.page) }] }
    : {
        query: exactSearchQuery(input.query),
        page: input.page,
        hitsPerPage: GRAILED_PAGE_SIZE,
        typoTolerance: "min",
        advancedSyntax: true,
        removeWordsIfNoResults: "none",
        queryType: "prefixLast",
        distinct: true,
        getRankingInfo: true,
        attributesToRetrieve: ["*"],
      };
  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      redirect: "manual",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-algolia-application-id": input.appId,
        "x-algolia-api-key": input.apiKey,
        origin: "https://www.grailed.com",
        referer: `https://www.grailed.com/shop?query=${encodeURIComponent(input.query)}`,
      },
      body: JSON.stringify(body),
    });
    const text = await limitedText(upstream);
    return { upstream, text, endpoint };
  } finally {
    clearTimeout(timeout);
    input.parentSignal.removeEventListener("abort", abort);
  }
}

export async function POST(request: Request) {
  let body: GrailedSearchBody;
  try { body = await request.json() as GrailedSearchBody; }
  catch { return invalid("The Grailed search body must be valid JSON."); }

  const query = typeof body.query === "string" ? body.query.trim().slice(0, 160) : "";
  const page = Math.min(MAX_GRAILED_PAGE, Math.max(0, Number.parseInt(String(body.page ?? "0"), 10) || 0));
  const mode = body.mode === "sold" ? "sold" : "active";
  const appId = typeof body.appId === "string" ? body.appId.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const requestedIndex = typeof body.index === "string" ? body.index.trim() : "";
  const index = mode === "sold"
    ? SOLD_INDEX
    : requestedIndex && ACTIVE_INDEXES.has(requestedIndex) && requestedIndex !== "Listing_production"
      ? requestedIndex
      : ACTIVE_QUALITY_INDEX;

  if (!query) return invalid("A Grailed search query is required.");
  if (!/^[A-Z0-9]{8,20}$/i.test(appId)) return invalid("The Grailed Algolia application ID is invalid.");
  if (!/^[a-z0-9]{20,80}$/i.test(apiKey)) return invalid("The Grailed public search key is invalid.");
  if (mode === "sold" ? requestedIndex && requestedIndex !== SOLD_INDEX : requestedIndex && !ACTIVE_INDEXES.has(requestedIndex)) {
    return invalid("The Grailed listing index is invalid.");
  }

  const overall = new AbortController();
  const totalTimer = setTimeout(() => overall.abort(), TOTAL_TIMEOUT_MS);
  const failures: string[] = [];
  try {
    for (const host of candidateHosts(appId)) {
      if (overall.signal.aborted) break;
      for (const format of ["batch", "single"] as const) {
        if (overall.signal.aborted) break;
        try {
          const { upstream, text, endpoint } = await requestHost({
            host, appId, apiKey, index, query, page, format, parentSignal: overall.signal,
          });
          if (!upstream.ok) {
            failures.push(`${host} ${format}: HTTP ${upstream.status}`);
            continue;
          }
          let sanitized = "";
          try { sanitized = sanitizeGrailedPayload(text, mode, query, index); }
          catch {
            failures.push(`${host} ${format}: invalid JSON payload`);
            continue;
          }
          return new Response(sanitized, {
            status: 200,
            headers: {
              "content-type": "application/json; charset=utf-8",
              "cache-control": "no-store, max-age=0",
              "x-rml-worker-revision": WORKER_REVISION,
              "x-rml-upstream-status": String(upstream.status),
              "x-rml-algolia-host": host,
              "x-rml-algolia-format": format,
              "x-rml-algolia-index": index,
              "x-rml-algolia-endpoint": endpoint,
              "x-rml-marketplace-mode": "grailed-current-quality-index",
            },
          });
        } catch (error) {
          failures.push(`${host} ${format}: ${error instanceof Error ? error.message : "request failed"}`);
        }
      }
    }

    return json({
      hits: [],
      candidates: [],
      nbHits: 0,
      rawNbHits: 0,
      validatedPosts: 0,
      page,
      nbPages: 0,
      partial: true,
      pageSize: GRAILED_PAGE_SIZE,
      hasMore: false,
      nextPage: null,
      recovery: "grailed-empty",
      marketplace: "Grailed",
      mode,
      query,
      index,
      failures: failures.slice(0, 8),
    }, {
      "x-rml-upstream-status": "0",
      "x-rml-partial-result": "1",
      "x-rml-marketplace-mode": "grailed-current-quality-fallback",
    });
  } finally {
    clearTimeout(totalTimer);
  }
}
