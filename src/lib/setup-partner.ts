/**
 * Setup Partner — onboarding interview, data summary shape, workflow map, and
 * private brain-rule rows. Pure helpers only; no ledger writes.
 */
import { clipMilonBrainRuleText, type MilonBrainRuleRow } from "./milon-brain-rules.ts";

export const SETUP_PARTNER_AGENT_KEY = "setup_partner" as const;
export const SETUP_PARTNER_DISPLAY_NAME = "Implementation Manager";
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

/** Per-client interview. One client, not the practice. */
export const SETUP_PARTNER_FIXED_QUESTIONS: readonly { id: string; prompt: string }[] = [
  { id: "bookkeeper", prompt: "Who handles day-to-day bookkeeping for this client?" },
  { id: "approvals", prompt: "Who approves payments and major purchases?" },
  {
    id: "outside_tools",
    prompt: "Besides the ledger, which spreadsheets or tools do you rely on?",
  },
  { id: "invoicing", prompt: "How are customer invoices raised and sent?" },
  { id: "bills", prompt: "How are supplier bills captured and paid?" },
  { id: "close_calendar", prompt: "When does month-end close usually finish?" },
  { id: "payroll", prompt: "Who runs payroll, and how is it posted to the ledger?" },
  { id: "vat", prompt: "Who prepares VAT or sales tax filings?" },
  { id: "pain", prompt: "What is the biggest month-end bottleneck right now?" },
  { id: "extra", prompt: "Anything else about how finance runs today?" },
];

/** Firm interview. The practice across its clients, not one end client. */
export const FIRM_SETUP_QUESTIONS: readonly { id: string; prompt: string; followUp: string }[] = [
  {
    id: "mix",
    prompt: "How many clients are on the book, and which industries and sizes make up most of it?",
    followUp: "Give a count, the top two industries, and whether most are small or mid-sized.",
  },
  {
    id: "ledgers",
    prompt: "Which clients are on Xero, QuickBooks, Sage, or another ledger?",
    followUp:
      "Name the ledger for the majority, and the exception if one group uses something else.",
  },
  {
    id: "cadence",
    prompt: "What do you send clients each month, and on which day does it go out?",
    followUp: "Name the pack and the day it usually leaves.",
  },
  {
    id: "chain",
    prompt: "Who prepares the pack, who reviews it, and who is allowed to sign off?",
    followUp: "Name the roles, even if one person does more than one.",
  },
  {
    id: "deadlines",
    prompt: "Which deadlines do you track, and where is that list kept?",
    followUp: "Name the filings and the place: a spreadsheet, a diary, or a tool.",
  },
  {
    id: "sources",
    prompt:
      "Where do source documents arrive — email, WhatsApp, Dext, a portal, or somewhere else?",
    followUp: "Name the main channel, and one other if a group of clients uses it.",
  },
  {
    id: "tools",
    prompt: "Which spreadsheets and other tools does the practice still run the work in?",
    followUp: "Name the spreadsheet or tool the month cannot close without.",
  },
  {
    id: "time_sink",
    prompt: "Where does the team lose the most time each month?",
    followUp: "Point at one step, not a general complaint.",
  },
  {
    id: "pricing",
    prompt:
      "What do you sell clients, and how is it priced — fixed fee, advisory, packs, or a mix?",
    followUp: "Name the main offer and whether the fee is fixed or hourly.",
  },
  {
    id: "team",
    prompt:
      "How many people are in the firm, and who does the books, the review, and client reporting?",
    followUp: "Give the headcount and who prepares versus who reviews.",
  },
];

/** One follow-up, only when the firm answer does not pin the step down. */
export function firmAnswerIsVague(answer: string): boolean {
  const text = answer.replace(/\s+/g, " ").trim();
  if (!text) return true;
  if (/^(it depends|depends|varies|not sure|unsure|same)\b/i.test(text)) return true;
  return text.split(" ").length < 4;
}

export function setupQuestionsForAnswers(
  answers: Record<string, string>,
): readonly { id: string; prompt: string }[] {
  const firm = new Set(FIRM_SETUP_QUESTIONS.map((row) => row.id));
  if (Object.keys(answers).some((id) => firm.has(id))) return FIRM_SETUP_QUESTIONS;
  return SETUP_PARTNER_FIXED_QUESTIONS;
}

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

export type SetupPartnerCountry = "US" | "ZA";

const MARKET_LEAK = /\bZA\b|\bSARS\b/;

/** Tax line for the coverage list. Omitted country keeps the legacy ZA line. */
export function setupPartnerTaxOwns(country?: SetupPartnerCountry | null): string {
  if (country === "US") return "Sales-tax prep for accountant review (no filing).";
  if (country === null) return "Tax prep for accountant review (no filing).";
  return "ZA tax prep for accountant review (no filing).";
}

export function setupPartnerCoverage(
  country?: SetupPartnerCountry | null,
): Array<{ agent: string; owns: string }> {
  return [
    { agent: "Financial Manager", owns: "Month-end pack, drafts, and books-quality checks." },
    { agent: "Analyst", owns: "Ratios, variance, and client reporting." },
    { agent: "Advisor", owns: "Deadlines, narrative moves, and owner questions." },
    { agent: "Tax Specialist", owns: setupPartnerTaxOwns(country) },
  ];
}

function scrubCoverageRow(
  row: { agent: string; owns: string },
  country: SetupPartnerCountry | null,
): { agent: string; owns: string } | null {
  const blob = `${row.agent} ${row.owns}`;
  if (!MARKET_LEAK.test(blob)) return row;
  if (/tax/i.test(row.agent)) return { agent: row.agent, owns: setupPartnerTaxOwns(country) };
  const owns = row.owns
    .replace(/\bZA tax prep\b/gi, "Sales-tax prep")
    .replace(/\bSARS\b/g, "")
    .replace(/\bZA\b/g, "US")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.;])/g, "$1")
    .trim();
  if (!owns) return null;
  return { agent: row.agent.replace(/\bZA\b/g, "US"), owns };
}

/**
 * US and unset markets never keep ZA or SARS in the coverage list.
 * An explicit ZA firm keeps the model's lines. An omitted country is unchanged.
 */
export function withMarketCoverage(
  map: SetupPartnerWorkflowMap,
  country?: SetupPartnerCountry | null,
): SetupPartnerWorkflowMap {
  if (country === "ZA" || country === undefined) return map;
  const milonCoverage = map.milonCoverage
    .map((row) => scrubCoverageRow(row, country))
    .filter((row): row is { agent: string; owns: string } => row != null);
  return {
    ...map,
    milonCoverage: milonCoverage.length ? milonCoverage : setupPartnerCoverage(country),
  };
}

/** Default workflow map when the model JSON parse fails. */
export function fallbackWorkflowMap(
  answers: Record<string, string>,
  country?: SetupPartnerCountry | null,
): SetupPartnerWorkflowMap {
  const flow = setupQuestionsForAnswers(answers)
    .map((q) => {
      const answer = (answers[q.id] ?? "").trim();
      if (!answer) return null;
      return `${q.prompt} → ${answer}`;
    })
    .filter((line): line is string => Boolean(line));
  const bottleneck = (answers.time_sink ?? answers.extra ?? answers.pain ?? "").trim();
  const told = Object.values(answers).join(" ");
  const checklist = /\b(xero|quickbooks|qbo|sage)\b/i.test(told)
    ? []
    : ["Connect Xero, QuickBooks, or Sage where the firm keeps the books."];
  return {
    todaysFlow: flow.length ? flow : ["Practice month-end close, review, and sign-off."],
    milonCoverage: setupPartnerCoverage(country),
    gaps: bottleneck
      ? [`Practice bottleneck: ${bottleneck}`]
      : ["Confirm the hand-offs the firm still does manually."],
    checklist,
  };
}

export function parseWorkflowMapJson(
  text: string,
  answers: Record<string, string>,
  country?: SetupPartnerCountry | null,
): SetupPartnerWorkflowMap {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start < 0 || end <= start) return fallbackWorkflowMap(answers, country);
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
    const base = fallbackWorkflowMap(answers, country);
    return withMarketCoverage(
      {
        todaysFlow: todaysFlow.length ? todaysFlow : base.todaysFlow,
        milonCoverage: milonCoverage.length ? milonCoverage : base.milonCoverage,
        gaps: gaps.length ? gaps : base.gaps,
        checklist: checklist.length ? checklist : base.checklist,
      },
      country,
    );
  } catch {
    return fallbackWorkflowMap(answers, country);
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
