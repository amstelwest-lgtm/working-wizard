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

export default defineConfig({
  plugins: [react()],
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
