/**
 * One live score snapshot for every narrative that quotes health.
 * Display does not splice new numbers into a stored sentence.
 */
import type { HealthPillarId, OverallHealth } from "./health-score.ts";
import { PILLAR_LABELS } from "./health-score.ts";
import { healthWithoutEvidence, liveHealthFromBooks } from "./health-score.ts";
import { figuresPeriodLabelFrom, readStatementMeta } from "./statement-period.ts";
import { marketForClient } from "./market/scope.ts";
import { MONTHS } from "./market/date-presets.ts";
import { hasFinancialEvidence } from "./client-metrics.ts";
import { parseOperatingProfile } from "./client-profile.ts";
import { clientIndustryDisplay } from "./profile-signals.ts";
import { resolvePriorSnapshot } from "./prior-period.ts";

export const FIGURES_CHANGED_REGENERATE = "Figures changed since this was written, regenerate";

/** Regen refused because the card's snapshot is not the one the server would store. */
export const FIGURES_CHANGED_RELOAD = "Figures changed — reload";

/**
 * Bumped when the same books produce a different liveHealthFromBooks result.
 * 1 is the scorer the 1020B narrative was written against (Cash 78).
 * 2 leaves a missing cash ratio unscored and uses the statement's own cover,
 * which scores those books Cash 34. A stored hash from an older engine cannot match.
 */
export const SCORE_ENGINE_VERSION = "2";

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
  return `e:${SCORE_ENGINE_VERSION}|o:${snapshot.overall}|w:${snapshot.weakestLabel.toLowerCase()}:${snapshot.weakestScore}|p:${pillars}|d:${normalizePeriod(snapshot.periodLabel)}`;
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

export function readStoredScoreSnapshotHash(evidence: unknown): string | null {
  if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return null;
  const hash = (evidence as { score_snapshot_hash?: unknown }).score_snapshot_hash;
  return typeof hash === "string" && hash.trim() ? hash.trim() : null;
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

const CONNECTORS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "so",
  "but",
  "with",
  "against",
  "of",
  "at",
  "to",
  "for",
  "from",
  "in",
  "on",
  "by",
  "is",
  "are",
  "was",
  "be",
  "its",
  "that",
  "this",
  "these",
  "those",
  "current",
  "reading",
  "overall",
  "score",
  "scores",
  "scored",
  "pillar",
  "pillars",
  "weakest",
  "strongest",
  "health",
  "figures",
  "period",
  "tied",
  "while",
  "than",
  "then",
  "also",
  "still",
  "now",
]);

/** Known score sentences. Longer clauses first so a weakest-pillar phrase is not split. */
function templateClausePatterns(): RegExp[] {
  const pillar = PILLAR_ALT;
  return [
    new RegExp(`\\b(?:${pillar})\\b,?\\s+(?:is\\s+)?the weakest pillar at\\s+\\d{1,3}\\b`, "gi"),
    new RegExp(`\\bwith\\s+(?:${pillar})\\s+weakest at\\s+\\d{1,3}\\b`, "gi"),
    new RegExp(`\\b(?:${pillar})\\s+pulls\\s+the\\s+(?:overall\\s+)?score\\s+down\\b`, "gi"),
    /\boverall(?:\s+health)?\s+score\s+of\s+\d{1,3}\b/gi,
    /\bHealth is\s+\d{1,3}\b/gi,
    /\bscores\s+\d{1,3}\s*\((?:critical|watch|healthy)\)/gi,
    new RegExp(`\\b(?:Weakest:\\s*|Strongest pillar:\\s*)?(?:${pillar})\\s*\\(\\d{1,3}\\)`, "gi"),
    new RegExp(`\\b(?:${pillar})\\s+at\\s+\\d{1,3}\\b`, "gi"),
    new RegExp(`\\b(?:${pillar})\\s+(?:scores?\\s+)?\\d{1,3}\\b`, "gi"),
    new RegExp(`\\b\\d{1,2}\\s+(?:${MONTH_WORD})\\s+\\d{4}\\b`, "gi"),
    new RegExp(`\\b(?:${MONTH_WORD})(?:\\s+\\d{4})?\\b`, "gi"),
    /\b\d{4}-\d{2}(?:-\d{2})?\b/g,
  ];
}

function withoutTemplateClauses(text: string): string {
  let next = text;
  for (const pattern of templateClausePatterns()) next = next.replace(pattern, " ");
  return next;
}

function residueWords(text: string): string[] {
  return withoutTemplateClauses(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 0 && !CONNECTORS.has(word) && !/^\d+$/.test(word));
}

/** True when every word is a known score or period template. */
export function isTemplateHealthSentence(text: string): boolean {
  if (residueWords(text).length > 0) return false;
  return templateClausePatterns().some((pattern) => pattern.test(text));
}

/**
 * A score number that sits outside the known templates. Percentages, day
 * counts, and years are not scores.
 */
function freeFormStaleScore(text: string, live: HealthScoreSnapshot): boolean {
  if (!/\b(?:health|score|pillar|profit|assets|financing|cash)\b/i.test(text)) return false;
  const liveScores = new Set<number>([live.overall, live.weakestScore, ...live.pillars.map((pillar) => pillar.score)]);
  const outside = withoutTemplateClauses(text);
  for (const match of outside.matchAll(/\b(\d{1,3})\b/g)) {
    const raw = match[0];
    const at = match.index ?? 0;
    const around = outside.slice(Math.max(0, at - 8), at + raw.length + 8);
    if (/%/.test(around) || /\bdays?\b/i.test(around)) continue;
    const score = Number(raw);
    if (!liveScores.has(score)) return true;
  }
  return false;
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
 * A sentence made of the known score templates is replaced with the live
 * snapshot sentence. Free-form prose that still quotes a score we cannot
 * rewrite becomes the regenerate marker. A two-period note stays stored.
 */
export function presentHealthNarrative(
  text: string,
  live: HealthScoreSnapshot | null | undefined,
  stored?: HealthScoreSnapshot | null,
): PresentedHealthNarrative {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (!trimmed) return { text: "", stale: false, regenerate: false };
  if (!live) return { text: trimmed, stale: false, regenerate: false };
  if (isHistoricalScoreNote(trimmed) && !healthClaimsDisagree(trimmed, live)) {
    return { text: trimmed, stale: false, regenerate: false };
  }
  const disagrees = healthClaimsDisagree(trimmed, live);
  const storedDiffers = Boolean(stored && healthSnapshotsDiffer(stored, live));
  if (isTemplateHealthSentence(trimmed) && (disagrees || storedDiffers)) {
    return { text: renderHealthNarrative(live), stale: false, regenerate: false };
  }
  if (disagrees || freeFormStaleScore(trimmed, live)) {
    return { text: FIGURES_CHANGED_REGENERATE, stale: true, regenerate: true };
  }
  return { text: trimmed, stale: false, regenerate: false };
}

/** Weakest pillar and overall only. The other pillar numbers stay on the score card. */
export function renderHealthNarrativeLead(snapshot: HealthScoreSnapshot): string {
  return `${snapshot.weakestLabel} is the weakest pillar at ${snapshot.weakestScore}, against an overall health score of ${snapshot.overall}.`;
}

/** The page's lead, then the regenerate action. Stored numbers are not in this string. */
export function staleHealthNarrative(snapshot: HealthScoreSnapshot): string {
  return `${renderHealthNarrativeLead(snapshot)} ${FIGURES_CHANGED_REGENERATE}`;
}

/**
 * Split a narrative that ends with the regenerate action.
 * The lead is what the screen prints. The action is the button.
 */
export function splitRegenerateNarrative(text: string): { lead: string; action: boolean } {
  const trimmed = text.replace(/\s+/g, " ").trim();
  const bare = trimmed.replace(/[.!?]+$/, "");
  if (bare === FIGURES_CHANGED_REGENERATE) return { lead: "", action: true };
  if (bare.endsWith(FIGURES_CHANGED_REGENERATE)) {
    const lead = bare.slice(0, bare.length - FIGURES_CHANGED_REGENERATE.length).trim();
    if (lead) return { lead, action: true };
  }
  return { lead: trimmed, action: false };
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
  const lead = renderHealthNarrativeLead(snapshot).replace(/\.$/, "");
  return `${lead}.${list}`;
}

type FigureBag = Map<string, number>;

function rememberScore(bag: FigureBag, key: string, value: unknown) {
  const score = finiteScore(value);
  if (score == null || score < 0 || score > 100 || !key.trim()) return;
  const raw = key.trim().toLowerCase();
  bag.set(raw, score);
  bag.set(raw.replace(/[\s_:-]+/g, ""), score);
}

function scoreFromBag(bag: FigureBag, ...keys: string[]): number | null {
  for (const key of keys) {
    const raw = key.trim().toLowerCase();
    if (bag.has(raw)) return bag.get(raw)!;
    const compact = raw.replace(/[\s_:-]+/g, "");
    if (bag.has(compact)) return bag.get(compact)!;
  }
  return null;
}

function legacyFigureBag(
  evidence: unknown,
  figures?: Record<string, number> | readonly { key: string; value: number }[] | null,
): FigureBag {
  const bag: FigureBag = new Map();
  const record =
    evidence && typeof evidence === "object" && !Array.isArray(evidence)
      ? (evidence as Record<string, unknown>)
      : null;
  const metrics = record?.metrics;
  if (Array.isArray(metrics)) {
    for (const item of metrics) {
      if (!item || typeof item !== "object") continue;
      const row = item as { metric?: unknown; value?: unknown };
      if (typeof row.metric === "string") rememberScore(bag, row.metric, row.value);
    }
  }
  const nested = record?.figures;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    for (const [key, value] of Object.entries(nested as Record<string, unknown>)) rememberScore(bag, key, value);
  }
  if (Array.isArray(figures)) {
    for (const entry of figures) rememberScore(bag, entry.key, entry.value);
  } else if (figures && typeof figures === "object") {
    for (const [key, value] of Object.entries(figures)) rememberScore(bag, key, value);
  }
  return bag;
}

/**
 * A finding written before score_snapshot_hash. Pillar keys and overall come
 * from evidence.metrics, then evidence.figures. stored_score is not the
 * narrative's overall. A missing period is filled by the caller.
 */
export function healthSnapshotFromLegacyEvidence(
  evidence: unknown,
  figures?: Record<string, number> | readonly { key: string; value: number }[] | null,
): HealthScoreSnapshot | null {
  const bag = legacyFigureBag(evidence, figures);
  const pillars: HealthSnapshotPillar[] = [];
  for (const id of PILLAR_IDS) {
    const score = scoreFromBag(bag, `pillar:${id}`, id);
    if (score == null) continue;
    pillars.push({ id, label: PILLAR_LABELS[id], score });
  }
  const overall = scoreFromBag(bag, "overall", "live_overall", "liveoverall");
  if (overall == null || pillars.length === 0) return null;
  const weakest = pillars.slice().sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))[0];
  if (!weakest) return null;
  const record =
    evidence && typeof evidence === "object" && !Array.isArray(evidence)
      ? (evidence as { period_label?: unknown })
      : null;
  const period = typeof record?.period_label === "string" ? record.period_label.trim() : ""; // date-ok: stored snapshot period, compared not printed
  return {
    overall,
    pillars,
    weakestLabel: weakest.label,
    weakestScore: weakest.score,
    periodLabel: period || null,
  };
}

export type ReconciledHealthNarrative = {
  text: string;
  stale: boolean;
  regenerate: boolean;
};

/**
 * What the sentence itself names. Null when it names no score.
 * True when a named overall, pillar, or weakest score is not the live one.
 * The engine prefix, the period string, and a missing hash are not scores.
 */
export function citedHealthDisagreement(
  text: string,
  live: HealthScoreSnapshot,
): boolean | null {
  let claims = 0;
  let differ = false;
  const claim = (ok: boolean) => {
    claims += 1;
    if (!ok) differ = true;
  };
  const weakestAt = new RegExp(
    `\\b(${PILLAR_ALT})\\b,?\\s+(?:is\\s+)?the weakest pillar at\\s+(\\d{1,3})\\b`,
    "gi",
  );
  const withWeak = new RegExp(`\\bwith\\s+(${PILLAR_ALT})\\s+weakest at\\s+(\\d{1,3})\\b`, "gi");
  for (const pattern of [weakestAt, withWeak]) {
    for (const match of text.matchAll(pattern)) {
      const label = pillarLabelFromWord(match[1] ?? "");
      const score = Number(match[2]);
      claim(Boolean(label) && label!.toLowerCase() === live.weakestLabel.toLowerCase() && score === live.weakestScore);
    }
  }
  const overallOf = /\boverall(?:\s+health)?\s+score\s+of\s+(\d{1,3})\b/gi;
  for (const match of text.matchAll(overallOf)) claim(Number(match[1]) === live.overall);
  const healthIs = /\bHealth is\s+(\d{1,3})\b/gi;
  for (const match of text.matchAll(healthIs)) claim(Number(match[1]) === live.overall);
  const band = /\bscores\s+(\d{1,3})\s*\((?:critical|watch|healthy)\)/gi;
  for (const match of text.matchAll(band)) claim(Number(match[1]) === live.overall);
  const pillarNum = new RegExp(`\\b(${PILLAR_ALT})\\s+(?:scores?\\s+|at\\s+)?(\\d{1,3})\\b`, "gi");
  for (const match of text.matchAll(pillarNum)) {
    const label = pillarLabelFromWord(match[1] ?? "");
    const score = Number(match[2]);
    if (!label) continue;
    const liveScore = pillarScore(live, label);
    claim(liveScore != null && liveScore === score);
  }
  const paren = new RegExp(`\\b(?:Weakest:\\s*)?(${PILLAR_ALT})\\s*\\((\\d{1,3})\\)`, "gi");
  for (const match of text.matchAll(paren)) {
    const label = pillarLabelFromWord(match[1] ?? "");
    const score = Number(match[2]);
    if (!label) continue;
    const liveScore = pillarScore(live, label);
    claim(liveScore != null && liveScore === score);
  }
  const pulls = new RegExp(`\\b(${PILLAR_ALT})\\s+pulls\\s+the\\s+(?:overall\\s+)?score\\s+down\\b`, "gi");
  for (const match of text.matchAll(pulls)) {
    const label = pillarLabelFromWord(match[1] ?? "");
    claim(Boolean(label) && label!.toLowerCase() === live.weakestLabel.toLowerCase());
  }
  if (claims === 0) return freeFormStaleScore(text, live) ? true : null;
  return differ;
}

function liveGrossMarginPct(canonicalRatios?: Record<string, number> | null): number | null {
  const raw = canonicalRatios?.["Gross Margin"] ?? canonicalRatios?.grossMargin;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw > 0 && raw <= 1 ? raw * 100 : raw;
}

/**
 * True when the sentence cites a gross margin that is not on the score card.
 * Null when it cites no margin.
 */
export function citedGrossMarginDisagreement(
  text: string,
  canonicalRatios?: Record<string, number> | null,
): boolean | null {
  const live = liveGrossMarginPct(canonicalRatios);
  if (live == null) return null;
  const patterns = [
    /\bgross margin(?:\s+is|\s+at|\s+of|\s+stands at)?\s+(\d+(?:\.\d+)?)\s*%/gi,
    /\bGM(?:\s+is|\s+at)?\s+(\d+(?:\.\d+)?)\s*%/gi,
  ];
  let claims = 0;
  let differ = false;
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      claims += 1;
      if (Math.abs(Number(match[1]) - live) > 0.6) differ = true;
    }
  }
  if (claims === 0) return null;
  return differ;
}

/**
 * Stale only when the sentence cites a score the live snapshot does not have.
 * A missing hash, an engine prefix, or a period string cannot force it.
 * A sentence that cites no score stays as stored.
 */
export function reconcileStoredHealthNarrative(input: {
  text: string;
  live?: HealthScoreSnapshot | null;
  evidence?: unknown;
  figures?: Record<string, number> | readonly { key: string; value: number }[] | null;
  storedHash?: string | null;
  storedHealth?: HealthScoreSnapshot | null;
  forceStale?: boolean;
  canonicalRatios?: Record<string, number> | null;
}): ReconciledHealthNarrative {
  const text = input.text.replace(/\s+/g, " ").trim();
  if (!text) return { text: "", stale: false, regenerate: false };
  const live = input.live ?? null;
  if (!live) return { text, stale: false, regenerate: false };
  if (isHistoricalScoreNote(text) && !healthClaimsDisagree(text, live)) {
    return { text, stale: false, regenerate: false };
  }
  const storedSnap = input.storedHealth ?? readStoredHealthSnapshot(input.evidence);
  if (storedSnap && !healthSnapshotsDiffer(storedSnap, live)) {
    const marginCheck = citedGrossMarginDisagreement(text, input.canonicalRatios);
    const citedCheck = citedHealthDisagreement(text, live);
    if (marginCheck !== true && citedCheck !== true) {
      const parts = splitRegenerateNarrative(text);
      const clean = parts.action
        ? parts.lead.trim() || renderHealthNarrative(live)
        : text;
      return { text: clean, stale: false, regenerate: false };
    }
  }
  const margin = citedGrossMarginDisagreement(text, input.canonicalRatios);
  if (margin === true) return { text: staleHealthNarrative(live), stale: true, regenerate: true };
  const cited = citedHealthDisagreement(text, live);
  if (cited === true) return { text: staleHealthNarrative(live), stale: true, regenerate: true };
  return { text, stale: false, regenerate: false };
}

function findingProse(title: string, detail: string | null | undefined): string {
  const head = title.replace(/\s+/g, " ").trim();
  const body = (detail ?? "").replace(/\s+/g, " ").trim();
  if (!body || body === head || head.includes(body)) return head;
  return `${head.replace(/[.!?]$/, "")}. ${body}`;
}

/**
 * When a regen save matches the live score snapshot, persist the reconciled
 * sentence instead of leaving the regenerate marker in the row.
 */
export function persistReconciledFindingCopy(input: {
  title: string;
  detail: string | null | undefined;
  evidence: unknown;
  live: HealthScoreSnapshot | null | undefined;
  canonicalRatios?: Record<string, number> | null;
}): { title: string; detail: string | null; changed: boolean } {
  const storedTitle = input.title.replace(/\s+/g, " ").trim();
  const storedDetail = (input.detail ?? "").replace(/\s+/g, " ").trim() || null;
  const storedText = findingProse(storedTitle, storedDetail);
  if (!storedText || !input.live) {
    return { title: storedTitle, detail: storedDetail, changed: false };
  }
  const reconciled = reconcileStoredHealthNarrative({
    text: storedText,
    live: input.live,
    evidence: input.evidence,
    storedHealth: readStoredHealthSnapshot(input.evidence),
    storedHash: readStoredScoreSnapshotHash(input.evidence),
    canonicalRatios: input.canonicalRatios,
  });
  if (reconciled.regenerate) {
    const freshTitle = renderHealthNarrative(input.live).replace(/\s+/g, " ").trim();
    if (!freshTitle || citedHealthDisagreement(freshTitle, input.live) === true) {
      return { title: storedTitle, detail: storedDetail, changed: false };
    }
    return { title: freshTitle, detail: null, changed: true };
  }
  const clean = reconciled.text.replace(/\s+/g, " ").trim();
  if (!clean) {
    return { title: storedTitle, detail: storedDetail, changed: false };
  }
  const hadRegen = splitRegenerateNarrative(storedText).action;
  if (clean === storedText && !hadRegen) {
    return { title: storedTitle, detail: storedDetail, changed: false };
  }
  return { title: clean, detail: null, changed: true };
}

/**
 * The card sends the hash and sentence it rendered. A server snapshot with
 * different figures must not be written. Matching figures return the title.
 */
export function guardReconciledFindingWrite(input: {
  server: HealthScoreSnapshot;
  clientHash: string;
  liveSentence: string;
  title: string;
}): { write: true; title: string } | { write: false; error: string } {
  const sentence = input.liveSentence.replace(/\s+/g, " ").trim();
  const title = input.title.replace(/\s+/g, " ").trim();
  const hash = input.clientHash.trim();
  if (!sentence || !hash || hash !== healthSnapshotHash(input.server) || title !== sentence) {
    return { write: false, error: FIGURES_CHANGED_RELOAD };
  }
  return { write: true, title };
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

type PageSnapshotRow = {
  period_label?: string | null;
  period_date?: string | null;
  financials?: Record<string, unknown> | null;
  created_at?: string | null;
  pinned?: boolean | null;
};

/** Newest created_at, matching pickCurrentSnapshot. No pin column on the table. */
function currentPageSnapshot(rows: readonly PageSnapshotRow[]): PageSnapshotRow | null {
  const list = rows.filter((row) => row != null);
  if (!list.length) return null;
  const pinned = list.find((row) => row.pinned === true);
  if (pinned) return pinned;
  return [...list].sort((a, b) => {
    const created = Date.parse(b.created_at ?? "") - Date.parse(a.created_at ?? "");
    if (Number.isFinite(created) && created !== 0) return created;
    return (b.period_date ?? "").localeCompare(a.period_date ?? "");
  })[0] ?? null;
}

function asFinancials(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/**
 * The Health page score: liveHealthFromBooks with the client's year start,
 * industry, prior snapshot, and the current snapshot's period label.
 */
export function pageHealthScoreSnapshot(input: {
  financials?: Record<string, unknown> | null;
  cashflow?: unknown;
  financialsUpdatedAt?: string | null;
  market?: unknown;
  operatingProfile?: unknown;
  clientName?: string | null;
  snapshots?: readonly PageSnapshotRow[];
  now?: Date;
}): HealthScoreSnapshot | null {
  const market = marketForClient({ market: input.market });
  const financials = asFinancials(input.financials);
  const profile = parseOperatingProfile(input.operatingProfile);
  const fyStartMonth = profile?.fyStartMonth ?? market.fyStartMonthDefault;
  const industry = clientIndustryDisplay(input.clientName, profile);
  const statementMeta = readStatementMeta(financials, market);
  const prior = resolvePriorSnapshot(
    (input.snapshots ?? []).map((row) => ({
      period_label: row.period_label ?? "",
      period_date: row.period_date ?? "",
      financials: asFinancials(row.financials),
      created_at: row.created_at ?? null,
    })),
    input.now ?? new Date(),
    { periodEnd: statementMeta.periodEnd, financials },
  );
  const current = currentPageSnapshot(input.snapshots ?? []);
  const scored = liveHealthFromBooks({
    financials,
    cashflow: input.cashflow,
    financialsUpdatedAt: input.financialsUpdatedAt ?? null,
    priorFinancials: prior?.financials ?? null,
    fyStartMonth,
    market,
    industry,
    timeZone: market.timezone,
    now: input.now,
  });
  const health = hasFinancialEvidence({ financials, cashflow: input.cashflow })
    ? scored
    : healthWithoutEvidence(scored);
  const periodLabel = figuresPeriodLabelFrom(financials, current?.period_label ?? null, market);
  return healthSnapshotFromBooks({ health, periodLabel });
}

type PageHealthDb = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        maybeSingle: () => PromiseLike<{
          data: Record<string, unknown> | null;
          error: { message: string } | null;
        }>;
        order: (column: string, options: { ascending: boolean }) => {
          limit: (count: number) => PromiseLike<{
            data: Record<string, unknown>[] | null;
            error: { message: string } | null;
          }>;
        };
      };
    };
  };
};

/**
 * Health-page snapshot for regenerate. Agent runs keep loadHealthScoreSnapshot.
 */
export async function loadPageHealthScoreSnapshot(
  db: unknown,
  clientId: string,
  now?: Date,
): Promise<HealthScoreSnapshot | null> {
  const query = db as PageHealthDb;
  try {
    const { data, error } = await query
      .from("clients")
      .select("financials, cashflow, financials_updated_at, market, operating_profile, name")
      .eq("id", clientId)
      .maybeSingle();
    if (error || !data) return null;
    const snaps = await query
      .from("client_financial_snapshots")
      .select("period_label, period_date, financials, created_at")
      .eq("client_id", clientId)
      .order("created_at", { ascending: false })
      .limit(24);
    const rows = snaps.error || !snaps.data ? [] : snaps.data;
    return pageHealthScoreSnapshot({
      financials: asFinancials(data.financials),
      cashflow: data.cashflow,
      financialsUpdatedAt: typeof data.financials_updated_at === "string" ? data.financials_updated_at : null,
      market: data.market,
      operatingProfile: data.operating_profile,
      clientName: typeof data.name === "string" ? data.name : null,
      snapshots: rows.map((row) => ({
        period_label: typeof row.period_label === "string" ? row.period_label : null,
        period_date: typeof row.period_date === "string" ? row.period_date : null,
        financials: asFinancials(row.financials),
        created_at: typeof row.created_at === "string" ? row.created_at : null,
      })),
      now,
    });
  } catch {
    return null;
  }
}

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
