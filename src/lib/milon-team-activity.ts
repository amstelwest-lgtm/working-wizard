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
  queued_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type AgentFindingRow = {
  id: string;
  agent: AgentKey;
  client_id: string;
  title: string;
  detail: string | null;
  evidence: unknown;
  as_of: string | null;
  created_at: string;
};

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
    return { label: "Couldn't finish — will retry", tone: "idle", lastRun: null, muted: true };
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

export function findingFigures(evidence: unknown): Record<string, number> {
  const figures = evidenceRecord(evidence).figures;
  if (!figures || typeof figures !== "object" || Array.isArray(figures)) return {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(figures as Record<string, unknown>)) {
    const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(n)) out[key] = n;
  }
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

function replaceExactNumber(text: string, raw: string, formatted: string): string {
  if (!raw || raw === formatted) return text;
  const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`, "g"), formatted);
}

function scrubRawDecimals(text: string, figures: Record<string, number>, market: MoneyMarket): string {
  let next = text;
  for (const [key, value] of Object.entries(figures)) {
    const formatted = formatFigure(key, value, market);
    const raws = [...new Set([String(value), value.toFixed(4), value.toFixed(2)])].sort((a, b) => b.length - a.length);
    for (const raw of raws) next = replaceExactNumber(next, raw, formatted);
  }
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

/** One sentence. Percentages and currency are formatted; 0.7795 never survives. */
export function findingSentence(input: {
  title: string;
  detail?: string | null;
  figures?: Record<string, number> | null;
  market?: MoneyMarket;
}): string {
  const market = input.market ?? ZA_MARKET;
  const title = input.title.replace(/\s+/g, " ").trim();
  const detail = (input.detail ?? "").replace(/\s+/g, " ").trim();
  let text = title;
  if (detail && detail !== title && !title.includes(detail)) {
    text = `${title.replace(/[.!?]$/, "")}. ${detail}`;
  }
  text = scrubRawDecimals(text, input.figures ?? {}, market).replace(/\s+/g, " ").trim();
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
  return line;
}

export function deskSignoffInvite(ownerReviewed: boolean): string | null {
  return ownerReviewed ? "Invite your accountant to sign off" : null;
}
