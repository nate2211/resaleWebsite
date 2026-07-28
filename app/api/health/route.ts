export const runtime = "edge";

export async function GET() {
  return Response.json({
    ok: true,
    revision: "official-page-source-marketplaces-v10",
    marketplaceRequests: "official-page-source-relay",
    browserBindingAvailable: false,
    cloudflareMarketplaceFetches: "one-official-page-per-relay-request",
  }, {
    headers: { "cache-control": "no-store" },
  });
}
