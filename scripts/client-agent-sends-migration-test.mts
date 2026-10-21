/**
 * Static checks for the send-an-agent migration. No database.
 * Run: pnpm test:client-agent-sends
 */
import { readFileSync } from "node:fs";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const migration = readFileSync(
  "supabase/migrations/20261021210000_client_agent_sends.sql",
  "utf8",
);
const tests = readFileSync("scripts/client-agent-sends-sql-tests.sql", "utf8");
const code = migration
  .split("\n")
  .map((line) => line.replace(/--.*$/, ""))
  .join("\n");
const folded = code.replace(/\s+/g, " ").toLowerCase();

assert(!/security\s+definer/i.test(code), "no security definer function");
assert(!/grant\b[^;]*\bto\s+(anon|public)\b/i.test(folded), "no grant to anon or public");
assert(!/\bdrop\s+table\b/i.test(folded), "no dropped table");
assert(
  !/create\s+or\s+replace\s+function\s+public\.is_firm_member/i.test(folded),
  "does not replace is_firm_member",
);

for (const match of folded.matchAll(/alter\s+table\s+(?:only\s+)?([a-z0-9_.]+)/g)) {
  const name = match[1].split(".").pop();
  assert(
    name === "client_agent_sends" ||
      name === "client_agent_send_items" ||
      name === "client_agent_send_attempts",
    `alters only the new tables, saw ${name}`,
  );
}

for (const needle of [
  "create table if not exists public.client_agent_sends",
  "create table if not exists public.client_agent_send_items",
  "create table if not exists public.client_agent_send_attempts",
  "token_hash text not null",
  "revoked_at timestamptz",
  "interval '14 days'",
  "consent_at timestamptz",
  "consent_notice_version text",
  "totals_only boolean not null default false",
  "medical_aid_certificate",
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "20971520",
  "bank_statements",
  "travel_logbook",
  "client_agent_sends.firm_id",
  "client_agent_send_item_touch",
  "item_key <> 'other'",
  "consent_required",
  "firm_client_mismatch",
  "revoke all on table public.client_agent_sends from public, anon, authenticated",
  "revoke all on table public.client_agent_send_attempts from public, anon, authenticated",
  "grant select on table public.client_agent_sends to authenticated",
  "grant all on table public.client_agent_sends to service_role",
  "for select",
  "to authenticated",
]) {
  assert(folded.includes(needle) || code.toLowerCase().includes(needle), `missing ${needle}`);
}

assert(!/\btoken\s+text\b/i.test(code), "no raw token column");
assert(!/prospect_talk/i.test(migration), "does not touch prospect talk");
assert(!/resend|send_email|whatsapp/i.test(migration), "no mail and no whatsapp");
assert(tests.includes("firm member should read the send"), "sql test covers firm read");
assert(tests.includes("anon must have no table privileges"), "sql test covers anon");
assert(tests.includes("a file before consent must be refused"), "sql test covers consent");
assert(tests.includes("default expiry must be 14 days"), "sql test covers expiry");
assert(tests.includes("medical item must be totals only"), "sql test covers medical totals");
assert(
  tests.includes("a member of a different firm must not read the send"),
  "sql test covers a moved client",
);
assert(tests.includes("other without label or explanation must be refused"), "sql test covers other");
assert(tests.includes("touch trigger must refresh updated_at"), "sql test covers updated_at");

console.log("client_agent_sends migration test ok");
