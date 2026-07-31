import { grailedHitToRecord } from "../../lib/marketplace-source-parsers";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const WORKER_REVISION = "market-search-zenmarket-grailed-posts-v24";
const TOTAL_TIMEOUT_MS = 11_000;
const PER_HOST_TIMEOUT_MS = 3_500;
const MAX_RESPONSE_BYTES = 2_000_000;
const ALLOWED_INDEXES = new Set(["Listing_production", "Listing_sold_production"]);

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

/** Standard Algolia DNS names. The previous 1-<app>-dsn form was invalid. */
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

function sanitizeGrailedPayload(text: string, mode: "active" | "sold") {
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const batchResults = Array.isArray(parsed.results) ? parsed.results : [];
  const payload = batchResults[0] && typeof batchResults[0] === "object"
    ? batchResults[0] as Record<string, unknown>
    : parsed;
  const rawHits = Array.isArray(payload.hits) ? payload.hits.filter((value): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value)) : [];
  const hits = rawHits.map((hit) => grailedHitToRecord(hit, mode)).filter(Boolean);
  const loadedUrls = new Set(hits.map((hit) => valueText((hit as Record<string, unknown>).url)).filter(Boolean));
  const candidates = rawHits.map(grailedHydrationCandidate)
    .filter((value): value is NonNullable<typeof value> => Boolean(value) && !loadedUrls.has(value.url))
    .slice(0, 16);
  const originalTotal = Math.max(0, Number(payload.nbHits) || 0);
  const page = Math.max(0, Number(payload.page) || 0);
  const nbPages = Math.max(0, Number(payload.nbPages) || 0);
  return JSON.stringify({
    ...payload,
    hits,
    candidates,
    nbHits: originalTotal,
    page,
    nbPages,
    returnedPosts: hits.length,
    hydrationCandidates: candidates.length,
    filteredInvalidHits: Math.max(0, rawHits.length - hits.length - candidates.length),
    partial: false,
  });
}

function algoliaParams(query: string, page: number) {
  return new URLSearchParams({
    query,
    page: String(page),
    hitsPerPage: "24",
    typoTolerance: "true",
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
        query: input.query,
        page: input.page,
        hitsPerPage: 24,
        typoTolerance: true,
        distinct: true,
        getRankingInfo: true,
        attributesToRetrieve: ["*"],
      };
  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-algolia-application-id": input.appId,
        "x-algolia-api-key": input.apiKey,
        origin: "https://www.grailed.com",
        referer: "https://www.grailed.com/",
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
  const page = Math.min(100, Math.max(0, Number.parseInt(String(body.page ?? "0"), 10) || 0));
  const mode = body.mode === "sold" ? "sold" : "active";
  const appId = typeof body.appId === "string" ? body.appId.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const expectedIndex = mode === "sold" ? "Listing_sold_production" : "Listing_production";
  const index = typeof body.index === "string" ? body.index.trim() : expectedIndex;

  if (!query) return invalid("A Grailed search query is required.");
  if (!/^[A-Z0-9]{8,20}$/i.test(appId)) return invalid("The Grailed Algolia application ID is invalid.");
  if (!/^[a-z0-9]{20,80}$/i.test(apiKey)) return invalid("The Grailed public search key is invalid.");
  if (!ALLOWED_INDEXES.has(index) || index !== expectedIndex) return invalid("The Grailed listing index is invalid.");

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
          try { sanitized = sanitizeGrailedPayload(text, mode); }
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
              "x-rml-algolia-endpoint": endpoint,
              "x-rml-marketplace-mode": "grailed-public-index-relay",
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
      page,
      nbPages: 0,
      partial: true,
      recovery: "grailed-empty",
      marketplace: "Grailed",
      mode,
      failures: failures.slice(0, 8),
    }, {
      "x-rml-upstream-status": "0",
      "x-rml-partial-result": "1",
      "x-rml-marketplace-mode": "grailed-public-index-fallback",
    });
  } finally {
    clearTimeout(totalTimer);
  }
}
