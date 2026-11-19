/**
 * Keychain fail-closed checks for the desktop agent.
 * Run: pnpm test:desktop-sync-keychain
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseLocalStateJson } from "../desktop-sync/src/keychain.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const keychainSrc = readFileSync(resolve("desktop-sync/src/keychain.ts"), "utf8");
assert(keychainSrc.includes("KEYCHAIN_REQUIRED_MESSAGE"), "keychain required message");
assert(keychainSrc.includes("assertKeychainAvailable"), "assert helper");
assert(!keychainSrc.includes("fallbackFile"), "no legacy fallback filename");
assert(keychainSrc.includes("parseLocalStateJson"), "local parser exported");

const localOnly = JSON.stringify({
  apiBase: "https://example.com",
  folderMaps: [{ folderLabel: "VAT", watchPath: "/tmp/vat" }],
  seenHashes: { "a|b": "2026-01-01" },
});
const parsed = parseLocalStateJson(localOnly);
assert(parsed?.apiBase === "https://example.com", "parses non-secret state");

const legacy = JSON.stringify({
  apiBase: "https://example.com",
  accessToken: "secret",
  refreshToken: "secret",
  folderMaps: [],
  seenHashes: {},
});
assert(parseLocalStateJson(legacy) === null, "rejects legacy token-in-file state");

console.log("desktop-sync keychain checks ok");