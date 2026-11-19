/**
 * IM routine Vercel cron + scheduler guards.
 * Run: pnpm test:im-routine-cron
 */
import { readFileSync } from "node:fs";
import {
  cronSecretConfigured,
  hasValidCronBearer,
  imRoutineCronFirmDailyCap,
  imRoutineCronEnabled,
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
  countImRoutineStubSkips,
  imRoutineInstantInPeriod,
  imRoutinePeriodKey,
  runStampInRoutinePeriod,
} from "../src/lib/im-routine-schedule.ts";
import { timeZoneCalendarDayUtcBounds } from "../src/lib/statement-period.ts";
import { buildActivationPlan } from "../src/lib/im-activation-planner.ts";
import { routineMapArtifactMeta } from "../src/lib/im-activation-persist.ts";
import { replayImplementationPlan } from "../src/lib/im-replay.ts";
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

assert(!imRoutineCronEnabled(), "cron default off");
const noop = await runImRoutineCron(
  new Request("http://local", { headers: { authorization: "Bearer test-cron-secret" } }),
);
assert(noop.ok && noop.wrote && noop.noop, "kill switch off is noop");

process.env.IM_ROUTINE_CRON_ENABLED = "true";
assert(imRoutineCronEnabled(), "cron on when env true");
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
const advisorRun = readFileSync("supabase/functions/agent-advisor/run.ts", "utf8");
assert(fmRun.includes('inputs.startsWith("im_activation:run:")'), "FM sonnet path for IM runs");
assert(advisorRun.includes('inputs.startsWith("im_activation:run:")'), "Advisor sonnet path for IM / Tax Specialist runs");
assert(advisorRun.includes("CLAUDE_SONNET_55"), "Advisor IM path names Sonnet");
assert(!advisorRun.includes("CLAUDE_OPUS_55"), "Advisor IM path never Opus");

const cronRoute = readFileSync("src/routes/api/im-routine-cron.ts", "utf8");
const vercel = readFileSync("vercel.json", "utf8");
assert(cronRoute.includes("runImRoutineCron"), "cron route wired");
assert(vercel.includes('"path": "/api/im-routine-cron"') && vercel.includes('"0 4 * * *"'), "vercel cron");

assert(
  !service.includes("resend") && !service.includes("accountant_request_respond"),
  "no send paths",
);
assert(!service.includes("efiling") && !service.includes("sars_login"), "scheduler has no SARS filing path");
assert(service.includes("no_sars"), "tax routine trace marks no SARS");
assert(service.includes('meta->>accepted_at'), "accepted firms filtered at query time");
assert(service.includes("timeZoneCalendarDayUtcBounds"), "firm daily cap uses SAST day");
assert(service.includes("timeZoneMonthStartUtcIso"), "upload-since uses SAST month start");
assert(service.includes("countImRoutineStubSkips"), "stub signal counted before planning");
assert(!service.includes("skipped_stub_signal += 1;\n          continue"), "no unreachable stub skip in loop");

const sastDay = timeZoneCalendarDayUtcBounds(new Date("2026-11-30T22:30:00.000Z"), "Africa/Johannesburg");
assert(sastDay.dayYmd === "2026-12-01", "22:30 UTC is 1 Dec SAST for day cap");
assert(sastDay.startIso === "2026-11-30T22:00:00.000Z", "SAST midnight maps to 22:00 UTC previous day");

const taxReplay = replayImplementationPlan({
  confirmRules: [
    {
      rule_text:
        "Practice: Prepare VAT201, EMP201, and provisional tax for the book — Practice; Monthly — Fits.",
      status: "active",
      source_event: "setup_partner_confirm",
    },
  ],
  meta: { country: "ZA" },
});
assert(taxReplay.status === "ready", "ZA tax replay");
if (taxReplay.status === "ready") {
  const taxActivation = buildActivationPlan({
    plan: taxReplay.plan,
    country: "ZA",
    pilots: [{ id: client, name: "Pilot", hasLedger: true, hasUpload: false }],
    manifest: taxReplay.manifest,
  });
  const taxMap = taxActivation.routineMaps.find((row) => row.routine === "tax_deadline_watch");
  assert(taxMap, "tax deadline watch map on ZA tax plan");
  assert(taxMap!.steps.every((step) => step.sends === false), "tax steps do not send");
  assert(
    taxMap!.steps[2]?.title.includes("no SARS filing"),
    "reminder step explicitly avoids SARS filing",
  );
  assert(taxMap!.steps[0]?.botOwner === "Tax Specialist", "Tax Specialist owns deadline watch");
  const meta = routineMapArtifactMeta({
    firmId: firm,
    clientId: client,
    map: taxMap!,
    hoursSavedPerRun: null,
    acceptedAt: new Date(0).toISOString(),
  });
  const stub = countImRoutineStubSkips({
    firmId: firm,
    clientId: client,
    meta,
    actions: [],
    runs: [],
    context: { hasLedger: true, hasUpload: false, cashCollectionsRisk: false },
  });
  assert(stub === 0, "tax map does not stub-skip");
}

const cashReplay = replayImplementationPlan({
  confirmRules: [{ rule_text: "Practice: Overdue receivables — covered", status: "active", source_event: "x" }],
  meta: { country: "ZA" },
});
if (cashReplay.status === "ready") {
  const cashActivation = buildActivationPlan({
    plan: cashReplay.plan,
    country: "ZA",
    pilots: [{ id: client, name: "Pilot", hasLedger: true, hasUpload: false }],
    manifest: cashReplay.manifest,
  });
  const cashMap = cashActivation.routineMaps.find((row) => row.routine === "cash_debtor_early_warning");
  if (cashMap) {
    const meta = routineMapArtifactMeta({
      firmId: firm,
      clientId: client,
      map: cashMap,
      hoursSavedPerRun: null,
      acceptedAt: new Date(0).toISOString(),
    });
    const stub = countImRoutineStubSkips({
      firmId: firm,
      clientId: client,
      meta,
      actions: [],
      runs: [],
      context: { hasLedger: true, hasUpload: false, cashCollectionsRisk: false },
    });
    assert(stub === 1, "cash stub signal counted before plan");
  }
}

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
