/**
 * Setup Partner gap triage: buckets, dedupe, bespoke hidden, since-yesterday.
 * Run: pnpm test:setup-partner-gap
 */
import { readFileSync } from "node:fs";
import { SETUP_PARTNER_FIXED_QUESTIONS } from "../src/lib/setup-partner.ts";
import {
  PRODUCT_GAPS_SINCE_YESTERDAY_SQL,
  bespokeLogRow,
  buildPracticeImplementationPlan,
  classifyPracticeStep,
  clientSetupBrainRows,
  isPracticeGapQueued,
  mergeProductGap,
  parseProductGapRule,
  practiceGapDedupeKey,
  productGapInsertRow,
  productGapsSinceYesterday,
} from "../src/lib/setup-partner-plan.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const firmA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const firmB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const clientA = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const clientB = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const seenAt = "2026-11-10T09:00:00.000Z";

const covered = classifyPracticeStep("Month-end close across the book");
assert(covered.bucket === "covered", `covered bucket: ${covered.bucket}`);
assert(covered.covers.includes("Financial Manager"), "covered names the agent");
assert(covered.effort === "S", "covered effort");
assert(
  covered.dedupe_key === practiceGapDedupeKey("financial-manager", "month_end_close"),
  "covered dedupe",
);

const setup = classifyPracticeStep("Which ledgers and spreadsheets does the practice use?");
assert(setup.bucket === "client_setup", `client_setup bucket: ${setup.bucket}`);
assert(setup.effort === "S", "setup effort");
assert(setup.fit_note.length > 0, "setup fit note");

const gapA = classifyPracticeStep("Post payroll journals for every client");
const gapB = classifyPracticeStep("Payroll journals each month for the practice");
assert(gapA.bucket === "product_gap" && gapB.bucket === "product_gap", "product_gap bucket");
assert(gapA.dedupe_key === gapB.dedupe_key, "same payroll gap shares a dedupe key");
assert(
  !gapA.dedupe_key.includes(clientA) && !gapA.dedupe_key.includes(firmA),
  "dedupe key is client-agnostic",
);
assert(gapA.effort === "M", "payroll effort");

const bespoke = classifyPracticeStep("Use AnyDesk to drive the client's desktop");
assert(bespoke.bucket === "bespoke", `bespoke bucket: ${bespoke.bucket}`);
assert(bespoke.effort === "L", "bespoke effort");

const plan = buildPracticeImplementationPlan({
  todaysFlow: [covered.step, setup.step],
  milonCoverage: [],
  gaps: [gapA.step, bespoke.step],
  checklist: ["Connect Xero where the firm keeps the books."],
});
const buckets = new Set(plan.steps.map((step) => step.bucket));
assert(buckets.has("covered") && buckets.has("client_setup"), "plan keeps covered and setup");
assert(buckets.has("product_gap") && buckets.has("bespoke"), "plan keeps gap and bespoke");

const setupRows = clientSetupBrainRows({
  firmId: firmA,
  approverId: "11111111-1111-1111-1111-111111111111",
  steps: plan.steps,
});
assert(setupRows.length >= 1, "client_setup writes a private rule");
assert(
  setupRows.every(
    (row) => row.layer === "private" && row.status === "active" && row.firm_id === firmA,
  ),
  "setup rows are firm private",
);
assert(
  setupRows.every((row) => row.client_id == null && row.pattern_key == null),
  "setup is firm-wide, no pattern key",
);

const first = mergeProductGap(null, {
  dedupeKey: gapA.dedupe_key,
  capability: gapA.capability,
  stepType: gapA.step_type,
  effort: gapA.effort,
  fitNote: gapA.fit_note,
  firmId: firmA,
  clientId: clientA,
  seenAt,
});
const second = mergeProductGap(first.rule_text, {
  dedupeKey: gapB.dedupe_key,
  capability: gapB.capability,
  stepType: gapB.step_type,
  effort: gapB.effort,
  fitNote: gapB.fit_note,
  firmId: firmB,
  clientId: clientB,
  seenAt: "2026-11-10T12:00:00.000Z",
});
assert(first.pattern_key === second.pattern_key, "merge keeps one pattern key");
assert(second.count === 2, `two clients bump count: ${second.count}`);
assert(second.firmIds.includes(firmA) && second.firmIds.includes(firmB), "both firms stored");
assert(
  second.clientIds.includes(clientA) && second.clientIds.includes(clientB),
  "both clients stored",
);
const parsed = parseProductGapRule(second.rule_text);
assert(parsed?.count === 2 && parsed.effort === "M", "encoded gap parses");
assert(second.rule_text.length <= 500, "rule text stays within the column clip");
const again = mergeProductGap(second.rule_text, {
  dedupeKey: gapA.dedupe_key,
  capability: gapA.capability,
  stepType: gapA.step_type,
  effort: gapA.effort,
  fitNote: gapA.fit_note,
  firmId: firmA,
  clientId: clientA,
  seenAt: "2026-11-10T13:00:00.000Z",
});
assert(again.count === 2 && again.clientIds.length === 2, "same client does not duplicate");

const gapRow = productGapInsertRow({
  dedupeKey: gapA.dedupe_key,
  capability: gapA.capability,
  stepType: gapA.step_type,
  effort: gapA.effort,
  fitNote: gapA.fit_note,
  firmId: firmA,
  clientId: clientA,
  seenAt,
  approverId: null,
});
assert(
  gapRow.layer === "milon_wide" && gapRow.status === "pending",
  "gap uses the pending milon_wide path",
);
assert(
  gapRow.task_type === "feature_idea" && gapRow.pattern_key === gapA.dedupe_key,
  "pattern_key is the dedupe key",
);
assert(
  gapRow.firm_id == null && gapRow.client_id == null,
  "merged row is not pinned to one firm column",
);
assert(isPracticeGapQueued(gapRow), "product gap is on the existing queue");

const bespokeRow = bespokeLogRow({
  firmId: firmA,
  clientId: clientA,
  approverId: null,
  step: bespoke,
});
assert(
  bespokeRow.status === "retired" && bespokeRow.task_type === "practice_bespoke",
  "bespoke is a log row",
);
assert(!isPracticeGapQueued(bespokeRow), "bespoke is not surfaced");
assert(
  !isPracticeGapQueued({
    ...gapRow,
    task_type: "practice_bespoke",
    layer: "milon_wide",
    status: "pending",
  }),
  "bespoke task never queues",
);

const now = new Date("2026-11-10T18:00:00.000Z");
const recent = productGapsSinceYesterday(
  [
    {
      id: "new",
      layer: "milon_wide",
      status: "pending",
      task_type: "feature_idea",
      created_at: "2026-11-10T10:00:00.000Z",
      rule_text: first.rule_text,
    },
    {
      id: "old",
      layer: "milon_wide",
      status: "pending",
      task_type: "feature_idea",
      created_at: "2026-11-01T10:00:00.000Z",
      rule_text: mergeProductGap(null, {
        dedupeKey: gapA.dedupe_key,
        capability: gapA.capability,
        stepType: gapA.step_type,
        effort: gapA.effort,
        fitNote: gapA.fit_note,
        firmId: firmA,
        clientId: clientA,
        seenAt: "2026-11-01T10:00:00.000Z",
      }).rule_text,
    },
    {
      id: "merged",
      layer: "milon_wide",
      status: "pending",
      task_type: "feature_idea",
      created_at: "2026-11-01T10:00:00.000Z",
      rule_text: second.rule_text,
    },
    {
      id: "bespoke",
      layer: "private",
      status: "retired",
      task_type: "practice_bespoke",
      created_at: "2026-11-10T10:00:00.000Z",
      rule_text: bespokeRow.rule_text,
    },
  ],
  now,
);
const ids = recent.map((row) => row.id).sort();
assert(
  ids.includes("new") && ids.includes("merged"),
  `since yesterday keeps new and merged: ${ids.join(",")}`,
);
assert(
  !ids.includes("old") && !ids.includes("bespoke"),
  `since yesterday hides old and bespoke: ${ids.join(",")}`,
);

const sql = PRODUCT_GAPS_SINCE_YESTERDAY_SQL.toLowerCase();
assert(sql.startsWith("select"), "since-yesterday snippet is a select");
assert(!/\b(insert|update|delete|drop|alter)\b/.test(sql), "since-yesterday snippet is read-only");
assert(
  sql.includes("milon_brain_rules") && sql.includes("feature_idea"),
  "query reads feature ideas",
);
assert(
  sql.includes("milon_wide") && sql.includes("pending") && sql.includes("interval '1 day'"),
  "query window",
);
assert(sql.includes("seen="), "query also honours a merge timestamp");

const prompts = SETUP_PARTNER_FIXED_QUESTIONS.map((row) => row.prompt).join(" ");
assert(/month-end close/i.test(prompts), "interview asks about close");
assert(/sign-off/i.test(prompts), "interview asks about sign-off");
assert(/client reports/i.test(prompts), "interview asks about reporting");
assert(!/supplier bills/i.test(prompts), "interview is not the end-client business");

const edge = read("supabase/functions/setup-partner/index.ts");
assert(edge.includes("buildPracticeImplementationPlan"), "confirm returns a plan");
assert(edge.includes("upsertProductGap"), "product gaps merge in the edge");
assert(edge.includes("bespokeLogRow"), "bespoke is logged from the edge");
assert(
  edge.includes('userClient.from("milon_brain_rules").insert'),
  "client_setup uses the caller JWT",
);
assert(
  edge.includes('adminClient.from("milon_brain_rules").insert(row)'),
  "bespoke log uses service role",
);
const prompt = read("supabase/functions/setup-partner/firm-interview-prompt.ts");
assert(prompt.includes("accountant firm"), "firm interview prompt");
assert(prompt.includes("Never ask for desktop access"), "prompt states no desktop access");
assert(prompt.includes("No remote desktop"), "prompt declines remote desktop");
assert(prompt.includes("screenshot"), "prompt allows screenshot notes");
const panel = read("src/components/setup-partner-panel.tsx");
assert(!panel.includes("product_gap") && !panel.includes("dedupe_key"), "plan stays off the panel");
const card = read("src/components/practice-setup-card.tsx");
assert(card.includes("Set up your practice"), "practice home card");
assert(!card.includes("setup-partner-panel"), "card does not render the panel");
assert(
  read("src/components/practice-board.tsx").includes("<PracticeSetupCard"),
  "card is on practice home",
);

console.log("setup-partner-gap-test: ok");
