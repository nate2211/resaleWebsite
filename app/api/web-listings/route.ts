export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function POST() {
  return Response.json({
    error: "AI web listing discovery now runs in the browser. This route intentionally performs no public-web or marketplace requests.",
    listings: [],
    searches: [],
    frontendOnly: true,
    workerRevision: "market-search-grailed-real-listings-v22",
  }, {
    status: 410,
    headers: { "cache-control": "no-store" },
  });
}
