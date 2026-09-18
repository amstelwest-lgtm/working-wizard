/**
 * Active data requests — pure module (P0.6 of the advisory OS spine).
 *
 * A data request is a tracked ask for something the diagnosis / forecast /
 * root-cause work needs and does not have. The detector (`detectDataGaps`)
 * is deterministic — no LLM, no clock reads (`now` is injected) — and only
 * ever asks for things the statement-depth engine genuinely lacks. Requests
 * surface as the blocking Next Step (`openDataRequests` in the resolver) and
 * can be emailed to the owner; they close themselves when the data lands
 * (DB triggers) or when the rule stops firing (`data_requests_sync`).
 *
 * Kinds / statuses mirror the CHECK constraints in
 * supabase/migrations/20260918140000_data_requests.sql (test-guarded).
 */
import type { Json } from "@/integrations/supabase/types";
import type { AdvisoryState } from "@/lib/advisory-state";

export const DATA_REQUEST_KINDS = [
  "bank_statement",
  "management_accounts",
  "aged_debtors",
  "aged_creditors",
  "bank_balance",
  "payroll",
  "accounting_connection",
  "other",
] as const;
export type DataRequestKind = (typeof DATA_REQUEST_KINDS)[number];

export const DATA_REQUEST_SEVERITIES = ["critical", "important", "nice_to_have"] as const;
export type DataRequestSeverity = (typeof DATA_REQUEST_SEVERITIES)[number];

export const DATA_REQUEST_STATUSES = ["open", "sent", "fulfilled", "waived", "expired"] as const;
export type DataRequestStatus = (typeof DATA_REQUEST_STATUSES)[number];

export const DATA_REQUEST_SOURCES = ["system", "accountant", "owner", "ai"] as const;
export type DataRequestSource = (typeof DATA_REQUEST_SOURCES)[number];

export const OPEN_DATA_REQUEST_STATUSES: readonly DataRequestStatus[] = ["open", "sent"];

export type DataRequest = {
  id: string;
  client_id: string;
  cycle_id: string | null;
  kind: DataRequestKind;
  title: string;
  reason: string | null;
  severity: DataRequestSeverity;
  status: DataRequestStatus;
  source: DataRequestSource;
  rule_key: string | null;
  requested_by: string | null;
  requested_at: string;
  due_at: string | null;
  sent_at: string | null;
  sent_to: string | null;
  last_reminded_at: string | null;
  fulfilled_at: string | null;
  fulfilled_by: string | null;
  fulfilled_with: Json | null;
  waived_reason: string | null;
  meta: Json;
  created_at: string;
  updated_at: string;
};

export function parseDataRequestRow(row: Record<string, unknown>): DataRequest {
  const str = (k: string): string | null =>
    typeof row[k] === "string" ? (row[k] as string) : null;
  const kind = str("kind");
  const severity = str("severity");
  const status = str("status");
  const source = str("source");
  return {
    id: String(row.id),
    client_id: String(row.client_id),
    cycle_id: str("cycle_id"),
    kind: (DATA_REQUEST_KINDS as readonly string[]).includes(kind ?? "")
      ? (kind as DataRequestKind)
      : "other",
    title: str("title") ?? "",
    reason: str("reason"),
    severity: (DATA_REQUEST_SEVERITIES as readonly string[]).includes(severity ?? "")
      ? (severity as DataRequestSeverity)
      : "important",
    status: (DATA_REQUEST_STATUSES as readonly string[]).includes(status ?? "")
      ? (status as DataRequestStatus)
      : "open",
    source: (DATA_REQUEST_SOURCES as readonly string[]).includes(source ?? "")
      ? (source as DataRequestSource)
      : "system",
    rule_key: str("rule_key"),
    requested_by: str("requested_by"),
    requested_at: str("requested_at") ?? str("created_at") ?? "",
    due_at: str("due_at"),
    sent_at: str("sent_at"),
    sent_to: str("sent_to"),
    last_reminded_at: str("last_reminded_at"),
    fulfilled_at: str("fulfilled_at"),
    fulfilled_by: str("fulfilled_by"),
    fulfilled_with:
      row.fulfilled_with && typeof row.fulfilled_with === "object"
        ? (row.fulfilled_with as Json)
        : null,
    waived_reason: str("waived_reason"),
    meta: row.meta && typeof row.meta === "object" ? (row.meta as Json) : {},
    created_at: str("created_at") ?? "",
    updated_at: str("updated_at") ?? "",
  };
}

export function isOpenDataRequest(r: Pick<DataRequest, "status">): boolean {
  return OPEN_DATA_REQUEST_STATUSES.includes(r.status);
}

/** Missing table / column → the P0.6 migration has not been applied. */
export function isMissingDataRequestRelation(err: unknown): boolean {
  const msg =
    err && typeof err === "object" && "message" in err
      ? String((err as { message?: unknown }).message ?? "")
      : "";
  return /data_requests/.test(msg) && /does not exist|schema cache|could not find/i.test(msg);
}

// ── Labels ───────────────────────────────────────────────────────────────────

export const DATA_REQUEST_KIND_LABELS: Record<
  DataRequestKind,
  { label: string; whatToSend: string }
> = {
  bank_statement: {
    label: "Bank statement",
    whatToSend: "A PDF or CSV bank statement for the most recent month.",
  },
  management_accounts: {
    label: "Latest figures",
    whatToSend: "Management accounts, a trial balance, or the latest P&L and balance sheet.",
  },
  aged_debtors: {
    label: "Aged debtors",
    whatToSend: "The debtors age analysis from your accounting system (who owes what, by age).",
  },
  aged_creditors: {
    label: "Aged creditors",
    whatToSend: "The creditors age analysis from your accounting system (who you owe, by age).",
  },
  bank_balance: {
    label: "Current bank balance",
    whatToSend:
      "Today's closing balance across your bank accounts — type it into the cash forecast.",
  },
  payroll: {
    label: "Payroll summary",
    whatToSend: "The latest payroll run summary (gross, deductions, net, headcount).",
  },
  accounting_connection: {
    label: "Accounting connection",
    whatToSend: "Connect your accounting software so MILŌN can read transactions directly.",
  },
  other: { label: "Document", whatToSend: "See the note from your accountant." },
};

export function severityLabel(s: DataRequestSeverity): string {
  switch (s) {
    case "critical":
      return "Blocking";
    case "important":
      return "Needed";
    case "nice_to_have":
      return "Helpful";
  }
}

export const SEVERITY_RANK: Record<DataRequestSeverity, number> = {
  critical: 0,
  important: 1,
  nice_to_have: 2,
};

export function sortDataRequests<T extends Pick<DataRequest, "severity" | "requested_at">>(
  rows: T[],
): T[] {
  return [...rows].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.requested_at.localeCompare(b.requested_at),
  );
}

// ── Detector ─────────────────────────────────────────────────────────────────

export type DataGapFacts = {
  state: AdvisoryState;
  /** Latest of snapshot.period_date / clients.financials_updated_at; null = no figures. */
  figuresAsOf: string | null;
  /** Latest snapshot ratios, keyed as the ratio engine stores them ("Debtor Days"). */
  ratios: Record<string, number> | null;
  hasForecast: boolean;
  /** `clients.cashflow.openingBalance` as saved by the forecast. */
  forecastOpeningBalance: string | number | null;
  /** Ageing reports already on file (artifact meta.kind or fulfilled requests). */
  hasAgedDebtors: boolean;
  hasAgedCreditors: boolean;
  now: string;
};

export type DataRequestDraft = {
  rule_key: string;
  kind: DataRequestKind;
  title: string;
  reason: string;
  severity: DataRequestSeverity;
  due_at?: string | null;
};

/** Figures older than this are treated as stale once the client is past data collection. */
export const STALE_FIGURES_DAYS = 75;
/** Debtor / creditor days above which statement totals stop being enough to act on. */
export const DEBTOR_DAYS_AGEING_THRESHOLD = 45;
export const CREDITOR_DAYS_AGEING_THRESHOLD = 60;
/** A rule resolved by hand (fulfilled / waived) within this window is not re-asked. */
export const RESOLVED_SUPPRESSION_DAYS = 90;

const PRE_DATA: readonly AdvisoryState[] = [
  "onboarding",
  "context_collection",
  "financial_data_collection",
];
const FORECAST_LIVE: readonly AdvisoryState[] = [
  "forecasting",
  "recommendations",
  "accountant_review",
  "client_decision",
  "action_execution",
  "outcome_monitoring",
];

const DAY_MS = 86_400_000;

export function daysOld(iso: string | null, now: string): number | null {
  if (!iso) return null;
  const a = Date.parse(iso);
  const b = Date.parse(now);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.floor((b - a) / DAY_MS);
}

function blankBalance(v: string | number | null): boolean {
  if (v === null || v === undefined) return true;
  const s = String(v).replace(/[,\s]/g, "").trim();
  if (!s) return true;
  const n = Number(s);
  return Number.isFinite(n) ? n === 0 : false;
}

function ratio(r: Record<string, number> | null, key: string): number | null {
  const v = r?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Deterministic gap rules. Pre-data states return nothing: "upload your
 * numbers" is already the whole Next Step there, and a request on top would
 * be noise. Every rule names the consequence of ignoring it.
 */
export function detectDataGaps(f: DataGapFacts): DataRequestDraft[] {
  if (PRE_DATA.includes(f.state)) return [];
  const out: DataRequestDraft[] = [];

  const age = daysOld(f.figuresAsOf, f.now);
  if (age === null || age > STALE_FIGURES_DAYS) {
    out.push({
      rule_key: "stale_figures",
      kind: "management_accounts",
      title: "Latest month's figures",
      reason:
        age === null
          ? "MILŌN has no dated figures for this business, so the diagnosis and forecast are running on assumptions."
          : `The newest figures are ${age} days old. Diagnosis, forecast and every recommendation are being judged against a period that has already moved on.`,
      severity: "critical",
    });
  }

  if (FORECAST_LIVE.includes(f.state) && f.hasForecast && blankBalance(f.forecastOpeningBalance)) {
    out.push({
      rule_key: "forecast_opening_balance",
      kind: "bank_balance",
      title: "Current bank balance",
      reason:
        "The 13-week cash forecast has no opening balance, so its runway starts from zero. One number fixes every week of it.",
      severity: "critical",
    });
  }

  const debtorDays = ratio(f.ratios, "Debtor Days");
  if (debtorDays !== null && debtorDays > DEBTOR_DAYS_AGEING_THRESHOLD && !f.hasAgedDebtors) {
    out.push({
      rule_key: "debtor_days_no_ageing",
      kind: "aged_debtors",
      title: "Aged debtors report",
      reason: `Debtor days are ${Math.round(debtorDays)} against a ${DEBTOR_DAYS_AGEING_THRESHOLD}-day benchmark. Statement totals show the problem but not who is behind it — the ageing lets MILŌN name the fix instead of guessing.`,
      severity: "important",
    });
  }

  const creditorDays = ratio(f.ratios, "Creditor Days");
  if (
    creditorDays !== null &&
    creditorDays > CREDITOR_DAYS_AGEING_THRESHOLD &&
    !f.hasAgedCreditors
  ) {
    out.push({
      rule_key: "creditor_days_no_ageing",
      kind: "aged_creditors",
      title: "Aged creditors report",
      reason: `Creditor days are ${Math.round(creditorDays)}, above the ${CREDITOR_DAYS_AGEING_THRESHOLD}-day mark. That may be deliberate or it may be strain — the ageing shows which suppliers are being stretched and for how long.`,
      severity: "important",
    });
  }

  return out;
}

/**
 * Drop drafts whose rule a human already resolved recently (fulfilled by
 * hand or waived). Auto-fulfilled rows do not suppress: their rule stopped
 * firing on its own, and if it fires again the ask is genuinely new.
 */
export function suppressRecentlyResolved(
  drafts: DataRequestDraft[],
  existing: Array<
    Pick<DataRequest, "rule_key" | "status" | "fulfilled_at" | "updated_at" | "fulfilled_with">
  >,
  now: string,
  windowDays = RESOLVED_SUPPRESSION_DAYS,
): DataRequestDraft[] {
  const recentlyResolved = new Set<string>();
  for (const r of existing) {
    if (!r.rule_key) continue;
    if (r.status !== "fulfilled" && r.status !== "waived") continue;
    if (
      r.fulfilled_with &&
      typeof r.fulfilled_with === "object" &&
      !Array.isArray(r.fulfilled_with) &&
      r.fulfilled_with.auto === true
    )
      continue;
    const at = r.fulfilled_at ?? r.updated_at;
    const age = daysOld(at, now);
    if (age !== null && age <= windowDays) recentlyResolved.add(r.rule_key);
  }
  return drafts.filter((d) => !recentlyResolved.has(d.rule_key));
}

// ── Email copy (pure; transport lives in data-requests.functions.ts) ─────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type DataRequestEmailInput = {
  clientName: string;
  recipientName: string | null;
  /** Who is asking: the accountant's name, or null when MILŌN asks on its own. */
  requesterName: string | null;
  requests: Array<Pick<DataRequest, "kind" | "title" | "reason" | "severity">>;
  /** Absolute link back to the owner board. */
  href: string;
};

export function dataRequestEmail(input: DataRequestEmailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const sorted = sortDataRequests(input.requests.map((r) => ({ ...r, requested_at: "" })));
  const n = sorted.length;
  const blocking = sorted.filter((r) => r.severity === "critical").length;
  const subject =
    n === 1
      ? `${input.clientName}: MILŌN needs your ${sorted[0].title.toLowerCase()}`
      : `${input.clientName}: ${n} things MILŌN needs before the next step`;
  const greeting = input.recipientName ? `Hi ${input.recipientName},` : "Hi,";
  const asker = input.requesterName
    ? `${input.requesterName} has asked for the following so MILŌN can keep the analysis honest:`
    : "MILŌN found gaps that make the diagnosis and cash forecast weaker than they look. It needs:";
  const lines = sorted.map((r) => {
    const what = DATA_REQUEST_KIND_LABELS[r.kind].whatToSend;
    return { title: r.title, reason: r.reason ?? "", what, blocking: r.severity === "critical" };
  });

  const text = [
    greeting,
    "",
    asker,
    "",
    ...lines.flatMap((l) => [
      `• ${l.title}${l.blocking ? " (blocking)" : ""}`,
      l.reason ? `  ${l.reason}` : "",
      `  What to send: ${l.what}`,
      "",
    ]),
    blocking > 0
      ? "Until the blocking items arrive, MILŌN pauses on recommendations rather than guess."
      : "Nothing here blocks you today; it makes the next recommendations sharper.",
    "",
    `Upload or update here: ${input.href}`,
    "",
    "— MILŌN",
  ]
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n");

  const html = `<!doctype html><html><body style="font-family:Inter,Arial,sans-serif;color:#0f172a;line-height:1.5;max-width:560px;margin:0 auto;padding:24px">
<p>${escapeHtml(greeting)}</p>
<p>${escapeHtml(asker)}</p>
<ul style="padding-left:18px">
${lines
  .map(
    (l) =>
      `<li style="margin-bottom:12px"><strong>${escapeHtml(l.title)}</strong>${
        l.blocking
          ? ' <span style="color:#b91c1c;font-size:12px;font-weight:600">BLOCKING</span>'
          : ""
      }${l.reason ? `<br/><span style="color:#334155">${escapeHtml(l.reason)}</span>` : ""}<br/><span style="color:#64748b;font-size:13px">What to send: ${escapeHtml(l.what)}</span></li>`,
  )
  .join("\n")}
</ul>
<p style="color:#334155">${escapeHtml(
    blocking > 0
      ? "Until the blocking items arrive, MILŌN pauses on recommendations rather than guess."
      : "Nothing here blocks you today; it makes the next recommendations sharper.",
  )}</p>
<p><a href="${escapeHtml(input.href)}" style="display:inline-block;background:#b7872a;color:#1b1300;font-weight:700;padding:10px 16px;border-radius:8px;text-decoration:none">Upload or update</a></p>
<p style="color:#64748b;font-size:13px">— MILŌN</p>
</body></html>`;

  return { subject, html, text };
}
