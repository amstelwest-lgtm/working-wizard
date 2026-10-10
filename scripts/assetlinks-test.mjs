/**
 * Android Digital Asset Links file served at /.well-known/assetlinks.json.
 * Run: pnpm test:assetlinks
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const FINGERPRINT =
  "53:72:E4:DA:D7:C3:B3:04:82:C1:93:2B:AE:AA:2A:B0:BC:56:46:4E:6D:6E:C4:84:86:49:F0:13:62:61:53:9E";
const PACKAGE_NAME = "com.milonfinance.app";
const RELATION = "delegate_permission/common.handle_all_urls";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const filePath = resolve("public/.well-known/assetlinks.json");
const raw = readFileSync(filePath, "utf8");
assert(!raw.includes("REPLACE_WITH"), "assetlinks.json must not contain a placeholder fingerprint");

const statements = JSON.parse(raw);
assert(Array.isArray(statements), "assetlinks.json is a statement list");
assert(statements.length === 1, "one statement");

const statement = statements[0];
assert(
  Array.isArray(statement.relation) && statement.relation.length === 1 && statement.relation[0] === RELATION,
  "relation is delegate_permission/common.handle_all_urls",
);
assert(statement.target?.namespace === "android_app", "target namespace is android_app");
assert(statement.target?.package_name === PACKAGE_NAME, `package_name is ${PACKAGE_NAME}`);

const fingerprints = statement.target?.sha256_cert_fingerprints;
assert(Array.isArray(fingerprints) && fingerprints.length === 1, "one fingerprint");
assert(fingerprints[0] === FINGERPRINT, "fingerprint is the upload key");

const vercel = JSON.parse(readFileSync(resolve("vercel.json"), "utf8"));
const rule = (vercel.headers ?? []).find((entry) => entry.source === "/.well-known/assetlinks.json");
assert(rule, "vercel.json has a header rule for /.well-known/assetlinks.json");
const contentType = (rule.headers ?? []).find(
  (header) => header.key.toLowerCase() === "content-type" && header.value === "application/json",
);
assert(contentType, "that rule sets Content-Type: application/json");

console.log("assetlinks ok");
