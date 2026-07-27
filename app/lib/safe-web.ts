import { normalizeText } from "./authenticity";

export type WebReadResult = {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string;
  description: string;
  text: string;
  links: { text: string; url: string }[];
  stylesheets: string[];
  scripts: string[];
  raw?: string;
};

const MAX_PAGE_BYTES = 1_200_000;
const MAX_ASSET_BYTES = 180_000;
const MAX_REDIRECTS = 4;

function parseIpv4(host: string) {
  const parts = host.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return null;
  const values = parts.map(Number);
  if (values.some((value) => value > 255)) return null;
  return values;
}

function blockedIpv4(values: number[]) {
  const [a, b] = values;
  return a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224;
}

export function assertPublicHttpsUrl(value: string, allowedDomains?: readonly string[]) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Enter a complete public HTTPS URL.");
  }
  if (url.protocol !== "https:") throw new Error("Only public HTTPS pages can be researched.");
  if (url.username || url.password) throw new Error("URLs containing credentials are not accepted.");
  if (url.port && url.port !== "443") throw new Error("Only the standard HTTPS port is accepted.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Local and private network hosts are blocked.");
  }
  const ipv4 = parseIpv4(host);
  if (ipv4 && blockedIpv4(ipv4)) throw new Error("Private and reserved IP ranges are blocked.");
  if (host.includes(":")) {
    const normalized = host.replace(/^0+/, "");
    if (normalized === "::1" || /^f[cd]/i.test(normalized) || /^fe[89ab]/i.test(normalized) || normalized === "::") {
      throw new Error("Private and reserved IPv6 ranges are blocked.");
    }
  }
  if (!ipv4 && !host.includes(":") && !host.includes(".")) throw new Error("A public domain name is required.");
  if (allowedDomains?.length && !allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) {
    throw new Error("This source is outside the requested research domains.");
  }
  url.hash = "";
  return url;
}

async function readLimited(response: Response, maximum = MAX_PAGE_BYTES) {
  const declared = Number(response.headers.get("content-length") || 0);
  if (declared > maximum) throw new Error("The page is larger than the research limit.");
  const text = await response.text();
  if (new TextEncoder().encode(text).byteLength > maximum) {
    throw new Error("The page is larger than the research limit.");
  }
  return text;
}

async function fetchSafe(initial: URL, maximum = MAX_PAGE_BYTES) {
  let current = initial;
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 11_000);
    try {
      const response = await fetch(current.toString(), {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          Accept: "text/html,application/xhtml+xml,text/css,application/javascript,text/javascript;q=0.8,*/*;q=0.2",
          "User-Agent": "ResaleMasterLab/2.0 evidence-reader (+public fashion research; no login or bot bypass)",
        },
      });
      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) return { response, finalUrl: current, body: "" };
        current = assertPublicHttpsUrl(new URL(location, current).toString());
        continue;
      }
      const body = await readLimited(response, maximum);
      return { response, finalUrl: current, body };
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error("The page redirected too many times.");
}

function attribute(tag: string, name: string) {
  const expression = new RegExp(`${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = tag.match(expression);
  return normalizeText(match?.[1] ?? match?.[2] ?? match?.[3] ?? "");
}

function meta(html: string, keys: string[]) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = (attribute(tag, "property") || attribute(tag, "name") || attribute(tag, "itemprop")).toLowerCase();
    if (keys.includes(key)) return attribute(tag, "content");
  }
  return "";
}

function absolute(value: string, base: string) {
  try {
    return new URL(value, base).toString();
  } catch {
    return "";
  }
}

export function parseWebDocument(html: string, pageUrl: string): Omit<WebReadResult, "status" | "contentType" | "url" | "finalUrl"> {
  const title = meta(html, ["og:title", "twitter:title"]) ||
    normalizeText(html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "");
  const description = meta(html, ["og:description", "description", "twitter:description"]);
  const links = (html.match(/<a\b[^>]*>[\s\S]*?<\/a>/gi) ?? []).slice(0, 400).map((tag) => ({
    text: normalizeText(tag.replace(/<[^>]+>/g, " ")).slice(0, 180),
    url: absolute(attribute(tag, "href"), pageUrl),
  })).filter((link) => link.url.startsWith("https://") && link.text);
  const stylesheets = unique((html.match(/<link\b[^>]*>/gi) ?? [])
    .filter((tag) => /stylesheet/i.test(attribute(tag, "rel")))
    .map((tag) => absolute(attribute(tag, "href"), pageUrl))
    .filter((value) => value.startsWith("https://"))).slice(0, 24);
  const scripts = unique((html.match(/<script\b[^>]*>/gi) ?? [])
    .map((tag) => absolute(attribute(tag, "src"), pageUrl))
    .filter((value) => value.startsWith("https://"))).slice(0, 24);
  const text = normalizeText(html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " "))
    .slice(0, 45_000);
  return {
    title,
    description,
    text,
    links: [...new Map(links.map((link) => [link.url, link])).values()].slice(0, 120),
    stylesheets,
    scripts,
  };
}

function unique(values: string[]) {
  return [...new Set(values)];
}

export async function readPublicWebPage(value: string, includeRaw = false): Promise<WebReadResult> {
  const initial = assertPublicHttpsUrl(value);
  const { response, finalUrl, body } = await fetchSafe(initial);
  const contentType = response.headers.get("content-type") || "";
  if (!/text\/html|application\/xhtml\+xml/i.test(contentType) && !/^\s*</.test(body)) {
    throw new Error("The requested URL did not return an HTML document.");
  }
  const parsed = parseWebDocument(body, finalUrl.toString());
  return {
    url: initial.toString(),
    finalUrl: finalUrl.toString(),
    status: response.status,
    contentType,
    ...parsed,
    raw: includeRaw ? body.slice(0, MAX_PAGE_BYTES) : undefined,
  };
}

export async function readPublicAsset(value: string) {
  const initial = assertPublicHttpsUrl(value);
  const { response, finalUrl, body } = await fetchSafe(initial, MAX_ASSET_BYTES);
  const contentType = response.headers.get("content-type") || "";
  if (!/text\/css|javascript|text\/plain|application\/json/i.test(contentType)) {
    throw new Error("Only readable CSS, JavaScript, text, and JSON assets are accepted.");
  }
  return {
    url: initial.toString(),
    finalUrl: finalUrl.toString(),
    status: response.status,
    contentType,
    text: body.slice(0, MAX_ASSET_BYTES),
    note: "Asset text is returned for evidence extraction only and is never executed by ResaleMasterLab.",
  };
}
