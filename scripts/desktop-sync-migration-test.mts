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

const withoutRegister = code.replace(
  /create or replace function public\.register_desktop_sync_source_document[\s\S]*?\$\$;/gi,
  "",
);
assert(!/security\s+definer/i.test(withoutRegister), "no security definer beyond register RPC");
assert(!/\bdrop\s+table\b/i.test(folded), "no dropped table");
assert(!/\balter\s+table\s+public\.source_documents/i.test(folded), "does not alter source_documents");
assert(folded.includes("create table if not exists public.desktop_sync_firms"), "firm table");
assert(folded.includes("token_hash text not null"), "token hash only");
assert(folded.includes("consent_notice_version"), "consent version");
assert(folded.includes("revoke all on table public.desktop_sync_devices from public, anon"), "deny anon devices");
assert(!/\btoken\s+text\b/i.test(code), "no raw token column");
console.log("desktop_sync migration static checks ok");