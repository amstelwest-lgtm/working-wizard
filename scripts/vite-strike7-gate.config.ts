/**
 * Vite config for the strike-7 gate race.
 * Stubs auth, the firm row, the stay check, and the client count so the
 * real AuthGate can run under fake timers. The @ alias stays last.
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
      { find: "@/hooks/use-auth", replacement: resolve(__dirname, "strike7-gate-auth.ts") },
      {
        find: "@/contexts/accountant-profile",
        replacement: resolve(__dirname, "strike7-gate-profile.ts"),
      },
      { find: "@/lib/user-roles", replacement: resolve(__dirname, "strike7-gate-roles.ts") },
      { find: "@/lib/firm-client-gate", replacement: resolve(__dirname, "strike7-gate-clients.ts") },
      { find: "@", replacement: resolve(__dirname, "../src") },
    ],
  },
});
