export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;

function allowedDepopImage(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.toLowerCase();
    if (url.protocol !== "https:") return undefined;
    const firstPartyPhotoHost = host === "media-photos.depop.com"
      || host.endsWith(".media-photos.depop.com")
      || (/^(?:images|photos|media)\./.test(host) && host.endsWith(".depop.com"));
    if (!firstPartyPhotoHost || host === "assets.depop.com") return undefined;
    if (/favicon|siteicon|apple-touch-icon|logo|qr-code|qrcode/.test(`${host}${path}`)) return undefined;
    if (!/\.(?:avif|gif|jpe?g|png|webp)(?:$|\/)/i.test(path) && !/\/p\d+(?:\.|$)/i.test(path)) return undefined;
    return url;
  } catch {
    return undefined;
  }
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const source = allowedDepopImage(requestUrl.searchParams.get("url") || "");
  if (!source) {
    return new Response("Unsupported image URL.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(source.toString(), {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        Referer: "https://www.depop.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36",
      },
    });
    if (!response.ok || !response.body) {
      return new Response("Depop image was unavailable.", { status: 502, headers: { "cache-control": "no-store" } });
    }
    if (!allowedDepopImage(response.url || source.toString())) {
      return new Response("Depop image redirected to an unsupported host.", { status: 502, headers: { "cache-control": "no-store" } });
    }
    const contentType = response.headers.get("content-type")?.toLowerCase() || "";
    if (!contentType.startsWith("image/")) {
      return new Response("Upstream response was not an image.", { status: 502, headers: { "cache-control": "no-store" } });
    }
    const length = Number(response.headers.get("content-length") || 0);
    if (length > MAX_IMAGE_BYTES) {
      return new Response("Image is too large.", { status: 413, headers: { "cache-control": "no-store" } });
    }
    return new Response(response.body, {
      status: 200,
      headers: {
        "content-type": contentType,
        "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
      },
    });
  } catch {
    return new Response("Depop image request failed.", { status: 504, headers: { "cache-control": "no-store" } });
  } finally {
    clearTimeout(timer);
  }
}

export const __imageProxyTest = { allowedDepopImage };
