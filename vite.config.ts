import { cloudflare } from "@cloudflare/vite-plugin";
import vinext from "vinext";
import { defineConfig } from "vite";

/**
 * ResaleMasterLab uses two deliberate Vite paths:
 *
 * - `npm run dev:windows`: Vinext App Router development with CSS HMR and
 *   Cloudflare bindings, including the remote Browser Run fallback.
 * - `vinext build`: the production App Router RSC/SSR Worker build.
 *
 * The production plugin and deployment command both read wrangler.jsonc so the
 * App Router Worker, API routes, custom domain, and Browser Run binding cannot
 * drift apart. The optional assets-only deployment uses wrangler.static.toml.
 */
export default defineConfig(({ command }) => {
  // Vinext's App Router must own the Vite development server. Keep the
  // Cloudflare plugin enabled for both `vinext dev` and `vinext build` so the
  // RSC/SSR router and bindings share the same runtime. Running raw `vite` here
  // serves no Vinext route manifest and results in GET / 404.
  const enableCloudflare = command === "serve" || command === "build";

  return {
    publicDir: "public",
    server: {
      host: "0.0.0.0",
      allowedHosts: ["localhost", "127.0.0.1", "terminal.local"],
    },
    css: {
      devSourcemap: true,
    },
    ssr: {
      // Keep the Workers native module external in the server graph as well.
      external: ["cloudflare:workers"],
    },
    build: {
      cssCodeSplit: false,
      assetsDir: "assets",
      sourcemap: true,
      // `cloudflare:workers` is a workerd-provided runtime module. Vinext's
      // first client-reference analysis pass still walks route-handler imports,
      // so Rolldown must leave this specifier external instead of trying to
      // resolve it from node_modules. The final Worker resolves it natively.
      rolldownOptions: {
        external: ["cloudflare:workers"],
      },
    },
    plugins: [
      vinext(),
      ...(enableCloudflare
        ? [
            cloudflare({
              configPath: "./wrangler.jsonc",
              viteEnvironment: {
                name: "rsc",
                childEnvironments: ["ssr"],
              },
              inspectorPort: false,
              remoteBindings: true,
            }),
          ]
        : []),
    ],
  };
});
