export const runtime = "edge";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({
    error: "Images load directly from marketplace CDNs in frontend-only mode; the Cloudflare image proxy is disabled.",
    frontendOnly: true,
  }, {
    status: 410,
    headers: { "cache-control": "no-store" },
  });
}
