import { unwrapZenMarketPayload } from "../../lib/zenmarket-source-parsers";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const WORKER_REVISION = "all-market-images-production-v16";
const MAX_BODY_BYTES = 2_000_000;
const TOTAL_TIMEOUT_MS = 12_000;
const ATTEMPT_TIMEOUT_MS = 4_500;

type SupportedMarketplace = "Mercari Japan" | "JDirectItems Auction" | "Rakuten" | "Rakuten Rakuma";

type MarketConfig = {
  page: string;
  storeId: number;
  endpointNames: string[];
  sort?: string;
};

const CONFIG: Record<SupportedMarketplace, MarketConfig> = {
  "Mercari Japan": {
    page: "mercari.aspx",
    storeId: 27,
    endpointNames: ["mercari.aspx/getProducts", "mercari.aspx/GetProducts"],
    sort: "sort=new&order=desc",
  },
  "JDirectItems Auction": {
    page: "yahoo.aspx",
    storeId: 28,
    endpointNames: ["yahoo.aspx/getProducts", "yahoo.aspx/GetProducts"],
    sort: "sort=new&order=desc",
  },
  Rakuten: {
    page: "rakuten.aspx",
    storeId: 0,
    endpointNames: ["rakuten.aspx/getProducts", "rakuten.aspx/GetProducts"],
  },
  "Rakuten Rakuma": {
    page: "rakuma.aspx",
    storeId: 25,
    endpointNames: ["rakuma.aspx/getProducts", "rakuma.aspx/GetProducts"],
    sort: "sort=new&order=desc",
  },
};

function json(value: unknown, init: ResponseInit = {}) {
  return Response.json(value, {
    ...init,
    headers: {
      "cache-control": "no-store",
      "x-rml-worker-revision": WORKER_REVISION,
      ...(init.headers || {}),
    },
  });
}

function isMarketplace(value: unknown): value is SupportedMarketplace {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CONFIG, value);
}

function parsedPayload(text: string) {
  try {
    const payload = unwrapZenMarketPayload(JSON.parse(text));
    if (payload === null || payload === undefined) return null;
    const serialized = JSON.stringify(payload);
    if (!serialized || serialized === "{}" || serialized === "[]" || serialized.length < 12) return null;
    return payload;
  } catch {
    return null;
  }
}

function endpointCandidates(config: MarketConfig, query: string, page: number) {
  const params = new URLSearchParams({ q: query, p: String(page + 1) });
  if (config.sort) {
    for (const part of config.sort.split("&")) {
      const [key, value] = part.split("=");
      if (key && value) params.set(key, value);
    }
  }
  const dedicated: Array<{ endpoint: string; body: Record<string, unknown> }> = config.endpointNames.map((name) => ({
    endpoint: `https://zenmarket.jp/en/${name}?${params.toString()}`,
    body: { page: page + 1, p: page + 1, query, q: query },
  }));
  // ZenMarket's current cross-site search supports explicit store filtering.
  // Keep one bounded compatibility attempt for deployments where the dedicated
  // marketplace endpoint has moved behind the unified search page.
  const crossParams = new URLSearchParams({
    q: query,
    p: String(page + 1),
    searchMode: "custom",
    stores: String(config.storeId),
  });
  dedicated.push({
    endpoint: `https://zenmarket.jp/en/search.aspx/GetProducts?${crossParams.toString()}`,
    body: {
      query,
      q: query,
      page: page + 1,
      p: page + 1,
      searchMode: "custom",
      stores: String(config.storeId),
      storeIds: [config.storeId],
    },
  });
  return dedicated.slice(0, 3);
}

async function fetchCandidate(
  endpoint: string,
  sourceUrl: string,
  body: Record<string, unknown>,
  requestSignal: AbortSignal,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  const abort = () => controller.abort();
  requestSignal.addEventListener("abort", abort, { once: true });
  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      redirect: "manual",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "accept-language": "en-US,en;q=0.9",
        "content-type": "application/json; charset=UTF-8",
        origin: "https://zenmarket.jp",
        referer: sourceUrl,
        "x-requested-with": "XMLHttpRequest",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
      },
      body: JSON.stringify(body),
    });
    const contentLength = Number(upstream.headers.get("content-length") || "0");
    if (contentLength > MAX_BODY_BYTES) return { data: null, status: 413 };
    const text = (await upstream.text()).slice(0, MAX_BODY_BYTES);
    return { data: upstream.ok ? parsedPayload(text) : null, status: upstream.status };
  } catch {
    return { data: null, status: 0 };
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener("abort", abort);
  }
}

export async function POST(request: Request) {
  let body: { marketplace?: unknown; query?: unknown; page?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, partial: true, data: null, error: "Invalid JSON request." });
  }

  if (!isMarketplace(body.marketplace)) {
    return json({ ok: false, partial: true, data: null, error: "Unsupported ZenMarket marketplace." });
  }
  const query = String(body.query || "").trim().slice(0, 160);
  const page = Math.max(0, Math.min(20, Number(body.page) || 0));
  if (!query) return json({ ok: false, partial: true, data: null, error: "A search query is required." });

  const config = CONFIG[body.marketplace];
  const sourceUrl = `https://zenmarket.jp/en/search.aspx?q=${encodeURIComponent(query)}&p=${page + 1}&searchMode=custom&stores=${config.storeId}`;
  const totalController = new AbortController();
  const totalTimer = setTimeout(() => totalController.abort(), TOTAL_TIMEOUT_MS);
  const abort = () => totalController.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const attempts: Array<{ endpoint: string; status: number }> = [];

  try {
    for (const candidate of endpointCandidates(config, query, page)) {
      if (totalController.signal.aborted) break;
      const result = await fetchCandidate(candidate.endpoint, sourceUrl, candidate.body, totalController.signal);
      attempts.push({ endpoint: candidate.endpoint, status: result.status });
      if (result.data !== null) {
        return json({
          ok: true,
          partial: false,
          data: result.data,
          sourceUrl,
          storeId: config.storeId,
          upstreamStatus: result.status,
          attempts,
        });
      }
    }
    return json({
      ok: false,
      partial: true,
      data: null,
      sourceUrl,
      storeId: config.storeId,
      attempts,
      error: "ZenMarket did not expose a readable catalog payload; the frontend will parse the normal marketplace pages instead.",
    });
  } finally {
    clearTimeout(totalTimer);
    request.signal.removeEventListener("abort", abort);
  }
}
