export const runtime = "edge";

export async function GET() {
  return Response.json({
    ok: true,
    revision: "frontend-marketplace-results-api-v9",
    marketplaceRequests: "frontend-api-relay",
    browserBindingAvailable: false,
    cloudflareMarketplaceFetches: "single-bounded-relay-only",
  }, {
    headers: { "cache-control": "no-store" },
  });
}
