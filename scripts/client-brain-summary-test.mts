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
  serializeAssumptionChecklist,
} from "../src/lib/client-brain";

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
assert(!migration.includes("client_brain_summaries"), "no separate summaries table");
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
assert(migration.includes("ENABLE ROW LEVEL SECURITY"), "RLS enabled");
assert(migration.includes("has_client_access"), "client-scoped RLS");
assert(migration.includes("CHECK (status IN ('proposed', 'approved', 'edited', 'rejected'))"), "step statuses");
assert(migration.includes("CHECK (status IN ('draft', 'ready', 'sent', 'discarded'))"), "draft statuses");

assert(typesSrc.includes("client_artifacts:"), "types include client_artifacts");
assert(typesSrc.includes("context_facts:"), "types include context_facts");
assert(typesSrc.includes("proposed_next_steps:"), "types include proposed_next_steps");
assert(typesSrc.includes("deliverable_drafts:"), "types include deliverable_drafts");
assert(typesSrc.includes("brain_summary: Json | null"), "types include brain_summary");

assert(clientSrc.includes('"summary"'), "summary is an ActiveTab");
assert(clientSrc.includes('{ id: "summary", label: "Summary" }'), "Summary tab in strip");
assert(clientSrc.includes('id="pane-summary"'), "Summary pane exists");
assert(clientSrc.includes("ClientBrainSummary"), "panel is mounted");
assert(clientSrc.includes('from "@/components/client-brain-summary"'), "panel imported");
assert(!clientSrc.includes("proposeBrain"), "no AI propose hook in portal");
assert(!panelSrc.includes("anthropic"), "panel does not call Claude");
assert(!panelSrc.includes("ask-ai"), "panel does not generate via Ask AI");

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

console.log("client-brain-summary-test: all assertions passed");
