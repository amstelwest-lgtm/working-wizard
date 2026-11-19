/**
 * IM routine Vercel cron + scheduler guards.
 * Run: pnpm test:im-routine-cron
 */
import { readFileSync } from "node:fs";
import {
  cronSecretConfigured,
  hasValidCronBearer,
  imRoutineCronFirmDailyCap,
  imRoutineCronKillSwitchOn,
  imRoutineCronMaxFirms,
  imRoutineCronMaxInvokes,
} from "../src/lib/im-routine-cron-auth.ts";
import {
  assertClientBelongsToFirm,
  emptyImRoutineSchedulerCounts,
  runImRoutineSchedulerCore,
} from "../src/lib/im-routine-scheduler.service.ts";
import { runImRoutineCron } from "../src/lib/im-routine-cron.service.ts";
import {
  imCashCollectionsRiskFromFinancials,
} from "../src/lib/im-routine-signals.ts";
import {
  imRoutineInstantInPeriod,
  imRoutinePeriodKey,
  runStampInRoutinePeriod,
} from "../src/lib/im-routine-schedule.ts";
import { buildCapabilityManifest, matchManifestClassifier } from "../src/lib/im-capability-manifest.ts";
import { STRIKE7_BEN_ID } from "./strike7-firms.ts";
import { CLAUDE_OPUS_55, CLAUDE_SONNET_55, isClaudeOpus55 } from "../src/lib/claude-request.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const firm = STRIKE7_BEN_ID;
const client = "e8f7a440-2222-2222-2222-222222222222";

delete process.env.CRON_SECRET;
delete process.env.IM_ROUTINE_CRON_ENABLED;
assert(!cronSecretConfigured(), "unset secret fails closed");
assert(!hasValidCronBearer(new Request("http://local", { headers: {} })), "bearer missing rejected");

process.env.CRON_SECRET = "test-cron-secret";
assert(cronSecretConfigured(), "secret configured");
assert(!hasValidCronBearer(new Request("http://local", { headers: { authorization: "Bearer wrong" } })), "wrong bearer");
assert(
  hasValidCronBearer(new Request("http://local", { headers: { authorization: "Bearer test-cron-secret" } })),
  "valid bearer",
);

assert(!imRoutineCronKillSwitchOn(), "kill switch default off");
const noop = await runImRoutineCron(
  new Request("http://local", { headers: { authorization: "Bearer test-cron-secret" } }),
);
assert(noop.ok && noop.wrote && noop.noop, "kill switch off is noop");

process.env.IM_ROUTINE_CRON_ENABLED = "true";
assert(imRoutineCronKillSwitchOn(), "kill switch on when true");
assert(imRoutineCronMaxFirms() === 5, "default max firms");
assert(imRoutineCronMaxInvokes() === 20, "default max invokes");
assert(imRoutineCronFirmDailyCap() === 10, "default firm daily cap");
process.env.IM_ROUTINE_CRON_MAX_FIRMS = "2";
process.env.IM_ROUTINE_CRON_MAX_INVOKES = "3";
process.env.IM_ROUTINE_CRON_FIRM_DAILY_CAP = "1";
assert(imRoutineCronMaxFirms() === 2 && imRoutineCronMaxInvokes() === 3 && imRoutineCronFirmDailyCap() === 1, "env caps parse");

const novBoundary = new Date("2026-11-30T23:30:00.000Z");
assert(imRoutinePeriodKey(novBoundary) === "2026-12", "23:30 UTC is December in JHB");
assert(
  runStampInRoutinePeriod("2026-11-30T23:30:00.000Z", "2026-12"),
  "queued_at uses JHB period not UTC prefix",
);
assert(!runStampInRoutinePeriod("2026-11-30T23:30:00.000Z", "2026-11"), "not in prior UTC month key");
assert(imRoutineInstantInPeriod(novBoundary, "2026-12"), "instant in period");

assert(
  !imCashCollectionsRiskFromFinancials({ revenue: 100_000, receivables: 10_000, periodMonths: "12" }),
  "low debtor days is not risk",
);
assert(
  imCashCollectionsRiskFromFinancials({ revenue: 100_000, receivables: 90_000, periodMonths: "12" }),
  "high debtor days is real signal",
);

const manifest = buildCapabilityManifest("ZA");
assert(!matchManifestClassifier("Improve cash management", manifest), "generic cash no match");
assert(matchManifestClassifier("Overdue receivables follow-up", manifest)?.stepType === "cash_collections", "cash collections match");
assert(!matchManifestClassifier("Comment on drift in tone", manifest), "generic drift no match");
assert(
  matchManifestClassifier("Budget versus actual drift check", manifest)?.stepType === "budget_variance",
  "budget drift match",
);

const runner = readFileSync("src/lib/im-routine-runner.functions.ts", "utf8");
const service = readFileSync("src/lib/im-routine-scheduler.service.ts", "utf8");
assert(!runner.includes("CLAUDE_OPUS_55"), "runner does not reference Opus");
assert(service.includes("CLAUDE_SONNET_55") && !service.includes("im_design_model"), "scheduler trace is Sonnet-only");
assert(!isClaudeOpus55(CLAUDE_SONNET_55), "scheduled model is not Opus");

const fmRun = readFileSync("supabase/functions/agent-financial-manager/run.ts", "utf8");
assert(fmRun.includes('inputs.startsWith("im_activation:run:")'), "FM sonnet path for IM runs");

const cronRoute = readFileSync("src/routes/api/im-routine-cron.ts", "utf8");
const vercel = readFileSync("vercel.json", "utf8");
assert(cronRoute.includes("runImRoutineCron"), "cron route wired");
assert(vercel.includes('"path": "/api/im-routine-cron"') && vercel.includes('"0 4 * * *"'), "vercel cron");

assert(
  !service.includes("resend") && !service.includes("accountant_request_respond"),
  "no send paths",
);

let clientRejected = false;
try {
  await assertClientBelongsToFirm(client, "00000000-0000-4000-8000-000000000099");
} catch {
  clientRejected = true;
}
assert(clientRejected || !process.env.SUPABASE_URL, "clientId not in firm rejects when DB configured");

const counts = emptyImRoutineSchedulerCounts();
assert(counts.invoked === 0 && counts.skipped_cap === 0, "empty counts");

console.log("im-routine-cron-test: ok");