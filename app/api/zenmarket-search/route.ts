import { unwrapZenMarketPayload } from "../../lib/zenmarket-source-parsers";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const WORKER_REVISION = "marketplace-card-recovery-v15";
const MAX_BODY_BYTES = 2_000_000;
const TIMEOUT_MS = 11_000;

type SupportedMarketplace = "Mercari Japan" | "JDirectItems Auction" | "Rakuten" | "Rakuten Rakuma";

const CONFIG: Record<SupportedMarketplace, { page: string; endpoint: string; sort?: string }> = {
  "Mercari Japan": { page: "mercari.aspx", endpoint: "mercari.aspx/getProducts", sort: "sort=new&order=desc" },
  "JDirectItems Auction": { page: "yahoo.aspx", endpoint: "yahoo.aspx/getProducts", sort: "sort=new&order=desc" },
  Rakuten: { page: "rakuten.aspx", endpoint: "rakuten.aspx/getProducts" },
  "Rakuten Rakuma": { page: "rakuma.aspx", endpoint: "rakuma.aspx/getProducts", sort: "sort=new&order=desc" },
};

function json(value: unknown, init: ResponseInit = {}) {
  return Response.json(value, {
    ...init,
    headers: { "cache-control": "no-store", "x-rml-worker-revision": WORKER_REVISION, ...(init.headers || {}) },
  });
}

function isMarketplace(value: unknown): value is SupportedMarketplace {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(CONFIG, value);
}


export async function POST(request: Request) {
  let body: { marketplace?: unknown; query?: unknown; page?: unknown };
  try { body = await request.json(); }
  catch { return json({ ok: false, partial: true, data: null, error: "Invalid JSON request." }); }

  if (!isMarketplace(body.marketplace)) {
    return json({ ok: false, partial: true, data: null, error: "Unsupported ZenMarket marketplace." });
  }
  const query = String(body.query || "").trim().slice(0, 160);
  const page = Math.max(0, Math.min(20, Number(body.page) || 0));
  if (!query) return json({ ok: false, partial: true, data: null, error: "A search query is required." });

  const config = CONFIG[body.marketplace];
  const params = new URLSearchParams({ q: query });
  if (config.sort) {
    for (const part of config.sort.split("&")) {
      const [key, value] = part.split("=");
      if (key && value) params.set(key, value);
    }
  }
  const sourceUrl = `https://zenmarket.jp/en/${config.page}?q=${encodeURIComponent(query)}&p=${page + 1}`;
  const endpoint = `https://zenmarket.jp/en/${config.endpoint}?${params.toString()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      signal: controller.signal,
      redirect: "manual",
      headers: {
        accept: "application/json, text/javascript, */*; q=0.01",
        "content-type": "application/json; charset=UTF-8",
        origin: "https://zenmarket.jp",
        referer: sourceUrl,
        "x-requested-with": "XMLHttpRequest",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
      },
      body: JSON.stringify({ page: page + 1 }),
    });
    const contentLength = Number(upstream.headers.get("content-length") || "0");
    if (contentLength > MAX_BODY_BYTES) {
      return json({ ok: false, partial: true, data: null, sourceUrl, error: "ZenMarket response exceeded the safe size limit." });
    }
    const text = (await upstream.text()).slice(0, MAX_BODY_BYTES);
    if (!upstream.ok || !text.trim()) {
      return json({ ok: false, partial: true, data: null, sourceUrl, upstreamStatus: upstream.status });
    }
    let parsed: unknown;
    try { parsed = unwrapZenMarketPayload(JSON.parse(text)); }
    catch { parsed = null; }
    return json({ ok: parsed !== null, partial: parsed === null, data: parsed, sourceUrl, upstreamStatus: upstream.status });
  } catch (error) {
    return json({
      ok: false,
      partial: true,
      data: null,
      sourceUrl,
      error: error instanceof Error ? error.message : "ZenMarket catalog request failed.",
    });
  } finally {
    clearTimeout(timer);
  }
}
