export const runtime = "edge";

export async function GET() {
  return Response.json({
    ok: true,
    revision: "frontend-marketplaces-v7",
    marketplaceRequests: "browser",
    browserBindingAvailable: false,
    cloudflareMarketplaceFetches: false,
  }, {
    headers: { "cache-control": "no-store" },
  });
}
