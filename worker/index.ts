/** Cloudflare Worker entry point for ResaleMasterLab. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";

interface BrowserRunBinding {
  quickAction(action: "content" | "links", options: Record<string, unknown>): Promise<Response>;
}

interface Env {
  ASSETS: Fetcher;
  BROWSER?: BrowserRunBinding;
  IMAGES?: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // Make the request-scoped Browser Run binding available to Vinext route handlers
    // without importing cloudflare:workers during plain Node/Vite development.
    (globalThis as typeof globalThis & { __RML_BROWSER__?: BrowserRunBinding }).__RML_BROWSER__ = env.BROWSER;
    const url = new URL(request.url);

    if (url.pathname === "/_vinext/image") {
      const images = env.IMAGES;
      if (!images) {
        return new Response("Cloudflare Images is not configured for this deployment.", {
          status: 501,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await images.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
