/**
 * Vite config for the page-render smoke test.
 * Swaps the browser Supabase client for an in-memory mock. The shared
 * test config stays untouched so other scripts still use the real client.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

/**
 * /app wraps the board in ClientOnly, which stays on the server snapshot in
 * this runner. Unwrap that one call so Route.options.component mounts the
 * board. Production builds do not use this config.
 */
function mountOwnerBoard() {
  return {
    name: "page-smoke-owner-board",
    enforce: "pre" as const,
    transform(code: string, id: string) {
      if (!id.replaceAll("\\", "/").endsWith("/src/routes/app.tsx")) return null;
      const next = code.replace(
        /<ClientOnly fallback={<AppBootSpinner \/>}>\s*<Index \/>\s*<\/ClientOnly>/,
        "<Index />",
      );
      if (next === code) {
        throw new Error("page-smoke: ClientOnly wrapper around Index was not found");
      }
      return next;
    },
  };
}

export default defineConfig({
  plugins: [mountOwnerBoard(), react()],
  resolve: {
    alias: [
      {
        find: "@/integrations/supabase/client",
        replacement: resolve(__dirname, "page-smoke-supabase.ts"),
      },
      { find: "@", replacement: resolve(__dirname, "../src") },
    ],
  },
});
