import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";

/**
 * ResaleMasterLab uses two deliberate Vite paths:
 *
 * - `npm run dev:windows`: Cloudflare-enabled development with CSS HMR and
 *   the remote Browser Run binding used by zero-card marketplace fallbacks.
 * - `npm run dev:local:windows`: frontend/API development without Cloudflare.
 * - `vinext build`: the production App Router RSC/SSR Worker build.
 *
 * The production plugin reads wrangler.vinext-build.toml. The user-facing
 * wrangler.toml remains the requested assets-only SPA configuration for the
 * explicit frontend-only deployment command.
 */
export default defineConfig(({ command, mode }) => {
  const productionBuild = command === "build";
  const cloudflareDevelopment = command === "serve" && mode === "cloudflare";
  const enableCloudflare = productionBuild || cloudflareDevelopment;

  return {
    publicDir: "public",
    server: {
      host: "0.0.0.0",
      allowedHosts: ["localhost", "127.0.0.1", "terminal.local"],
    },
    css: {
      devSourcemap: true,
    },
    build: {
      cssCodeSplit: false,
      assetsDir: "assets",
      sourcemap: true,
    },
    plugins: [
      vinext(),
      ...(enableCloudflare
        ? [
            cloudflare({
              configPath: "./wrangler.vinext-build.toml",
              viteEnvironment: {
                name: "rsc",
                childEnvironments: ["ssr"],
              },
              inspectorPort: false,
            }),
          ]
        : []),
    ],
  };
});
