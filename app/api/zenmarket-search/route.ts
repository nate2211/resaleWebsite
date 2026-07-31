import {
  isZenMarketChallengeSource,
  parseOfficialStorePageSource,
  parseZenMarketPageSource,
  unwrapZenMarketPayload,
  zenMarketPayloadHasItems,
  type ZenMarketName,
} from "../../lib/zenmarket-source-parsers";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const WORKER_REVISION = "market-search-bounded-pagination-v25";
const MAX_BODY_BYTES = 2_000_000;
const TOTAL_TIMEOUT_MS = 12_000;
const ATTEMPT_TIMEOUT_MS = 4_500;

type SupportedMarketplace = ZenMarketName;
type CandidateKind = "catalog" | "zenmarket-page" | "official-store";

type MarketConfig = {
  page: string;
  storeId: number;
  endpointNames: string[];
  sort?: string;
  directSearch(query: string, page: number): string[];
};

const CONFIG: Record<SupportedMarketplace, MarketConfig> = {
  "Mercari Japan": {
    page: "mercari.aspx",
    storeId: 27,
    endpointNames: ["mercari.aspx/getProducts", "mercari.aspx/GetProducts"],
    sort: "sort=new&order=desc",
    directSearch: (query, page) => [
      `https://jp.mercari.com/en/search?keyword=${encodeURIComponent(query)}`,
      `https://jp.mercari.com/search?keyword=${encodeURIComponent(query)}`,
    ],
  },
  "JDirectItems Auction": {
    page: "yahoo.aspx",
    storeId: 28,
    endpointNames: ["yahoo.aspx/getProducts", "yahoo.aspx/GetProducts"],
    sort: "sort=new&order=desc",
    directSearch: (query, page) => [
      `https://auctions.yahoo.co.jp/search/search?p=${encodeURIComponent(query)}&b=${Math.max(1, (page - 1) * 50 + 1)}&n=50`,
    ],
  },
  Rakuten: {
    page: "rakuten.aspx",
    storeId: 0,
    endpointNames: ["rakuten.aspx/getProducts", "rakuten.aspx/GetProducts"],
    directSearch: (query, page) => [
      `https://search.rakuten.co.jp/search/mall/${encodeURIComponent(query)}/?p=${page}`,
    ],
  },
  "Rakuten Rakuma": {
    page: "rakuma.aspx",
    storeId: 25,
    endpointNames: ["rakuma.aspx/getProducts", "rakuma.aspx/GetProducts"],
    sort: "sort=new&order=desc",
    directSearch: (query, page) => [
      `https://fril.jp/s?query=${encodeURIComponent(query)}&page=${page}`,
    ],
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

function parsedPayload(text: string, marketplace: SupportedMarketplace) {
  if (!text.trim() || isZenMarketChallengeSource(text)) return null;
  try {
    const payload = unwrapZenMarketPayload(JSON.parse(text));
    if (!zenMarketPayloadHasItems(payload, marketplace)) return null;
    return payload;
  } catch {
    return null;
  }
}

function endpointCandidates(config: MarketConfig, query: string, page: number) {
  const pageNumber = page + 1;
  const crossParams = new URLSearchParams({
    q: query,
    p: String(pageNumber),
    searchMode: "custom",
    stores: String(config.storeId),
  });
  const body = {
    query,
    q: query,
    page: pageNumber,
    p: pageNumber,
    searchMode: "custom",
    stores: String(config.storeId),
    storeId: config.storeId,
    storeIds: [config.storeId],
  };
  const dedicatedParams = new URLSearchParams({ q: query, p: String(pageNumber) });
  if (config.sort) {
    for (const part of config.sort.split("&")) {
      const [key, value] = part.split("=");
      if (key && value) dedicatedParams.set(key, value);
    }
  }
  return [
    {
      endpoint: `https://zenmarket.jp/en/search.aspx/GetProducts?${crossParams.toString()}`,
      body,
    },
    {
      endpoint: `https://zenmarket.jp/search.aspx/GetProducts?${crossParams.toString()}`,
      body,
    },
    {
      endpoint: `https://zenmarket.jp/en/${config.page}/GetProducts?${dedicatedParams.toString()}`,
      body: { ...body, pageType: config.page.replace(".aspx", "") },
    },
  ];
}

function pageCandidates(config: MarketConfig, query: string, page: number) {
  const pageNumber = page + 1;
  const encodedPlus = query.trim().split(/\s+/).filter(Boolean).map(encodeURIComponent).join("%2B");
  const encoded = encodeURIComponent(query);
  const exactSearch = `https://zenmarket.jp/en/search.aspx?q=${encodedPlus}&p=${pageNumber}&searchMode=custom&stores=${config.storeId}`;
  const dedicated = `https://zenmarket.jp/en/${config.page}?q=${encoded}&p=${pageNumber}${config.sort ? `&${config.sort}` : ""}`;
  return [
    { endpoint: exactSearch, kind: "zenmarket-page" as const },
    { endpoint: dedicated, kind: "zenmarket-page" as const },
    ...config.directSearch(query, pageNumber).map((endpoint) => ({ endpoint, kind: "official-store" as const })),
  ];
}

function browserHeaders(endpoint: string, sourceUrl: string, jsonRequest = false) {
  const parsed = new URL(endpoint);
  const headers: Record<string, string> = {
    accept: jsonRequest
      ? "application/json, text/javascript, */*; q=0.01"
      : "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.7",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    pragma: "no-cache",
    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
  };
  if (parsed.hostname.endsWith("zenmarket.jp")) {
    headers.origin = "https://zenmarket.jp";
    headers.referer = sourceUrl;
  }
  if (jsonRequest) {
    headers["content-type"] = "application/json; charset=UTF-8";
    headers["x-requested-with"] = "XMLHttpRequest";
  }
  return headers;
}

async function readCandidate(
  endpoint: string,
  sourceUrl: string,
  requestSignal: AbortSignal,
  init: RequestInit,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
  const abort = () => controller.abort();
  requestSignal.addEventListener("abort", abort, { once: true });
  try {
    const upstream = await fetch(endpoint, {
      redirect: "follow",
      cache: "no-store",
      ...init,
      signal: controller.signal,
    });
    const contentLength = Number(upstream.headers.get("content-length") || "0");
    if (contentLength > MAX_BODY_BYTES) return { text: "", status: 413 };
    const text = (await upstream.text()).slice(0, MAX_BODY_BYTES);
    return { text, status: upstream.status };
  } catch {
    return { text: "", status: 0 };
  } finally {
    clearTimeout(timer);
    requestSignal.removeEventListener("abort", abort);
  }
}

async function fetchCatalogCandidate(
  endpoint: string,
  sourceUrl: string,
  body: Record<string, unknown>,
  marketplace: SupportedMarketplace,
  requestSignal: AbortSignal,
) {
  const result = await readCandidate(endpoint, sourceUrl, requestSignal, {
    method: "POST",
    headers: browserHeaders(endpoint, sourceUrl, true),
    body: JSON.stringify(body),
  });
  return { data: result.status >= 200 && result.status < 300 ? parsedPayload(result.text, marketplace) : null, status: result.status };
}

async function fetchPageCandidate(
  endpoint: string,
  kind: Exclude<CandidateKind, "catalog">,
  sourceUrl: string,
  marketplace: SupportedMarketplace,
  requestSignal: AbortSignal,
) {
  const result = await readCandidate(endpoint, sourceUrl, requestSignal, {
    method: "GET",
    headers: browserHeaders(endpoint, sourceUrl, false),
  });
  if (result.status < 200 || result.status >= 300 || isZenMarketChallengeSource(result.text)) {
    return { data: null, status: result.status };
  }
  const records = kind === "zenmarket-page"
    ? parseZenMarketPageSource(result.text, marketplace, endpoint)
    : parseOfficialStorePageSource(result.text, marketplace, endpoint);
  return { data: records.length ? { Items: records } : null, status: result.status };
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

  const marketplace = body.marketplace;
  const config = CONFIG[marketplace];
  const sourceQuery = query.trim().split(/\s+/).filter(Boolean).map(encodeURIComponent).join("%2B");
  const sourceUrl = `https://zenmarket.jp/en/search.aspx?q=${sourceQuery}&p=${page + 1}&searchMode=custom&stores=${config.storeId}`;
  const totalController = new AbortController();
  const totalTimer = setTimeout(() => totalController.abort(), TOTAL_TIMEOUT_MS);
  const abort = () => totalController.abort();
  request.signal.addEventListener("abort", abort, { once: true });
  const attempts: Array<{ endpoint: string; status: number; kind: CandidateKind }> = [];

  try {
    const catalogResults = await Promise.all(endpointCandidates(config, query, page).map(async (candidate) => {
      const result = await fetchCatalogCandidate(candidate.endpoint, sourceUrl, candidate.body, marketplace, totalController.signal);
      attempts.push({ endpoint: candidate.endpoint, status: result.status, kind: "catalog" });
      return result;
    }));
    const catalog = catalogResults.find((result) => result.data !== null);
    if (catalog?.data !== null && catalog?.data !== undefined) {
      return json({
        ok: true,
        partial: false,
        data: catalog.data,
        sourceUrl,
        storeId: config.storeId,
        upstreamStatus: catalog.status,
        attempts,
      });
    }

    const pageResults = await Promise.all(pageCandidates(config, query, page).map(async (candidate) => {
      const result = await fetchPageCandidate(candidate.endpoint, candidate.kind, sourceUrl, marketplace, totalController.signal);
      attempts.push({ endpoint: candidate.endpoint, status: result.status, kind: candidate.kind });
      return result;
    }));
    const pageResult = pageResults.find((result) => result.data !== null);
    if (pageResult?.data !== null && pageResult?.data !== undefined) {
      return json({
        ok: true,
        partial: false,
        data: pageResult.data,
        sourceUrl,
        storeId: config.storeId,
        upstreamStatus: pageResult.status,
        attempts,
      });
    }

    return json({
      ok: false,
      partial: true,
      data: null,
      sourceUrl,
      storeId: config.storeId,
      attempts,
      recovery: "zenmarket-empty",
      error: "No complete ZenMarket products were returned by the store catalog, normal store pages, or official source-market fallbacks.",
    });
  } finally {
    clearTimeout(totalTimer);
    request.signal.removeEventListener("abort", abort);
  }
}
