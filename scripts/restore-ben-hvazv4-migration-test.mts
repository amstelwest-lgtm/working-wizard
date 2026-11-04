/**
 * Guards the one-shot Ben fixture restore migration.
 * Run: pnpm test:restore-ben-hvazv4
 */
import { readFileSync } from "node:fs";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const path = "supabase/migrations/20261104120000_restore_ben_fixture_mln_hvazv4.sql";
const sql = readFileSync(path, "utf8");

assert(sql.includes("MLN-HVAZV4"), "names the restore client code");
assert(sql.includes("MLN-T8UEXM"), "archives the swap client");
assert(sql.includes("e8f7a440-a541-422c-8e4f-82ba33dd0604"), "targets Ben Accountants");
assert(sql.includes("1a857761-e116-4cb8-9b8e-5777bb4f125a"), "expects throwaway firm");
assert(sql.includes("SET active = false"), "soft-archives instead of deleting");
assert(sql.includes("already active on Ben"), "idempotent no-op path");
assert(sql.includes("Rollback"), "documents rollback");

console.log("restore-ben-hvazv4 migration guards OK");
