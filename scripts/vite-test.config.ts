/**
 * Minimal Vite config used exclusively by the report smoke-test runner.
 * Only sets up the @/ path alias — no SSR, no Cloudflare, no TanStack plugins.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "../src"),
    },
  },
});
