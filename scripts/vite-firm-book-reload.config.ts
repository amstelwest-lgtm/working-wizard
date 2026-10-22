/**
 * Vite config for the practice-board firm reload deadline.
 * Auth, the firm row, roles, Supabase, and error reporting are stubbed.
 * The real PracticeBoard runs. The @ alias stays last.
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
      { find: "@/hooks/use-auth", replacement: resolve(__dirname, "firm-book-reload-auth.ts") },
      {
        find: "@/contexts/accountant-profile",
        replacement: resolve(__dirname, "firm-book-reload-profile.ts"),
      },
      { find: "@/lib/user-roles", replacement: resolve(__dirname, "firm-book-reload-roles.ts") },
      {
        find: "@/integrations/supabase/client",
        replacement: resolve(__dirname, "firm-book-reload-supabase.ts"),
      },
      { find: "@/lib/monitoring", replacement: resolve(__dirname, "firm-book-reload-monitoring.ts") },
      { find: "@", replacement: resolve(__dirname, "../src") },
    ],
  },
});
