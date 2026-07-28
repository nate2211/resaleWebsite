import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";

/**
 * Cloudflare serves the application and lightweight same-origin features only.
 * Marketplace and public-web listing requests execute in the user's browser;
 * no Browser Run binding or marketplace scraper is bundled into the Worker.
 */
export default defineConfig(({ command }) => ({
  publicDir: "public",
  server: {
    host: "0.0.0.0",
    allowedHosts: ["localhost", "127.0.0.1", "terminal.local"],
  },
  css: { devSourcemap: true },
  build: {
    cssCodeSplit: false,
    assetsDir: "assets",
    sourcemap: true,
  },
  plugins: [
    vinext(),
    ...(command === "serve" || command === "build"
      ? [cloudflare({
          configPath: "./wrangler.jsonc",
          viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
          inspectorPort: false,
          remoteBindings: false,
        })]
      : []),
  ],
}));
