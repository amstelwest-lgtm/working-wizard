/**
 * Desktop folder-sync unit checks. No database.
 * Run: pnpm test:desktop-sync
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  DESKTOP_SYNC_CONSENT_VERSION,
  desktopSyncFileRejected,
  extensionAllowed,
  folderLabelValid,
  mimeAllowed,
  deviceTokenCanRead,
  hashDeviceToken,
} from "../src/lib/desktop-sync.ts";
import { desktopSyncFirmAllowed, DESKTOP_SYNC_FIRM_ALLOWLIST } from "../src/lib/desktop-sync-allowlist.ts";
import { desktopSyncDeviceScopes } from "../src/lib/desktop-sync-device.functions.ts";
import { desktopSyncSqlReady } from "../src/lib/desktop-sync-ready.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(DESKTOP_SYNC_FIRM_ALLOWLIST.length === 1, "single QA firm");
assert(desktopSyncFirmAllowed("e8f7a440-a541-422c-8e4f-82ba33dd0604"), "ben firm allowed");
assert(!desktopSyncFirmAllowed("00000000-0000-0000-0000-000000000001"), "random firm blocked");

assert(!desktopSyncFirmAllowed("00000000-0000-0000-0000-000000000099"), "unknown firm blocked");

assert(DESKTOP_SYNC_CONSENT_VERSION.startsWith("popia-"), "consent version");
assert(folderLabelValid("VAT 2026"), "folder label ok");
assert(!folderLabelValid("../escape"), "folder label rejects path");
assert(extensionAllowed("invoice.PDF"), "pdf ok");
assert(!extensionAllowed("script.exe"), "exe blocked");
assert(desktopSyncFileRejected(".env", 10) === "hidden", "hidden env");
assert(desktopSyncFileRejected("/home/user/id_rsa", 10) === "secret", "secret blocked");
assert(mimeAllowed("application/pdf"), "mime pdf");
assert(!deviceTokenCanRead(), "token cannot read");
assert(!desktopSyncDeviceScopes.canListClients, "no client list");
assert(!desktopSyncDeviceScopes.canCallAgents, "no agents");
assert(!desktopSyncSqlReady(), "sql ready off by default");

const functions = readFileSync(resolve("src/lib/desktop-sync.functions.ts"), "utf8");
const device = readFileSync(resolve("src/lib/desktop-sync-device.functions.ts"), "utf8");
const pairApi = readFileSync(resolve("src/routes/api/desktop-sync/pair.ts"), "utf8");

assert(functions.includes("desktopSyncSqlReady"), "server gated on sql ready");
assert(pairApi.includes("desktopSyncSqlReady"), "pair api gated");
assert(device.includes("usage_date"), "daily caps on devices");
assert(!device.includes("desktop_sync_daily_usage"), "no daily_usage table in code");
assert(functions.includes("if (!(await firmEnabled"), "pairing blocked when firm off");
assert(functions.includes("desktopSyncFirmAllowed"), "allowlist on server");
assert(device.includes('reason: "off"'), "off flag blocks upload");
assert(device.includes('reason: "revoked"'), "revoke blocks upload");
assert(device.includes('reason: "folder"'), "unmapped folder rejected");
assert(!device.includes("writeFile"), "agent server must not write local files");

const agentFilter = readFileSync(resolve("desktop-sync/src/filter.ts"), "utf8");
for (const api of ["writeFile", "unlink", "rename"] as const) {
  assert(!agentFilter.includes(`${api}(`), `agent filter module avoids ${api}`);
}

const hash = await hashDeviceToken("sample-token");
assert(hash.length === 64, "token hashed");

console.log("desktop-sync checks ok");