export const runtime = "edge";
export const dynamic = "force-dynamic";

const WORKER_REVISION = "production-navigation-markets-v14";
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

function candidateHosts(appId: string) {
  const normalized = appId.toLowerCase();
  return [
    `${normalized}.algolia.net`,
    `${normalized}-dsn.algolia.net`,
    `1-${normalized}-dsn.algolianet.com`,
    `2-${normalized}-dsn.algolianet.com`,
    `3-${normalized}-dsn.algolianet.com`,
  ];
}

async function requestHost(input: {
  host: string;
  appId: string;
  apiKey: string;
  index: string;
  query: string;
  page: number;
  parentSignal: AbortSignal;
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PER_HOST_TIMEOUT_MS);
  const abort = () => controller.abort();
  input.parentSignal.addEventListener("abort", abort, { once: true });
  try {
    const upstream = await fetch(`https://${input.host}/1/indexes/${encodeURIComponent(input.index)}/query`, {
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
      body: JSON.stringify({
        query: input.query,
        page: input.page,
        hitsPerPage: 24,
        typoTolerance: true,
        distinct: true,
        getRankingInfo: true,
      }),
    });
    const text = await limitedText(upstream);
    return { upstream, text };
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
      try {
        const { upstream, text } = await requestHost({
          host, appId, apiKey, index, query, page, parentSignal: overall.signal,
        });
        if (!upstream.ok) {
          failures.push(`${host}: HTTP ${upstream.status}`);
          continue;
        }
        return new Response(text, {
          status: 200,
          headers: {
            "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
            "cache-control": "no-store, max-age=0",
            "x-rml-worker-revision": WORKER_REVISION,
            "x-rml-upstream-status": String(upstream.status),
            "x-rml-algolia-host": host,
            "x-rml-marketplace-mode": "grailed-public-index-relay",
          },
        });
      } catch (error) {
        failures.push(`${host}: ${error instanceof Error ? error.message : "request failed"}`);
      }
    }

    // A public-index outage is a partial-data condition, not an application
    // transport failure. Returning 200 avoids repeated 502 console errors and
    // lets the frontend preserve any Grailed page-source cards it already read.
    return json({
      hits: [],
      nbHits: 0,
      page,
      nbPages: 0,
      partial: true,
      marketplace: "Grailed",
      mode,
      message: "Grailed's public listing index was temporarily unavailable; official page-source fallbacks remain active.",
      failures: failures.slice(0, 5),
    }, {
      "x-rml-upstream-status": "0",
      "x-rml-partial-result": "1",
      "x-rml-marketplace-mode": "grailed-public-index-fallback",
    });
  } finally {
    clearTimeout(totalTimer);
  }
}
