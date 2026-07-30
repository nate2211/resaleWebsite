const INSTALL_KEY = "__RML_MARKETPLACE_CAPTURE_INSTALLED__";
const MAX_BODY_CHARS = 4_800_000;
const MAX_ITEMS = 120;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function absoluteUrl(value) {
  try {
    return new URL(String(value || ""), location.href).toString();
  } catch {
    return "";
  }
}

function listingPathPattern() {
  const host = location.hostname.toLowerCase();
  if (host.endsWith("depop.com")) return /\/products\/[^/?#]+\/?(?:[?#]|$)/i;
  if (host.endsWith("grailed.com")) return /\/listings\/\d+/i;
  if (host.endsWith("poshmark.com")) return /\/listing\//i;
  if (host === "jp.mercari.com") return /\/(?:en\/)?item\/m\d+/i;
  if (host.endsWith("zenmarket.jp")) return /\/(?:auction|mercari|rakuten|rakuma)\.aspx\?/i;
  if (host.endsWith("rakuten.co.jp")) return /\/[^/?#]+\/[^/?#]+\/?(?:[?#]|$)/i;
  if (host.endsWith("fril.jp")) return /\/item\//i;
  if (host.endsWith("globalbunjang.com")) return /\/product\//i;
  if (host.endsWith("ebay.com")) return /\/itm\//i;
  if (host.endsWith("mercari.com")) return /\/us\/item\//i;
  if (host.endsWith("facebook.com")) return /\/marketplace\/item\//i;
  if (host.endsWith("goofish.com")) return /\/item\?/i;
  if (host.endsWith("2.taobao.com")) return /\/item\.htm/i;
  return /\/(?:product|products|item|items|listing|listings)\//i;
}

function challengeReason() {
  const source = cleanText(`${document.title}\n${document.body?.innerText || ""}`).slice(0, 80_000);
  const patterns = [
    /sorry,? not authorized/i,
    /403 forbidden/i,
    /access denied/i,
    /you (?:have been|were) blocked/i,
    /verify (?:that )?you are human/i,
    /checking your browser/i,
    /security challenge/i,
    /unusual traffic/i,
    /captcha/i
  ];
  const matched = patterns.find((pattern) => pattern.test(source));
  return matched ? cleanText(source).slice(0, 500) : "";
}

function nearestCard(anchor) {
  let current = anchor;
  for (let depth = 0; current && depth < 7; depth += 1, current = current.parentElement) {
    const text = cleanText(current.innerText || current.textContent || "");
    if (text.length >= 12 && text.length <= 1800 && current.querySelector("img")) return current;
  }
  return anchor.parentElement || anchor;
}

function candidateImage(card, anchor) {
  const image = card?.querySelector("img") || anchor.querySelector?.("img");
  return absoluteUrl(image?.currentSrc || image?.src || image?.getAttribute?.("data-src") || "");
}

function extractRecords() {
  const pathPattern = listingPathPattern();
  const seen = new Set();
  const items = [];
  for (const anchor of document.querySelectorAll("a[href]")) {
    const url = absoluteUrl(anchor.getAttribute("href"));
    if (!url || !pathPattern.test(url) || seen.has(url)) continue;
    const card = nearestCard(anchor);
    const text = cleanText(card?.innerText || card?.textContent || anchor.textContent || "");
    const title = cleanText(
      anchor.getAttribute("aria-label") ||
      anchor.getAttribute("title") ||
      card?.querySelector("h1,h2,h3,h4,[data-testid*='title'],[class*='title']")?.textContent ||
      anchor.textContent ||
      text
    ).slice(0, 320);
    if (!title || title.length < 2) continue;
    const priceMatch = text.match(/(?:USD|US\$|\$|JPY|JP¥|¥|KRW|₩|EUR|€|GBP|£|CNY|RMB|CN¥)\s*[\d,.]+|[\d,.]+\s*(?:JPY|円|KRW|원)/i);
    const image = candidateImage(card, anchor);
    items.push({
      title,
      name: title,
      url,
      web_url: url,
      image,
      imageUrl: image,
      price: priceMatch?.[0] || "",
      description: text.slice(0, 1000)
    });
    seen.add(url);
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

async function waitForHydration() {
  const pathPattern = listingPathPattern();
  let previousCount = -1;
  let stableTicks = 0;
  for (let tick = 0; tick < 24; tick += 1) {
    if (challengeReason()) return;
    const count = [...document.querySelectorAll("a[href]")]
      .filter((anchor) => pathPattern.test(absoluteUrl(anchor.getAttribute("href")))).length;
    if (count > 0 && count === previousCount) stableTicks += 1;
    else stableTicks = 0;
    if (count >= 6 && stableTicks >= 2) return;
    previousCount = count;
    await delay(400);
  }
}

function snapshotBody(records) {
  const json = JSON.stringify({
    __rmlBrowserBridge: true,
    capturedAt: new Date().toISOString(),
    sourceUrl: location.href,
    items: records
  }).replace(/</g, "\\u003c");
  const metadata = [...document.querySelectorAll("meta,link[rel='canonical'],script[type='application/ld+json'],script#__NEXT_DATA__")]
    .map((element) => element.outerHTML)
    .join("\n")
    .slice(0, 1_300_000);
  const bodyHtml = (document.body?.innerHTML || "").slice(0, 2_700_000);
  const visibleText = cleanText(document.body?.innerText || "").slice(0, 500_000);
  return `<!doctype html><html><head>${metadata}<script id="__RML_BRIDGE_SNAPSHOT__" type="application/json">${json}</script></head><body>${bodyHtml}<section data-rml-visible-text>${visibleText}</section></body></html>`
    .slice(0, MAX_BODY_CHARS);
}

async function capturePage() {
  await waitForHydration();
  const reason = challengeReason();
  const records = extractRecords();
  return {
    ok: !reason,
    status: reason ? 403 : 200,
    url: location.href,
    contentType: "text/html; charset=utf-8",
    body: snapshotBody(records),
    title: document.title,
    recordCount: records.length,
    challenge: Boolean(reason),
    requiresUserAction: Boolean(reason),
    error: reason ? "Marketplace verification is open in a browser tab. Complete it once, then retry the search." : "",
    transport: "tab-capture"
  };
}

if (!window[INSTALL_KEY]) {
  Object.defineProperty(window, INSTALL_KEY, { value: true, configurable: false });
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "RML_CAPTURE_PAGE") return false;
    capturePage().then(sendResponse).catch((error) => sendResponse({
      ok: false,
      status: 0,
      url: location.href,
      contentType: "text/html; charset=utf-8",
      body: "",
      error: error instanceof Error ? error.message : "Marketplace page capture failed.",
      transport: "tab-capture"
    }));
    return true;
  });
}
