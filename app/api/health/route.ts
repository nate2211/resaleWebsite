export const runtime = "edge";

export async function GET() {
  return Response.json({
    ok: true,
    revision: "production-thrift-listing-v13",
    marketplaceRequests: "official-page-source-relay",
    grailedSearch: "public-index-relay",
    browserBindingAvailable: false,
    cloudflareMarketplaceFetches: "one-official-page-per-relay-request",
    grailedPublicIndexFetches: "one-bounded-json-request-per-search",
    productionDomain: "resalemasterlab.cloud-cord.com",
    tools: ["thrift-check", "listing-template"],
    visualComparisonProxy: "bounded-approved-image-hosts",
  }, {
    headers: { "cache-control": "no-store" },
  });
}
