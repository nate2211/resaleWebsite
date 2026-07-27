import { assertPublicHttpsUrl, parseWebDocument } from "../../lib/safe-web";
import { extractWatchStatus } from "../../lib/watch-status";

const MARKETPLACE_HOSTS = ["depop.com", "grailed.com", "poshmark.com"];
const MAX_MARKETPLACE_HTML = 5_000_000;
const MAX_OTHER_HTML = 1_500_000;

function reply(value: unknown, status = 200) {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" },
  });
}

function isMarketplaceHost(host: string) {
  return MARKETPLACE_HOSTS.some((domain) => host === domain || host.endsWith(`.${domain}`));
}

async function readListingPage(value: string) {
  let current = assertPublicHttpsUrl(value);
  for (let redirect = 0; redirect <= 4; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    try {
      const response = await fetch(current.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "Accept-Language": "en-US,en;q=0.8",
          "User-Agent": "ResaleMasterLab/3.0 public listing monitor; no login or bot bypass",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { response, finalUrl: current, body: "" };
        current = assertPublicHttpsUrl(new URL(location, current).toString());
        continue;
      }
      const maximum = isMarketplaceHost(current.hostname.toLowerCase())
        ? MAX_MARKETPLACE_HTML : MAX_OTHER_HTML;
      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > maximum * 2) throw new Error("The listing page is too large for safe monitoring.");
      const body = (await response.text()).slice(0, maximum);
      return { response, finalUrl: current, body };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("The listing redirected too many times.");
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { url?: string };
  const url = String(body.url || "").trim();
  if (!url) return reply({ error: "A public listing URL is required." }, 400);

  try {
    const initial = assertPublicHttpsUrl(url);
    const { response, finalUrl, body: html } = await readListingPage(initial.toString());
    const parsed = parseWebDocument(html, finalUrl.toString());
    const report = extractWatchStatus({
      html,
      text: parsed.text,
      url: initial.toString(),
      finalUrl: finalUrl.toString(),
      title: parsed.title,
      httpStatus: response.status,
    });
    return reply({
      ...report,
      policy: "Public page evidence only. Sold prices and dates remain unknown unless the source publishes them.",
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "The listing took too long to respond."
      : error instanceof Error ? error.message : "The listing status could not be checked.";
    return reply({ error: message }, 422);
  }
}
