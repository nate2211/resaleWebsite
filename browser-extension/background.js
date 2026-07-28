const MAX_BODY_CHARS = 3_000_000;
const ALLOWED_PROTOCOLS = new Set(["https:", "http:"]);
const INSTALL_KEY = "__RML_BROWSER_BRIDGE_BACKGROUND_INSTALLED__";

function safeUrl(value) {
  const url = new URL(String(value || ""));
  if (!ALLOWED_PROTOCOLS.has(url.protocol)) throw new Error("Unsupported URL protocol.");
  if (url.username || url.password) throw new Error("Credential-bearing URLs are not allowed.");
  return url;
}

if (!globalThis[INSTALL_KEY]) {
  globalThis[INSTALL_KEY] = true;
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || message.type !== "RML_FETCH") return false;

    (async () => {
      try {
        const url = safeUrl(message.url);
        const response = await fetch(url.toString(), {
          method: "GET",
          credentials: "omit",
          redirect: "follow",
          cache: "no-store",
          headers: {
            Accept: "application/json,text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.7"
          }
        });
        const body = (await response.text()).slice(0, MAX_BODY_CHARS);
        sendResponse({
          ok: response.ok,
          status: response.status,
          url: response.url || url.toString(),
          contentType: response.headers.get("content-type") || "",
          body
        });
      } catch (error) {
        sendResponse({
          ok: false,
          status: 0,
          error: error instanceof Error ? error.message : "Browser bridge request failed."
        });
      }
    })();

    return true;
  });
}
