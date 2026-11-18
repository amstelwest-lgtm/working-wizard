/**
 * The shell's first paint CSS is inlined, and the app sheet starts non-blocking.
 * Run: node scripts/shell-critical-css.mjs
 * After a production build: node scripts/shell-critical-css.mjs --dist
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

function fail(message) {
  console.error(message);
  process.exit(1);
}

const root = readFileSync("src/routes/__root.tsx", "utf8");
const css = readFileSync("src/lib/shell-critical-css.ts", "utf8");
if (!css.includes("[data-shell-paint]") || !css.includes("[data-client-boot]")) {
  fail("critical shell CSS does not cover the skeleton and the standby");
}
if (!root.includes("SHELL_CRITICAL_CSS")) fail("critical shell CSS is not inlined in the document");
if (!root.includes('link.media="print"')) fail("the app sheet is not started with media=print");
if (root.includes('rel: "stylesheet" as const, href: appCss') || root.includes('href: "/ask-ai.css"')) {
  fail("the app sheet is still a blocking head link");
}

function walk(dir, hit) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) {
      walk(path, hit);
      continue;
    }
    if (!/\.(js|html|css|mjs)$/.test(name)) continue;
    if (info.size > 5_000_000) continue;
    const text = readFileSync(path, "utf8");
    if (text.includes("data-shell-paint")) hit.css = true;
    if (text.includes('link.media="print"') || text.includes("media=\"print\"")) hit.print = true;
    if (hit.css && hit.print) return;
  }
}

if (process.argv.includes("--dist")) {
  const hit = { css: false, print: false };
  walk("dist", hit);
  if (!hit.css) fail("built output does not inline the shell CSS marker");
  if (!hit.print) fail("built output does not start the sheet as non-blocking");
  console.log("shell-critical-css dist ok");
} else {
  console.log("shell-critical-css ok");
}
