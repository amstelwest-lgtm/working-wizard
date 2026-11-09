/**
 * Milōn brain rules: capture shape, retrieval filter, hook smoke source checks.
 * Run: pnpm test:milon-brain-rules
 */
import { readFileSync } from "node:fs";
import {
  dedupeMilonBrainRules,
  filterMilonBrainRulesForPrompt,
  formatMilonBrainRulesPromptBlock,
  milonBrainRuleInsert,
  milonBrainRuleText,
  milonBrainRulesPromptBlockFromRows,
  MILON_BRAIN_RULE_TEXT_MAX,
  MILON_BRAIN_RULES_PROMPT_LABEL,
  MILON_BRAIN_SOURCE_AGENT_DRAFT,
} from "../src/lib/milon-brain-rules.ts";
import { FM_DRAFT_KINDS } from "../src/lib/agent-financial-manager.ts";

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
];

const forA = filterMilonBrainRulesForPrompt(rows, {
  firmId: firmA,
  clientId: clientA,
  taskTypes: FM_DRAFT_KINDS,
});
assert(forA.every((r) => r.firm_id === firmA), "firm A filter drops firm B");
assert(!forA.some((r) => r.client_id === clientB), "client-scoped rules from another client are dropped");
assert(forA.length === 2, "same-firm client rules stay");

const deduped = dedupeMilonBrainRules(forA);
assert(deduped.length === 1, "duplicate rule_text dedupes");

const block = milonBrainRulesPromptBlockFromRows(rows, {
  firmId: firmA,
  clientId: clientA,
  taskTypes: FM_DRAFT_KINDS,
});
assert(block.includes(MILON_BRAIN_RULES_PROMPT_LABEL), "block uses stable label");
assert(formatMilonBrainRulesPromptBlock([]) === "", "empty table is no-op");

const migration = read("supabase/migrations/20261109180000_milon_brain_rules.sql");
assert(migration.includes("milon_brain_rules"), "migration creates milon_brain_rules");
assert(migration.includes("is_firm_member"), "RLS uses firm membership");
assert(migration.includes("milon_brain_rules_firm_select"), "select policy exists");
assert(!migration.includes("management_habit_rule"), "does not reuse habit rules");
assert(!migration.includes("client_artifacts"), "does not reuse client_artifacts");

const edge = read("supabase/functions/agent-draft-decision/index.ts");
assert(edge.includes("captureMilonBrainRule"), "approve/dismiss calls capture");
assert(edge.includes('milon_brain_rules'), "capture inserts milon_brain_rules");
assert(edge.includes("milon_brain_rule_capture_failed"), "insert failure is logged");
const captureBody = edge.slice(edge.indexOf("async function captureMilonBrainRule"), edge.indexOf("async function reread"));
assert(captureBody.includes("try {") && captureBody.includes("catch"), "capture never fails the user's action");

const shared = read("supabase/functions/_shared/agent-shared-reads.ts");
assert(shared.includes("loadMilonBrainRulesPromptBlock"), "shared reads loader exists");
assert(shared.includes("applyRedaction"), "rules are redacted before the model");

const job = read("supabase/functions/_shared/agent-core/job.ts");
assert(job.includes("loadMilonBrainRulesPromptBlock"), "FM job loads brain rules");
assert(job.includes('config.agent === "financial_manager"'), "only FM gets the block");

const approvedPath = edge.indexOf('decision: "approved"');
const dismissPath = edge.indexOf('decision: "dismissed"');
assert(approvedPath > 0 && dismissPath > 0, "approve and dismiss both capture");

console.log("milon-brain-rules: ok");
