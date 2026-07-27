import { readPublicAsset, readPublicWebPage } from "../../lib/safe-web";

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
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
}

async function searchPublicWeb(query: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9_000);
  try {
    const url = `https://www.bing.com/search?format=rss&count=10&q=${encodeURIComponent(query)}`;
    const result = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/rss+xml,text/xml",
        "User-Agent": "ResaleMasterLab/2.0 public-fashion-search",
      },
    });
    const xml = result.ok ? await result.text() : "";
    return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 10).map((match) => {
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

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as {
    action?: "search" | "read" | "asset";
    query?: string;
    url?: string;
    includeRaw?: boolean;
  };
  try {
    if (body.action === "search") {
      const query = String(body.query || "").trim().slice(0, 180);
      if (!query) return response({ error: "A public web search query is required." }, 400);
      const results = await searchPublicWeb(query);
      return response({
        query,
        results,
        policy: "Public search results only. ResaleMasterLab does not log in, bypass bot protection, or access private pages.",
      });
    }
    if (body.action === "asset") {
      const result = await readPublicAsset(String(body.url || ""));
      return response(result);
    }
    if (body.action === "read") {
      const result = await readPublicWebPage(String(body.url || ""), Boolean(body.includeRaw));
      return response({
        ...result,
        policy: "HTML is converted to evidence text. Linked CSS and JavaScript are listed for optional reading but are never executed.",
      });
    }
    return response({ error: "Choose search, read, or asset." }, 400);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The public page could not be read.";
    return response({ error: message }, /required|accepted|blocked|HTTPS|domain/i.test(message) ? 400 : 502);
  }
}
