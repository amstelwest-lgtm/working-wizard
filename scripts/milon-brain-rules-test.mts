/**
 * Milōn brain rules: capture shape, retrieval filter, hook smoke source checks.
 * Run: pnpm test:milon-brain-rules
 */
import { readFileSync } from "node:fs";
import {
  appliedBrainRulesLine,
  brainRuleTaskTypesForRunner,
  dedupeMilonBrainRules,
  filterMilonBrainRulesForPrompt,
  formatMilonBrainRulesPromptBlock,
  milonBrainRuleInsert,
  milonBrainRuleRemember,
  milonBrainRuleText,
  milonBrainRulesPromptBlockFromRows,
  MILON_BRAIN_RULE_TEXT_MAX,
  MILON_BRAIN_RULES_FENCE_CLOSE,
  MILON_BRAIN_RULES_FENCE_OPEN,
  MILON_BRAIN_RULES_PROMPT_LABEL,
  MILON_BRAIN_SOURCE_AGENT_DRAFT,
  MILON_BRAIN_SOURCE_REMEMBER,
  MILON_BRAIN_RULES_UNTRUSTED_INSTRUCTION,
  withAppliedBrainRules,
} from "../src/lib/milon-brain-rules.ts";
import { FM_DRAFT_KINDS } from "../src/lib/agent-financial-manager.ts";
import { ADVISOR_DRAFT_KINDS } from "../src/lib/agent-advisor.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const firmA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const firmB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const clientA = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const clientB = "dddddddd-dddd-dddd-dddd-dddddddddddd";
const user = "11111111-1111-1111-1111-111111111111";
const finding = "33333333-3333-3333-3333-333333333333";

const approvedRow = milonBrainRuleInsert({
  firmId: firmA,
  clientId: clientA,
  taskType: "action_point_draft",
  findingId: finding,
  decision: "approved",
  title: "Collect overdue debtor follow-up",
  detail: "Email the top three debtors this week.",
  approverId: user,
});
assert(approvedRow.firm_id === firmA, "insert carries firm_id");
assert(approvedRow.client_id === clientA, "insert carries client_id");
assert(approvedRow.task_type === "action_point_draft", "task_type is the finding kind");
assert(approvedRow.decision === "approved", "decision is approved");
assert(approvedRow.source_event === MILON_BRAIN_SOURCE_AGENT_DRAFT, "source_event is agent_draft_decision");
assert(approvedRow.source_row_id === finding, "source_row_id is the finding");
assert(approvedRow.approver_id === user, "approver_id is set");
assert(approvedRow.layer === "private" && approvedRow.status === "active", "layer private and status active");

const remember = milonBrainRuleRemember({
  firmId: firmA,
  clientId: clientA,
  taskType: "action_point_draft",
  findingId: finding,
  ruleText: "Always cite the cash figure.",
  approverId: user,
});
assert(remember.source_event === MILON_BRAIN_SOURCE_REMEMBER, "remember source_event");
assert(remember.decision === "corrected", "remember decision is corrected");

const dismissed = milonBrainRuleInsert({
  firmId: firmA,
  clientId: clientA,
  taskType: "data_request_draft",
  findingId: finding,
  decision: "dismissed",
  title: "Request bank statements",
  approverId: user,
  dismissedReason: "dismissed by user",
});
assert(dismissed.decision === "dismissed", "dismissed decision");
assert(dismissed.rule_text.includes("dismissed by user"), "dismiss includes reason");

const longTitle = "x".repeat(600);
const clipped = milonBrainRuleText({ decision: "approved", title: longTitle });
assert(clipped.length <= MILON_BRAIN_RULE_TEXT_MAX, "rule_text is capped");

const rows = [
  { ...approvedRow, id: "1", created_at: "2026-11-09T12:00:00Z" },
  {
    ...approvedRow,
    id: "2",
    created_at: "2026-11-09T11:00:00Z",
    rule_text: approvedRow.rule_text,
  },
  {
    ...approvedRow,
    firm_id: firmB,
    id: "3",
    created_at: "2026-11-09T10:00:00Z",
    rule_text: "Other firm rule",
  },
  {
    ...approvedRow,
    client_id: clientB,
    id: "4",
    rule_text: "Wrong client",
  },
  {
    ...approvedRow,
    id: "5",
    status: "retired",
    rule_text: "Retired rule",
  },
];

const forA = filterMilonBrainRulesForPrompt(rows, {
  firmId: firmA,
  clientId: clientA,
  taskTypes: FM_DRAFT_KINDS,
});
assert(forA.every((r) => r.firm_id === firmA), "firm A filter drops firm B");
assert(!forA.some((r) => r.client_id === clientB), "client-scoped rules from another client are dropped");
assert(!forA.some((r) => r.status === "retired"), "retired rules are not injected");
assert(forA.length === 2, "same-firm client rules stay");

const deduped = dedupeMilonBrainRules(forA);
assert(deduped.length === 1, "duplicate rule_text dedupes");

const block = milonBrainRulesPromptBlockFromRows(rows, {
  firmId: firmA,
  clientId: clientA,
  taskTypes: FM_DRAFT_KINDS,
});
assert(block.includes(MILON_BRAIN_RULES_PROMPT_LABEL), "block uses stable label");
assert(block.includes(MILON_BRAIN_RULES_FENCE_OPEN) && block.includes(MILON_BRAIN_RULES_FENCE_CLOSE), "block is fenced");
assert(block.includes(MILON_BRAIN_RULES_UNTRUSTED_INSTRUCTION), "block warns the model");
assert(formatMilonBrainRulesPromptBlock([]) === "", "empty table is no-op");

assert(brainRuleTaskTypesForRunner("financial_manager").some((t) => FM_DRAFT_KINDS.includes(t as (typeof FM_DRAFT_KINDS)[number])), "FM runner task types");
assert(brainRuleTaskTypesForRunner("advisor").some((t) => ADVISOR_DRAFT_KINDS.includes(t as (typeof ADVISOR_DRAFT_KINDS)[number])), "advisor runner task types");
assert(brainRuleTaskTypesForRunner("analyst").includes("data_request_draft"), "analyst runner task types");

const evidence = withAppliedBrainRules({ draft: true }, ["Approved: tone", "Dismissed: pack"]);
const line = appliedBrainRulesLine(evidence);
assert(line?.includes("Applied rules:") && line.includes("tone"), "applied rules line for accountant UI");

const appliedUi = read("src/components/applied-brain-rules-line.tsx");
assert(appliedUi.includes('audience !== "accountant"'), "owners never see applied rules");

const migration = read("supabase/migrations/20261109180000_milon_brain_rules.sql");
assert(migration.includes("milon_brain_rules"), "migration creates milon_brain_rules");
assert(migration.includes("is_firm_member"), "RLS uses firm membership");
assert(migration.includes("milon_brain_rules_firm_select"), "select policy exists");
assert(!migration.includes("management_habit_rule"), "does not reuse habit rules");
assert(!migration.includes("client_artifacts"), "does not reuse client_artifacts");

const edge = read("supabase/functions/agent-draft-decision/index.ts");
assert(edge.includes("captureRememberedBrainRule"), "remember opt-in captures one row");
assert(edge.includes("remember_this"), "approve body accepts remember_this");
assert(!edge.includes("captureMilonBrainRule"), "approve/dismiss no longer auto-capture every decision");
assert(edge.includes("milon_brain_rules"), "capture inserts milon_brain_rules");
assert(edge.includes("milon_brain_rule_capture_failed"), "insert failure is logged");
const captureBody = edge.slice(edge.indexOf("async function captureRememberedBrainRule"), edge.indexOf("async function reread"));
assert(captureBody.includes("try {") && captureBody.includes("catch"), "capture never fails the user's action");

const shared = read("supabase/functions/_shared/agent-shared-reads.ts");
assert(shared.includes("loadMilonBrainRulesForPrompt"), "shared reads loader exists");
assert(shared.includes("ruleSummaries"), "shared reads return summaries for findings");
assert(shared.includes("applyRedaction"), "rules are redacted before the model");

const job = read("supabase/functions/_shared/agent-core/job.ts");
assert(job.includes("loadMilonBrainRulesForPrompt"), "FM/advisor job loads brain rules");
assert(job.includes("brainRuleTaskTypesForRunner(config.agent)"), "runner picks task types by agent");
assert(job.includes("appliedBrainRuleSummaries"), "findings record applied rule summaries");

const analyst = read("supabase/functions/agent-analyst/run.ts");
assert(analyst.includes('brainRuleTaskTypesForRunner("analyst")'), "analyst run loads brain rules");
assert(analyst.includes("appliedBrainRuleSummaries"), "analyst findings carry summaries");

const pane = read("src/components/milon-team/milon-team-pane.tsx");
assert(pane.includes('section="rules"') && pane.includes("AgentBotRulesPanel"), "client bots expose Rules tab");

const setup = read("src/routes/_authenticated/practice_.setup.tsx");
assert(setup.includes('tab="implementation_manager"'), "practice setup exposes IM rules");

console.log("milon-brain-rules: ok");