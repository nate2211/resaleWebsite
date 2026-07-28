export const runtime = "edge";
export const dynamic = "force-dynamic";

const MAX_IMAGE_BYTES = 4_500_000;
const ALLOWED_IMAGE_HOSTS = [
  "media-photos.depop.com",
  "media-assets.grailed.com",
  "media.grailed.com",
  "cdn-images.grailed.com",
  "images.grailed.com",
  "process.fs.grailed.com",
  "i.ebayimg.com",
  "u-mercari-images.mercdn.net",
  "static.mercdn.net",
  "thumbnail.image.rakuten.co.jp",
  "image.rakuten.co.jp",
  "tshop.r10s.jp",
  "img.fril.jp",
  "ccimage.hellomarket.com",
  "img.bunjang.co.kr",
  "auctions.c.yimg.jp",
  "item-shopping.c.yimg.jp",
  "shopping.c.yimg.jp",
  "di2ponv0v5otw.cloudfront.net",
  "poshmark.com",
  "zenmarket.jp",
  "img.zenmarket.jp",
  "alicdn.com",
  "g-search1.alicdn.com",
] as const;

function allowedImageUrl(value: string) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
    throw new Error("Only public HTTPS image URLs are supported.");
  }
  const hostname = parsed.hostname.toLowerCase();
  if (!ALLOWED_IMAGE_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))) {
    throw new Error("That image host is not approved for visual comparison.");
  }
  return parsed;
}

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  let source: URL;
  try {
    source = allowedImageUrl(requestUrl.searchParams.get("url") || "");
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Image URL rejected." }, {
      status: 400,
      headers: { "cache-control": "no-store" },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9_000);
  try {
    const upstream = await fetch(source, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: {
        accept: "image/avif,image/webp,image/png,image/jpeg,image/*;q=0.8",
        "user-agent": "Mozilla/5.0 ResaleMasterLab/1.0 image-comparison",
      },
    });
    if (!upstream.ok) {
      return Response.json({ error: `Image host returned ${upstream.status}.` }, { status: 502 });
    }
    const contentType = upstream.headers.get("content-type") || "";
    if (!contentType.startsWith("image/")) {
      return Response.json({ error: "The upstream resource was not an image." }, { status: 415 });
    }
    const declaredLength = Number(upstream.headers.get("content-length") || "0");
    if (declaredLength > MAX_IMAGE_BYTES) {
      return Response.json({ error: "The image is too large for visual comparison." }, { status: 413 });
    }
    const bytes = await upstream.arrayBuffer();
    if (bytes.byteLength > MAX_IMAGE_BYTES) {
      return Response.json({ error: "The image is too large for visual comparison." }, { status: 413 });
    }
    return new Response(bytes, {
      status: 200,
      headers: {
        "content-type": contentType,
        "content-length": String(bytes.byteLength),
        "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
        "x-content-type-options": "nosniff",
        "cross-origin-resource-policy": "same-origin",
      },
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Image request failed." }, {
      status: 502,
      headers: { "cache-control": "no-store" },
    });
  } finally {
    clearTimeout(timer);
  }
}
