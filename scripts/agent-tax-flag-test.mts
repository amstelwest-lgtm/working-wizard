/**
 * Tax review queue: off by default, on for one firm, and one message per finish.
 * Run: pnpm test:agent-tax-flag
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  planTaxEnqueue,
  TAX_SPECIALIST_QUEUE,
  taxSpecialistDispatchEnabled,
  taxSpecialistEnabled,
} from "../src/lib/agent-tax-flag.ts";
import { SEND_AGENT_FIRM_ALLOWLIST } from "../src/lib/client-agent-send-allowlist.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = process.cwd();
function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const firmId = SEND_AGENT_FIRM_ALLOWLIST[0];
const otherFirm = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const sendId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const on = { default: false, firms: { [firmId]: true } };

assert(taxSpecialistEnabled(false, firmId) === false, "a boolean false is off");
assert(taxSpecialistEnabled(null, firmId) === false, "a missing flag is off");
assert(taxSpecialistEnabled(true, firmId) === false, "a global true does not enable every firm");
assert(taxSpecialistEnabled({ default: false, firms: {} }, firmId) === false, "an empty firm map is off");
assert(taxSpecialistEnabled(on, otherFirm) === false, "another firm stays off");
assert(taxSpecialistEnabled(on, firmId.slice(0, 8)) === false, "a prefix of the firm id is off");
assert(taxSpecialistEnabled(on, firmId) === true, "the named firm is on");
assert(taxSpecialistDispatchEnabled(false) === false, "dispatch stays quiet when the flag is off");
assert(taxSpecialistDispatchEnabled(on) === true, "dispatch can read the queue when one firm is on");
assert(taxSpecialistDispatchEnabled({ default: true, firms: {} }) === false, "default true with no firm is still off");

const off = planTaxEnqueue({
  already: false,
  setting: false,
  firmId,
  sendId,
  clientId,
});
assert(off.enqueue === false, "flag off enqueues nothing");

const other = planTaxEnqueue({
  already: false,
  setting: on,
  firmId: otherFirm,
  sendId,
  clientId,
});
assert(other.enqueue === false, "a firm that is off enqueues nothing");

const once = planTaxEnqueue({
  already: false,
  setting: on,
  firmId,
  sendId,
  clientId,
});
assert(once.enqueue === true, "the named firm enqueues once");
if (once.enqueue) {
  assert(once.queue === TAX_SPECIALIST_QUEUE, "the message goes to agent_tax");
  assert(
    once.payload.send_id === sendId &&
      once.payload.client_id === clientId &&
      once.payload.firm_id === firmId,
    "the message is send, client, and firm",
  );
  assert(Object.keys(once.payload).length === 3, "the message has no extra fields");
}

const again = planTaxEnqueue({
  already: true,
  setting: on,
  firmId,
  sendId,
  clientId,
});
assert(again.enqueue === false, "a finished link does not enqueue again");

const fn = read("src/lib/client-agent-link.functions.ts");
const handler = fn.slice(fn.indexOf("export const completeClientAgentSend"));
const alreadyAt = handler.indexOf("if (decision.already) return { ok: true }");
const markAt = handler.indexOf("markCompleted");
const enqueueAt = handler.indexOf("enqueueTaxReview");
assert(alreadyAt > 0 && alreadyAt < markAt && markAt < enqueueAt, "enqueue runs after the first completion only");
assert(handler.indexOf("enqueueTaxReview", enqueueAt + 1) === -1, "finish enqueues at one call site");
assert(fn.includes("agent_queue_send"), "finish sends through the queue function");
assert(fn.includes("planTaxEnqueue"), "finish uses the firm flag");

const dispatch = read("supabase/functions/agent-dispatch/index.ts");
assert(dispatch.includes('queue: "agent_tax"'), "dispatch reads the tax queue");
assert(dispatch.includes('fn: "agent-tax-specialist"'), "dispatch names the tax runner");
assert(dispatch.includes("taxSpecialistEnabled"), "dispatch skips a firm that is off");
assert(dispatch.includes("taxSpecialistDispatchEnabled"), "a firm map can turn the runner on");

const sql = read("supabase/migrations/20261022220000_agent_tax_specialist.sql");
const code = sql
  .split("\n")
  .filter((line) => !line.trim().startsWith("--"))
  .join("\n")
  .toLowerCase();
assert(code.includes("add value if not exists 'tax_specialist'"), "the agent enum gains tax_specialist");
assert(code.includes("pgmq.create('agent_tax')"), "the tax queue is created");
assert(code.includes("pgmq.create('agent_tax_dlq')"), "the tax dead-letter queue is created");
assert(code.includes("'tax_specialist_enabled'"), "the setting key is tax_specialist_enabled");
assert(code.includes("'default', false"), "the flag defaults off");
assert(code.includes(`'${firmId}', true`), "only the named firm is set on");
assert(!code.includes(`'${firmId.slice(0, 8)}', true`), "a prefix is not the firm key");
assert(!code.includes("set value = 'true'"), "the migration does not flip a global flag on");
assert(!code.includes("cron.alter_job"), "the migration does not activate the cron");
assert(code.includes("'agent_tax', 'agent_tax_dlq'"), "the tax queues are allowed");
assert(code.includes("'agent-tax-specialist'"), "invoke allows the tax runner");
assert(code.includes("agent_tax_specialist_enabled"), "invoke checks the firm flag");
assert(code.includes("agent_tax_specialist_dispatch_enabled()"), "the tick notices a firm that is on");
assert(
  code.includes("revoke all on function public.agent_tax_specialist_enabled(uuid) from public, anon, authenticated"),
  "login roles cannot call the firm check",
);
assert(!/grant\b[^;]*\bto\s+(anon|public)\b/i.test(code), "the migration does not grant to anon or public");
const helper = code.slice(
  code.indexOf("create or replace function public.agent_tax_specialist_enabled"),
  code.indexOf("create or replace function public.agent_tax_specialist_dispatch_enabled"),
);
assert(!/security\s+definer/i.test(helper), "the firm check is not security definer");

console.log("agent tax flag test ok");
