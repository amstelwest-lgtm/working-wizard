/**
 * Setup Partner — onboarding interview, data summary shape, workflow map, and
 * private brain-rule rows. Pure helpers only; no ledger writes.
 */
import { clipMilonBrainRuleText, type MilonBrainRuleRow } from "./milon-brain-rules.ts";

export const SETUP_PARTNER_AGENT_KEY = "setup_partner" as const;
export const SETUP_PARTNER_DISPLAY_NAME = "Setup Partner";
export const SETUP_PARTNER_SOURCE_EVENT = "setup_partner_confirm";
export const SETUP_PARTNER_TASK_WORKFLOW = "onboarding_workflow";
export const SETUP_PARTNER_TASK_FEATURE = "feature_idea";
export const SETUP_PARTNER_MAX_BRAIN_ROWS = 12;
export const SETUP_PARTNER_MAX_FOLLOWUPS = 5;
export const SETUP_PARTNER_MAX_OUTPUT_TOKENS = 384;
export const SETUP_PARTNER_MODEL_TURN_CAP = 16;

/** No ledger posting tools on this agent path. */
export const SETUP_PARTNER_ALLOWED_TOOLS: readonly string[] = [];

export type SetupPartnerLedgerStatus = {
  xero: { connected: boolean; sync_status: string | null; last_synced_at: string | null };
  qbo: { connected: boolean; sync_status: string | null; last_synced_at: string | null };
  sage: { connected: boolean; sync_status: string | null; last_synced_at: string | null };
  hasUpload: boolean;
};

export type SetupPartnerBooksSignals = {
  period_label: string | null;
  revenue: number | null;
  messy_accounts: boolean;
  ar_aged_hint: boolean;
  ap_aged_hint: boolean;
  recon_lag_hint: boolean;
  invoice_cadence_hint: boolean;
};

export type SetupPartnerSummary = {
  headline: string;
  ledger: SetupPartnerLedgerStatus;
  signals: SetupPartnerBooksSignals;
  bullets: string[];
  no_ledger: boolean;
};

export type SetupPartnerWorkflowMap = {
  todaysFlow: string[];
  milonCoverage: Array<{ agent: string; owns: string }>;
  gaps: string[];
  checklist: string[];
};

/** Practice workflow. A client answer is an example, not the subject. */
export const SETUP_PARTNER_FIXED_QUESTIONS: readonly { id: string; prompt: string }[] = [
  { id: "close", prompt: "How does the practice run month-end close across clients?" },
  { id: "review", prompt: "Who reviews the draft pack before it goes out?" },
  { id: "sign_off", prompt: "How does sign-off work, and who is allowed to sign?" },
  { id: "deadlines", prompt: "How does the firm track filing deadlines and client due dates?" },
  { id: "reporting", prompt: "How does the firm deliver client reports today?" },
  { id: "tools", prompt: "Which ledgers and spreadsheets does the practice use?" },
  {
    id: "handoff",
    prompt: "Where does work still sit outside Milōn (email, folders, other tools)?",
  },
  {
    id: "example",
    prompt: "Give one client only as an example of a step the firm still does by hand.",
  },
  { id: "extra", prompt: "Anything else about how the practice runs finance work?" },
];

export type SetupPartnerFollowupTemplate = {
  id: string;
  when: (summary: SetupPartnerSummary) => boolean;
  template: string;
};

export const SETUP_PARTNER_FOLLOWUP_TEMPLATES: readonly SetupPartnerFollowupTemplate[] = [
  {
    id: "no_ledger",
    when: (s) => s.no_ledger,
    template: "With no ledger on this example client, how does the practice collect the numbers?",
  },
  {
    id: "messy_chart",
    when: (s) => s.signals.messy_accounts,
    template:
      "Books-quality flags messy accounts on this example — who in the firm cleans coding before review?",
  },
  {
    id: "ar_aged",
    when: (s) => s.signals.ar_aged_hint,
    template: "Aged receivables on this example — how does the practice chase overdue customers?",
  },
  {
    id: "ap_aged",
    when: (s) => s.signals.ap_aged_hint,
    template: "Payables ageing on this example — who in the firm schedules supplier payments?",
  },
  {
    id: "recon_lag",
    when: (s) => s.signals.recon_lag_hint,
    template: "Bank reconciliation looks behind on this example — what slows the firm's matching?",
  },
];

export function setupPartnerFollowups(summary: SetupPartnerSummary): string[] {
  const out: string[] = [];
  for (const row of SETUP_PARTNER_FOLLOWUP_TEMPLATES) {
    if (!row.when(summary)) continue;
    out.push(row.template);
    if (out.length >= SETUP_PARTNER_MAX_FOLLOWUPS) break;
  }
  return out;
}

function syncLagHint(
  row: { sync_status: string | null; last_synced_at: string | null },
  connected: boolean,
): boolean {
  if (!connected) return false;
  const status = (row.sync_status ?? "").toLowerCase();
  if (status.includes("error") || status.includes("stale")) return true;
  if (!row.last_synced_at) return true;
  const ageMs = Date.now() - Date.parse(row.last_synced_at);
  return Number.isFinite(ageMs) && ageMs > 7 * 24 * 60 * 60 * 1000;
}

export function buildSetupPartnerSummary(input: {
  ledger: SetupPartnerLedgerStatus;
  booksQuality: unknown;
  snapshot: unknown;
  ratios: unknown;
}): SetupPartnerSummary {
  const bq = asRecord(input.booksQuality);
  const figures = asRecord(bq?.figures);
  const snap = asRecord(input.snapshot);
  const snapFigures = asRecord(snap?.figures);
  const revenue =
    num(snapFigures?.revenue) ?? num(figures?.revenue) ?? num(asRecord(input.ratios)?.revenue);
  const connected =
    input.ledger.xero.connected ||
    input.ledger.qbo.connected ||
    input.ledger.sage.connected ||
    input.ledger.hasUpload;
  const no_ledger = !connected;
  const period =
    typeof snap?.period_label === "string" // date-ok: month stamp passthrough for onboarding summary only
      ? snap.period_label
      : typeof bq?.period_label === "string" // date-ok: month stamp passthrough for onboarding summary only
        ? bq.period_label
        : null;
  const messy = Boolean(figures?.messy_accounts ?? figures?.uncoded_volume);
  const arHint = Boolean(figures?.ar_aged ?? figures?.collections_risk);
  const apHint = Boolean(figures?.ap_aged ?? figures?.payables_stretch);
  const reconHint =
    syncLagHint(input.ledger.xero, input.ledger.xero.connected) ||
    syncLagHint(input.ledger.qbo, input.ledger.qbo.connected);
  const invoiceHint = revenue != null && revenue > 0;
  const signals: SetupPartnerBooksSignals = {
    period_label: period,
    revenue,
    messy_accounts: messy,
    ar_aged_hint: arHint,
    ap_aged_hint: apHint,
    recon_lag_hint: reconHint,
    invoice_cadence_hint: invoiceHint,
  };
  const bullets: string[] = [];
  if (no_ledger) {
    bullets.push("No ledger connected yet — interview still captures how finance runs.");
  } else {
    if (period) bullets.push(`Latest figures period: ${period}.`);
    if (revenue != null) bullets.push(`Revenue on file: ${formatMoney(revenue)}.`);
    if (messy) bullets.push("Books-quality: messy or uncoded accounts flagged.");
    if (arHint) bullets.push("Receivables: ageing shape suggests collections follow-up.");
    if (apHint) bullets.push("Payables: ageing suggests stretched supplier timing.");
    if (reconHint) bullets.push("Sync or reconciliation may be behind last week.");
  }
  if (bullets.length === 0)
    bullets.push("Connected books with limited automated signals — rely on the interview.");
  const headline = no_ledger ? "No ledger yet" : "Ledger and books snapshot";
  return { headline, ledger: input.ledger, signals, bullets, no_ledger };
}

const EMPTY_LEDGER_SIDE = { connected: false, sync_status: null, last_synced_at: null };

/** Firm interview context. No client books. */
export function firmSetupPartnerSummary(): SetupPartnerSummary {
  return buildSetupPartnerSummary({
    ledger: {
      xero: EMPTY_LEDGER_SIDE,
      qbo: EMPTY_LEDGER_SIDE,
      sage: EMPTY_LEDGER_SIDE,
      hasUpload: false,
    },
    booksQuality: { figures: {} },
    snapshot: { empty: true },
    ratios: { empty: true },
  });
}

function formatMoney(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}m`;
  if (abs >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/,/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function ledgerStatusFromBooksQuality(raw: unknown): SetupPartnerLedgerStatus {
  const bq = asRecord(raw);
  const xero = asRecord(bq?.xero);
  const qbo = asRecord(bq?.qbo);
  const sage = asRecord(bq?.sage);
  const read = (row: Record<string, unknown> | null) => ({
    connected: Boolean(row?.connected),
    sync_status: typeof row?.sync_status === "string" ? row.sync_status : null,
    last_synced_at: typeof row?.last_synced_at === "string" ? row.last_synced_at : null,
  });
  return {
    xero: read(xero),
    qbo: read(qbo),
    sage: read(sage),
    hasUpload: Boolean(bq?.latest_source && String(bq.latest_source).includes("upload")),
  };
}

/** Default workflow map when the model JSON parse fails. */
export function fallbackWorkflowMap(answers: Record<string, string>): SetupPartnerWorkflowMap {
  const flow = SETUP_PARTNER_FIXED_QUESTIONS.map((q) => {
    const answer = (answers[q.id] ?? "").trim();
    if (!answer) return null;
    return `${q.prompt} → ${answer}`;
  }).filter((line): line is string => Boolean(line));
  const bottleneck = (answers.extra ?? answers.pain ?? "").trim();
  return {
    todaysFlow: flow.length ? flow : ["Practice month-end close, review, and sign-off."],
    milonCoverage: [
      { agent: "Financial Manager", owns: "Month-end pack, drafts, and books-quality checks." },
      { agent: "Analyst", owns: "Ratios, variance, and client reporting." },
      { agent: "Advisor", owns: "Deadlines, narrative moves, and owner questions." },
      { agent: "Tax Specialist", owns: "ZA tax prep for accountant review (no filing)." },
    ],
    gaps: bottleneck
      ? [`Practice bottleneck: ${bottleneck}`]
      : ["Confirm the hand-offs the firm still does manually."],
    checklist: [
      "Connect Xero, QuickBooks, or Sage where the firm keeps the books.",
      "Name who reviews and who signs off.",
      "Agree deadline tracking for the practice.",
      "Note one client only as an example of the firm workflow.",
    ],
  };
}

export function parseWorkflowMapJson(
  text: string,
  answers: Record<string, string>,
): SetupPartnerWorkflowMap {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return fallbackWorkflowMap(answers);
  try {
    const raw = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    const todaysFlow = stringList(raw.todaysFlow ?? raw.todays_flow);
    const gaps = stringList(raw.gaps);
    const checklist = stringList(raw.checklist ?? raw.setup_checklist);
    const coverageRaw = raw.milonCoverage ?? raw.milon_coverage;
    const milonCoverage: Array<{ agent: string; owns: string }> = [];
    if (Array.isArray(coverageRaw)) {
      for (const row of coverageRaw) {
        const rec = asRecord(row);
        if (!rec) continue;
        const agent = typeof rec.agent === "string" ? rec.agent : "";
        const owns =
          typeof rec.owns === "string" ? rec.owns : typeof rec.steps === "string" ? rec.steps : "";
        if (agent && owns) milonCoverage.push({ agent, owns });
      }
    }
    const base = fallbackWorkflowMap(answers);
    return {
      todaysFlow: todaysFlow.length ? todaysFlow : base.todaysFlow,
      milonCoverage: milonCoverage.length ? milonCoverage : base.milonCoverage,
      gaps: gaps.length ? gaps : base.gaps,
      checklist: checklist.length ? checklist : base.checklist,
    };
  } catch {
    return fallbackWorkflowMap(answers);
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => (typeof row === "string" ? row.trim() : ""))
    .filter((row) => row.length > 0);
}

/** Legacy row builder. Confirm now writes client_setup rows from the practice plan. */
export function setupPartnerBrainRows(input: {
  firmId: string;
  clientId: string;
  approverId: string;
  map: SetupPartnerWorkflowMap;
}): MilonBrainRuleRow[] {
  const rows: MilonBrainRuleRow[] = [];
  const push = (taskType: string, text: string) => {
    if (rows.length >= SETUP_PARTNER_MAX_BRAIN_ROWS) return;
    const clipped = clipMilonBrainRuleText(text);
    if (!clipped) return;
    rows.push({
      firm_id: input.firmId,
      client_id: input.clientId,
      task_type: taskType,
      source_event: SETUP_PARTNER_SOURCE_EVENT,
      source_row_id: null,
      decision: "approved",
      rule_text: clipped,
      approver_id: input.approverId,
      layer: "private",
      status: "active",
    });
  };
  for (const line of input.map.todaysFlow.slice(0, 4)) {
    push(SETUP_PARTNER_TASK_WORKFLOW, `Today's flow: ${line}`);
  }
  for (const row of input.map.milonCoverage.slice(0, 3)) {
    push(SETUP_PARTNER_TASK_WORKFLOW, `Milōn ${row.agent}: ${row.owns}`);
  }
  for (const line of input.map.checklist) {
    push(SETUP_PARTNER_TASK_WORKFLOW, `Setup: ${line}`);
  }
  for (const gap of input.map.gaps) {
    push(SETUP_PARTNER_TASK_FEATURE, `Gap: ${gap}`);
  }
  return rows.slice(0, SETUP_PARTNER_MAX_BRAIN_ROWS);
}

export function setupPartnerMapPromptBlock(map: SetupPartnerWorkflowMap): string {
  const lines = [
    "Today's flow:",
    ...map.todaysFlow.map((l) => `- ${l}`),
    "",
    "Milōn coverage:",
    ...map.milonCoverage.map((r) => `- ${r.agent}: ${r.owns}`),
    "",
    "Gaps:",
    ...map.gaps.map((l) => `- ${l}`),
    "",
    "Setup checklist:",
    ...map.checklist.map((l) => `- ${l}`),
  ];
  return lines.join("\n");
}

export function setupPartnerPhraseUserPrompt(template: string): string {
  return (
    "Rephrase this as one short interview question (max 22 words). " +
    "Do not add advice, ledger writes, or vendor names.\n\n" +
    template
  );
}

export function setupPartnerScreenshotNotes(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") continue;
    const note = item.replace(/\s+/g, " ").trim().slice(0, 240);
    if (!note) continue;
    out.push(note);
    if (out.length >= 4) break;
  }
  return out;
}

export function setupPartnerMapUserPrompt(
  summary: SetupPartnerSummary,
  answers: Record<string, string>,
  screenshots: readonly string[] = [],
): string {
  const answerLines = Object.entries(answers)
    .filter(([, v]) => v.trim())
    .map(([k, v]) => `${k}: ${v.trim()}`);
  const shots = screenshots
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
  return [
    "Return JSON only with keys: todaysFlow (string[]), milonCoverage ({agent, owns}[]), gaps (string[]), checklist (string[]).",
    "This is the accountant firm's practice workflow, not one end-client business. Client detail is an example only.",
    "No ledger writes. No desktop access. Name Milōn agents: Financial Manager, Analyst, Advisor, Tax Specialist.",
    "",
    "Data summary:",
    ...summary.bullets.map((b) => `- ${b}`),
    "",
    "Interview answers:",
    ...answerLines,
    "",
    "Screenshot notes (optional):",
    ...(shots.length ? shots.map((line) => `- ${line}`) : ["- none"]),
  ].join("\n");
}
