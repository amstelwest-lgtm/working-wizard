/**
 * One live score snapshot for every narrative that quotes health.
 * Display does not splice new numbers into a stored sentence.
 */
import type { HealthPillarId, OverallHealth } from "./health-score.ts";
import { PILLAR_LABELS } from "./health-score.ts";
import { liveHealthFromBooks } from "./health-score.ts";
import { figuresPeriodLabelFrom } from "./statement-period.ts";
import { marketForClient } from "./market/scope.ts";
import { MONTHS } from "./market/date-presets.ts";

export const FIGURES_CHANGED_REGENERATE = "Figures changed since this was written, regenerate";

export const SCORE_SNAPSHOT_RULE =
  "When a tool returns score_snapshot, quote only that snapshot: its pillars, overall, weakest pillar, and period_label. Do not quote any other pillar score, and do not say a different pillar pulls the score down.";

export type HealthSnapshotPillar = {
  id: HealthPillarId;
  label: string;
  score: number;
};

export type HealthScoreSnapshot = {
  overall: number;
  pillars: HealthSnapshotPillar[];
  weakestLabel: string;
  weakestScore: number;
  /** Statement period from figuresPeriodLabelFrom, with the client market. */
  periodLabel: string | null;
};

const PILLAR_IDS: readonly HealthPillarId[] = ["profit", "assets", "financing", "cash"];

const MONTH_INDEX: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const MONTH_WORD =
  "January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";

function roundScore(value: number): number {
  return Math.round(value);
}

function normalizePeriod(label: string | null | undefined): string {
  return (label ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export function healthSnapshotFromBooks(input: {
  health: OverallHealth;
  periodLabel?: string | null;
}): HealthScoreSnapshot | null {
  if (input.health.overall == null || !Number.isFinite(input.health.overall)) return null;
  const pillars: HealthSnapshotPillar[] = [];
  for (const id of PILLAR_IDS) {
    const row = input.health.pillars.find((pillar) => pillar.id === id);
    if (row?.score == null || !Number.isFinite(row.score)) continue;
    pillars.push({ id, label: PILLAR_LABELS[id], score: roundScore(row.score) });
  }
  const weakest = input.health.weakestPillar;
  const weakestId = weakest?.id ?? pillars.slice().sort((a, b) => a.score - b.score)[0]?.id;
  const weakestRow = pillars.find((pillar) => pillar.id === weakestId) ?? null;
  const weakestLabel = weakest?.label?.trim() || weakestRow?.label || "";
  const weakestScore =
    weakest?.score != null && Number.isFinite(weakest.score) ? roundScore(weakest.score) : weakestRow?.score;
  if (!weakestLabel || weakestScore == null) return null;
  return {
    overall: roundScore(input.health.overall),
    pillars,
    weakestLabel,
    weakestScore,
    periodLabel: input.periodLabel?.trim() || null,
  };
}

export function healthSnapshotHash(snapshot: HealthScoreSnapshot): string {
  const pillars = [...snapshot.pillars]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((pillar) => `${pillar.id}:${pillar.score}`)
    .join(",");
  return `o:${snapshot.overall}|w:${snapshot.weakestLabel.toLowerCase()}:${snapshot.weakestScore}|p:${pillars}|d:${normalizePeriod(snapshot.periodLabel)}`;
}

export function snapshotEvidenceFields(snapshot: HealthScoreSnapshot): {
  score_snapshot: HealthScoreSnapshot;
  score_snapshot_hash: string;
} {
  return { score_snapshot: snapshot, score_snapshot_hash: healthSnapshotHash(snapshot) };
}

function finiteScore(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? roundScore(n) : null;
}

function pillarId(value: unknown): HealthPillarId | null {
  if (value === "profit" || value === "assets" || value === "financing" || value === "cash") return value;
  return null;
}

/** Tool payload from get_health. Missing pillars are not invented. */
export function healthSnapshotFromTool(
  record: Record<string, unknown> | null | undefined,
  periodLabel?: string | null,
): HealthScoreSnapshot | null {
  if (!record) return null;
  const overall = finiteScore(record.overall);
  if (overall == null) return null;
  const pillars: HealthSnapshotPillar[] = [];
  if (Array.isArray(record.pillars)) {
    for (const item of record.pillars) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      const id = pillarId(row.id);
      const score = finiteScore(row.score);
      if (!id || score == null) continue;
      pillars.push({ id, label: PILLAR_LABELS[id], score });
    }
  }
  const weakestRaw = record.weakest;
  const weakest =
    weakestRaw && typeof weakestRaw === "object" ? (weakestRaw as Record<string, unknown>) : null;
  const weakestLabel =
    (typeof record.weakestLabel === "string" && record.weakestLabel.trim()) ||
    (typeof weakest?.label === "string" && weakest.label.trim()) ||
    pillars.slice().sort((a, b) => a.score - b.score)[0]?.label ||
    "";
  const weakestScore =
    finiteScore(record.weakestScore) ??
    finiteScore(weakest?.score) ??
    pillars.slice().sort((a, b) => a.score - b.score)[0]?.score;
  if (!weakestLabel || weakestScore == null) return null;
  const period =
    (typeof periodLabel === "string" && periodLabel.trim()) ||
    (typeof record.periodLabel === "string" ? record.periodLabel.trim() : "") ||
    (typeof record.period_label === "string" ? record.period_label.trim() : "") || // date-ok: stored snapshot period, compared not printed
    null;
  return { overall, pillars, weakestLabel, weakestScore, periodLabel: period };
}

export function readStoredHealthSnapshot(evidence: unknown): HealthScoreSnapshot | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const raw = (evidence as { score_snapshot?: unknown }).score_snapshot;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return healthSnapshotFromTool(raw as Record<string, unknown>, (raw as { periodLabel?: unknown }).periodLabel as string);
}

export function healthSnapshotsDiffer(stored: HealthScoreSnapshot, live: HealthScoreSnapshot): boolean {
  if (stored.overall !== live.overall) return true;
  if (stored.weakestLabel.trim().toLowerCase() !== live.weakestLabel.trim().toLowerCase()) return true;
  if (stored.weakestScore !== live.weakestScore) return true;
  if (normalizePeriod(stored.periodLabel) !== normalizePeriod(live.periodLabel)) return true;
  const liveById = new Map(live.pillars.map((pillar) => [pillar.id, pillar.score]));
  const storedById = new Map(stored.pillars.map((pillar) => [pillar.id, pillar.score]));
  for (const pillar of live.pillars) {
    if (storedById.get(pillar.id) !== pillar.score) return true;
  }
  for (const pillar of stored.pillars) {
    const now = liveById.get(pillar.id);
    if (now == null || now !== pillar.score) return true;
  }
  return false;
}

type QuoteLike = {
  overall?: number | null;
  weakestLabel?: string | null;
  weakestScore?: number | null;
  periodLabel?: string | null;
  pillars?: readonly { id?: string; label: string; score: number | null }[] | null;
};

export function snapshotFromLiveQuote(live: QuoteLike | null | undefined): HealthScoreSnapshot | null {
  if (!live || live.overall == null || !Number.isFinite(live.overall)) return null;
  if (!live.weakestLabel?.trim() || live.weakestScore == null || !Number.isFinite(live.weakestScore)) return null;
  const pillars: HealthSnapshotPillar[] = [];
  for (const pillar of live.pillars ?? []) {
    const id = pillarId(pillar.id) ?? pillarId(pillarLabelFromWord(pillar.label)?.toLowerCase());
    if (!id || pillar.score == null || !Number.isFinite(pillar.score)) continue;
    pillars.push({ id, label: PILLAR_LABELS[id], score: roundScore(pillar.score) });
  }
  return {
    overall: roundScore(live.overall),
    pillars,
    weakestLabel: live.weakestLabel.trim(),
    weakestScore: roundScore(live.weakestScore),
    periodLabel: live.periodLabel?.trim() || null,
  };
}

/** End month of a statement span. "1 Jan 2026 – 30 Sep 2026" is Sep. */
export function badgeMonthFromPeriod(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const text = value.trim();
  const hits: { index: number; month: number }[] = [];
  const words = new RegExp(`\\b(${MONTH_WORD})\\b`, "gi");
  for (const match of text.matchAll(words)) {
    const key = match[1]!.toLowerCase();
    const month = MONTH_INDEX[key];
    if (month == null || match.index == null) continue;
    hits.push({ index: match.index, month });
  }
  const iso = /\b(\d{4})-(\d{2})(?:-\d{2})?\b/g;
  for (const match of text.matchAll(iso)) {
    const month = Number(match[2]) - 1;
    if (month < 0 || month > 11 || match.index == null) continue;
    hits.push({ index: match.index, month });
  }
  if (hits.length === 0) return null;
  hits.sort((a, b) => a.index - b.index);
  return MONTHS[hits[hits.length - 1]!.month] ?? null;
}

const PILLAR_ALT =
  "profit drivers|profitability|asset efficiency|financing\\s*(?:&|and)\\s*solvency|leverage\\s*(?:&|and)\\s*finance|cash\\s*(?:&|and)\\s*working capital|cash flow|financing|assets|profit|cash";

function pillarLabelFromWord(word: string): string | null {
  const compact = word.toLowerCase().replace(/[^a-z]/g, "");
  if (compact.startsWith("profit")) return "Profit";
  if (compact.startsWith("asset")) return "Assets";
  if (compact.startsWith("financ") || compact.startsWith("leverage")) return "Financing";
  if (compact.startsWith("cash")) return "Cash";
  return null;
}

function pillarScore(snapshot: HealthScoreSnapshot, label: string): number | null {
  const row = snapshot.pillars.find((pillar) => pillar.label.toLowerCase() === label.toLowerCase());
  return row?.score ?? null;
}

function isHistoricalScoreNote(text: string): boolean {
  if (/\bfrom\b[\s\S]{0,48}\bto\b/i.test(text) && /\d/.test(text)) return true;
  return /\b(?:dropped|fell|rose|climbed|declined|improved)\b/i.test(text) && /\d/.test(text);
}

/** True when a current-state claim names a pillar, overall, or weakest the snapshot does not. */
export function healthClaimsDisagree(text: string, live: HealthScoreSnapshot): boolean {
  const weakestAt = new RegExp(
    `\\b(${PILLAR_ALT})\\b,?\\s+(?:is\\s+)?the weakest pillar at\\s+(\\d{1,3})\\b`,
    "gi",
  );
  const withWeak = new RegExp(`\\bwith\\s+(${PILLAR_ALT})\\s+weakest at\\s+(\\d{1,3})\\b`, "gi");
  for (const pattern of [weakestAt, withWeak]) {
    for (const match of text.matchAll(pattern)) {
      const label = pillarLabelFromWord(match[1] ?? "");
      const score = Number(match[2]);
      if (!label || label.toLowerCase() !== live.weakestLabel.toLowerCase() || score !== live.weakestScore) {
        return true;
      }
    }
  }
  const overallOf = /\boverall(?:\s+health)?\s+score\s+of\s+(\d{1,3})\b/gi;
  for (const match of text.matchAll(overallOf)) {
    if (Number(match[1]) !== live.overall) return true;
  }
  const healthIs = /\bHealth is\s+(\d{1,3})\b/gi;
  for (const match of text.matchAll(healthIs)) {
    if (Number(match[1]) !== live.overall) return true;
  }
  const band = /\bscores\s+(\d{1,3})\s*\((?:critical|watch|healthy)\)/gi;
  for (const match of text.matchAll(band)) {
    if (Number(match[1]) !== live.overall) return true;
  }
  const pillarNum = new RegExp(`\\b(${PILLAR_ALT})\\s+(?:scores?\\s+)?(\\d{1,3})\\b`, "gi");
  for (const match of text.matchAll(pillarNum)) {
    const label = pillarLabelFromWord(match[1] ?? "");
    const score = Number(match[2]);
    if (!label) continue;
    const liveScore = pillarScore(live, label);
    if (liveScore == null || liveScore !== score) return true;
  }
  const paren = new RegExp(`\\b(?:Weakest:\\s*)?(${PILLAR_ALT})\\s*\\((\\d{1,3})\\)`, "gi");
  for (const match of text.matchAll(paren)) {
    const label = pillarLabelFromWord(match[1] ?? "");
    const score = Number(match[2]);
    if (!label) continue;
    const liveScore = pillarScore(live, label);
    if (liveScore == null || liveScore !== score) return true;
  }
  const pulls = new RegExp(`\\b(${PILLAR_ALT})\\s+pulls\\s+the\\s+(?:overall\\s+)?score\\s+down\\b`, "gi");
  for (const match of text.matchAll(pulls)) {
    const label = pillarLabelFromWord(match[1] ?? "");
    if (!label || label.toLowerCase() !== live.weakestLabel.toLowerCase()) return true;
  }
  return false;
}

export type PresentedHealthNarrative = {
  text: string;
  stale: boolean;
  regenerate: boolean;
};

/**
 * Stored prose stays when it does not argue with the snapshot.
 * A disagreement replaces the whole narrative. Numbers are not rewritten in place.
 * A two-period note with no current-state claim stays as it was written.
 */
export function presentHealthNarrative(
  text: string,
  live: HealthScoreSnapshot | null | undefined,
  stored?: HealthScoreSnapshot | null,
): PresentedHealthNarrative {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return { text: "", stale: false, regenerate: false };
  if (!live) return { text: trimmed, stale: false, regenerate: false };
  if (stored && healthSnapshotsDiffer(stored, live)) {
    return { text: FIGURES_CHANGED_REGENERATE, stale: true, regenerate: true };
  }
  if (isHistoricalScoreNote(trimmed) && !healthClaimsDisagree(trimmed, live)) {
    return { text: trimmed, stale: false, regenerate: false };
  }
  if (healthClaimsDisagree(trimmed, live)) {
    return { text: FIGURES_CHANGED_REGENERATE, stale: true, regenerate: true };
  }
  return { text: trimmed, stale: false, regenerate: false };
}

/** One sentence. Every number comes from the snapshot. */
export function renderHealthNarrative(snapshot: HealthScoreSnapshot): string {
  const pillars = snapshot.pillars;
  let list = "";
  if (pillars.length === 1) list = ` ${pillars[0]!.label} scores ${pillars[0]!.score}.`;
  else if (pillars.length > 1) {
    const head = pillars
      .slice(0, -1)
      .map((pillar) => `${pillar.label} scores ${pillar.score}`)
      .join(", ");
    const tail = pillars[pillars.length - 1]!;
    list = ` ${head} and ${tail.label} scores ${tail.score}.`;
  }
  return `${snapshot.weakestLabel} is the weakest pillar at ${snapshot.weakestScore}, against an overall health score of ${snapshot.overall}.${list}`;
}

export function healthSnapshotPromptBlock(snapshot: HealthScoreSnapshot): string {
  const pillars = snapshot.pillars.map((pillar) => `${pillar.label} ${pillar.score}`).join(", ");
  return `Live score snapshot ${healthSnapshotHash(snapshot)}. Quote only these figures. Period: ${snapshot.periodLabel ?? "unknown"}. Overall ${snapshot.overall}. ${pillars}. Weakest: ${snapshot.weakestLabel} ${snapshot.weakestScore}. Do not quote any other pillar score, overall, or period.`;
}

type SnapshotQuery = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

/**
 * Books on file, read at generation time. A miss does not block the write.
 * The client is the Supabase service client. It is accepted as unknown so the
 * PostgREST generics are not expanded at every call.
 */
export async function loadHealthScoreSnapshot(
  db: unknown,
  clientId: string,
  market?: unknown,
): Promise<HealthScoreSnapshot | null> {
  const query = db as SnapshotQuery;
  try {
    const { data, error } = await query
      .from("clients")
      .select("financials, cashflow, financials_updated_at, market")
      .eq("id", clientId)
      .maybeSingle();
    if (error || !data) return null;
    const financials =
      data.financials && typeof data.financials === "object" && !Array.isArray(data.financials)
        ? (data.financials as Record<string, unknown>)
        : null;
    const dateMarket = marketForClient({ market: data.market ?? market });
    const health = liveHealthFromBooks({
      financials,
      cashflow: data.cashflow,
      financialsUpdatedAt: typeof data.financials_updated_at === "string" ? data.financials_updated_at : null,
      market: dateMarket,
    });
    const periodLabel = figuresPeriodLabelFrom(financials, null, dateMarket);
    return healthSnapshotFromBooks({ health, periodLabel });
  } catch {
    return null;
  }
}
