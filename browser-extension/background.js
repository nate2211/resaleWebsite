const MAX_BODY_CHARS = 4_800_000;
const INSTALL_KEY = "__RML_BROWSER_BRIDGE_BACKGROUND_INSTALLED__";
const APP_ORIGINS = new Set([
  "https://resalemasterlab.cloud-cord.com",
  "https://resalemasterlab.com",
  "https://www.resalemasterlab.com",
  "https://resalewebsite.unusualsuspectsclothing.workers.dev",
  "http://localhost",
  "http://127.0.0.1"
]);
const ALLOWED_HOSTS = [
  "depop.com", "grailed.com", "poshmark.com", "jp.mercari.com", "zenmarket.jp",
  "rakuten.co.jp", "auctions.yahoo.co.jp", "fril.jp", "globalbunjang.com",
  "ebay.com", "mercari.com", "facebook.com", "superbuy.com", "goofish.com", "2.taobao.com"
];
const hostQueues = new Map();

function hostnameMatches(hostname, domain) {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

function safeUrl(value) {
  const url = new URL(String(value || ""));
  if (url.protocol !== "https:") throw new Error("Only HTTPS marketplace URLs are allowed.");
  if (url.username || url.password || url.port) throw new Error("Credential-bearing or custom-port URLs are not allowed.");
  const hostname = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.some((domain) => hostnameMatches(hostname, domain))) {
    throw new Error("That marketplace host is not enabled in the Browser Bridge.");
  }
  return url;
}

function senderAllowed(sender) {
  try {
    const url = new URL(sender?.url || sender?.tab?.url || "");
    if (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) {
      return true;
    }
    return APP_ORIGINS.has(url.origin);
  } catch {
    return false;
  }
}

function challengeDetected(status, body) {
  if (status === 401 || status === 403 || status === 429) return true;
  const sample = String(body || "").slice(0, 120_000);
  return /sorry,? not authorized|403 forbidden|access denied|you (?:have been|were) blocked|verify (?:that )?you are human|checking your browser|security challenge|unusual traffic|captcha/i.test(sample);
}

function tabsQuery(queryInfo) {
  return new Promise((resolve) => chrome.tabs.query(queryInfo, resolve));
}

function tabsCreate(createProperties) {
  return new Promise((resolve, reject) => {
    chrome.tabs.create(createProperties, (tab) => {
      const error = chrome.runtime.lastError;
      if (error || !tab?.id) reject(new Error(error?.message || "Could not open marketplace tab."));
      else resolve(tab);
    });
  });
}

function tabsGet(tabId) {
  return new Promise((resolve, reject) => {
    chrome.tabs.get(tabId, (tab) => {
      const error = chrome.runtime.lastError;
      if (error || !tab) reject(new Error(error?.message || "Marketplace tab is no longer available."));
      else resolve(tab);
    });
  });
}

function tabsUpdate(tabId, updateProperties) {
  return new Promise((resolve) => chrome.tabs.update(tabId, updateProperties, resolve));
}

function tabsRemove(tabId) {
  return new Promise((resolve) => chrome.tabs.remove(tabId, () => resolve()));
}

function sendTabMessage(tabId, message) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const error = chrome.runtime.lastError;
      if (error) reject(new Error(error.message));
      else resolve(response);
    });
  });
}

async function waitForTabComplete(tabId, timeoutMs = 22_000) {
  const current = await tabsGet(tabId);
  if (current.status === "complete") return current;
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Marketplace tab did not finish loading."));
    }, timeoutMs);
    const listener = (updatedId, changeInfo, tab) => {
      if (updatedId !== tabId || changeInfo.status !== "complete") return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(tab);
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

async function sessionFetch(url) {
  try {
    const response = await fetch(url.toString(), {
      method: "GET",
      credentials: "include",
      redirect: "follow",
      cache: "no-store",
      headers: {
        Accept: "application/json,text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.7"
      }
    });
    const body = (await response.text()).slice(0, MAX_BODY_CHARS);
    return {
      ok: response.ok && !challengeDetected(response.status, body),
      status: response.status,
      url: response.url || url.toString(),
      contentType: response.headers.get("content-type") || "",
      body,
      challenge: challengeDetected(response.status, body),
      transport: "session-fetch"
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      url: url.toString(),
      contentType: "",
      body: "",
      error: error instanceof Error ? error.message : "Browser-session fetch failed.",
      transport: "session-fetch"
    };
  }
}

async function findReusableTab(url) {
  const tabs = await tabsQuery({});
  return tabs.find((tab) => {
    try {
      const current = new URL(tab.url || "");
      return current.toString() === url.toString() && tab.id;
    } catch {
      return false;
    }
  });
}

async function captureThroughTab(url) {
  let tab = await findReusableTab(url);
  let created = false;
  if (!tab?.id) {
    tab = await tabsCreate({ url: url.toString(), active: false });
    created = true;
  } else if (tab.url !== url.toString()) {
    tab = await tabsUpdate(tab.id, { url: url.toString(), active: false });
  }

  const tabId = tab.id;
  try {
    await waitForTabComplete(tabId);
    let captured;
    let lastError;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        captured = await sendTabMessage(tabId, { type: "RML_CAPTURE_PAGE", url: url.toString() });
        if (captured) break;
      } catch (error) {
        lastError = error;
        await new Promise((resolve) => setTimeout(resolve, 450));
      }
    }
    if (!captured) throw lastError || new Error("Marketplace capture script did not respond.");

    if (captured.requiresUserAction) {
      await tabsUpdate(tabId, { active: true });
      return { ...captured, tabId, createdTab: created };
    }
    if (created) await tabsRemove(tabId);
    return { ...captured, tabId, createdTab: created };
  } catch (error) {
    if (created) await tabsRemove(tabId);
    throw error;
  }
}

async function fetchWithRecovery(url) {
  const direct = await sessionFetch(url);
  if (direct.ok && direct.body.trim()) return direct;
  try {
    const captured = await captureThroughTab(url);
    if (captured.body?.trim()) return captured;
    return {
      ...direct,
      error: captured.error || direct.error || `Marketplace returned HTTP ${direct.status || 0}.`
    };
  } catch (error) {
    return {
      ...direct,
      error: [direct.error, error instanceof Error ? error.message : "Browser-tab capture failed."]
        .filter(Boolean).join("; ") || `Marketplace returned HTTP ${direct.status || 0}.`
    };
  }
}

function runSerialized(hostname, work) {
  const previous = hostQueues.get(hostname) || Promise.resolve();
  const current = previous.catch(() => undefined).then(work);
  const tracked = current.finally(() => {
    if (hostQueues.get(hostname) === tracked) hostQueues.delete(hostname);
  });
  hostQueues.set(hostname, tracked);
  return tracked;
}

if (!globalThis[INSTALL_KEY]) {
  globalThis[INSTALL_KEY] = true;
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.type !== "RML_FETCH") return false;
    if (!senderAllowed(sender)) {
      sendResponse({ ok: false, status: 0, error: "Browser Bridge rejected an untrusted sender." });
      return false;
    }

    let url;
    try {
      url = safeUrl(message.url);
    } catch (error) {
      sendResponse({ ok: false, status: 0, error: error instanceof Error ? error.message : "Marketplace URL rejected." });
      return false;
    }

    runSerialized(url.hostname, () => fetchWithRecovery(url))
      .then(sendResponse)
      .catch((error) => sendResponse({
        ok: false,
        status: 0,
        url: url.toString(),
        error: error instanceof Error ? error.message : "Browser Bridge request failed."
      }));
    return true;
  });
}
