/**
 * Standalone Vite app for the rail screenshots. Not part of the production build.
 */
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      {
        find: "@/integrations/supabase/client",
        replacement: resolve(root, "supabase-stub.ts"),
      },
      { find: "@tanstack/react-start/server", replacement: resolve(root, "start-stub.ts") },
      { find: "@tanstack/react-start", replacement: resolve(root, "start-stub.ts") },
      { find: "@", replacement: resolve(root, "../../src") },
      { find: "node:crypto", replacement: resolve(root, "crypto-stub.ts") },
    ],
  },
  server: {
    host: "127.0.0.1",
    port: 4179,
    strictPort: true,
  },
});
