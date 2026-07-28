export const runtime = "edge";
export const dynamic = "force-dynamic";

const WORKER_REVISION = "grailed-depop-results-v11";
const TIMEOUT_MS = 10_000;
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

function errorJson(message: string, status: number) {
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

export async function POST(request: Request) {
  let body: GrailedSearchBody;
  try { body = await request.json() as GrailedSearchBody; }
  catch { return errorJson("The Grailed search body must be valid JSON.", 400); }

  const query = typeof body.query === "string" ? body.query.trim().slice(0, 160) : "";
  const page = Math.min(100, Math.max(0, Number.parseInt(String(body.page ?? "0"), 10) || 0));
  const mode = body.mode === "sold" ? "sold" : "active";
  const appId = typeof body.appId === "string" ? body.appId.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const expectedIndex = mode === "sold" ? "Listing_sold_production" : "Listing_production";
  const index = typeof body.index === "string" ? body.index.trim() : expectedIndex;

  if (!query) return errorJson("A Grailed search query is required.", 400);
  if (!/^[A-Z0-9]{8,20}$/i.test(appId)) return errorJson("The Grailed Algolia application ID is invalid.", 400);
  if (!/^[a-z0-9]{20,80}$/i.test(apiKey)) return errorJson("The Grailed public search key is invalid.", 400);
  if (!ALLOWED_INDEXES.has(index) || index !== expectedIndex) return errorJson("The Grailed listing index is invalid.", 400);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(`https://${appId.toLowerCase()}-dsn.algolia.net/1/indexes/${index}/query`, {
      method: "POST",
      redirect: "error",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-algolia-application-id": appId,
        "x-algolia-api-key": apiKey,
        origin: "https://www.grailed.com",
        referer: "https://www.grailed.com/",
      },
      body: JSON.stringify({
        query,
        page,
        hitsPerPage: 24,
        typoTolerance: true,
        distinct: true,
        getRankingInfo: true,
      }),
    });
    const text = await limitedText(upstream);
    return new Response(text, {
      status: 200,
      headers: {
        "content-type": upstream.headers.get("content-type") || "application/json; charset=utf-8",
        "cache-control": "no-store, max-age=0",
        "x-rml-worker-revision": WORKER_REVISION,
        "x-rml-upstream-status": String(upstream.status),
        "x-rml-marketplace-mode": "grailed-public-index-relay",
      },
    });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Grailed public index request failed.", 502);
  } finally {
    clearTimeout(timer);
  }
}
