/**
 * Vite config for the boot-timing line.
 * Stubs auth, the firm row, and the stay check so the real AuthGate can
 * release the skeleton. The @ alias stays last.
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
      { find: "@/hooks/use-auth", replacement: resolve(__dirname, "boot-timing-auth.ts") },
      {
        find: "@/contexts/accountant-profile",
        replacement: resolve(__dirname, "boot-timing-profile.ts"),
      },
      { find: "@/lib/user-roles", replacement: resolve(__dirname, "boot-timing-roles.ts") },
      { find: "@", replacement: resolve(__dirname, "../src") },
    ],
  },
});
