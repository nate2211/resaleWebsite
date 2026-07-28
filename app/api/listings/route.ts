export const runtime = "edge";
export const dynamic = "force-dynamic";

const WORKER_REVISION = "frontend-marketplace-results-api-v9";
const MAX_BODY_BYTES = 2_000_000;
const UPSTREAM_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 2;

const ALLOWED_MARKETPLACE_HOSTS = [
  "depop.com",
  "webapi.depop.com",
  "grailed.com",
  "poshmark.com",
  "jp.mercari.com",
  "zenmarket.jp",
  "rakuten.co.jp",
  "fril.jp",
  "globalbunjang.com",
  "ebay.com",
  "mercari.com",
  "facebook.com",
] as const;

type RelayPayload = {
  ok: boolean;
  status: number;
  url: string;
  contentType: string;
  body: string;
  truncated: boolean;
  transport: "frontend-api";
  workerRevision: string;
  error?: string;
};

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
  if (parsed.protocol !== "https:") {
    throw new Error("Only HTTPS marketplace URLs are allowed.");
  }
  if (parsed.username || parsed.password || parsed.port) {
    throw new Error("Marketplace URLs cannot contain credentials or custom ports.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_MARKETPLACE_HOSTS.some((domain) => hostnameMatches(hostname, domain))) {
    throw new Error("That marketplace host is not allowed by the results relay.");
  }
  return parsed;
}

function json(value: RelayPayload | { error: string; workerRevision: string }, status = 200) {
  return Response.json(value, {
    status,
    headers: {
      "cache-control": "no-store, max-age=0",
      "cdn-cache-control": "no-store",
      "cloudflare-cdn-cache-control": "no-store",
      "x-rml-worker-revision": WORKER_REVISION,
      "x-rml-marketplace-mode": "thin-results-relay",
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
        await reader.cancel("Marketplace result body limit reached.");
        break;
      }
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value;
      size += chunk.byteLength;
      body += decoder.decode(chunk, { stream: true });
      if (value.byteLength > remaining) {
        truncated = true;
        await reader.cancel("Marketplace result body limit reached.");
        break;
      }
    }
    body += decoder.decode();
    return { body, truncated };
  } finally {
    reader.releaseLock();
  }
}

async function fetchMarketplaceResult(initialUrl: URL, requestSignal: AbortSignal) {
  let current = initialUrl;
  for (let redirectCount = 0; redirectCount <= MAX_REDIRECTS; redirectCount += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    const abort = () => controller.abort();
    requestSignal.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(current, {
        method: "GET",
        redirect: "manual",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          accept: "application/json,text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.7",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "no-cache",
          pragma: "no-cache",
          "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/150 Safari/537.36",
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        if (!location || redirectCount >= MAX_REDIRECTS) {
          return { response, url: current };
        }
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
  let source = "";
  if (request.method === "POST") {
    try {
      const payload = await request.json() as { source?: unknown; url?: unknown };
      source = typeof payload.source === "string" ? payload.source : typeof payload.url === "string" ? payload.url : "";
    } catch {
      return json({ error: "The request body must be valid JSON.", workerRevision: WORKER_REVISION }, 400);
    }
  } else {
    source = new URL(request.url).searchParams.get("source") || "";
  }

  let sourceUrl: URL;
  try {
    sourceUrl = parseAllowedUrl(source);
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Marketplace URL rejected.",
      workerRevision: WORKER_REVISION,
    }, 400);
  }

  try {
    const { response, url } = await fetchMarketplaceResult(sourceUrl, request.signal);
    const { body, truncated } = await readLimitedText(response);
    return json({
      ok: response.ok,
      status: response.status,
      url: url.toString(),
      contentType: response.headers.get("content-type") || "",
      body,
      truncated,
      transport: "frontend-api",
      workerRevision: WORKER_REVISION,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Marketplace request failed.";
    return json({
      ok: false,
      status: 0,
      url: sourceUrl.toString(),
      contentType: "",
      body: "",
      truncated: false,
      transport: "frontend-api",
      workerRevision: WORKER_REVISION,
      error: message,
    });
  }
}

export async function GET(request: Request) {
  return relay(request);
}

export async function POST(request: Request) {
  return relay(request);
}
