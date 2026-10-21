/**
 * Universal Links and Digital Asset Links stay in step.
 * Run: node scripts/app-links-test.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const publicLinks = readFileSync(resolve("public/.well-known/assetlinks.json"), "utf8");
const mobileLinks = readFileSync(resolve("mobile/well-known/assetlinks.json"), "utf8");
assert(publicLinks === mobileLinks, "public and mobile assetlinks.json must match");

const vercel = JSON.parse(readFileSync(resolve("vercel.json"), "utf8"));
const aasaRule = (vercel.headers ?? []).find(
  (entry) => entry.source === "/.well-known/apple-app-site-association",
);
assert(aasaRule, "vercel.json sets headers for apple-app-site-association");
const aasaType = (aasaRule.headers ?? []).find(
  (header) => header.key.toLowerCase() === "content-type" && header.value === "application/json",
);
assert(aasaType, "AASA Content-Type is application/json");

const apexRedirect = (vercel.redirects ?? []).find(
  (entry) => entry.destination === "https://www.milonfinance.com/$1",
);
assert(apexRedirect, "apex to www redirect exists");
assert(
  String(apexRedirect.source).includes("well-known"),
  "apex redirect source excludes .well-known so assetlinks and AASA are not redirected",
);

const aasa = JSON.parse(readFileSync(resolve("public/.well-known/apple-app-site-association"), "utf8"));
const detail = aasa.applinks?.details?.[0];
assert(detail, "AASA has one applinks detail");
assert(
  Array.isArray(detail.appIDs) && detail.appIDs[0] === "APPLE_TEAM_ID.com.milonfinance.app",
  "AASA app id uses the APPLE_TEAM_ID placeholder plus the bundle id",
);
assert(
  aasa.webcredentials?.apps?.[0] === "APPLE_TEAM_ID.com.milonfinance.app",
  "AASA webcredentials uses the same placeholder app id",
);
const paths = (detail.components ?? []).map((row) => row["/"]);
for (const path of [
  "/talk/*",
  "/a/*",
  "/auth/*",
  "/billing/*",
  "/api/qbo/callback",
  "/api/xero/callback",
]) {
  assert(paths.includes(path), `AASA claims ${path}`);
}

const java = readFileSync(
  resolve("mobile/android/app/src/main/java/com/milonfinance/app/MilonExternalUrls.java"),
  "utf8",
);
const swift = readFileSync(resolve("mobile/ios/App/App/MilonShellPlugin.swift"), "utf8");
for (const host of [
  "accounts.google.com",
  "checkout.stripe.com",
  "login.xero.com",
  "accounts.intuit.com",
  "auth.milonfinance.com",
  "accounting.sageone.co.za",
]) {
  assert(java.includes(`"${host}"`), `Android host list includes ${host}`);
  assert(swift.includes(`"${host}"`), `iOS host list includes ${host}`);
}

const manifest = readFileSync(resolve("mobile/android/app/src/main/AndroidManifest.xml"), "utf8");
assert(manifest.includes('android:host="www.milonfinance.com"'), "Android claims www");
assert(manifest.includes('android:host="milonfinance.com"'), "Android claims the apex");
assert(manifest.includes('android:autoVerify="true"'), "Android autoVerify is on");

console.log("app links ok");
