export const runtime = "edge";

export async function GET() {
  return Response.json({
    ok: true,
    revision: "market-search-depop-parallel-recovery-v21",
    marketplaceRequests: "frontend-api-depop-parallel-recovery",
    grailedSearch: "public-index-relay",
    browserBindingAvailable: false,
    cloudflareMarketplaceFetches: "parallel-depop-ssr-api-reader-index-recovery",
    grailedPublicIndexFetches: "one-bounded-json-request-per-search",
    productionDomain: "resalemasterlab.cloud-cord.com",
    navigation: "complete-sticky-responsive-menu",
    marketplaceBatchSize: { standard: 3, allMarkets: 2 },
    marketplaceRelayConcurrency: 3,
    depopDiscovery: "parallel-ssr-public-catalog-reader-index-and-product-page-sources",
    mercariJapanDiscovery: "zenmarket-mercari-store-27-catalog-and-page-sources",
    zenMarketDiscovery: {
      mercariJapan: "store-27-catalog-plus-mercari-and-cross-site-pages",
      jdirectItems: "store-28-catalog-plus-yahoo-and-cross-site-pages",
      rakuten: "store-0-catalog-plus-rakuten-and-cross-site-pages",
      rakuma: "store-25-catalog-plus-rakuma-and-cross-site-pages",
    },
    tools: ["thrift-check", "listing-template"],
    visualComparisonProxy: "bounded-approved-image-hosts",
  }, {
    headers: { "cache-control": "no-store" },
  });
}
