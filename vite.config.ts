// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { mkdirSync, writeFileSync } from "node:fs";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";
import { currentBuildId, versionJson } from "./src/lib/build-version";

const buildId = currentBuildId();

/** Writes /version.json so an open tab can tell a deploy has shipped. */
function emitVersionJson() {
  const body = versionJson(buildId);
  const writePublic = () => {
    mkdirSync("public", { recursive: true });
    writeFileSync("public/version.json", body);
  };
  return {
    name: "milon-version-json",
    buildStart: writePublic,
    configureServer: writePublic,
    closeBundle() {
      mkdirSync("dist/client", { recursive: true });
      writeFileSync("dist/client/version.json", body);
    },
  };
}

// DEPLOY_TARGET=vercel disables the Cloudflare Worker plugin so the build produces a
// portable Node server output (dist/server/index.js) that we wrap for Vercel's Build
// Output API. Unset/default keeps the Cloudflare Worker build used by `pnpm run deploy`.
const isVercel = process.env.DEPLOY_TARGET === "vercel";

// Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
// @cloudflare/vite-plugin builds from this — wrangler.jsonc main alone is insufficient.
export default defineConfig({
  plugins: [emitVersionJson()],
  cloudflare: isVercel ? false : undefined,
  tanstackStart: {
    server: { entry: "server" },
  },
  vite: {
    server: {
      port: 5000,
      host: "0.0.0.0",
      allowedHosts: true,
    },
    build: {
      rollupOptions: {
        // ask-ai.js is a public-directory vanilla-JS widget loaded at runtime.
        // Declaring it external prevents Rollup from trying to bundle it during build.
        external: ["/ask-ai.js"],
      },
    },
    // Override stale .env VITE_* values with the live process.env at dev/build time.
    // process.env is populated by Replit's env system with the correct project values.
    define: {
      "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
        process.env.SUPABASE_URL ?? ""
      ),
      "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
        process.env.SUPABASE_PUBLISHABLE_KEY ?? ""
      ),
      "import.meta.env.VITE_SUPABASE_PROJECT_ID": JSON.stringify(
        process.env.VITE_SUPABASE_PROJECT_ID ?? ""
      ),
      "import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY": JSON.stringify(
        process.env.STRIPE_PUBLISHABLE_KEY ??
          process.env.VITE_STRIPE_PUBLISHABLE_KEY ??
          ""
      ),
      "import.meta.env.VITE_BUILD_ID": JSON.stringify(buildId),
    },
  },
});
