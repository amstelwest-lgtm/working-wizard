/**
 * The shell's first paint CSS is inlined, and appCss plus ask-ai.css start
 * non-blocking, with a noscript link and an onload/onerror/timeout flip.
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
if (!root.includes('link.onload=show') || !root.includes('link.onerror=show') || !root.includes("setTimeout(show,3000)")) {
  fail("a hung or failed sheet does not flip back to all");
}
if (!root.includes('arm("/ask-ai.css")') || !root.includes("arm(${JSON.stringify(appCss)})")) {
  fail("appCss and ask-ai.css are not both armed as non-blocking sheets");
}
if (
  !root.includes('href="/ask-ai.css"') ||
  !root.includes("<noscript") ||
  !root.includes('href="${appCss}"')
) {
  fail("noscript is missing a stylesheet link for appCss or ask-ai.css");
}
if (root.includes('rel: "stylesheet" as const, href: appCss') || root.includes('href: "/ask-ai.css"')) {
  fail("the app sheet is still a blocking head link");
}

function walk(dir, texts) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) {
      walk(path, texts);
      continue;
    }
    if (!/\.(js|html|mjs)$/.test(name)) continue;
    if (info.size > 8_000_000) continue;
    const text = readFileSync(path, "utf8");
    if (text.includes("/ask-ai.css") || text.includes("data-shell-paint")) texts.push(text);
  }
}

if (process.argv.includes("--dist")) {
  const texts = [];
  walk("dist", texts);
  const built = texts.join("\n");
  if (!built.includes("data-shell-paint")) fail("built output does not inline the shell CSS marker");
  if (!built.includes('link.media="print"')) fail("built output does not start the sheet as non-blocking");
  if (!built.includes("link.onload=show") || !built.includes("link.onerror=show") || !built.includes("setTimeout(show,3000)")) {
    fail("built output is missing the onload, onerror, or timeout flip");
  }
  if (!built.includes('arm("/ask-ai.css")')) fail("built output does not arm /ask-ai.css");
  const armsApp =
    built.includes("JSON.stringify(appCss)") || /arm\("\/assets\/[^"]+\.css"\)/.test(built);
  if (!armsApp) fail("built output does not arm appCss");
  if (!built.includes("noscript")) fail("built output is missing the noscript fallback");
  if (!built.includes('href="/ask-ai.css"') && !built.includes('href=\\"/ask-ai.css\\"')) {
    fail("built output noscript is missing /ask-ai.css");
  }
  const noscriptApp =
    built.includes('href="${appCss}"') ||
    built.includes("href=\\\"${appCss}\\\"") ||
    /href="\/assets\/[^"]+\.css"/.test(built);
  if (!noscriptApp) fail("built output noscript is missing appCss");
  console.log("shell-critical-css dist ok");
} else {
  console.log("shell-critical-css ok");
}
