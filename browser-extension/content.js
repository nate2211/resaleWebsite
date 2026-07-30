const SOURCE = "resalemasterlab-browser-bridge";
const VERSION = "2.0.0";
const INSTALL_KEY = "__RML_BROWSER_BRIDGE_CONTENT_INSTALLED__";

function announceReady() {
  document.documentElement.dataset.rmlBridge = "ready";
  document.documentElement.dataset.rmlBridgeVersion = VERSION;
  window.postMessage({
    type: "RML_BRIDGE_READY",
    source: SOURCE,
    version: VERSION,
    capabilities: ["session-fetch", "tab-capture", "challenge-recovery"]
  }, "*");
}

if (!window[INSTALL_KEY]) {
  Object.defineProperty(window, INSTALL_KEY, { value: true, configurable: false });
  announceReady();

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.type !== "RML_FETCH_REQUEST" || typeof data.id !== "string") return;
    const url = data.request && data.request.url;
    if (typeof url !== "string") return;

    chrome.runtime.sendMessage({ type: "RML_FETCH", url }, (response) => {
      const lastError = chrome.runtime.lastError;
      window.postMessage({
        type: "RML_FETCH_RESPONSE",
        id: data.id,
        source: SOURCE,
        version: VERSION,
        response: lastError
          ? { ok: false, status: 0, error: lastError.message }
          : response
      }, "*");
    });
  });
} else {
  announceReady();
}
