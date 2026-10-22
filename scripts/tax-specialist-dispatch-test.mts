/**
 * Tax Specialist dispatch: the flag, one firm, one enqueue.
 * No database and no model call.
 * Run: pnpm test:tax-specialist-dispatch
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  planTaxDispatch,
  TAX_AGENT_KEY,
  TAX_AGENT_QUEUE,
  TAX_DISPATCH_FIRM_ID,
  TAX_SEND_AGENT,
  taxDispatchSkip,
  type TaxDispatchSend,
} from "../src/lib/tax-specialist-dispatch.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

function sqlCode(path: string): string {
  return read(path)
    .split("\n")
    .map((line) => line.split("--")[0])
    .join("\n")
    .toLowerCase();
}

const sendId = "55555555-5555-4555-8555-555555555555";
const clientId = "22222222-2222-4222-8222-222222222222";
const otherFirm = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function send(patch: Partial<TaxDispatchSend> = {}): TaxDispatchSend {
  return {
    id: sendId,
    firmId: TAX_DISPATCH_FIRM_ID,
    clientId,
    agent: TAX_SEND_AGENT,
    completedAt: "2026-10-22T09:00:00.000Z",
    alreadyQueued: false,
    ...patch,
  };
}

const off = planTaxDispatch({ sends: [send()], flagEnabled: false });
assert(off.length === 0, "the flag off means no enqueue");
assert(taxDispatchSkip({ send: send(), flagEnabled: false }) === "flag_off", "the skip reason is the flag");

const once = planTaxDispatch({ sends: [send(), send()], flagEnabled: true });
assert(once.length === 1, "the flagged firm enqueues once");
assert(once[0]?.queue === TAX_AGENT_QUEUE, "the send goes on agent_tax");
assert(once[0]?.payload.agent === TAX_AGENT_KEY, "the queued agent is tax_specialist");
assert(once[0]?.payload.send_id === sendId, "the payload names the send");
assert(once[0]?.payload.firm_id === TAX_DISPATCH_FIRM_ID, "the payload names the firm");
assert(!JSON.stringify(once).includes("password"), "the payload has no password");

const again = planTaxDispatch({
  sends: [send({ alreadyQueued: true })],
  flagEnabled: true,
});
assert(again.length === 0, "a second pass does not enqueue the same send");
assert(
  taxDispatchSkip({ send: send({ alreadyQueued: true }), flagEnabled: true }) === "already_queued",
  "the second pass is the queued skip",
);

const others = planTaxDispatch({
  sends: [send({ firmId: otherFirm }), send({ id: "66666666-6666-4666-8666-666666666666", firmId: otherFirm })],
  flagEnabled: true,
});
assert(others.length === 0, "other firms do nothing");
assert(
  taxDispatchSkip({ send: send({ firmId: otherFirm }), flagEnabled: true }) === "other_firm",
  "another firm is skipped while the flag is on",
);

assert(
  planTaxDispatch({ sends: [send({ completedAt: null })], flagEnabled: true }).length === 0,
  "an open send is not enqueued",
);
assert(
  planTaxDispatch({ sends: [send({ agent: "analyst" })], flagEnabled: true }).length === 0,
  "another agent is not enqueued",
);

const enumSql = sqlCode("supabase/migrations/20261025120000_agent_key_tax_specialist.sql");
assert(enumSql.includes("alter type public.agent_key add value if not exists 'tax_specialist'"), "the enum gains tax_specialist");
assert(!enumSql.includes("agent_tax"), "the enum migration does not use the new value");
assert(!/\bsecurity\s+definer\b/.test(enumSql), "the enum migration is not security definer");

const queueSql = sqlCode("supabase/migrations/20261025120100_agent_tax_queue.sql");
assert(queueSql.includes("pgmq.create('agent_tax')"), "agent_tax is created");
assert(queueSql.includes("enabled boolean not null default false"), "the flag defaults off");
assert(queueSql.includes("tax_specialist_dispatch"), "the flag name is tax_specialist_dispatch");
assert(queueSql.includes(TAX_DISPATCH_FIRM_ID), "the seed names the one firm");
assert(queueSql.includes("on conflict (firm_id, flag) do nothing"), "a re-run does not turn the flag back on");
assert(queueSql.includes("when 'tax_specialist' then 'agent_tax'"), "the enum value maps to agent_tax");
assert(queueSql.includes("'agent_tax'"), "agent_queue_send may use agent_tax");
assert(!queueSql.includes("agent_queue_read"), "the queue is not added to the read path");
assert(!queueSql.includes("agent_invoke"), "the migration does not call a model");
assert(!queueSql.includes("cron.alter_job"), "the migration does not activate the cron");
assert(!/\bsecurity\s+definer\b/.test(queueSql), "the queue migration adds no security definer function");
assert(!/grant\b[^;]*\bto\s+(anon|public)\b/.test(queueSql), "the migration does not grant to anon or public");
assert(queueSql.includes("revoke all on table public.agent_firm_flags from public, anon, authenticated"), "login roles cannot read the flag");
assert(!queueSql.includes("completed_at"), "the migration does not finish a send");
assert(!queueSql.includes("reviewed_at"), "the migration does not mark a send reviewed");

for (const script of [
  "scripts/apply-client-agent-sends-sql.sh",
  "scripts/apply-client-agent-send-storage-sql.sh",
  "scripts/apply-source-documents-sql.sh",
  ".github/workflows/ci.yml",
]) {
  const text = read(script);
  assert(!text.includes("20261025120000"), `${script} does not apply the enum migration`);
  assert(!text.includes("20261025120100"), `${script} does not apply the queue migration`);
}

const dispatch = read("supabase/functions/agent-dispatch/index.ts");
const enqueueFn = dispatch.slice(
  dispatch.indexOf("async function enqueueCompletedTaxSends"),
  dispatch.indexOf("Deno.serve"),
);
assert(enqueueFn.includes("planTaxDispatch"), "dispatch uses the firm decision");
assert(enqueueFn.includes("agent_queue_send"), "dispatch enqueues through the queue send");
assert(enqueueFn.includes("agent_tax_enqueued"), "dispatch claims the send before a second enqueue");
assert(enqueueFn.indexOf(".insert(") < enqueueFn.indexOf("agent_queue_send"), "the claim is stored before the send");
assert(enqueueFn.includes('.delete().eq("send_id"'), "a failed send drops the claim");
assert(!enqueueFn.includes("agent_invoke"), "the tax path does not call a model");
assert(!enqueueFn.includes("agent_queue_read"), "the tax path does not read a runner queue");
assert(!/anthropic|claude|sars|xero|quickbooks|sage/i.test(enqueueFn), "the tax path does not call a model or a ledger");
assert(dispatch.includes('fn: "agent-analyst"'), "dispatch still invokes the analyst");
assert(dispatch.includes('fn: "agent-financial-manager"'), "dispatch still invokes the financial manager");
assert(dispatch.includes('fn: "agent-advisor"'), "dispatch still invokes the advisor");
assert(dispatch.includes('reason: "disabled"'), "every runner flag off does not read a queue");
assert(!dispatch.includes("precard"), "dispatch does not touch the pre-card allowance");

console.log("tax specialist dispatch test ok");
