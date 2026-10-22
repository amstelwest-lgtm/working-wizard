/**
 * Tax document review from fixture files. No live model call.
 * Run: pnpm test:tax-specialist-review
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RUNNER_COST_CEILING_USD, defaultDraftRecipient } from "../src/lib/agent-draft.ts";
import {
  draftDecisionAccess,
  isDraftFinding,
  liveRecordForDraft,
  taxReviewApprovalUpdate,
  taxReviewStaysOnFinding,
} from "../src/lib/agent-draft-decision.ts";
import { DRAFT_NEEDS_ACCOUNTANT, DRAFT_NEEDS_OWNER, draftFindingLabel } from "../src/hooks/owner-agent-ui.ts";
import { findingFigureEntries } from "../src/lib/milon-team-activity.ts";
import { ownerDraftPresentations, ownerNeedsView, ownerSurfaceForFinding } from "../src/lib/owner-needs.ts";
import { taxReviewCardFromFinding } from "../src/lib/tax-review-card.ts";
import {
  TAX_REVIEW_COST_CAP_USD,
  TAX_REVIEW_DOCUMENT_TYPES,
  estimateTaxReviewTokens,
  reviewTaxSend,
  taxDocumentType,
  type TaxArtifact,
  type TaxDocumentType,
} from "../src/lib/tax-specialist-review.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const root = process.cwd();
function read(path: string): string {
  return readFileSync(resolve(root, path), "utf8");
}

const sendId = "11111111-1111-4111-8111-111111111111";
const clientId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";

const specs: Array<{ file: string; itemKey: string | null; type: TaxDocumentType }> = [
  { file: "practice-income.txt", itemKey: "practice_income_expenses", type: "practice_income_expenses" },
  { file: "irp6.txt", itemKey: null, type: "irp6" },
  { file: "medical-aid.txt", itemKey: "medical_aid_certificate", type: "medical_aid" },
  { file: "ra.txt", itemKey: "ra_contribution_certificate", type: "ra_contributions" },
  { file: "travel-logbook.txt", itemKey: "travel_logbook", type: "travel_logbook" },
  { file: "it3b.txt", itemKey: "it3b", type: "interest" },
  { file: "maintenance.txt", itemKey: null, type: "maintenance" },
];

const artifacts: TaxArtifact[] = specs.map((spec, index) => {
  const id = `44444444-4444-4444-8444-44444444444${index}`;
  const text = read(`tests/fixtures/tax-specialist/${spec.file}`);
  const artifact = { id, fileName: spec.file, itemKey: spec.itemKey, text };
  assert(taxDocumentType(artifact) === spec.type, `${spec.file} is ${spec.type}`);
  return artifact;
});

const estimate = estimateTaxReviewTokens(artifacts);
assert(estimate.usd <= TAX_REVIEW_COST_CAP_USD, "the fixture pack stays inside the per-send cap");
assert(TAX_REVIEW_COST_CAP_USD < RUNNER_COST_CEILING_USD, "the per-send cap is under the runner ceiling");
console.log("TOKEN_ESTIMATE");
console.log(`cap_usd ${TAX_REVIEW_COST_CAP_USD}`);
console.log(`prompt_tokens ${estimate.promptTokens}`);
console.log(`input_tokens ${estimate.inputTokens}`);
console.log(`output_tokens ${estimate.outputTokens}`);
console.log(`usd ${estimate.usd}`);
for (const type of TAX_REVIEW_DOCUMENT_TYPES) {
  const line = estimate.byType[type];
  if (line.documents === 0) continue;
  console.log(
    `${type} documents ${line.documents} input ${line.inputTokens} output ${line.outputTokens} usd ${line.usd}`,
  );
}

const byFile = new Map(artifacts.map((artifact) => [artifact.fileName, artifact]));
const model = {
  summary: "Practice income is 480 000 and expenses are 125 000, with one personal grocery line. The second provisional payment is still an estimate. Maintenance is not confirmed.",
  figures: [
    {
      key: "practice_income",
      label: "Practice income",
      amount: "480000",
      artifact_id: byFile.get("practice-income.txt")!.id,
      confidence: "high",
      reason: "The income total is stated on the income note.",
    },
    {
      key: "practice_expenses",
      label: "Practice expenses",
      amount: "125000",
      artifact_id: byFile.get("practice-income.txt")!.id,
      confidence: "medium",
      reason: "A grocery line looks personal.",
    },
    {
      key: "provisional_first",
      label: "First provisional payment",
      amount: "45000",
      artifact_id: byFile.get("irp6.txt")!.id,
      confidence: "high",
      reason: "The first payment is shown as paid.",
    },
    {
      key: "provisional_second",
      label: "Second provisional payment",
      amount: "45000",
      artifact_id: byFile.get("irp6.txt")!.id,
      confidence: "low",
      reason: "The second payment is still an estimate.",
    },
    {
      key: "medical_contributions",
      label: "Medical scheme contributions",
      amount: "36000",
      artifact_id: byFile.get("medical-aid.txt")!.id,
      confidence: "high",
      reason: "Twelve months, the member, and two dependants are shown.",
    },
    {
      key: "ra_contributions",
      label: "Retirement annuity contributions",
      amount: "18000",
      artifact_id: byFile.get("ra.txt")!.id,
      confidence: "high",
      reason: "The certificate states the contributions.",
    },
    {
      key: "business_km",
      label: "Business kilometres",
      amount: "6000",
      artifact_id: byFile.get("travel-logbook.txt")!.id,
      confidence: "medium",
      reason: "Opening 10 000 and closing 25 000 are shown.",
    },
    {
      key: "interest",
      label: "Interest",
      amount: "8400",
      artifact_id: byFile.get("it3b.txt")!.id,
      confidence: "high",
      reason: "The certificate states the interest.",
    },
    {
      key: "maintenance",
      label: "Maintenance received",
      amount: "60000",
      artifact_id: byFile.get("maintenance.txt")!.id,
      confidence: "high",
      reason: "Likely exempt.",
    },
  ],
  flags: ["The second provisional payment needs an estimate check.", "Maintenance received is likely exempt."],
  questions: ["Please confirm the grocery line is personal."],
};

const review = reviewTaxSend({
  sendId,
  artifacts,
  model,
  usage: { inputTokens: estimate.inputTokens, outputTokens: estimate.outputTokens },
});
assert(review.skippedForCost === false, "the fixture pack is reviewed");
assert(review.costUsd > 0 && review.costUsd <= TAX_REVIEW_COST_CAP_USD, "the spend is stored under the cap");
assert(review.evidence.kind === "tax_document_review", "one finding kind");
assert(review.evidence.audience === "accountant", "the finding is for the accountant");
assert(review.evidence.draft === true && review.evidence.requires_human_approval === true, "a person still approves it");
const figures = review.evidence.figures as Record<string, Record<string, string>>;
assert(Object.keys(figures).length >= 8, "the review holds the pack figures");
for (const figure of Object.values(figures)) {
  assert(artifacts.some((artifact) => artifact.id === figure.artifact_id), "each figure cites an artifact");
  assert(artifacts.some((artifact) => artifact.fileName === figure.file_name), "each figure cites a file name");
  assert(["high", "medium", "low"].includes(figure.confidence), "each figure has a confidence");
  assert(figure.reason.trim().length > 0, "each figure has a reason");
}
assert(!JSON.stringify(review.evidence).toLowerCase().includes("likely exempt"), "maintenance is not treated as exempt without an order");
assert(
  review.questions.some((question) => question.audience === "accountant" && /order/i.test(question.prompt_text)),
  "the missing order becomes an accountant question",
);
assert(review.questions.every((question) => question.audience === "accountant"), "every question is for the accountant");
assert(!("client_message" in review.evidence), "there is no client text");
assert(findingFigureEntries(review.evidence).length === 0, "owner figure lists do not pick up the review amounts");

const orderText = read("tests/fixtures/tax-specialist/maintenance-order.txt");
const withOrder = reviewTaxSend({
  sendId,
  artifacts: [
    ...artifacts,
    {
      id: "55555555-5555-4555-8555-555555555555",
      fileName: "maintenance-order.txt",
      itemKey: null,
      text: orderText,
    },
  ],
  model: {
    summary: "The order confirms the maintenance.",
    figures: [
      {
        key: "maintenance",
        label: "Maintenance received",
        amount: "60000",
        artifact_id: byFile.get("maintenance.txt")!.id,
        confidence: "high",
        reason: "The divorce order in the files confirms it. Likely exempt.",
      },
    ],
    flags: ["Maintenance received is likely exempt."],
    questions: [],
  },
  usage: { inputTokens: 100, outputTokens: 50 },
});
assert(
  JSON.stringify(withOrder.evidence).toLowerCase().includes("likely exempt"),
  "an order in the files can mark maintenance likely exempt",
);

const maxed = artifacts.map((artifact) => ({ ...artifact, text: "income line ".repeat(2000) }));
const skipped = reviewTaxSend({ sendId, artifacts: maxed, model });
assert(skipped.skippedForCost === true && skipped.costUsd === 0, "a pack over the cap is not sent");
assert(skipped.evidence.kind === "tax_document_review", "the capped pack still records one finding");

const card = taxReviewCardFromFinding({
  id: "66666666-6666-4666-8666-666666666666",
  evidence: review.evidence,
  status: null,
  questions: review.questions.map((question) => question.prompt_text),
});
assert(card?.summary && card.figures.length > 0 && card.questions.length > 0, "the card reads the finding");
assert(
  taxReviewCardFromFinding({
    id: card!.findingId,
    evidence: { ...review.evidence, audience: "owner" },
    status: null,
    questions: [],
  }) === null,
  "an owner audience is not a card",
);

assert(ownerSurfaceForFinding("tax_document_review") === "accountant", "owner needs maps the review to the accountant");
assert(ownerSurfaceForFinding("documents_received") === "hidden", "a documents item is not an owner finding");
assert(
  draftFindingLabel({
    kind: "tax_document_review",
    evidence: review.evidence,
  }) === DRAFT_NEEDS_ACCOUNTANT,
  "the review needs the accountant",
);
assert(
  draftFindingLabel({
    kind: "tax_document_review",
    evidence: review.evidence,
  }) !== DRAFT_NEEDS_OWNER,
  "the review never needs the owner",
);
assert(
  ownerDraftPresentations([
    {
      id: "finding-tax",
      agent: "analyst",
      client_id: clientId,
      kind: "tax_document_review",
      title: "Tax Specialist review",
      detail: review.detail,
      evidence: review.evidence,
      as_of: null,
      created_at: "2026-10-22T12:00:00.000Z",
    },
  ]).length === 0,
  "the review is not an owner draft",
);
const ownerView = ownerNeedsView({
  ownerEmail: null,
  actionsReady: true,
  actionsUnavailable: false,
  actions: [],
  draftsReady: true,
  draftsUnavailable: false,
  draftTitles: [],
  deliverablesReady: true,
  deliverablesUnavailable: false,
  deliverableCount: 0,
  advisoryTitles: [],
  quickBooks: { state: "absent" },
  xero: { state: "absent" },
  when: (iso) => iso,
});
assert(!JSON.stringify(ownerView).includes("Tax Specialist review"), "owner needs does not invent the review");

const owner = draftDecisionAccess({
  kind: "tax_document_review",
  userId,
  ownerUserId: userId,
  firmMember: false,
});
assert(!owner.ok, "the owner cannot approve the review");
const firm = draftDecisionAccess({
  kind: "tax_document_review",
  userId,
  ownerUserId: "other",
  firmMember: true,
});
assert(firm.ok && firm.seat === "firm", "a firm member can approve the review");
assert(
  isDraftFinding({ kind: "tax_document_review", evidence: review.evidence }),
  "the review is a draft until a person decides",
);
const live = liveRecordForDraft({
  kind: "tax_document_review",
  title: "Tax Specialist review",
  detail: review.detail,
  severity: "info",
  clientId,
  userId,
  seat: "firm",
  firmId: "fca0f102-a597-4ec6-8f45-825c57f78797",
  findingId: "66666666-6666-4666-8666-666666666666",
});
assert(!live.ok, "approval does not build a live client row");
const patch = taxReviewApprovalUpdate("66666666-6666-4666-8666-666666666666", userId, "2026-10-22T12:00:00.000Z");
assert(patch.approved_table === "agent_findings", "approval names the finding table");
assert(taxReviewStaysOnFinding("tax_document_review"), "the decision path keeps the review on the finding");
assert(
  defaultDraftRecipient("financial_manager", "tax_document_review") === null,
  "the review is not handed to another bot",
);

const fn = read("supabase/functions/agent-tax-specialist/index.ts");
assert(fn.includes('kind: "tax_document_review"'), "the function writes one review finding");
assert(fn.includes('audience: "accountant"'), "questions are for the accountant");
assert(fn.includes("cost_usd: review.costUsd"), "the run stores the spend");
assert(fn.includes("callClaudeRound"), "the function uses the shared model call");
assert(fn.includes("client_artifacts"), "the function reads stored files");
assert(!fn.includes("deliverable_drafts"), "the function does not write a deliverable");
assert(!/\b(resend|xero|quickbooks|sage|sample-compute)\b/i.test(fn), "the function does not mail or post a ledger");
const decision = read("supabase/functions/agent-draft-decision/index.ts");
assert(decision.includes("taxReviewStaysOnFinding"), "approve uses the finding path");
assert(!decision.includes('from("deliverable_drafts")'), "approve does not insert a deliverable");
const cardSource = read("src/components/tax-specialist-review-card.tsx");
const panel = read("src/components/send-agent-panel.tsx");
for (const needle of ["IRP6", "ITR14", "South Africa", "ZAR", "rand ", "flex-row", "toLocaleDateString"]) {
  assert(!cardSource.includes(needle), `the card does not contain ${needle}`);
  assert(!panel.includes(needle), `the panel does not contain ${needle}`);
}
assert(!read("src/routes/a.$token.tsx").includes("tax-specialist-review"), "the public page does not import the review");
assert(read("src/lib/agent-draft.ts").includes('"tax_document_review"'), "a person approves this kind");
const migration = read("supabase/migrations/20261022230000_agent_tax_review_approval.sql").toLowerCase();
assert(migration.includes("'agent_findings'"), "approval may stay on the finding");
assert(!migration.includes("deliverable_drafts") || migration.includes("'deliverable_drafts'"), "the check still names the old tables");

console.log("tax specialist review test ok");
