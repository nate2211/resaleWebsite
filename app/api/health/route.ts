export const runtime = "edge";

export async function GET() {
  return Response.json({
    ok: true,
    revision: "grailed-depop-results-v11",
    marketplaceRequests: "official-page-source-relay",
    grailedSearch: "public-index-relay",
    browserBindingAvailable: false,
    cloudflareMarketplaceFetches: "one-official-page-per-relay-request",
    grailedPublicIndexFetches: "one-bounded-json-request-per-search",
  }, {
    headers: { "cache-control": "no-store" },
  });
}
