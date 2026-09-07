/**
 * Client Brain Summary slice — schema + tab wiring, no AI propose.
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
} from "../src/lib/client-brain-questions";
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
assert(!clientSrc.includes("proposeBrain"), "no AI propose hook in portal");
assert(!panelSrc.includes("anthropic"), "panel does not call Claude");
assert(!panelSrc.includes("ask-ai"), "panel does not generate via Ask AI");
assert(panelSrc.includes("Mini GAP report"), "GAP section");
assert(panelSrc.includes("Competitors"), "competitors section");
assert(panelSrc.includes("10 initial questions"), "10-Q status");
assert(panelSrc.includes("Product line questions"), "product-line section");
assert(panelSrc.includes("Business map"), "business-map stubs");
assert(panelSrc.includes("Outstanding questions"), "shared questions queue");
assert(!panelSrc.includes("Acme Corp"), "no fake competitor filler");
assert(!panelSrc.includes("example.com"), "no fake placeholder URLs");

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

console.log("client-brain-summary-test: all assertions passed");
