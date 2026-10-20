/**
 * The production client chunk must initialize the issued-report count before
 * the Home needs memo, and /clients/:id must render without a temporal-dead-zone
 * crash. Expects `vite build` output in dist/ and a preview already serving it.
 *
 *   CLIENT_ROUTE_PREVIEW=http://127.0.0.1:4180 node scripts/client-route-build-render.mjs
 *
 * Without CLIENT_ROUTE_PREVIEW, only the built chunk is checked.
 */
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const dir = resolve("dist/client/assets");
const chunk = readdirSync(dir).find((name) => name.startsWith("clients._clientId-") && name.endsWith(".js"));
if (!chunk) {
  console.error("production client chunk is missing from dist/client/assets");
  process.exit(1);
}
const code = readFileSync(resolve(dir, chunk), "utf8");
const declared = code.indexOf("reports_issued_count");
// A zero report count omits the Home reports line, so that old sentence is
// gone from this chunk. "No draft waiting." is still inside the same memo.
const used = code.indexOf("No draft waiting.");
if (declared === -1 || used === -1 || declared > used) {
  console.error(
    `${chunk} reads the issued-report count before initializing it. /clients/:id crashes with ReferenceError: Cannot access '…' before initialization.`,
  );
  process.exit(1);
}
console.log(`${chunk}: issued-report count is initialized before the Home needs memo`);

const preview = process.env.CLIENT_ROUTE_PREVIEW;
if (!preview) {
  console.log("client-route-build-render: chunk ok (set CLIENT_ROUTE_PREVIEW to render /clients/:id)");
  process.exit(0);
}

const { chromium } = await import("playwright");
let browser;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });
} catch {
  browser = await chromium.launch({ headless: true });
}
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (err) => errors.push(err.message));
await page.route("**/_authenticated.gate-*.js", async (route) => {
  const res = await route.fetch();
  let body = await res.text();
  const next = body.replace(
    /function _\(\)\{[\s\S]*\}export\{_ as AuthGate\};/,
    "function _(){return i.jsx(T,{})}export{_ as AuthGate};",
  );
  if (next === body) {
    errors.push("could not open the client page past the auth gate");
  }
  await route.fulfill({ status: 200, contentType: "text/javascript", body: next });
});
await page.goto(`${preview.replace(/\/$/, "")}/clients/00000000-0000-0000-0000-000000000001`, {
  waitUntil: "domcontentloaded",
  timeout: 30000,
});
await page.waitForTimeout(1000);
const text = await page.locator("body").innerText();
await browser.close();

const tdz = errors.find((msg) => /before initialization/i.test(msg));
if (tdz) {
  console.error(tdz);
  process.exit(1);
}
if (/This page didn't load/.test(text)) {
  console.error("production /clients/:id hit the error screen");
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("client-route-build-render: /clients/:id rendered");
