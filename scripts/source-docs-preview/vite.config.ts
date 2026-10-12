/**
 * Local preview for document screenshots. Not part of the production build.
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
    alias: [{ find: "@", replacement: resolve(root, "../../src") }],
  },
  server: {
    host: "127.0.0.1",
    port: 4187,
    strictPort: true,
    fs: { allow: [resolve(root, "../..")] },
  },
});
