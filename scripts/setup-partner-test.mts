/**
 * Setup Partner P0: summary, follow-ups, brain rows, cross-firm filter, no ledger tools.
 * Run: pnpm test:setup-partner
 */
import { readFileSync } from "node:fs";
import {
  SETUP_PARTNER_ALLOWED_TOOLS,
  SETUP_PARTNER_FIXED_QUESTIONS,
  SETUP_PARTNER_MAX_BRAIN_ROWS,
  SETUP_PARTNER_MAX_FOLLOWUPS,
  SETUP_PARTNER_SOURCE_EVENT,
  SETUP_PARTNER_TASK_FEATURE,
  SETUP_PARTNER_TASK_WORKFLOW,
  buildSetupPartnerSummary,
  fallbackWorkflowMap,
  parseWorkflowMapJson,
  setupPartnerBrainRows,
  setupPartnerFollowups,
} from "../src/lib/setup-partner.ts";
import { filterMilonBrainRulesForPrompt } from "../src/lib/milon-brain-rules.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string): string {
  return readFileSync(path, "utf8");
}

const firmA = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const firmB = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const clientA = "cccccccc-cccc-cccc-cccc-cccccccccccc";

assert(SETUP_PARTNER_FIXED_QUESTIONS.length >= 8 && SETUP_PARTNER_FIXED_QUESTIONS.length <= 10, "fixed question count");

const emptySummary = buildSetupPartnerSummary({
  ledger: {
    xero: { connected: false, sync_status: null, last_synced_at: null },
    qbo: { connected: false, sync_status: null, last_synced_at: null },
    sage: { connected: false, sync_status: null, last_synced_at: null },
    hasUpload: false,
  },
  booksQuality: { figures: {} },
  snapshot: { empty: true },
  ratios: { empty: true },
});
assert(emptySummary.no_ledger, "empty books → no ledger");
assert(emptySummary.headline === "No ledger yet", "headline for empty books");
assert(emptySummary.bullets.length > 0, "summary bullets present");

const connectedSummary = buildSetupPartnerSummary({
  ledger: {
    xero: { connected: true, sync_status: "ok", last_synced_at: new Date().toISOString() },
    qbo: { connected: false, sync_status: null, last_synced_at: null },
    sage: { connected: false, sync_status: null, last_synced_at: null },
    hasUpload: false,
  },
  booksQuality: { figures: { revenue: 120000, messy_accounts: true }, period_label: "Jan–Sep 2026" },
  snapshot: { period_label: "Jan–Sep 2026", figures: { revenue: 120000 } },
  ratios: {},
});
assert(!connectedSummary.no_ledger, "connected books summary");
assert(connectedSummary.signals.messy_accounts, "messy flag");

const followups = setupPartnerFollowups(connectedSummary);
assert(followups.length <= SETUP_PARTNER_MAX_FOLLOWUPS, "follow-up cap");

const map = parseWorkflowMapJson(
  JSON.stringify({
    todaysFlow: ["Finance admin posts daily"],
    milonCoverage: [{ agent: "Financial Manager", owns: "Close pack" }],
    gaps: ["Manual payroll journal"],
    checklist: ["Connect Xero"],
  }),
  { bookkeeper: "Client admin" },
);
assert(map.todaysFlow[0] === "Finance admin posts daily", "parsed map flow");

const rows = setupPartnerBrainRows({
  firmId: firmA,
  clientId: clientA,
  approverId: "11111111-1111-1111-1111-111111111111",
  map: fallbackWorkflowMap({ pain: "Late bank rec" }),
});
assert(rows.length > 0 && rows.length <= SETUP_PARTNER_MAX_BRAIN_ROWS, "brain row cap");
assert(rows.every((r) => r.layer === "private" && r.status === "active"), "private active rows");
assert(rows.every((r) => r.source_event === SETUP_PARTNER_SOURCE_EVENT), "source event");
assert(rows.some((r) => r.task_type === SETUP_PARTNER_TASK_WORKFLOW), "workflow rows");
assert(rows.some((r) => r.task_type === SETUP_PARTNER_TASK_FEATURE), "feature idea rows");
assert(rows.every((r) => r.rule_text.length <= 500), "rule_text clipped");

const crossFirm = filterMilonBrainRulesForPrompt(
  [
    { ...rows[0], firm_id: firmB },
    rows[0],
  ],
  { firmId: firmA, clientId: clientA, taskTypes: [SETUP_PARTNER_TASK_WORKFLOW] },
);
assert(crossFirm.length === 1 && crossFirm[0].firm_id === firmA, "firm A rules only");

assert(SETUP_PARTNER_ALLOWED_TOOLS.length === 0, "no ledger write tools");

const edge = read("supabase/functions/setup-partner/index.ts");
assert(edge.includes("milon_brain_rules"), "confirm inserts brain rules");
assert(edge.includes("readBooksQuality"), "summary reuses books quality read");
assert(!edge.includes("getXeroStatus"), "no new xero write path");

const prompt = read("supabase/functions/setup-partner/firm-interview-prompt.ts");
assert(prompt.includes("never post"), "prompt forbids ledger writes");
assert(prompt.includes("accountant firm"), "firm interview prompt");
const promptEntry = read("supabase/functions/_shared/agent-prompts/setup-partner.ts");
assert(promptEntry.includes("firm-interview-prompt.ts"), "one swappable prompt file");

const panel = read("src/components/setup-partner-panel.tsx");
assert(panel.includes("Confirm workflow map"), "explicit confirm control");

console.log("setup-partner-test: ok");
