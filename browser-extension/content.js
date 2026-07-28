const SOURCE = "resalemasterlab-browser-bridge";
const INSTALL_KEY = "__RML_BROWSER_BRIDGE_CONTENT_INSTALLED__";

if (!window[INSTALL_KEY]) {
  Object.defineProperty(window, INSTALL_KEY, { value: true, configurable: false });
  document.documentElement.dataset.rmlBridge = "ready";
  window.postMessage({ type: "RML_BRIDGE_READY", source: SOURCE }, "*");

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
        response: lastError
          ? { ok: false, status: 0, error: lastError.message }
          : response
      }, "*");
    });
  });
} else {
  document.documentElement.dataset.rmlBridge = "ready";
  window.postMessage({ type: "RML_BRIDGE_READY", source: SOURCE }, "*");
}
