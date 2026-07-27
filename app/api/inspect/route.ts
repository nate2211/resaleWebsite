import { extractMarketplaceEngagement, type EngagementMarketplace } from "../../lib/engagement";

const ALLOWED_HOSTS = new Set([
  "depop.com",
  "www.depop.com",
  "grailed.com",
  "www.grailed.com",
  "poshmark.com",
  "www.poshmark.com",
  "jp.mercari.com",
  "zenmarket.jp",
  "www.zenmarket.jp",
  "globalbunjang.com",
  "www.globalbunjang.com",
  "superbuy.com",
  "www.superbuy.com",
  "goofish.com",
  "www.goofish.com",
]);

const MAX_HTML_LENGTH = 5_000_000;

function jsonResponse(
  payload: Record<string, unknown>,
  status = 200,
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function assertAllowedUrl(value: string) {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Enter a complete marketplace listing URL.");
  }
  if (parsed.protocol !== "https:" || !ALLOWED_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error("Only supported public resale marketplace HTTPS URLs are accepted.");
  }
  if (parsed.hostname.toLowerCase().includes("depop") && /\/manage\/?$/i.test(parsed.pathname)) {
    parsed.pathname = parsed.pathname.replace(/\/manage\/?$/i, "/");
  }
  parsed.username = "";
  parsed.password = "";
  parsed.hash = "";
  return parsed;
}

async function fetchWithSafeRedirects(initialUrl: URL) {
  let current = initialUrl;
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent":
            "ResaleMasterLab/1.0 public-listing-metadata-reader (+local resale research)",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { response, finalUrl: current };
        current = assertAllowedUrl(new URL(location, current).toString());
        continue;
      }
      return { response, finalUrl: current };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("The marketplace redirected too many times.");
}

function decodeEntities(value: string) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function metaContent(html: string, keys: string[]) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const attrs: Record<string, string> = {};
    for (const match of tag.matchAll(
      /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g,
    )) {
      attrs[match[1].toLowerCase()] = decodeEntities(
        match[2] ?? match[3] ?? match[4] ?? "",
      );
    }
    const key = (attrs.property ?? attrs.name ?? attrs.itemprop ?? "").toLowerCase();
    if (keys.includes(key) && attrs.content) return attrs.content.trim();
  }
  return "";
}

function flattenJsonLd(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.flatMap(flattenJsonLd);
  if (!value || typeof value !== "object") return [];
  const object = value as Record<string, unknown>;
  const graph = Array.isArray(object["@graph"])
    ? object["@graph"].flatMap(flattenJsonLd)
    : [];
  return [object, ...graph];
}

function readJsonLd(html: string) {
  const records: Record<string, unknown>[] = [];
  const expression =
    /<script\b[^>]*type\s*=\s*(?:"application\/ld\+json"|'application\/ld\+json')[^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(expression)) {
    try {
      records.push(...flattenJsonLd(JSON.parse(match[1].trim())));
    } catch {
      // Some marketplaces emit malformed or partial JSON-LD. OpenGraph remains
      // a safe fallback, so one bad block should not end inspection.
    }
  }
  return records;
}

function textValue(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function numericValue(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function marketplaceFromHost(host: string) {
  if (host.includes("depop")) return "Depop";
  if (host.includes("grailed")) return "Grailed";
  if (host.includes("poshmark")) return "Poshmark";
  if (host.includes("mercari")) return "Mercari Japan";
  if (host.includes("zenmarket")) return "ZenMarket";
  if (host.includes("bunjang")) return "Bunjang";
  return "Goofish";
}

function depopSellerEvidence(html: string) {
  const username = decodeEntities(
    html.match(/aria-label=(?:"([^"]+)'s shop"|'([^']+)'s shop')/i)?.[1] ??
    html.match(/aria-label=(?:"([^"]+)'s shop"|'([^']+)'s shop')/i)?.[2] ??
    html.match(/alt=(?:"([^"]+)'s profile picture"|'([^']+)'s profile picture')/i)?.[1] ??
    "",
  );
  const sales = numericValue(html.match(/([\d,.]+)\s+sold\b/i)?.[1]);
  const activity = decodeEntities(html.match(/\b(Active\s+(?:today|this week|this month|recently))\b/i)?.[1] ?? "");
  const rating = numericValue(html.match(/shop rating\s+([\d.]+)\s+stars/i)?.[1]);
  const ratingArea = html.match(/shop rating[\s\S]{0,1800}/i)?.[0] ?? "";
  const reviews = numericValue(ratingArea.match(/>\s*\(([\d,.]+)\)\s*</)?.[1]);
  const profileUrlRaw = html.match(
    /href=(?:"(\/[^"?#]+\/\?[^"]*productId=[^"]+)"|'(\/[^'?#]+\/\?[^']*productId=[^']+)')/i,
  );
  const profileUrl = profileUrlRaw?.[1] || profileUrlRaw?.[2]
    ? new URL(decodeEntities(profileUrlRaw[1] ?? profileUrlRaw[2]), "https://www.depop.com").toString()
    : "";
  return { username, sales, activity, rating, reviews, profileUrl };
}

function publicDate(html: string, ageDays?: number) {
  const meta = metaContent(html, ["article:published_time", "date", "datepublished", "listing:published_time"]);
  const parsed = meta ? new Date(meta) : null;
  if (parsed && !Number.isNaN(parsed.getTime())) {
    return { listedAt: parsed.toISOString(), dateSource: "public page metadata" };
  }
  const visibleDate = html.match(/(?:Online\s+since|Listed\s+on|Posted\s+on)\s*:?\s*([12]\d{3}-\d{2}-\d{2}|[A-Z][a-z]+\s+\d{1,2},\s+[12]\d{3})/i)?.[1];
  const visibleParsed = visibleDate ? new Date(visibleDate) : null;
  if (visibleParsed && !Number.isNaN(visibleParsed.getTime())) {
    return { listedAt: visibleParsed.toISOString(), dateSource: "public listing details" };
  }
  if (Number.isFinite(ageDays) && Number(ageDays) >= 0) {
    return {
      listedAt: new Date(Date.now() - Number(ageDays) * 86_400_000).toISOString(),
      dateSource: "derived from public listing age",
    };
  }
  return {};
}

export async function POST(request: Request) {
  let body: { url?: string };
  try {
    body = (await request.json()) as { url?: string };
  } catch {
    return jsonResponse(
      { error: "Send a JSON body containing a listing URL." },
      400,
    );
  }

  let url: URL;
  try {
    url = assertAllowedUrl(body.url ?? "");
  } catch (error) {
    return jsonResponse(
      { error: error instanceof Error ? error.message : "Invalid listing URL." },
      400,
    );
  }

  try {
    const { response, finalUrl } = await fetchWithSafeRedirects(url);
    if (!response.ok) {
      return jsonResponse(
        {
          error:
            response.status === 403 || response.status === 429
              ? "This marketplace did not provide public metadata right now. Use manual import below; no login or anti-bot bypass is attempted."
              : `The marketplace returned HTTP ${response.status}. Use manual import if the listing is visible in your browser.`,
          status: response.status,
          marketplace: marketplaceFromHost(finalUrl.hostname),
          finalUrl: finalUrl.toString(),
        },
        422,
      );
    }

    const contentLength = Number(response.headers.get("content-length") ?? 0);
    if (contentLength > MAX_HTML_LENGTH * 2) {
      return jsonResponse(
        { error: "The listing page is too large for safe metadata inspection." },
        413,
      );
    }

    const html = (await response.text()).slice(0, MAX_HTML_LENGTH);
    const jsonLd = readJsonLd(html);
    const product =
      jsonLd.find((record) => {
        const kind = record["@type"];
        return kind === "Product" || (Array.isArray(kind) && kind.includes("Product"));
      }) ?? {};
    const offersRaw = product.offers;
    const offers = Array.isArray(offersRaw)
      ? (offersRaw[0] as Record<string, unknown> | undefined)
      : (offersRaw as Record<string, unknown> | undefined);
    const imageRaw = product.image;
    const image = Array.isArray(imageRaw)
      ? textValue(imageRaw[0])
      : typeof imageRaw === "object" && imageRaw
        ? textValue((imageRaw as Record<string, unknown>).url)
        : textValue(imageRaw);
    const title =
      textValue(product.name) ||
      metaContent(html, ["og:title", "twitter:title"]) ||
      decodeEntities(
        html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? "",
      );
    const description =
      textValue(product.description) ||
      metaContent(html, ["og:description", "twitter:description", "description"]);
    const price =
      numericValue(offers?.price) ||
      numericValue(offers?.lowPrice) ||
      numericValue(
        metaContent(html, [
          "product:price:amount",
          "og:price:amount",
          "twitter:data1",
        ]),
      );
    const currency =
      textValue(offers?.priceCurrency) ||
      metaContent(html, ["product:price:currency", "og:price:currency"]) ||
      "USD";
    const brandRaw = product.brand;
    const brand =
      typeof brandRaw === "object" && brandRaw
        ? textValue((brandRaw as Record<string, unknown>).name)
        : textValue(brandRaw);

    const marketplace = marketplaceFromHost(finalUrl.hostname);
    const engagement = ["Depop", "Grailed", "Poshmark"].includes(marketplace)
      ? extractMarketplaceEngagement(html, finalUrl.toString(), marketplace as EngagementMarketplace)
      : undefined;
    const depopSeller = marketplace === "Depop"
      ? depopSellerEvidence(html)
      : { username: "", sales: 0, activity: "", rating: 0, reviews: 0, profileUrl: "" };
    const seller = engagement ? {
      username: engagement.seller.username || depopSeller.username,
      sales: engagement.seller.itemsSold || depopSeller.sales,
      activity: engagement.seller.activity || depopSeller.activity,
      rating: engagement.seller.rating || depopSeller.rating,
      reviews: engagement.seller.ratingCount || depopSeller.reviews,
      followers: engagement.seller.followers || 0,
      verified: Boolean(engagement.seller.verified),
      trusted: Boolean(engagement.seller.trusted),
      profileUrl: depopSeller.profileUrl,
    } : depopSeller;

    return jsonResponse({
      marketplace,
      finalUrl: finalUrl.toString(),
      title,
      description,
      price,
      currency,
      brand,
      image:
        image ||
        metaContent(html, ["og:image", "twitter:image", "twitter:image:src"]),
      availability: textValue(offers?.availability),
      inspectedAt: new Date().toISOString(),
      source: Object.keys(product).length ? "json-ld" : "open-graph",
      seller,
      engagement,
      ...publicDate(html, engagement?.ageDays),
      warning:
        "Public metadata only. Confirm price, condition, seller details, and authenticity on the original listing before buying.",
    });
  } catch (error) {
    const message =
      error instanceof Error && error.name === "AbortError"
        ? "The marketplace took too long to respond. Open the listing directly or use manual import."
        : error instanceof Error
          ? error.message
          : "Listing inspection failed.";
    return jsonResponse({ error: message }, 422);
  }
}
