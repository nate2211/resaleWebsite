import { createHash } from "node:crypto";
import {
  extractPrice,
  extractReferenceProducts,
  normalizeText,
} from "../../lib/authenticity";
import { assertPublicHttpsUrl, readPublicWebPage } from "../../lib/safe-web";
import type { Listing, Marketplace } from "../../lib/analysis";

const MAX_RESULTS = 18;
const MAX_READS = 10;

function response(payload: Record<string, unknown>, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function cleanText(value: string) {
  return normalizeText(value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " "));
}

function marketplaceForUrl(value: string): Marketplace {
  let host = "";
  try { host = new URL(value).hostname.toLowerCase(); } catch { return "Depop"; }
  if (host.endsWith("grailed.com")) return "Grailed";
  if (host.endsWith("poshmark.com")) return "Poshmark";
  if (host.endsWith("depop.com")) return "Depop";
  if (host.endsWith("mercari.com")) return "Mercari Japan";
  if (host.endsWith("globalbunjang.com") || host.endsWith("bunjang.co.kr")) return "Bunjang";
  if (host.endsWith("rakuten.co.jp")) return "Rakuten";
  if (host.includes("rakuma")) return "Rakuten Rakuma";
  if (host.endsWith("zenmarket.jp")) return "JDirectItems Auction";
  if (host.endsWith("superbuy.com") || host.endsWith("goofish.com") || host.includes("2.taobao.com")) return "Goofish";
  // Unknown public shops are source listings rather than target fee schedules.
  // Depop is only the internal source classification; sourceName/sourceHost are shown to users.
  return "Depop";
}

async function searchPublicWeb(query: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const url = `https://www.bing.com/search?format=rss&count=20&q=${encodeURIComponent(query)}`;
    const result = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/rss+xml,text/xml",
        "Accept-Language": "en-US,en;q=0.8",
        "User-Agent": "ResaleMasterLab/1.0 guarded-public-listing-search",
      },
    });
    const xml = result.ok ? await result.text() : "";
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 20).map((match) => {
      const item = match[1];
      return {
        title: cleanText(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || ""),
        url: cleanText(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || ""),
        snippet: cleanText(item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || ""),
      };
    }).filter((item) => item.url.startsWith("https://"));
  } finally {
    clearTimeout(timer);
  }
}

function fallbackPrice(text: string) {
  const matches = [...text.matchAll(/(?:US\s*)?\$\s*([\d,]+(?:\.\d{1,2})?)/g)]
    .map((match) => extractPrice(match[1]))
    .filter((value): value is number => Boolean(value));
  return matches.find((value) => value >= 3 && value <= 100_000);
}

function inferBrand(title: string, query: string) {
  const queryWords = query.split(/\s+/).filter((word) => word.length > 2);
  const titleWords = title.split(/\s+/).filter((word) => word.length > 2);
  return queryWords.find((word) => titleWords.some((titleWord) =>
    titleWord.toLowerCase() === word.toLowerCase())) || titleWords[0] || "Unspecified";
}


function publicListingDate(raw: string) {
  const patterns: [string, RegExp][] = [
    ["dateCreated", /["']dateCreated["']\s*:\s*["']([^"']+)["']/i],
    ["datePublished", /["']datePublished["']\s*:\s*["']([^"']+)["']/i],
    ["created_at", /["']created_at["']\s*:\s*(?:["']([^"']+)["']|(\d{10,13}))/i],
    ["listed_at", /["']listed_at["']\s*:\s*(?:["']([^"']+)["']|(\d{10,13}))/i],
    ["article:published_time", /property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i],
  ];
  for (const [source, pattern] of patterns) {
    const match = raw.match(pattern);
    const value = match?.[1] || match?.[2];
    if (!value) continue;
    const numeric = /^\d{10,13}$/.test(value) ? Number(value) : Number.NaN;
    const date = Number.isFinite(numeric)
      ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
      : new Date(value);
    if (!Number.isNaN(date.getTime())) return { listedAt: date.toISOString(), dateSource: `public ${source}` };
  }
  return {};
}

function listingId(url: string) {
  return `web-${createHash("sha1").update(url).digest("hex").slice(0, 16)}`;
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    query?: string;
    queries?: string[];
  };
  try {
    const query = String(body.query || "").trim().slice(0, 160);
    if (!query) return response({ error: "A listing search query is required." }, 400);
    const modelQueries = Array.isArray(body.queries)
      ? body.queries.map((value) => String(value).trim().slice(0, 160)).filter(Boolean)
      : [];
    const searches = [...new Set([
      ...modelQueries,
      `${query} buy listing price`,
      `${query} shop sale`,
      `"${query}" resale listing`,
    ].map((value) => value.replace(/\s+/g, " ").trim()))].slice(0, 5);

    const groups = await Promise.all(searches.map(searchPublicWeb));
    const discovered = [...new Map(groups.flat().map((item) => [item.url, item])).values()]
      .filter((item) => {
        try {
          assertPublicHttpsUrl(item.url);
          return true;
        } catch {
          return false;
        }
      })
      .slice(0, MAX_RESULTS);

    const reads = await Promise.all(discovered.slice(0, MAX_READS).map(async (item) => {
      try {
        const page = await readPublicWebPage(item.url, true);
        const pageHost = new URL(page.finalUrl).hostname.toLowerCase().replace(/^www\./, "");
        const references = extractReferenceProducts(
          page.raw || "",
          page.finalUrl,
          pageHost,
          query,
        ).sort((left, right) => right.similarity - left.similarity);
        const reference = references[0];
        const title = (reference?.title || page.title || item.title).replace(/\s*[|–—-]\s*[^|–—-]{2,40}$/, "").trim();
        const description = reference?.description || page.description || item.snippet || page.text.slice(0, 500);
        const price = reference?.price || fallbackPrice(`${page.description} ${page.text.slice(0, 8_000)}`) || 0;
        if (!title || !price) return null;
        const marketplace = marketplaceForUrl(page.finalUrl);
        const listing: Partial<Listing> = {
          id: listingId(page.finalUrl),
          title: title.slice(0, 180),
          brand: (reference?.brand || inferBrand(title, query)).slice(0, 80),
          marketplace,
          url: page.finalUrl,
          price,
          shipping: 0,
          condition: "Verify on source",
          size: "Unknown",
          sellerRating: 0,
          sellerSales: 0,
          likes: 0,
          ageDays: 0,
          ...publicListingDate(page.raw || ""),
          image: reference?.image || "",
          description: description.slice(0, 900),
          compPrices: {},
          authenticitySignals: ["Original public source URL retained", "Structured product metadata read when available"],
          riskSignals: ["Unknown-site listing: verify checkout, seller identity, condition, shipping, and return policy"],
          live: true,
          sourceName: pageHost,
          sourceHost: pageHost,
          webDiscovered: true,
        };
        return listing;
      } catch {
        return null;
      }
    }));

    const listings = reads.filter((item): item is Partial<Listing> => Boolean(item));
    return response({
      query,
      searches,
      listings,
      discoveredCount: discovered.length,
      readCount: listings.length,
      policy: "Public HTTPS pages only. No login, private-network access, script execution, or anti-bot bypass.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The public listing search failed.";
    return response({ error: message }, /required|public|HTTPS|blocked|domain|credential/i.test(message) ? 400 : 502);
  }
}
