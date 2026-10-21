/**
 * Test config that swaps the Stripe server client for a class-instance mock.
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
      {
        find: "@/lib/stripe.server",
        replacement: resolve(__dirname, "./stripe-server-test-double.ts"),
      },
      { find: "@", replacement: resolve(__dirname, "../src") },
    ],
  },
});
