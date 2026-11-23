/**
 * Mom Test phase: after the integration plan, three bank questions, one at a time.
 * Answers are client_setup or product_gap on the existing confirm paths.
 * Run: pnpm test:mom-test-phase
 */
import { readFileSync } from "node:fs";
import {
  IMPLEMENTATION_MANAGER_PLAYBOOK,
  MOM_TEST_GAP_IDS,
  MOM_TEST_PER_INTERVIEW,
  MOM_TEST_QUESTIONS,
  MOM_TEST_SETUP_IDS,
  momTestQuestionsForInterview,
  nextMomTestQuestion,
} from "../supabase/functions/setup-partner/firm-interview-prompt.ts";
import { interviewTurnFromModel, questionShouldRegenerate } from "../src/lib/setup-partner.ts";
import {
  buildPracticeImplementationPlan,
  classifyMomTestAnswer,
  clientSetupBrainRows,
  isPracticeGapQueued,
  momTestFlowLine,
  practicePlanFromConfirmRules,
  productGapInsertRow,
} from "../src/lib/setup-partner-plan.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const firmA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const approver = "11111111-1111-1111-1111-111111111111";

const planAt = IMPLEMENTATION_MANAGER_PLAYBOOK.indexOf("**Implementation plan**");
const momAt = IMPLEMENTATION_MANAGER_PLAYBOOK.indexOf("## Mom Test");
const toneAt = IMPLEMENTATION_MANAGER_PLAYBOOK.indexOf("## 6. Tone");
assert(planAt >= 0 && momAt > planAt && toneAt > momAt, "Mom Test follows the integration plan");
const section = IMPLEMENTATION_MANAGER_PLAYBOOK.slice(momAt, toneAt);
assert(section.includes("Ask one per turn"), "one question per turn");
assert(section.includes("already happened"), "questions are about the past");
assert(/would use/i.test(section), "the phase forbids would-you-use questions");
assert(!MOM_TEST_QUESTIONS.some((row) => /would you/i.test(row.prompt)), "the bank does not ask would you");
assert(!/whatsapp/i.test(section), "Mom Test wording does not name a chat app");
assert(!/\b(SARS|IRS|HMRC|ZAR)\b/.test(section), "Mom Test wording stays market-neutral");
assert(section.includes("client_setup") && section.includes("product_gap"), "answers use the two buckets");
assert(section.includes("17:00 SAST"), "product gaps still feed the weekday digest");
assert(section.includes("Nothing in this phase is posted to Xero, QuickBooks, or Sage"), "nothing is posted");
assert(section.includes("Nothing is filed"), "nothing is filed");
for (const row of MOM_TEST_QUESTIONS) {
  assert(section.includes(row.prompt), `bank question is in the playbook: ${row.id}`);
}
assert(MOM_TEST_QUESTIONS.length === 8, "the approved bank has eight questions");
assert(MOM_TEST_PER_INTERVIEW === 3, "an interview asks three");
const ids = new Set(MOM_TEST_QUESTIONS.map((row) => row.id));
assert(ids.size === MOM_TEST_QUESTIONS.length, "question ids are unique");
for (const id of ids) {
  const inSetup = MOM_TEST_SETUP_IDS.has(id);
  const inGap = MOM_TEST_GAP_IDS.has(id);
  assert(inSetup !== inGap, `${id} is setup or a product gap, not both`);
}

const blank = momTestQuestionsForInterview("");
assert(blank.length === 3, "three questions when nothing matches");
assert(
  blank.map((row) => row.id).join(",") === MOM_TEST_QUESTIONS.slice(0, 3).map((row) => row.id).join(","),
  "no match keeps bank order",
);
const relevant = momTestQuestionsForInterview(
  "We keep a spreadsheet of documents. A client asked what they pay.",
);
assert(
  relevant.map((row) => row.id).join(",") === "late-documents,fees-shown,outside-tool",
  `relevant questions come first: ${relevant.map((row) => row.id).join(",")}`,
);

assert(
  nextMomTestQuestion({ planReady: false, firmAnswers: "", askedIds: [] }) === null,
  "nothing is asked before the plan",
);
const asked: string[] = [];
const seen: string[] = [];
for (let turn = 0; turn < 3; turn += 1) {
  const next = nextMomTestQuestion({ planReady: true, firmAnswers: "", askedIds: asked });
  assert(next, `turn ${turn + 1} has one question`);
  assert(!seen.includes(next.prompt), "the same question is not asked twice");
  assert(
    MOM_TEST_QUESTIONS.some((row) => row.id === next.id && row.prompt === next.prompt),
    "the question is from the bank",
  );
  seen.push(next.prompt);
  asked.push(next.id);
}
assert(
  nextMomTestQuestion({ planReady: true, firmAnswers: "", askedIds: asked }) === null,
  "the fourth turn stops",
);
assert(seen.length === 3, "three questions, one at a time");

const compound = MOM_TEST_QUESTIONS.find((row) => row.id === "unsolicited-update");
assert(compound, "update question");
assert(!questionShouldRegenerate(compound.prompt), "a bank question is one turn");
const kept = interviewTurnFromModel({
  toolUses: [{ name: "ask_question", input: { question: compound.prompt, done: false } }],
});
assert(kept.question === compound.prompt && kept.multiple === false, "the parser keeps the bank question");
assert(
  questionShouldRegenerate("When did you last send it? What was in it?"),
  "a second question that is not in the bank is still rejected",
);

const surprise = classifyMomTestAnswer({
  questionId: "tax-surprise",
  answer: "The tax bill arrived and the client had no warning",
});
assert(surprise.bucket === "product_gap", `tax surprise is a product gap: ${surprise.bucket}`);
const surprisePlan = buildPracticeImplementationPlan({
  todaysFlow: [momTestFlowLine(surprise)],
  milonCoverage: [],
  gaps: [],
  checklist: [],
});
assert(surprisePlan.steps.length === 1 && surprisePlan.steps[0]?.bucket === "product_gap", "confirm keeps the gap");
assert(!surprisePlan.steps[0]?.step.includes("[|"), "the bucket mark stays off the step text");
const gapRow = productGapInsertRow({
  dedupeKey: surprisePlan.steps[0]!.dedupe_key,
  capability: surprisePlan.steps[0]!.capability,
  stepType: surprisePlan.steps[0]!.step_type,
  effort: surprisePlan.steps[0]!.effort,
  fitNote: surprisePlan.steps[0]!.fit_note,
  firmId: firmA,
  clientId: null,
  seenAt: "2026-11-23T15:00:00.000Z",
  approverId: null,
});
assert(gapRow.layer === "milon_wide" && gapRow.status === "pending", "the gap is a pending product row");
assert(gapRow.task_type === "feature_idea", "the gap uses the feature-idea queue");
assert(isPracticeGapQueued(gapRow), "the weekday digest queue still includes it");

const sheet = classifyMomTestAnswer({
  questionId: "outside-tool",
  answer: "I opened the cash spreadsheet for the drawdown",
});
assert(sheet.bucket === "client_setup", `spreadsheet is client setup: ${sheet.bucket}`);
const setupRows = clientSetupBrainRows({ firmId: firmA, approverId: approver, steps: [sheet] });
assert(setupRows.length === 1 && setupRows[0]?.client_id === null, "client setup stays on the firm");
assert(setupRows[0]?.layer === "private" && setupRows[0]?.rule_text.includes("[|client_setup]"), "private rule");

const tracked = classifyMomTestAnswer({
  questionId: "lost-client",
  answer: "We tracked the loss in a spreadsheet",
});
assert(tracked.bucket === "client_setup", "a spreadsheet answer stays configuration");

const payroll = classifyMomTestAnswer({
  questionId: "outside-tool",
  answer: "We posted payroll journals",
});
assert(payroll.bucket === "product_gap", "payroll stays a product gap");

const pack = classifyMomTestAnswer({
  questionId: "unseen-work",
  answer: "The month-end pack took the longest",
});
assert(pack.bucket === "client_setup", "work Milōn already does is client setup");

const warned = classifyMomTestAnswer({
  questionId: "lost-client",
  answer: "They nearly lost the client and nothing warned them",
});
assert(warned.bucket === "product_gap", `a missing warning is a product gap: ${warned.bucket}`);
const warnedPlan = buildPracticeImplementationPlan({
  todaysFlow: [momTestFlowLine(warned)],
  milonCoverage: [],
  gaps: [],
  checklist: [],
});
assert(warnedPlan.steps[0]?.bucket === "product_gap", "the flow line keeps the product gap");
const stored = clientSetupBrainRows({ firmId: firmA, approverId: approver, steps: warnedPlan.steps });
const reloaded = practicePlanFromConfirmRules(
  stored.map((row) => ({
    rule_text: row.rule_text,
    client_id: row.client_id,
    source_event: row.source_event,
    status: row.status,
  })),
);
assert(reloaded.steps[0]?.bucket === "product_gap", "reload keeps the product gap");

const desk = classifyMomTestAnswer({
  questionId: "outside-tool",
  answer: "I opened AnyDesk on their machine",
});
assert(desk.bucket === "client_setup", "a one-firm tool on a setup question is client setup");

const panel = read("src/components/practice-setup-panel.tsx");
assert(
  panel.indexOf("Your integration plan") >= 0 &&
    panel.indexOf("Your integration plan") < panel.indexOf("data-mom-test"),
  "the page asks the Mom Test after the plan",
);
assert(panel.includes("nextMomTestQuestion") && panel.includes("classifyMomTestAnswer"), "the page uses the phase");
assert(!panel.includes("would you use"), "the page does not pitch");

console.log("mom-test-phase-test: ok");
