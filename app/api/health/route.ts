export const runtime = "edge";

export async function GET() {
  return Response.json({
    ok: true,
    revision: "frontend-marketplaces-cors-safe-v8",
    marketplaceRequests: "browser",
    browserBindingAvailable: false,
    cloudflareMarketplaceFetches: false,
  }, {
    headers: { "cache-control": "no-store" },
  });
}
