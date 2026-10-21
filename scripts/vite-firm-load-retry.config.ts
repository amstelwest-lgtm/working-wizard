/**
 * Vite config for a hung firm list on a later client file.
 * Auth and Supabase are stubbed. The real profile and the real gate run.
 * The @ alias stays last.
 */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: "@/hooks/use-auth", replacement: resolve(__dirname, "firm-load-retry-auth.ts") },
      {
        find: "@/integrations/supabase/client",
        replacement: resolve(__dirname, "firm-load-retry-supabase.ts"),
      },
      { find: "@", replacement: resolve(__dirname, "../src") },
    ],
  },
});
