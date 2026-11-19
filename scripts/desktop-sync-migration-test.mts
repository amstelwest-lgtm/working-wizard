/**
 * Static checks for desktop_sync migration. No database.
 * Run: pnpm test:desktop-sync-migration
 */
import { readFileSync } from "node:fs";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const migration = readFileSync("supabase/migrations/20261119120000_desktop_sync.sql", "utf8");
const code = migration
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");
const folded = code.replace(/\s+/g, " ").toLowerCase();

assert(folded.includes("security invoker"), "register RPC uses security invoker");
assert(!/security\s+definer/i.test(code), "no security definer");
assert(!/\bdrop\s+table\b/i.test(folded), "no dropped table");
assert(!/\balter\s+table\s+public\.source_documents/i.test(folded), "does not alter source_documents");
assert(!folded.includes("desktop_sync_daily_usage"), "no daily_usage table");
assert(folded.includes("usage_date date"), "usage on devices");
assert(folded.includes("usage_count integer"), "usage_count on devices");
assert(folded.includes("create table if not exists public.desktop_sync_pairing_codes"), "pairing codes");
assert(!folded.includes("desktop_sync_devices_select"), "no authenticated devices policy");
assert(!folded.includes("grant select on table public.desktop_sync_devices"), "no select grant on devices");
assert(
  folded.includes("revoke all on table public.desktop_sync_devices from public, anon, authenticated"),
  "devices deny authenticated",
);
assert(folded.includes("token_hash text not null"), "token hash only");
assert(!/\btoken\s+text\b/i.test(code), "no raw token column");
assert(!folded.includes("text/csv"), "no csv mime in migration");
assert(!folded.includes("spreadsheetml"), "no xlsx mime in migration");
assert(folded.includes("image/webp"), "webp mime allowed");
assert(folded.includes("desktop_sync_folder_map_guard"), "folder map firm guard");
assert(
  folded.includes("revoke all on table public.desktop_sync_pairing_codes from public, anon, authenticated"),
  "pairing codes deny authenticated",
);
assert(folded.includes("upload_skipped"), "upload_skipped activity kind");

console.log("desktop_sync migration static checks ok");