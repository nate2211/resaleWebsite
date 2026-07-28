export const runtime = "edge";

export async function GET() {
  return Response.json({
    ok: true,
    revision: "production-navigation-markets-v14",
    marketplaceRequests: "official-page-source-relay",
    grailedSearch: "public-index-relay",
    browserBindingAvailable: false,
    cloudflareMarketplaceFetches: "one-official-page-per-relay-request",
    grailedPublicIndexFetches: "one-bounded-json-request-per-search",
    productionDomain: "resalemasterlab.cloud-cord.com",
    navigation: "complete-sticky-responsive-menu",
    marketplaceBatchSize: 3,
    marketplaceRelayConcurrency: 4,
    depopDiscovery: "official-search-brand-theme-and-product-page-sources",
    mercariJapanDiscovery: "zenmarket-mercari-and-store-27-page-sources",
    tools: ["thrift-check", "listing-template"],
    visualComparisonProxy: "bounded-approved-image-hosts",
  }, {
    headers: { "cache-control": "no-store" },
  });
}
