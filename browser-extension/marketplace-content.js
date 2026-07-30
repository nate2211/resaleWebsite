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
  return patterns.some((pattern) => pattern.test(source)) ? source.slice(0, 500) : "";
}

function nearestCard(anchor) {
  const semantic = anchor.closest("article,li,[data-testid*='product'],[data-testid*='listing'],[class*='card'],[class*='Card'],[class*='product'],[class*='Product']");
  if (semantic?.querySelector("img")) return semantic;
  let current = anchor;
  for (let depth = 0; current && depth < 8; depth += 1, current = current.parentElement) {
    const text = cleanText(current.innerText || current.textContent || "");
    if (text.length >= 8 && text.length <= 2200 && current.querySelector("img")) return current;
  }
  return anchor.parentElement || anchor;
}

function imageFromSrcset(value) {
  const candidates = String(value || "").split(",").map((entry) => {
    const [url, descriptor = "0"] = entry.trim().split(/\s+/);
    const weight = Number.parseFloat(descriptor) || 0;
    return { url, weight };
  }).filter((entry) => entry.url);
  candidates.sort((a, b) => b.weight - a.weight);
  return candidates[0]?.url || "";
}

function candidateImage(card, anchor) {
  const images = [...(card?.querySelectorAll("img") || []), ...(anchor.querySelectorAll?.("img") || [])];
  for (const image of images) {
    const value = imageFromSrcset(image.currentSrc ? "" : image.getAttribute("srcset") || image.getAttribute("data-srcset"))
      || image.currentSrc || image.src || image.getAttribute("data-src") || image.getAttribute("data-original") || "";
    const url = absoluteUrl(value);
    if (url && !/(?:logo|favicon|avatar|badge|sprite|qr)/i.test(url)) return url;
  }
  return "";
}

function candidateTitle(card, anchor, text) {
  const imageAlt = card?.querySelector("img[alt]")?.getAttribute("alt") || "";
  const heading = card?.querySelector("h1,h2,h3,h4,[data-testid*='title'],[data-testid*='name'],[class*='title'],[class*='Title'],[class*='name']")?.textContent || "";
  const values = [
    anchor.getAttribute("aria-label"),
    anchor.getAttribute("title"),
    imageAlt,
    heading,
    anchor.textContent,
    text
  ];
  return values.map(cleanText).find((value) => value.length >= 2 && !/^\$?[\d,.]+$/.test(value))?.slice(0, 320) || "";
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
    const title = candidateTitle(card, anchor, text);
    if (!title) continue;
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

function isSearchPage() {
  return /\/(?:search|brands|theme)\/?/i.test(location.pathname);
}

async function waitForHydration() {
  const pathPattern = listingPathPattern();
  const originalScroll = window.scrollY;
  let previousCount = -1;
  let stableTicks = 0;
  try {
    for (let tick = 0; tick < 36; tick += 1) {
      if (challengeReason()) return;
      const count = [...document.querySelectorAll("a[href]")]
        .filter((anchor) => pathPattern.test(absoluteUrl(anchor.getAttribute("href")))).length;
      if (count > 0 && count === previousCount) stableTicks += 1;
      else stableTicks = 0;
      if (count >= 12 && stableTicks >= 3) return;
      if (isSearchPage() && tick > 4 && tick % 3 === 0) {
        const maximum = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        window.scrollTo(0, Math.min(maximum, Math.max(window.scrollY, tick * 650)));
      }
      previousCount = count;
      await delay(350);
    }
  } finally {
    if (isSearchPage()) window.scrollTo(0, originalScroll);
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
    .slice(0, 1_000_000);
  const stateScripts = [...document.scripts]
    .filter((script) => !script.src && /(?:__next_f|__INITIAL_STATE__|__APOLLO_STATE__|\/products\/|\/listings\/|\/listing\/)/i.test(script.textContent || ""))
    .map((script) => script.outerHTML)
    .join("\n")
    .slice(0, 1_200_000);
  const bodyHtml = (document.body?.innerHTML || "").slice(0, 2_300_000);
  const visibleText = cleanText(document.body?.innerText || "").slice(0, 250_000);
  return `<!doctype html><html><head>${metadata}${stateScripts}<script id="__RML_BRIDGE_SNAPSHOT__" type="application/json">${json}</script></head><body>${bodyHtml}<section data-rml-visible-text>${visibleText}</section></body></html>`
    .slice(0, MAX_BODY_CHARS);
}

async function capturePage() {
  if (document.readyState === "loading") {
    await new Promise((resolve) => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  }
  await waitForHydration();
  const reason = challengeReason();
  if (reason) {
    return {
      ok: false,
      status: 403,
      url: location.href,
      contentType: "text/html; charset=utf-8",
      body: "",
      title: document.title,
      recordCount: 0,
      challenge: true,
      requiresUserAction: true,
      error: "Depop opened its verification page in the browser. Complete it in that tab, then run the search again.",
      transport: "interactive-tab"
    };
  }
  const records = extractRecords();
  return {
    ok: true,
    status: 200,
    url: location.href,
    contentType: "text/html; charset=utf-8",
    body: snapshotBody(records),
    title: document.title,
    recordCount: records.length,
    challenge: false,
    requiresUserAction: false,
    error: "",
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
