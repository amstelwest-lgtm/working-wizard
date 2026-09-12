/**
 * Client Brain Summary slice — propose, deliverable drafts + sign-off, slow drip.
 * Run: pnpm test:client-brain
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  artifactKindLabel,
  buildNextStepEditDiff,
  isMissingBrainRelation,
  parseAssumptionChecklist,
  parseBrainSummary,
  parseBusinessMap,
  parseCompetitors,
  parseGapReport,
  serializeAssumptionChecklist,
} from "../src/lib/client-brain";
import {
  mergeOutstandingQuestions,
  operatingProfileQuestionStates,
  productLineQuestionStates,
  activeOwnerDrip,
  pickNextOwnerDrip,
  buildOwnerDripCandidates,
  DRIP_COOLDOWN_DAYS,
} from "../src/lib/client-brain-questions";
import {
  applyDraftBrainPatches,
  filterNewProposedSteps,
  parseClaudeProposePayload,
  titlesSimilar,
} from "../src/lib/client-brain-propose";
import {
  assumptionsFromUnknown,
  bodiesSimilar,
  bodyWithAssumptionFooter,
  canDiscard,
  canMarkReady,
  canSend,
  composeDraftBody,
  filterNewDeliverableDraft,
  kindToDelivery,
  parseClaudeDeliverablePayload,
  parseDraftSubjectBody,
} from "../src/lib/client-brain-deliverable";
import { assertBrainDeliverableResponse } from "../src/lib/brain-deliverable-client";
import { emptyProductMix } from "../src/lib/product-mix";
import { emptyWeeklyInputs } from "../src/lib/weekly-inputs";
import type { ClientOperatingProfile } from "../src/lib/client-profile";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const migration = readFileSync(
  resolve("supabase/migrations/20260907140000_client_brain.sql"),
  "utf8",
);
const brainSummaryRls = readFileSync(
  resolve("supabase/migrations/20260910180000_clients_brain_summary_access.sql"),
  "utf8",
);
const typesSrc = readFileSync(resolve("src/integrations/supabase/types.ts"), "utf8");
const clientSrc = readFileSync(
  resolve("src/routes/_authenticated/clients.$clientId.tsx"),
  "utf8",
);
const panelSrc = readFileSync(resolve("src/components/client-brain-summary.tsx"), "utf8");

assert(migration.includes("brain_summary jsonb"), "clients.brain_summary column");
assert(
  migration.includes("brain_summary_updated_at timestamptz"),
  "clients.brain_summary_updated_at column",
);
assert(
  !/create table[\s\S]{0,40}client_brain_summaries/i.test(migration),
  "no separate summaries table",
);
assert(migration.includes("CREATE TABLE IF NOT EXISTS public.client_artifacts"), "artifacts table");
assert(migration.includes("CREATE TABLE IF NOT EXISTS public.context_facts"), "facts table");
assert(
  migration.includes("CREATE TABLE IF NOT EXISTS public.proposed_next_steps"),
  "next steps table",
);
assert(
  migration.includes("CREATE TABLE IF NOT EXISTS public.deliverable_drafts"),
  "drafts table",
);
assert(
  migration.includes("CREATE TABLE IF NOT EXISTS public.client_brain_questions"),
  "brain questions table",
);
assert(migration.includes("CHECK (status IN ('unanswered', 'answered', 'skipped'))"), "question statuses");
assert(migration.includes("CHECK (audience IN ('owner', 'accountant', 'both'))"), "question audience");
assert(migration.includes("ENABLE ROW LEVEL SECURITY"), "RLS enabled");
assert(migration.includes("has_client_access"), "client-scoped RLS");
assert(
  brainSummaryRls.includes('"clients update brain summary by access"'),
  "brain_summary narrow UPDATE policy",
);
assert(
  brainSummaryRls.includes("has_client_access(auth.uid(), id)"),
  "brain_summary policy uses has_client_access",
);
assert(
  brainSummaryRls.includes("limited to brain_summary"),
  "non-writer trigger guards non-brain columns",
);
assert(migration.includes("CHECK (status IN ('proposed', 'approved', 'edited', 'rejected'))"), "step statuses");
assert(migration.includes("CHECK (status IN ('draft', 'ready', 'sent', 'discarded'))"), "draft statuses");

assert(typesSrc.includes("client_artifacts:"), "types include client_artifacts");
assert(typesSrc.includes("context_facts:"), "types include context_facts");
assert(typesSrc.includes("proposed_next_steps:"), "types include proposed_next_steps");
assert(typesSrc.includes("deliverable_drafts:"), "types include deliverable_drafts");
assert(typesSrc.includes("client_brain_questions:"), "types include client_brain_questions");
assert(typesSrc.includes("brain_summary: Json | null"), "types include brain_summary");

assert(clientSrc.includes('"summary"'), "summary is an ActiveTab");
assert(clientSrc.includes('{ id: "summary", label: "Summary" }'), "Summary tab in strip");
assert(clientSrc.includes('id="pane-summary"'), "Summary pane exists");
assert(clientSrc.includes("ClientBrainSummary"), "panel is mounted");
assert(clientSrc.includes('from "@/components/client-brain-summary"'), "panel imported");
assert(!clientSrc.includes("proposeBrain"), "propose is not wired in the fat portal");
assert(!clientSrc.includes("brain-propose"), "propose fetch lives in the Summary panel");
assert(!clientSrc.includes("Propose from brain"), "Propose trigger is on the Summary panel");
assert(!clientSrc.includes("Draft advisory from brain"), "Draft advisory trigger is on the Summary panel");
assert(!clientSrc.includes("brain-deliverable-draft"), "deliverable draft fetch lives in Summary");
assert(!panelSrc.includes("anthropic"), "panel does not call Claude directly");
assert(!panelSrc.includes("ask-ai"), "panel does not generate via Ask AI chat");
assert(panelSrc.includes("Propose from brain"), "Propose from brain trigger");
assert(panelSrc.includes("Draft advisory from brain"), "Draft advisory from brain trigger");
assert(panelSrc.includes("invokeBrainPropose"), "panel invokes brain-propose");
assert(panelSrc.includes("invokeBrainDeliverableDraft"), "panel invokes brain-deliverable-draft");
assert(panelSrc.includes("ClientBrainDrafts"), "drafts panel is extracted");
assert(panelSrc.includes("Asking now"), "drip highlight on outstanding queue");
assert(panelSrc.includes("Sign off"), "GAP/competitor drafts can be signed off");
assert(
  panelSrc.includes('.select("id")') && panelSrc.includes("Could not save brain summary"),
  "0-row brain_summary update surfaces as failure",
);
assert(panelSrc.includes("Mini GAP report"), "GAP section");
assert(panelSrc.includes("Competitors"), "competitors section");
assert(panelSrc.includes("10 initial questions"), "10-Q status");
assert(panelSrc.includes("Product line questions"), "product-line section");
assert(panelSrc.includes("Business map"), "business-map stubs");
assert(panelSrc.includes("Outstanding questions"), "shared questions queue");
assert(panelSrc.includes("onAnswerProfile"), "empty profile questions can open the funnel");
assert(panelSrc.includes("Answer"), "empty questions expose an Answer control");
assert(panelSrc.includes("brain-fill-answer"), "stored / map questions can be filled in-place");
assert(!panelSrc.includes("Acme Corp"), "no fake competitor filler");
assert(!panelSrc.includes("example.com"), "no fake placeholder URLs");

let stubErr: Error | null = null;
try {
  assertBrainDeliverableResponse({ smoke: "smoke-bdd" });
} catch (e) {
  stubErr = e as Error;
}
assert(Boolean(stubErr?.message.includes("smoke stub")), "smoke-bdd stub is rejected");

let emptyErr: Error | null = null;
try {
  assertBrainDeliverableResponse({});
} catch (e) {
  emptyErr = e as Error;
}
assert(Boolean(emptyErr?.message.includes("unexpected response")), "empty 200 body is rejected");

assertBrainDeliverableResponse({ draftInserted: false, skippedReason: "ai_not_configured" });
assertBrainDeliverableResponse({ draftInserted: true });

assert(parseBrainSummary(null) === null, "empty summary");
assert(parseBrainSummary("  hello  ")?.body === "hello", "string summary");
const blob = parseBrainSummary({ headline: "H", summary: "S", bullets: ["a", 1, "b"] });
assert(blob?.headline === "H" && blob.body === "S" && blob.bullets?.join(",") === "a,b", "object summary");

const items = parseAssumptionChecklist([{ text: "Cash is tight", checked: true }, "Need VAT review"]);
assert(items.length === 2 && items[0].checked && items[1].text === "Need VAT review", "checklist parse");
assert(
  JSON.stringify(serializeAssumptionChecklist(items)).includes("Cash is tight"),
  "checklist serialize",
);

const diff = buildNextStepEditDiff(
  { title: "Call the bank", rationale: "Runway" },
  { title: "Call the bank this week", rationale: "Runway" },
);
assert(diff.title?.from === "Call the bank" && !diff.rationale, "edit diff only changed fields");
assert(artifactKindLabel("financial_snapshot") === "Financial snapshot", "kind label");
assert(isMissingBrainRelation({ code: "42P01" }), "missing relation helper");
assert(!isMissingBrainRelation({ code: "42501", message: "permission denied" }), "other errors stay");

assert(parseGapReport({ gap_report: { items: [] } }) === null, "empty gap report is empty");
assert(parseGapReport({ gap_report: { items: [{ title: "Cash squeeze", severity: "high" }] } })?.items[0].title === "Cash squeeze", "gap item");
assert(parseCompetitors({ competitors: [] }).length === 0, "empty competitors");
assert(parseCompetitors({ competitors: [{ name: "Rival Co", threat: "price" }] })[0].name === "Rival Co", "competitor row");
assert(!parseBusinessMap({}).customers_channels, "empty business map");
assert(parseBusinessMap({ business_map: { team_size: "  12  " } }).team_size === "12", "business map field");

const coreProfile = {
  version: 1,
  payMotion: "goods",
  volumeUnit: "units_sku",
  templateId: "retail_units",
  secondaryVolumeUnits: [],
  debtorDaysDefault: 0,
  costShape: "variable",
  seasonality: "flat",
  inventoryIntensity: "heavy",
  customerConcentration: "moderate",
  debtPosition: "light",
  ownerGoal: "survive_cash",
  primaryPressure: "cash",
  fyStartMonth: 3,
  businessTypeId: "retail",
  depth: "core",
  confirmedAt: "2026-01-01T00:00:00.000Z",
} as ClientOperatingProfile;

const coreQs = operatingProfileQuestionStates(coreProfile);
assert(coreQs.length === 10, "10 profile questions");
assert(coreQs.filter((q) => q.answered).length === 4, "core depth answers only the four");
assert(
  coreQs.find((q) => q.key === "operating_profile.seasonality")?.answered === false,
  "core seasonality stays empty — do not invent inferred defaults",
);
assert(operatingProfileQuestionStates(null).every((q) => !q.answered), "no profile → all empty");

const fullQs = operatingProfileQuestionStates({ ...coreProfile, depth: "full" });
assert(fullQs.every((q) => q.answered), "full profile answers all ten");

const mixQs = productLineQuestionStates(emptyProductMix(), emptyWeeklyInputs());
assert(mixQs.every((q) => !q.answered), "empty mix/weekly stay empty");
assert(
  mergeOutstandingQuestions([...coreQs, ...mixQs], []).some((q) => q.key === "operating_profile.costShape"),
  "outstanding includes unanswered deferred 10-Q",
);

assert(titlesSimilar("Call the bank this week", "Call the bank"), "similar titles skip duplicates");
assert(!titlesSimilar("Renegotiate suppliers", "Call the bank"), "unrelated titles are not similar");
assert(
  filterNewProposedSteps(
    [{ title: "Call the bank", rationale: null, assumptions: [] }],
    [{ title: "Call the bank this week", status: "proposed" }],
  ).length === 0,
  "skip insert when a similar open proposed step exists",
);
assert(
  filterNewProposedSteps(
    [{ title: "Tighten debtor follow-up", rationale: "Days are high", assumptions: [] }],
    [{ title: "Call the bank", status: "proposed" }],
  ).length === 1,
  "distinct titles still insert",
);
assert(
  filterNewProposedSteps(
    [
      { title: "A", rationale: null, assumptions: [] },
      { title: "B", rationale: null, assumptions: [] },
    ],
    [
      { title: "1", status: "proposed" },
      { title: "2", status: "proposed" },
      { title: "3", status: "proposed" },
      { title: "4", status: "proposed" },
      { title: "5", status: "proposed" },
    ],
  ).length === 0,
  "do not flood when five open proposed steps exist",
);

const sneaky = parseClaudeProposePayload(
  '```json\n{"next_steps":[{"title":"Collect faster"}],"gap_items":[{"title":"Cash gap","status":"signed_off"}],"competitors":[{"name":"Rival","status":"signed_off"}]}\n```',
);
assert(sneaky.next_steps[0].title === "Collect faster", "parse fenced JSON");
assert(sneaky.gap_items[0].status === undefined, "strip model signed_off from GAP");
assert(sneaky.competitors[0].status === undefined, "strip model signed_off from competitors");

const patched = applyDraftBrainPatches(
  { gap_report: { items: [{ key: "cash-gap", title: "Cash gap", status: "signed_off" }] } },
  {
    gap_items: [
      { title: "Cash gap", status: "draft" },
      { key: "margin", title: "Margin squeeze", detail: "Gross margin slipped" },
    ],
    competitors: [{ name: "Rival Co", notes: "Price" }],
  },
  "2026-09-07T00:00:00.000Z",
);
assert(patched.gapAdded === 1, "only the new GAP item is added");
const gapItems = (patched.blob.gap_report as { items: Array<{ key: string; status?: string }> }).items;
assert(
  gapItems.find((i) => i.key === "cash-gap")?.status === "signed_off",
  "never overwrite a signed-off GAP item",
);
assert(
  gapItems.find((i) => i.key === "margin")?.status === "draft",
  "Claude GAP stubs are draft",
);
assert(
  (patched.blob.competitors as Array<{ status?: string }>)[0].status === "draft",
  "Claude competitor stubs are draft",
);

const now = new Date("2026-09-07T12:00:00.000Z");
const dripCandidates = buildOwnerDripCandidates(
  [{ key: "operating_profile.costShape", prompt: "Cost base?", audience: "both", answered: false, answer: null, source: "operating_profile" }],
  [
    {
      id: "q1",
      client_id: "c1",
      question_key: "operating_profile.costShape",
      prompt_text: "Cost base?",
      status: "unanswered",
      audience: "both",
      answer_text: null,
      answer_json: null,
      last_asked_at: "2026-09-01T12:00:00.000Z",
      answered_at: null,
      answered_by: null,
      created_at: "2026-08-01T00:00:00.000Z",
      updated_at: "2026-09-01T12:00:00.000Z",
    },
  ],
);
assert(activeOwnerDrip(dripCandidates, now, DRIP_COOLDOWN_DAYS)?.key === "operating_profile.costShape", "recent ask is the active drip");
assert(pickNextOwnerDrip(dripCandidates, now, DRIP_COOLDOWN_DAYS) === null, "do not pick a second drip while one is active");
const cooled = buildOwnerDripCandidates(
  [{ key: "operating_profile.costShape", prompt: "Cost base?", audience: "both", answered: false, answer: null, source: "operating_profile" }],
  [],
);
assert(pickNextOwnerDrip(cooled, now)?.key === "operating_profile.costShape", "never-asked key can drip once");

const sneakyDraft = parseClaudeDeliverablePayload(
  '```json\n{"kind":"client_email","subject":"Cash this month","body":"Collect faster.","assumptions":["Debtor days stay high"],"status":"sent"}\n```',
);
assert(sneakyDraft?.kind === "client_email", "parse fenced deliverable JSON");
assert(sneakyDraft?.subject === "Cash this month", "keep subject");
assert(sneakyDraft?.body === "Collect faster.", "keep body");
assert(sneakyDraft?.assumptions.length === 1 && sneakyDraft.assumptions[0].checked === false, "assumptions start unchecked");
assert(parseClaudeDeliverablePayload('{"kind":"advisory","assumptions":["invented"]}') === null, "empty body is not a draft");
assert(assumptionsFromUnknown([]).length === 0, "missing assumptions stay empty");
assert(assumptionsFromUnknown(null).length === 0, "null assumptions stay empty");
assert(composeDraftBody("Hi", "Body").startsWith("SUBJECT: Hi"), "compose subject prefix");
assert(parseDraftSubjectBody("SUBJECT: Hi\n\nBody").subject === "Hi", "split subject from body");
assert(kindToDelivery("meeting_agenda") === "meeting_agenda", "agenda maps to delivery kind");
assert(kindToDelivery("client_email") === "advisory_draft", "email maps to advisory_draft");
assert(canMarkReady("draft") && !canMarkReady("ready"), "mark ready only from draft");
assert(canSend("ready") && !canSend("draft") && !canSend("sent"), "send only from ready");
assert(canDiscard("draft") && canDiscard("ready") && !canDiscard("sent"), "cannot discard after send");
assert(bodiesSimilar("Collect the debtors this week", "Collect the debtors"), "similar bodies skip duplicates");
assert(
  filterNewDeliverableDraft(
    { kind: "advisory", subject: null, body: "Collect faster this week", assumptions: [] },
    [{ kind: "advisory", body: "SUBJECT: x\n\nCollect faster", status: "draft" }],
  ) === null,
  "skip insert when a similar open draft exists",
);
assert(
  filterNewDeliverableDraft(
    { kind: "advisory", subject: null, body: "Renegotiate suppliers", assumptions: [] },
    [{ kind: "advisory", body: "Collect faster", status: "draft" }],
  )?.body === "Renegotiate suppliers",
  "distinct draft bodies still insert",
);
assert(
  filterNewDeliverableDraft(
    { kind: "advisory", subject: null, body: "A new pack", assumptions: [] },
    [
      { kind: "advisory", body: "one", status: "draft" },
      { kind: "advisory", body: "two", status: "ready" },
      { kind: "advisory", body: "three", status: "draft" },
    ],
  ) === null,
  "do not flood when three open drafts exist",
);
assert(
  filterNewDeliverableDraft(
    { kind: "advisory", subject: null, body: "A new pack", assumptions: [] },
    [{ kind: "advisory", body: "old", status: "sent" }],
  )?.body === "A new pack",
  "sent drafts do not block a new pack",
);
assert(
  bodyWithAssumptionFooter("Hello", [{ id: "a-0", text: "Cash is tight", checked: true }]).includes("[x] Cash is tight"),
  "ledger footer includes ticked assumptions",
);

const fnSrc = readFileSync(resolve("supabase/functions/brain-propose/index.ts"), "utf8");
const logicSrc = readFileSync(resolve("supabase/functions/brain-propose/logic.ts"), "utf8");
const appSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(fnSrc.includes('from "../ask-ai/anthropic.ts"'), "reuses ask-ai Claude wrapper");
assert(fnSrc.includes("ask_ai_record_request"), "reuses ask-ai rate limit");
assert(fnSrc.includes("has_client_access"), "same access check as ask-ai");
assert(fnSrc.includes('.select("id")'), "brain_summary update checks row count");
assert(fnSrc.includes("Could not save brain summary"), "0-row brain_summary update returns 403");
assert(fnSrc.includes('status: "proposed"'), "inserts proposed_next_steps as proposed");
assert(fnSrc.includes("last_asked_at"), "drip stamps last_asked_at");
assert(logicSrc.includes('status: "draft"'), "GAP/competitor merges force draft");
assert(!fnSrc.includes('status: "signed_off"'), "edge function never writes signed_off");
assert(!fnSrc.toLowerCase().includes("stripe"), "no Stripe");
assert(!panelSrc.toLowerCase().includes("stripe"), "panel has no Stripe");
assert(!clientSrc.toLowerCase().includes("stripe"), "portal has no Stripe");
assert(appSrc.includes("OwnerBrainDrip"), "owner-facing drip shell");
assert(appSrc.includes('id="ask-ai-overview"'), "owner Ask AI mount unchanged");

const draftFnSrc = readFileSync(resolve("supabase/functions/brain-deliverable-draft/index.ts"), "utf8");
const draftPanelSrc = readFileSync(resolve("src/components/client-brain-drafts.tsx"), "utf8");
const configSrc = readFileSync(resolve("supabase/config.toml"), "utf8");
assert(draftFnSrc.includes("@supabase/supabase-js@2.49.1"), "deliverable fn pins createClient for deploy");
assert(draftFnSrc.includes("callClaude"), "deliverable fn inlines Claude draft");
assert(draftFnSrc.includes("ask_ai_record_request"), "deliverable fn reuses ask-ai rate limit");
assert(draftFnSrc.includes("has_client_access"), "deliverable fn uses same access check");
assert(draftFnSrc.includes('status: "draft"'), "inserts deliverable_drafts as draft");
assert(draftFnSrc.includes("draftInserted"), "returns draftInserted contract");
assert(draftFnSrc.includes("assumption_checklist"), "writes explicit assumptions list");
assert(!draftFnSrc.includes('status: "sent"'), "edge function never writes sent");
assert(!draftFnSrc.includes('status: "ready"'), "edge function never writes ready");
assert(!draftFnSrc.toLowerCase().includes("stripe"), "deliverable fn has no Stripe");
assert(draftFnSrc.includes("bodiesSimilar"), "idempotent similar-open skip inlined");
assert(!draftFnSrc.includes('from "./logic.ts"'), "deploy bundle is self-contained");
assert(configSrc.includes("[functions.brain-deliverable-draft]"), "function is registered");
assert(draftPanelSrc.includes("Mark ready"), "accountant can mark ready");
assert(draftPanelSrc.includes("Discard"), "accountant can discard");
assert(draftPanelSrc.includes("Sign off and log"), "accountant can promote to deliveries");
assert(draftPanelSrc.includes("recordDelivery"), "reuses advisory ledger");
assert(draftPanelSrc.includes('status: "sent"'), "send sets status sent");
assert(draftPanelSrc.includes("advisory_delivery_id"), "send links advisory_delivery_id");
assert(!draftPanelSrc.includes("clients.$clientId"), "does not rewrite the fat portal");
assert(!appSrc.toLowerCase().includes("deliverable_drafts"), "owner app is not a drafts workspace");

console.log("client-brain-summary-test: all assertions passed");
