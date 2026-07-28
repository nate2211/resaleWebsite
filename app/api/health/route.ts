import { env } from "cloudflare:workers";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const REVISION = "depop-production-results-images-v6";

export async function GET() {
  const browser = (env as { BROWSER?: { quickAction?: unknown } }).BROWSER;
  return new Response(JSON.stringify({
    ok: true,
    revision: REVISION,
    runtime: "cloudflare-worker",
    browserBindingAvailable: Boolean(browser && typeof browser.quickAction === "function"),
    checkedAt: new Date().toISOString(),
  }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store, max-age=0",
      "cdn-cache-control": "no-store",
      "cloudflare-cdn-cache-control": "no-store",
      "x-rml-worker-revision": REVISION,
    },
  });
}
