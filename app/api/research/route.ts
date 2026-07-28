function zenMarketQuery(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).map(encodeURIComponent).join("%2B");
}

const MARKET_URLS = {
  Depop: (query: string) => `https://www.depop.com/search/?q=${encodeURIComponent(query)}`,
  Grailed: (query: string) =>
    `https://www.grailed.com/shop?query=${encodeURIComponent(query).replaceAll("%20", "+")}&sort=most-relevant`,
  Poshmark: (query: string) =>
    `https://poshmark.com/search?query=${encodeURIComponent(query)}&type=listings&src=ac`,
  "Mercari Japan": (query: string) =>
    `https://zenmarket.jp/en/search.aspx?q=${zenMarketQuery(query)}&p=1&searchMode=custom&stores=27`,
  "Mercari Japan sold": (query: string) =>
    `https://zenmarket.jp/en/search.aspx?q=${zenMarketQuery(query)}&p=1&searchMode=custom&stores=27`,
  "JDirectItems Auction": (query: string) =>
    `https://zenmarket.jp/en/search.aspx?q=${zenMarketQuery(query)}&p=1&searchMode=custom&stores=28`,
  Rakuten: (query: string) =>
    `https://zenmarket.jp/en/search.aspx?q=${zenMarketQuery(query)}&p=1&searchMode=custom&stores=0`,
  "Rakuten Rakuma": (query: string) =>
    `https://zenmarket.jp/en/search.aspx?q=${zenMarketQuery(query)}&p=1&searchMode=custom&stores=25`,
  Bunjang: (query: string) =>
    `https://globalbunjang.com/search?q=${encodeURIComponent(query)}`,
  Goofish: (query: string) => {
    const params = new URLSearchParams({
      nTag: "Home-search",
      from: "search-input",
      keyword: query,
    });
    return `https://www.superbuy.com/en/page/search/?${params.toString()}`;
  },
};

function cleanText(value: string) {
  return value
    .replace(/<!\[CDATA\[|\]\]>/g, "")
    .replace(/<[^>]+>/g, " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replace(/\s+/g, " ")
    .trim();
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 140);
  if (!query) return Response.json({ error: "Research query is required." }, { status: 400 });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 9_000);
  try {
    const rssUrl = `https://www.bing.com/search?format=rss&count=8&q=${encodeURIComponent(`${query} fashion resale history authenticity`)}`;
    const result = await fetch(rssUrl, {
      signal: controller.signal,
      headers: { Accept: "application/rss+xml,text/xml" },
    });
    const xml = result.ok ? await result.text() : "";
    const sources = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 8).map((match) => {
      const item = match[1];
      return {
        title: cleanText(item.match(/<title>([\s\S]*?)<\/title>/i)?.[1] || ""),
        url: cleanText(item.match(/<link>([\s\S]*?)<\/link>/i)?.[1] || ""),
        snippet: cleanText(item.match(/<description>([\s\S]*?)<\/description>/i)?.[1] || ""),
      };
    }).filter((item) => item.url.startsWith("http"));
    return Response.json({
      query,
      sources,
      marketplaceSearches: Object.entries(MARKET_URLS).map(([marketplace, build]) => ({
        marketplace,
        url: build(query),
      })),
    }, { headers: { "cache-control": "public, max-age=120" } });
  } catch {
    return Response.json({
      query,
      sources: [],
      marketplaceSearches: Object.entries(MARKET_URLS).map(([marketplace, build]) => ({
        marketplace,
        url: build(query),
      })),
    });
  } finally {
    clearTimeout(timer);
  }
}
