/**
 * Desk presentation for live agent runs, findings, and hand-offs.
 * Numbers are formatted here. Raw decimals never reach the screen.
 */
import { formatSnapshotRatio } from "./advisory-narrative";
import { formatMoney, type MoneyMarket } from "./market/format";
import { ZA_MARKET } from "./market/resolve";
import { formatAsOf, formatLastRun, type AgentHeaderStatus } from "./milon-team";
import type { AgentKey, TeamBriefingItem } from "./milon-team-feed";
import { metricDirection } from "./ratios";

export const TODAY_RATIO_CAP = 3;

export type AgentRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "partial"
  | "skipped"
  | "failed"
  | "dead"
  | "cancelled";

export type AgentRunRow = {
  id: string;
  agent: AgentKey;
  client_id: string;
  status: AgentRunStatus | string;
  summary?: string;
  /** sync and upload are ingest. Other triggers are ordinary work. */
  trigger?: string | null;
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type AgentFindingRow = {
  id: string;
  agent: AgentKey;
  client_id: string;
  kind?: string | null;
  /** info, watch, or act. Missing on rows loaded before the column was selected. */
  severity?: string | null;
  title: string;
  detail: string | null;
  evidence: unknown;
  as_of: string | null;
  created_at: string;
  /** Null while a draft is waiting. Approved rows stay visible. */
  status?: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  approved_table?: string | null;
  approved_row_id?: string | null;
  superseded_by?: string | null;
  dismissed_reason?: string | null;
};

/** Dismissed and superseded drafts stay off the owner surfaces. Approved rows stay. */
export function isVisibleAgentFinding(row: {
  superseded_by?: unknown;
  status?: string | null;
  dismissed_reason?: string | null;
}): boolean {
  if (row.superseded_by) return false;
  if (row.status === "dismissed") return false;
  if (typeof row.dismissed_reason === "string" && row.dismissed_reason.trim()) return false;
  return true;
}

export type AgentMessageRow = {
  id: string;
  client_id: string;
  from_agent: AgentKey;
  to_agent: AgentKey | null;
  type: string;
  payload: unknown;
  created_at: string;
};

export type AgentActivitySnapshot = {
  runs: AgentRunRow[];
  findings: AgentFindingRow[];
  messages: AgentMessageRow[];
  market: MoneyMarket;
};

const WORKING = new Set(["queued", "running"]);
const DONE = new Set(["succeeded", "partial"]);
const FAILED = new Set(["failed", "dead"]);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function emptyAgentActivity(): AgentActivitySnapshot {
  return { runs: [], findings: [], messages: [], market: ZA_MARKET };
}

/** A missing table or a revoked read is the disabled desk, not a failure. */
export function agentActivityUnavailable(error: { message?: string; code?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = error.message ?? "";
  return (
    code === "PGRST205" ||
    code === "42P01" ||
    code === "42501" ||
    /schema cache|does not exist|permission denied|not acceptable/i.test(message)
  );
}

export function latestRunByAgent(runs: readonly AgentRunRow[]): Partial<Record<AgentKey, AgentRunRow>> {
  const sorted = [...runs].sort((a, b) => {
    const delta = b.queued_at.localeCompare(a.queued_at);
    if (delta !== 0) return delta;
    return b.id.localeCompare(a.id);
  });
  const out: Partial<Record<AgentKey, AgentRunRow>> = {};
  for (const run of sorted) {
    if (!out[run.agent]) out[run.agent] = run;
  }
  return out;
}

export function headerFromRun(run: AgentRunRow, now: Date = new Date()): AgentHeaderStatus | null {
  if (WORKING.has(run.status)) {
    return { label: "Working…", tone: "clear", lastRun: null, pulse: true };
  }
  if (FAILED.has(run.status)) {
    return { label: "Couldn't finish, we're on it", tone: "idle", lastRun: null, muted: true };
  }
  if (DONE.has(run.status)) {
    const at = run.finished_at || run.started_at || run.queued_at;
    return { label: formatLastRun(at, now) ?? "Not run yet", tone: "clear", lastRun: null };
  }
  return null;
}

export function checkedStamp(run: AgentRunRow | undefined, fallback: string | null): string | null {
  if (!run) return fallback;
  if (run.finished_at) return run.finished_at;
  if (DONE.has(run.status)) return run.started_at || run.queued_at || fallback;
  return fallback;
}

function monthShort(value: string | null): string | null {
  if (!value) return null;
  const iso = /^(\d{4})-(\d{2})/.exec(value.trim());
  if (iso) return MONTHS[Number(iso[2]) - 1] ?? null;
  const head = value.trim().slice(0, 3).toLowerCase();
  const idx = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(head);
  return idx >= 0 ? MONTHS[idx] : null;
}

/** Period plus the day the figures were checked. "Sep figures · checked 9 Oct". */
export function figuresCheckedLine(
  period: string | null,
  checkedAt: string | null,
  now: Date = new Date(),
): string | null {
  const month = monthShort(period);
  const checked = formatAsOf(checkedAt, now);
  if (!month || !checked) return null;
  return `${month} figures · checked ${checked}`;
}

function evidenceRecord(evidence: unknown): Record<string, unknown> {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return {};
  return evidence as Record<string, unknown>;
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** Flat numbers, plus one level of period maps. A null period label still has figures. */
export function findingFigureEntries(evidence: unknown): { key: string; value: number }[] {
  const figures = evidenceRecord(evidence).figures;
  if (!figures || typeof figures !== "object" || Array.isArray(figures)) return [];
  const out: { key: string; value: number }[] = [];
  for (const [key, value] of Object.entries(figures as Record<string, unknown>)) {
    const flat = finiteNumber(value);
    if (flat != null) {
      out.push({ key, value: flat });
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const [innerKey, inner] of Object.entries(value as Record<string, unknown>)) {
      const n = finiteNumber(inner);
      if (n != null) out.push({ key: innerKey, value: n });
    }
  }
  return out;
}

export function findingFigures(evidence: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const entry of findingFigureEntries(evidence)) out[entry.key] = entry.value;
  return out;
}

export function findingPeriod(row: Pick<AgentFindingRow, "evidence" | "as_of">): string | null {
  const label = evidenceRecord(row.evidence).period_label;
  if (typeof label === "string" && label.trim()) return label.trim();
  return row.as_of;
}

function formatFigure(key: string, value: number, market: MoneyMarket): string {
  const compact = key.toLowerCase().replace(/[\s_-]+/g, "");
  const spec = metricDirection(key) ?? metricDirection(compact);
  if (spec) return formatSnapshotRatio(spec.name, value);
  const label = key.toLowerCase();
  if (/margin|percent|growth|rate|burden/.test(label)) {
    const pct = Math.abs(value) <= 1.5 ? value * 100 : value;
    return `${pct.toFixed(1)}%`;
  }
  if (/day/.test(label)) return `${Math.round(value)} days`;
  if (
    Math.abs(value) >= 100 ||
    /revenue|cash|cost|expense|asset|liabilit|balance|amount|sales|profit|wage/.test(label)
  ) {
    return formatMoney(value, market);
  }
  return value.toFixed(2);
}

/** One pass, longest spelling first, so a formatted amount is not formatted again. */
function applyReplacements(text: string, replacements: { raw: string; formatted: string }[]): string {
  const chosen = new Map<string, string>();
  for (const item of replacements) {
    if (item.raw && item.raw !== item.formatted && !chosen.has(item.raw)) chosen.set(item.raw, item.formatted);
  }
  const list = [...chosen.entries()].sort((a, b) => b[0].length - a[0].length);
  if (!list.length) return text;
  const pattern = list.map(([raw]) => raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.replace(new RegExp(`(?<![\\d.])(?:${pattern})(?!\\d)(?!\\.\\d)`, "g"), (match) => chosen.get(match) ?? match);
}

function figureEntries(
  figures: Record<string, number> | readonly { key: string; value: number }[] | null | undefined,
): { key: string; value: number }[] {
  if (!figures) return [];
  if (Array.isArray(figures)) return figures.filter((entry) => Number.isFinite(entry.value));
  return Object.entries(figures).map(([key, value]) => ({ key, value }));
}

/** A bare 1 must not become 1.00 inside "(1)". Decimals, money, days, and percents still replace. */
function worthReplacing(raw: string, formatted: string, value: number): boolean {
  if (!raw || raw === formatted) return false;
  if (raw.includes(".")) return true;
  if (Math.abs(value) >= 100) return true;
  return /%|days|R\s?\d|\$/.test(formatted);
}

/** 700000 in prose may already be written 700,000 or 700 000. */
function rawSpellings(value: number): string[] {
  const spellings = [String(value), value.toFixed(4), value.toFixed(2)];
  const rounded = Math.round(value);
  if (Math.abs(value) >= 1000 && Math.abs(value - rounded) < 0.001) {
    const digits = String(Math.abs(rounded));
    const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    const sign = rounded < 0 ? "-" : "";
    const body = `${sign}${grouped}`;
    spellings.push(body, body.replace(/,/g, " "), body.replace(/,/g, "\u00a0"));
  }
  return spellings;
}

function scrubRawDecimals(
  text: string,
  figures: Record<string, number> | readonly { key: string; value: number }[] | null | undefined,
  market: MoneyMarket,
): string {
  let next = text;
  const replacements: { raw: string; formatted: string }[] = [];
  for (const { key, value } of figureEntries(figures)) {
    const formatted = formatFigure(key, value, market);
    for (const raw of rawSpellings(value)) {
      if (worthReplacing(raw, formatted, value)) replacements.push({ raw, formatted });
    }
  }
  next = applyReplacements(next, replacements);
  return next.replace(/-?\d+\.\d{3,}/g, (raw, offset: number) => {
    const window = next.slice(Math.max(0, offset - 28), offset + raw.length + 16).toLowerCase();
    const n = Number(raw);
    if (!Number.isFinite(n)) return raw;
    if (/margin|percent|rate|growth|burden/.test(window)) {
      const pct = Math.abs(n) <= 1.5 ? n * 100 : n;
      return `${pct.toFixed(1)}%`;
    }
    if (/equity|ratio|turnover|multiple/.test(window)) return formatSnapshotRatio("Debt-to-Equity", n);
    if (Math.abs(n) >= 100) return formatMoney(n, market);
    return n.toFixed(2);
  });
}

/** 60.0% is the ratio formatter's percent. A finding on screen says 60%. */
function tidyRatioPercent(text: string): string {
  return text.replace(/(\d+)\.0%/g, "$1%");
}

/** Title or detail, with the finding's own figures. 0.6 on a margin becomes 60%. */
export function formatFindingProse(
  text: string,
  figures?: Record<string, number> | readonly { key: string; value: number }[] | null,
  market: MoneyMarket = ZA_MARKET,
): string {
  return tidyRatioPercent(scrubRawDecimals(text, figures ?? {}, market)).replace(/\s+/g, " ").trim();
}

const METRIC_WORD =
  /\b(?:gross|operating|net)\s+margin\b|\b(?:debtor|creditor|inventory|working\s+capital|wip)\s+days\b|\b(?:current|fixed\s+cost)\s+ratio\b|\bdebt[-\s]to[-\s]equity\b|\brevenue\s+growth\b|\breturn\s+on\s+(?:assets|equity)\b|\b(?:tax|interest)\s+burden\b|\basset\s+turnover\b|\brevenue\b|\bcash\b/i;

function isMetricSentence(sentence: string): boolean {
  if (!/\d/.test(sentence) || !METRIC_WORD.test(sentence)) return false;
  const rest = sentence
    .replace(new RegExp(METRIC_WORD.source, "gi"), " ")
    .replace(/-?\d[\d,]*(?:\.\d+)?%?/g, " ")
    .replace(/\b(?:is|are|of|and|the|a|an|both|periods?|shows?|with|at|for|in|was|were|on|to|from|vs|versus|days)\b/gi, " ")
    .replace(/[^A-Za-z]+/g, " ")
    .trim();
  return rest.length === 0;
}

/** True when the text is only metric citations, so it cannot be the ask. A decimal point stays inside the number. */
function isMetricDump(text: string): boolean {
  const parts = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<!\d)[.!?;]+|[.!?;]+(?!\d)/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every(isMetricSentence);
}

function skipFigureKey(key: string): boolean {
  const compact = key.toLowerCase().replace(/[\s_:-]+/g, "");
  if (compact.startsWith("pillar") || compact.startsWith("score")) return true;
  return /^(hasupload|connectedledgers|lowestweek|horizonweeks|cashrunwayweeks|overall|storedscore|liveoverall|invoices|snapshotid|draft)$/.test(
    compact,
  );
}

/** One value per metric. A period label wins when the figures are nested under it. */
function findingDisplayFigures(evidence: unknown): { key: string; value: number }[] {
  const record = evidenceRecord(evidence);
  const figures = record.figures;
  if (!figures || typeof figures !== "object" || Array.isArray(figures)) return [];
  const period = typeof record.period_label === "string" ? record.period_label.trim() : "";
  const flat: { key: string; value: number }[] = [];
  const buckets: { name: string; entries: { key: string; value: number }[] }[] = [];
  for (const [key, value] of Object.entries(figures as Record<string, unknown>)) {
    const n = finiteNumber(value);
    if (n != null) {
      flat.push({ key, value: n });
      continue;
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const entries: { key: string; value: number }[] = [];
    for (const [innerKey, inner] of Object.entries(value as Record<string, unknown>)) {
      const innerN = finiteNumber(inner);
      if (innerN != null) entries.push({ key: innerKey, value: innerN });
    }
    if (entries.length) buckets.push({ name: key, entries });
  }
  const matched = period ? buckets.find((bucket) => bucket.name === period)?.entries : undefined;
  const merged = new Map<string, number>();
  for (const entry of flat) merged.set(entry.key, entry.value);
  for (const entry of matched ?? buckets.flatMap((bucket) => bucket.entries)) merged.set(entry.key, entry.value);
  return [...merged.entries()].map(([key, value]) => ({ key, value }));
}

const DAY_RANK: Record<string, number> = {
  "Debtor Days": 0,
  "Creditor Days": 1,
  "Inventory Days": 2,
  "WIP Days": 3,
  "Working Capital Days": 4,
};

const MARGIN_RANK: Record<string, number> = {
  "Gross Margin": 0,
  "Operating Margin": 1,
  "Net Margin": 2,
};

/** Structured figures as one muted line. Days round; a margin is a percent. */
export function findingMetricContext(evidence: unknown, market: MoneyMarket = ZA_MARKET): string | null {
  const clauses: { kind: number; rank: number; label: string; amount: string; days: boolean }[] = [];
  for (const { key, value } of findingDisplayFigures(evidence)) {
    if (skipFigureKey(key)) continue;
    const formatted = tidyRatioPercent(formatFigure(key, value, market));
    if (/^-?\d+\.\d+$/.test(formatted)) continue;
    const spec = metricDirection(key);
    const label = (spec?.name ?? key).replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
    const days = /days$/.test(formatted);
    const kind = days ? 0 : formatted.endsWith("%") ? 1 : /×/.test(formatted) ? 2 : 3;
    const rank = days ? (DAY_RANK[spec?.name ?? ""] ?? 50) : formatted.endsWith("%") ? (MARGIN_RANK[spec?.name ?? ""] ?? 50) : 50;
    clauses.push({
      kind,
      rank,
      label,
      amount: days ? String(Math.round(value)) : formatted,
      days,
    });
  }
  clauses.sort((a, b) => a.kind - b.kind || a.rank - b.rank || a.label.localeCompare(b.label));
  if (!clauses.length) return null;
  let seenDays = false;
  const parts = clauses.map((clause) => {
    if (clause.days && !seenDays) {
      seenDays = true;
      return `${clause.label} are ${clause.amount}`;
    }
    return `${clause.label} ${clause.amount}`;
  });
  const line = parts.join(", ");
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function requestAsk(evidence: unknown): string | null {
  const record = evidenceRecord(evidence);
  const request = record.request;
  const nested =
    request && typeof request === "object" && !Array.isArray(request) ? (request as Record<string, unknown>) : null;
  const candidates = [
    nested?.title,
    nested?.detail,
    record.request_title,
    record.requestTitle,
    record.ask,
    record.what_to_send,
    record.whatToSend,
    typeof request === "string" ? request : null,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) return candidate.trim();
  }
  return null;
}

export type FindingCardCopy = { lead: string; context: string | null };

/**
 * What the card shows. A data request leads with the ask. The ratios sit on
 * a second line taken from the structured figures.
 */
export function findingCardCopy(
  row: Pick<AgentFindingRow, "kind" | "title" | "detail" | "evidence">,
  market: MoneyMarket = ZA_MARKET,
): FindingCardCopy {
  const figures = findingFigureEntries(row.evidence);
  const title = formatFindingProse(row.title, figures, market);
  const detail = formatFindingProse(row.detail ?? "", figures, market);
  if (row.kind !== "data_request_draft") return { lead: title, context: null };
  const asked = requestAsk(row.evidence);
  const fromEvidence = asked ? formatFindingProse(asked, figures, market) : "";
  let lead = "";
  if (fromEvidence && !isMetricDump(fromEvidence)) lead = fromEvidence;
  else if (title && !isMetricDump(row.title)) lead = title;
  else if (detail && !isMetricDump(row.detail ?? "")) lead = detail;
  else lead = title || detail;
  const context = findingMetricContext(row.evidence, market);
  return { lead, context: context && !isMetricDump(lead) ? context : null };
}

/** One sentence. Percentages and currency are formatted; 0.7795 never survives. */
export function findingSentence(input: {
  title: string;
  detail?: string | null;
  figures?: Record<string, number> | readonly { key: string; value: number }[] | null;
  market?: MoneyMarket;
}): string {
  const market = input.market ?? ZA_MARKET;
  const title = input.title.replace(/\s+/g, " ").trim();
  const detail = (input.detail ?? "").replace(/\s+/g, " ").trim();
  let text = title;
  if (detail && detail !== title && !title.includes(detail)) {
    text = `${title.replace(/[.!?]$/, "")}. ${detail}`;
  }
  text = formatFindingProse(text, input.figures ?? {}, market);
  if (!text) return "";
  if (!/[.!?]$/.test(text)) text = `${text}.`;
  return text;
}

export function ratioSentence(name: string, detail?: string): string {
  const source = (detail ?? "").trim();
  const pct = source.match(/(-?\d+(?:\.\d+)?)%\s*$/);
  if (pct) return `${name} is ${Number(pct[1]).toFixed(1)}%.`;
  const days = source.match(/(-?\d+(?:\.\d+)?)\s+days\s*$/i);
  if (days) return `${name} is ${Math.round(Number(days[1]))} days.`;
  const num = source.match(/(-?\d+(?:\.\d+)?)\s*$/);
  if (!num) return source || name;
  const value = Number(num[1]);
  if (!Number.isFinite(value)) return source || name;
  return `${name} is ${formatSnapshotRatio(name, value)}.`;
}

export function splitTodayBriefing(items: readonly TeamBriefingItem[]): {
  lead: TeamBriefingItem[];
  ratios: TeamBriefingItem[];
} {
  return {
    lead: items.filter((item) => !item.id.startsWith("ratio:")),
    ratios: items.filter((item) => item.id.startsWith("ratio:")),
  };
}

/**
 * Chip text for a briefing source. Internal file names stay off the desk.
 * A proposal uses the area it is about, or "Next move" when it has none.
 */
export function deskSourceLabel(
  item: Pick<TeamBriefingItem, "id" | "title" | "detail" | "source">,
): string {
  const raw = item.source.label.trim();
  if (!/client brain/i.test(raw)) return raw;
  if (item.id.startsWith("proposal:") || /proposals/i.test(raw)) {
    const text = `${item.title} ${item.detail ?? ""}`;
    if (/\b(debt|loan|equity|gearing)\b/i.test(text)) return "Debt";
    if (/\b(cash|runway|floor)\b/i.test(text)) return "Cash";
    if (/\bdebtors?\b/i.test(text)) return "Debtors";
    return "Next move";
  }
  return "Advisory";
}

/** A next step already stored against this ratio. Nothing is invented. */
export function nextActionHint(
  item: TeamBriefingItem,
  all: readonly TeamBriefingItem[],
): string | null {
  if (!item.id.startsWith("ratio:")) {
    const own = item.detail?.trim();
    return own || null;
  }
  const name = item.title.trim().toLowerCase();
  if (!name) return null;
  const proposal = all.find((other) => {
    if (!other.id.startsWith("proposal:")) return false;
    return `${other.title} ${other.detail ?? ""}`.toLowerCase().includes(name);
  });
  const hint = proposal?.detail?.trim() || proposal?.title?.trim() || "";
  return hint || null;
}

function payloadText(payload: unknown): string | null {
  const record = evidenceRecord(payload);
  for (const key of ["text", "summary", "title", "detail", "message", "note"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.replace(/\s+/g, " ").trim();
  }
  return null;
}

export function handoffParts(
  row: Pick<AgentMessageRow, "type" | "from_agent" | "to_agent" | "payload">,
): { from: AgentKey; to: AgentKey; text: string } | null {
  if (row.type !== "handoff" || !row.to_agent || row.to_agent === row.from_agent) return null;
  const text = payloadText(row.payload);
  if (!text) return null;
  return { from: row.from_agent, to: row.to_agent, text };
}

/** "Analyst → Advisor: …" for a hand-off. Other message types stay off the desk. */
export function handoffLine(
  row: Pick<AgentMessageRow, "type" | "from_agent" | "to_agent" | "payload">,
  shortName: (agent: AgentKey) => string,
): string | null {
  const parts = handoffParts(row);
  if (!parts) return null;
  return `${shortName(parts.from)} → ${shortName(parts.to)}: ${parts.text}`;
}

/** Owner review is never a sign-off. Only an accountant approval uses the check. */
export function deskSignoffText(line: string | null, ownerReviewed: boolean): string | null {
  if (ownerReviewed) return "Reviewed by you";
  if (!line) return null;
  if (/\bsigned off\b/i.test(line)) return "Signed off ✓";
  if (line.trim() === "Draft") return "Advisory pack · still a draft";
  return line;
}

export function deskSignoffInvite(ownerReviewed: boolean): string | null {
  return ownerReviewed ? "Invite your accountant to sign off" : null;
}
