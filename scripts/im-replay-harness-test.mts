/**
 * Saved-practice replay. Questions only when answers are missing.
 * Run: pnpm test:im-replay-harness
 */
import { interviewDraftRuleText, interviewDraftWithQuestion } from "../src/lib/firm-interview-draft.ts";
import { classifyWithManifest, hoursSaved, type PilotClient } from "../src/lib/im-activation.ts";
import { buildCapabilityManifest, defaultManifestTools } from "../src/lib/im-capability-manifest.ts";
import { loadInterview, replayFailures, replayPractice, type ReplayRule } from "../src/lib/im-replay.ts";
import { practiceConfirmRuleText } from "../src/lib/setup-partner-plan.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function rule(step: string): ReplayRule {
  return {
    rule_text: practiceConfirmRuleText(step, "Saved from the practice interview."),
    status: "active",
    task_type: "onboarding_workflow",
    client_id: null,
  };
}

function clients(count: number, ledger: PilotClient["ledger"], prefix: string): PilotClient[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index + 1}`,
    name: `${prefix} ${index + 1}`,
    ledger,
    hasUpload: index === 0,
  }));
}

const theoInterview = loadInterview(
  interviewDraftRuleText(
    interviewDraftWithQuestion(
      [
        { role: "assistant", content: "How does a typical month end?" },
        { role: "user", content: "The partner reviews the pack. Deadlines sit on a desktop calendar." },
      ],
      "How does a typical month end?",
      1,
      { sessionId: "sess-theo", savedAt: "2026-11-01T00:00:00.000Z" },
    ),
  ),
);

const theoRules = [
  "Month-end close pack for the book",
  "Management pack goes to the partner",
  "Bookkeeping review before the pack",
  "Cash and profit reporting each month",
  "Deadlines tracked on the desktop calendar",
  "Who reviews the pack",
  "Who signs off the pack",
  "Xero is the only ledger",
  "Clients email receipts and statements",
  "Bank reconciliation before the pack",
  "Cash forecast each Monday",
  "Which spreadsheet is still in use",
  "Name the reviewer for the book",
  "When the monthly pack goes out",
].map(rule);
assert(theoRules.length === 14, "Theo's stand-in has 14 saved rules");

const theo = replayPractice({
  rules: theoRules,
  interview: theoInterview,
  clients: [
    { id: "pilot-north", name: "Pilot North", ledger: "xero", hasUpload: true },
    { id: "pilot-south", name: "Pilot South", ledger: "xero", hasUpload: false },
    { id: "pilot-east", name: "Pilot East", ledger: null, hasUpload: true },
  ],
});
assert(theo.questions.length === 0, "a saved interview does not ask again");
assert(replayFailures(theo).length === 0, replayFailures(theo).join("; ") || "theo replay");
assert(
  theo.plan.steps.some((step) => /deadline/i.test(step.step) && step.bucket !== "bespoke"),
  "a deadline is not bespoke because it mentions desktop",
);
assert(theo.pilots.length >= 2 && theo.pilots.length <= 3, "two or three pilots");
assert(theo.pilots.every((pilot) => pilot.editable), "the partner can edit the pilots");
assert(theo.hoursSaved == null, "hours stay blank until the partner enters an estimate");
assert(theo.firstValue?.sent === false, "the first draft is unsent");

const small = replayPractice({
  rules: [
    rule("Clients email the receipts"),
    rule("The partner does the review and the sign-off"),
    rule("Monthly management pack"),
    rule("Xero is the ledger for every client"),
  ],
  interview: theoInterview,
  clients: clients(15, "xero", "book"),
});
assert(replayFailures(small).length === 0, replayFailures(small).join("; "));
assert(
  !small.checklist.some((line) => /which ledger/i.test(line)),
  "one ledger does not ask which ledger",
);

const multiClients: PilotClient[] = [
  ...clients(22, "xero", "xero"),
  ...clients(20, "sage", "sage"),
];
assert(multiClients.length >= 40, "the multi-ledger book has 40 or more clients");
const multi = replayPractice({
  rules: [
    rule("Xero and Sage are both on the book"),
    rule("Several reviewers share the pack"),
    rule("Who reviews each client"),
    rule("Monthly management pack"),
  ],
  interview: theoInterview,
  clients: multiClients,
});
assert(replayFailures(multi).length === 0, replayFailures(multi).join("; "));
assert(
  multi.checklist.some((line) => /which ledger does each pilot use/i.test(line)),
  "a mixed ledger book asks which ledger each pilot uses",
);
assert(multi.checklist.some((line) => /who reviews/i.test(line)), "the checklist asks who reviews");
assert(
  multi.routines.every((map) => map.steps.some((step) => step.approval)),
  "the accountant approval gate stays",
);

const tax = replayPractice({
  rules: [
    rule("VAT return comes first"),
    rule("EMP monthly return comes next"),
    rule("Provisional tax is prepared in the firm"),
    rule("Annual return follows the provisional work"),
    rule("Deadline watch sends reminders only"),
    rule("Monthly management pack"),
  ],
  interview: theoInterview,
  clients: clients(4, "xero", "tax"),
});
assert(replayFailures(tax).length === 0, replayFailures(tax).join("; "));
const taxSteps = tax.plan.steps.filter((step) => /\b(vat|emp|provisional|annual return)\b/i.test(step.step));
assert(taxSteps.length >= 4 && taxSteps.every((step) => step.bucket === "product_gap"), "tax work stays a product gap");
const watch = tax.routines.find((map) => map.id === "deadline_watch");
assert(watch != null && watch.filing === false, "deadline watch is reminders only");
assert(
  watch.steps.every((step) => !/\b(sars|e-?filing|submit)\b/i.test(step.title)),
  "deadline watch does not file",
);

const us = replayPractice({
  rules: [
    rule("QuickBooks is the ledger"),
    rule("Monthly management pack for the clients"),
    rule("The partner reviews and signs off"),
    rule("Clients email the source documents"),
  ],
  interview: theoInterview,
  clients: clients(6, "qbo", "cpa"),
});
assert(replayFailures(us).length === 0, replayFailures(us).join("; "));
assert(!/\b(vat|emp|sars|provisional)\b/i.test(JSON.stringify(us)), "a US practice has no ZA tax wording");

const missing = replayPractice({ rules: [], interview: null, clients: [] });
assert(missing.questions.length > 0, "missing answers are the path that asks");
assert(missing.answersPresent === false, "an empty save has no answers");

const tools = defaultManifestTools();
const plain = classifyWithManifest("Chase the supplier portal every Monday", buildCapabilityManifest());
const withTool = classifyWithManifest(
  "Chase the supplier portal every Monday",
  buildCapabilityManifest({
    tools: [...tools, { name: "chase_supplier_portal", label: "Supplier portal", agent: "financial_manager" }],
  }),
);
assert(withTool.step_type === "chase_supplier_portal", "a registry tool changes the match");
assert(plain.step_type !== withTool.step_type, "without that tool the step does not take its id");
assert(defaultManifestTools().length === tools.length, "the planner reads the same registry");
assert(hoursSaved(2, 3) === 6, "hours are the partner estimate times completed runs");
assert(hoursSaved(null, 3) == null && hoursSaved(2, null) == null, "a missing estimate or run stays blank");

console.log("im-replay-harness ok");
