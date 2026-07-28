export const runtime = "edge";
export const dynamic = "force-dynamic";

function response() {
  return Response.json({
    status: "unavailable",
    message: "Marketplace requests run in the browser in frontend-only mode. Update the client or use the included browser bridge; this Cloudflare route intentionally performs no marketplace fetches.",
    listings: [],
    hasMore: false,
    frontendOnly: true,
    workerRevision: "frontend-marketplaces-cors-safe-v8",
  }, {
    status: 410,
    headers: { "cache-control": "no-store" },
  });
}

export async function GET() {
  return response();
}

export async function POST() {
  return response();
}
