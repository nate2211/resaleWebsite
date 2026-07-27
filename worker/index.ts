/** Cloudflare Worker entry point that delegates all requests to Vinext. */
import handler from "vinext/server/fetch-handler";

export default {
  fetch(
    ...args: Parameters<typeof handler.fetch>
  ): ReturnType<typeof handler.fetch> {
    return handler.fetch(...args);
  },
};
