/**
 * Desk presentation for live agent runs, findings, and hand-offs.
 * Numbers are formatted here. Raw decimals never reach the screen.
 */
import { formatSnapshotRatio, groundAdvisoryNarrative } from "./advisory-narrative";
import { draftMetricUnit, repairDraftMetricUnits } from "./agent-bus";
import { formatMoney, type MoneyMarket } from "./market/format";
import { ZA_MARKET } from "./market/resolve";
import { MONTHS } from "./market/date-presets";
import { formatAsOf, formatLastRun, type AgentHeaderStatus } from "./milon-team";
import type { AgentKey, TeamBriefingItem } from "./milon-team-feed";
import { correctedGrossMarginFraction, metricDirection, workingCapitalFromDayParts } from "./ratios";
import { canonicalScoreProse, preferLiveHealthProse, type LiveHealthQuote } from "./score-prose";
import { quoteLiveScoreOnly, liveOverallFromRecord } from "./draft-figures";
import { rewriteDraftMonthStamp } from "./statement-period";

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
  /** Set when this run was started for one action. */
  action_item_id?: string | null;
};

export type AgentFindingRow = {
  id: string;
  agent: AgentKey;
  client_id: string;
  /** The run that wrote this row. Hand-off "finished" needs this on the action's run. */
  run_id?: string | null;
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

/** Period plus the day the figures were checked. "Sep figures · checked 9 Oct 2026". */
export function figuresCheckedLine(
  period: string | null,
  checkedAt: string | null,
  now: Date,
  market: { locale?: string | null },
): string | null {
  const month = monthShort(period);
  const checked = formatAsOf(checkedAt, now, market);
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
  const label = evidenceRecord(row.evidence).period_label; // date-ok: month name for the checked line, not the raw span
  if (typeof label === "string" && label.trim()) return label.trim();
  return row.as_of;
}

type FigureKind = "gross" | "debtor" | "inventory" | "creditor" | "wc" | "other";

function figureKind(key: string): FigureKind {
  const compact = key.toLowerCase().replace(/[\s_-]+/g, "");
  if (compact === "grossmargin" || compact === "gm") return "gross";
  if (compact === "workingcapitaldays" || compact === "ccc") return "wc";
  if (compact === "debtordays" || compact === "dso" || compact === "daysar") return "debtor";
  if (compact === "inventorydays" || compact === "dio" || compact === "stockdays") return "inventory";
  if (compact === "creditordays" || compact === "dpo" || compact === "daysap") return "creditor";
  return "other";
}

/** Sign-corrected quote. Component days stay non-negative. A margin above 100% is the signed-cost reading. */
function correctQuotedFigure(key: string, value: number): number {
  if (!Number.isFinite(value)) return value;
  const kind = figureKind(key);
  if (kind === "gross") {
    const fraction = correctedGrossMarginFraction(value);
    return Math.abs(value) <= 1.5 ? fraction : fraction * 100;
  }
  if ((kind === "inventory" || kind === "creditor" || kind === "debtor") && value < 0) {
    return Math.abs(value);
  }
  return value;
}

function correctQuotedFigures(entries: { key: string; value: number }[]): { key: string; value: number }[] {
  const corrected = entries.map((entry) => ({
    key: entry.key,
    value: correctQuotedFigure(entry.key, entry.value),
  }));
  const pick = (kind: FigureKind) => corrected.find((entry) => figureKind(entry.key) === kind);
  const debtor = pick("debtor");
  const inventory = pick("inventory");
  const creditor = pick("creditor");
  const wc = workingCapitalFromDayParts(
    debtor?.value ?? Number.NaN,
    inventory?.value ?? Number.NaN,
    creditor?.value ?? Number.NaN,
  );
  if (!Number.isFinite(wc)) return corrected;
  return corrected.map((entry) => (figureKind(entry.key) === "wc" ? { ...entry, value: wc } : entry));
}

function formatFigure(key: string, value: number, market: MoneyMarket): string {
  if (skipFigureKey(key)) return String(Math.round(value));
  const unit = draftMetricUnit(key, value);
  if (unit === "count") return String(Math.round(value));
  const compact = key.toLowerCase().replace(/[\s_-]+/g, "");
  const spec = metricDirection(key) ?? metricDirection(compact);
  if (spec) return formatSnapshotRatio(spec.name, value);
  const label = key.toLowerCase();
  if (unit === "percent" || /margin|percent|growth|rate|burden/.test(label)) {
    const pct = Math.abs(value) <= 1.5 ? value * 100 : value;
    return `${pct.toFixed(1)}%`;
  }
  if (unit === "days" || /day/.test(label)) return `${Math.round(value)} days`;
  if (
    unit === "currency" ||
    Math.abs(value) >= 100 ||
    /revenue|cash|cost|expense|asset|liabilit|balance|amount|sales|profit|wage/.test(label)
  ) {
    return formatMoney(value, market);
  }
  if (unit === "ratio") return `${value.toFixed(2)}×`;
  return value.toFixed(2);
}

function withCanonicalRatioFigures(
  entries: { key: string; value: number }[],
  canonical?: Record<string, number> | null,
): { key: string; value: number }[] {
  if (!canonical) return entries;
  return entries.map((entry) => {
    const next = canonical[entry.key];
    if (typeof next === "number" && Number.isFinite(next)) return { key: entry.key, value: next };
    return entry;
  });
}

/** One pass, longest spelling first, so a formatted amount is not formatted again. */
function applyReplacements(
  text: string,
  replacements: { raw: string; formatted: string; unit: ReturnType<typeof draftMetricUnit> }[],
): string {
  const byRaw = new Map<string, { formatted: string; unit: ReturnType<typeof draftMetricUnit> }[]>();
  for (const item of replacements) {
    if (!item.raw || item.raw === item.formatted) continue;
    const list = byRaw.get(item.raw) ?? [];
    if (!list.some((row) => row.formatted === item.formatted && row.unit === item.unit)) list.push(item);
    byRaw.set(item.raw, list);
  }
  const raws = [...byRaw.keys()].sort((a, b) => b.length - a.length);
  if (!raws.length) return text;
  const pattern = raws.map((raw) => raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  return text.replace(new RegExp(`(?<![R$£€][ \\u00a0\\u202f]?)(?<![\\d.])(?:${pattern})(?!\\d)(?!\\.\\d)`, "g"), (match, offset: number) => {
    const after = text.slice(offset + match.length, offset + match.length + 20);
    if (/^\s+out of\s+100\b/i.test(after) || /^\s*\/\s*100\b/.test(after)) return match;
    const window = text.slice(Math.max(0, offset - 80), offset).toLowerCase();
    const score = /\b(?:health|overall|pillar)\b[^.\n]*$/.test(window) || /\bscore\b[^.\n]{0,24}$/.test(window);
    const days = /\b(?:debtor|creditor|inventory|working\s+capital|wip)\s+days\b[^.\n]*$/.test(window);
    const margin = /\b(?:gross|operating|net)\s+margin\b[^.\n]*$/.test(window);
    if (score && !days) return match;
    const options = byRaw.get(match) ?? [];
    const preferred = days
      ? options.find((row) => row.unit === "days")
      : margin
        ? options.find((row) => row.unit === "percent")
        : options.length === 1
          ? options[0]
          : undefined;
    if (!preferred) return match;
    if (preferred.unit === "days" && /^\s*days\b/i.test(after)) return match;
    if (preferred.unit === "percent" && /^\s*%/.test(after)) return match;
    return preferred.formatted;
  });
}

/** A score is never money, even when a draft already wrote $70 out of 100. */
function stripScoreCurrency(text: string): string {
  return text
    .replace(/(?:\$|R[\u00a0 ])(\d[\d,]*(?:\.\d+)?)(?=\s+out of\s+100\b)/gi, "$1")
    .replace(/(?:\$|R[\u00a0 ])(\d[\d,]*(?:\.\d+)?)(?=\s*\/\s*100\b)/gi, "$1");
}

/** A template that already wrote $0 must not gain a second symbol. */
function stripDoubleCurrency(text: string): string {
  return text.replace(/\$\s*\$/g, "$").replace(/R(?:[\u00a0 ]+)R(?:[\u00a0 ])/g, "R ");
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
  const replacements: { raw: string; formatted: string; unit: ReturnType<typeof draftMetricUnit> }[] = [];
  for (const { key, value } of figureEntries(figures)) {
    const formatted = formatFigure(key, value, market);
    const unit = draftMetricUnit(key, value);
    for (const raw of rawSpellings(value)) {
      if (worthReplacing(raw, formatted, value)) replacements.push({ raw, formatted, unit });
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
    if (/pillar|score|out of\s+100|\/\s*100/.test(window)) return String(Math.round(n));
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
  canonicalRatios?: Record<string, number> | null,
): string {
  const corrected = correctQuotedFigures(withCanonicalRatioFigures(figureEntries(figures), canonicalRatios));
  const formatted = canonicalScoreProse(
    rewriteDraftMonthStamp(
      stripDoubleCurrency(stripScoreCurrency(tidyRatioPercent(scrubRawDecimals(text, corrected, market))))
        .replace(/\s+/g, " ")
        .trim(),
    ),
  );
  const repaired = repairDraftMetricUnits(formatted);
  const grounded = canonicalRatios
    ? repairDraftMetricUnits(groundAdvisoryNarrative(repaired, canonicalRatios))
    : repaired;
  const bag: Record<string, number> = {};
  for (const entry of figureEntries(figures)) bag[entry.key] = entry.value;
  return repairDraftMetricUnits(quoteLiveScoreOnly(grounded, liveOverallFromRecord(bag)));
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
  if (compact.includes("pillar") || compact.includes("score")) return true;
  return /^(hasupload|connectedledgers|lowestweek|horizonweeks|cashrunwayweeks|overall|storedscore|liveoverall|invoices|snapshotid|draft)$/.test(
    compact,
  );
}

/** One value per metric. A period label wins when the figures are nested under it. */
function findingDisplayFigures(evidence: unknown): { key: string; value: number }[] {
  const record = evidenceRecord(evidence);
  const figures = record.figures;
  if (!figures || typeof figures !== "object" || Array.isArray(figures)) return [];
  const period = typeof record.period_label === "string" ? record.period_label.trim() : ""; // date-ok: figure bucket key, not printed copy
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
export function findingMetricContext(
  evidence: unknown,
  market: MoneyMarket = ZA_MARKET,
  canonicalRatios?: Record<string, number> | null,
): string | null {
  const clauses: { kind: number; rank: number; label: string; amount: string; days: boolean }[] = [];
  for (const { key, value } of correctQuotedFigures(
    withCanonicalRatioFigures(findingDisplayFigures(evidence), canonicalRatios),
  )) {
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
  canonicalRatios?: Record<string, number> | null,
): FindingCardCopy {
  const figures = findingFigureEntries(row.evidence);
  const title = formatFindingProse(row.title, figures, market, canonicalRatios);
  const detail = formatFindingProse(row.detail ?? "", figures, market, canonicalRatios);
  if (row.kind !== "data_request_draft") return { lead: title, context: null };
  const asked = requestAsk(row.evidence);
  const fromEvidence = asked ? formatFindingProse(asked, figures, market, canonicalRatios) : "";
  let lead = "";
  if (fromEvidence && !isMetricDump(fromEvidence)) lead = fromEvidence;
  else if (title && !isMetricDump(row.title)) lead = title;
  else if (detail && !isMetricDump(row.detail ?? "")) lead = detail;
  else lead = title || detail;
  const context = findingMetricContext(row.evidence, market, canonicalRatios);
  return { lead, context: context && !isMetricDump(lead) ? context : null };
}

/** One sentence. Percentages and currency are formatted; 0.7795 never survives. */
export function findingSentence(input: {
  title: string;
  detail?: string | null;
  figures?: Record<string, number> | readonly { key: string; value: number }[] | null;
  market?: MoneyMarket;
  canonicalRatios?: Record<string, number> | null;
  /** When set, a current-state health sentence quotes these numbers. */
  liveHealth?: LiveHealthQuote | null;
}): string {
  const market = input.market ?? ZA_MARKET;
  const title = input.title.replace(/\s+/g, " ").trim();
  const detail = (input.detail ?? "").replace(/\s+/g, " ").trim();
  let text = title;
  if (detail && detail !== title && !title.includes(detail)) {
    text = `${title.replace(/[.!?]$/, "")}. ${detail}`;
  }
  text = quoteLiveScoreOnly(
    preferLiveHealthProse(
      formatFindingProse(text, input.figures ?? {}, market, input.canonicalRatios),
      input.liveHealth,
    ),
    input.liveHealth?.overall,
  );
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
  return `${shortName(parts.from)} → ${shortName(parts.to)}: ${canonicalScoreProse(parts.text)}`;
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
