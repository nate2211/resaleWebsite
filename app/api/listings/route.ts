export const runtime = "edge";
export const dynamic = "force-dynamic";

const WORKER_REVISION = "market-search-depop-tab-capture-production-v19";
const MAX_BODY_BYTES = 5_500_000;
const UPSTREAM_TIMEOUT_MS = 15_000;
const MAX_REDIRECTS = 2;

const ALLOWED_MARKETPLACE_HOSTS = [
  "grailed.com",
  "poshmark.com",
  "jp.mercari.com",
  "zenmarket.jp",
  "rakuten.co.jp",
  "auctions.yahoo.co.jp",
  "fril.jp",
  "globalbunjang.com",
  "ebay.com",
  "mercari.com",
  "facebook.com",
  "superbuy.com",
  "goofish.com",
  "2.taobao.com",
] as const;

function hostnameMatches(hostname: string, domain: string) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function parseAllowedUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("A valid marketplace URL is required.");
  }
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS marketplace URLs are allowed.");
  if (parsed.username || parsed.password || parsed.port) {
    throw new Error("Marketplace URLs cannot contain credentials or custom ports.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (hostnameMatches(hostname, "depop.com")) {
    throw new Error("Depop is browser-tab-only in this build and is never requested from the Cloudflare relay.");
  }
  if (!ALLOWED_MARKETPLACE_HOSTS.some((domain) => hostnameMatches(hostname, domain))) {
    throw new Error("That marketplace host is not allowed by the page-source relay.");
  }
  return parsed;
}

function errorJson(message: string, status: number) {
  return Response.json({ error: message, workerRevision: WORKER_REVISION }, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "x-rml-worker-revision": WORKER_REVISION,
      "x-rml-marketplace-mode": "official-page-source-relay",
      "x-rml-relay-error": "1",
    },
  });
}

async function readLimitedText(response: Response) {
  if (!response.body) return { body: "", truncated: false };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      const remaining = MAX_BODY_BYTES - size;
      if (remaining <= 0) {
        truncated = true;
        await reader.cancel("Marketplace page-source limit reached.");
        break;
      }
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      size += chunk.byteLength;
      body += decoder.decode(chunk, { stream: true });
      if (value.byteLength > remaining) {
        truncated = true;
        await reader.cancel("Marketplace page-source limit reached.");
        break;
      }
    }
    body += decoder.decode();
    return { body, truncated };
  } finally {
    reader.releaseLock();
  }
}

async function fetchMarketplacePage(initialUrl: URL, requestSignal: AbortSignal) {
  let current = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    const abort = () => controller.abort();
    requestSignal.addEventListener("abort", abort, { once: true });
    try {
      const requestHeaders: Record<string, string> = {
        accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.6",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        pragma: "no-cache",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
      };
      if (hostnameMatches(current.hostname.toLowerCase(), "zenmarket.jp")) {
        requestHeaders.referer = "https://zenmarket.jp/en/";
      }
      const response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: requestHeaders,
      });
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirectCount >= MAX_REDIRECTS) return { response, url: current };
        current = parseAllowedUrl(new URL(location, current).toString());
        continue;
      }
      return { response, url: new URL(response.url || current.toString()) };
    } finally {
      clearTimeout(timer);
      requestSignal.removeEventListener("abort", abort);
    }
  }
  throw new Error("Marketplace redirect limit exceeded.");
}

async function relay(request: Request) {
  const requestUrl = new URL(request.url);
  let source = requestUrl.searchParams.get("source") || "";
  if (request.method === "POST") {
    try {
      const payload = await request.json() as { source?: unknown; url?: unknown };
      source = typeof payload.source === "string" ? payload.source : typeof payload.url === "string" ? payload.url : "";
    } catch {
      return errorJson("The request body must be valid JSON.", 400);
    }
  }

  let sourceUrl: URL;
  try {
    sourceUrl = parseAllowedUrl(source);
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Marketplace URL rejected.", 400);
  }

  try {
    const { response, url } = await fetchMarketplacePage(sourceUrl, request.signal);
    const { body, truncated } = await readLimitedText(response);
    return new Response(body, {
      // The browser must be able to parse challenge/error HTML too, so expose
      // the upstream status in a header instead of turning it into a same-origin
      // fetch rejection. The frontend decides whether the body contains cards.
      status: 200,
      headers: {
        "content-type": response.headers.get("content-type") || "text/plain; charset=utf-8",
        "cache-control": "no-store, max-age=0",
        "cdn-cache-control": "no-store",
        "x-rml-worker-revision": WORKER_REVISION,
        "x-rml-marketplace-mode": "official-page-source-relay",
        "x-rml-upstream-status": String(response.status),
        "x-rml-final-url": url.toString(),
        "x-rml-upstream-content-type": response.headers.get("content-type") || "",
        "x-rml-truncated": truncated ? "1" : "0",
      },
    });
  } catch (error) {
    return errorJson(error instanceof Error ? error.message : "Marketplace request failed.", 200);
  }
}

export async function GET(request: Request) {
  return relay(request);
}

export async function POST(request: Request) {
  return relay(request);
}
