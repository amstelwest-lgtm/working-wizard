/**
 * Vite config for the billing-gate deadline test.
 * Stubs the gate's auth, profile, stay check, and client count so the
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
      { find: "@/hooks/use-auth", replacement: resolve(__dirname, "billing-deadline-auth.ts") },
      {
        find: "@/contexts/accountant-profile",
        replacement: resolve(__dirname, "billing-deadline-profile.ts"),
      },
      { find: "@/lib/user-roles", replacement: resolve(__dirname, "billing-deadline-user-roles.ts") },
      {
        find: "@/lib/firm-client-gate",
        replacement: resolve(__dirname, "billing-deadline-client-gate.ts"),
      },
      { find: "@", replacement: resolve(__dirname, "../src") },
    ],
  },
});
