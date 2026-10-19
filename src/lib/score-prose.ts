/**
 * One score on screen is the bare number. Legacy pillar names in stored
 * notes become Profit, Assets, Financing, or Cash. A ratio nickname stays
 * a sub-factor, never the pillar title.
 */

const LEGACY_PILLAR: readonly [RegExp, string][] = [
  [/\bprofit drivers\b/gi, "Profit"],
  [/\bLeverage\s*(?:&|and)\s*Finance\b/gi, "Financing"],
  [/\bFinancing\s*(?:&|and)\s*Solvency\b/gi, "Financing"],
  [/\bFinancing\s*\/\s*debt\b/gi, "Financing"],
  [/\bAsset efficiency\b/g, "Assets"],
  [/\bCash\s*(?:&|and)\s*working capital\b/gi, "Cash"],
];

function bareScore(raw: string): string | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  return String(Math.round(n));
}

/** Stored notes and briefs. Margins such as 8.6% stay percentages. */
export function canonicalScoreProse(text: string): string {
  let next = text;
  for (const [pattern, label] of LEGACY_PILLAR) next = next.replace(pattern, label);
  next = next.replace(/\b(\d{1,3}(?:\.\d+)?)\s*\/\s*100\b/g, (full, raw: string) => bareScore(raw) ?? full);
  next = next.replace(
    /\b(\d{1,3}(?:\.\d+)?)\s+out of\s+100\b/gi,
    (full, raw: string) => bareScore(raw) ?? full,
  );
  next = next.replace(
    /\b(scores?)\s+(\d{1,3}(?:\.\d+)?)\s*%/gi,
    (full, word: string, raw: string) => {
      const score = bareScore(raw);
      if (!score) return full;
      return `${word.toLowerCase() === "scores" ? "scores" : "score"} ${score}`;
    },
  );
  return next;
}

/** Live pillars a stored note should quote when the books have moved. */
export type LiveHealthQuote = {
  overall: number | null;
  weakestLabel: string | null;
  weakestScore: number | null;
  /** Chip word. The pack body uses it in "scores 54 (critical)". */
  label?: string | null;
  /** Pillar lines such as "Cash (93)" take these scores. */
  pillars?: readonly { label: string; score: number | null }[] | null;
};

const PILLAR_WORD =
  "profit drivers|profitability|profit|assets|financing|cash flow|cash";

/** A two-period comparison stays as it was recorded. */
function isHistoricalScoreNote(text: string): boolean {
  if (/\bfrom\b[\s\S]{0,48}\bto\b/i.test(text) && /\d/.test(text)) return true;
  return /\b(?:dropped|fell|rose|climbed|declined|improved)\b/i.test(text) && /\d/.test(text);
}

/**
 * A current-state finding keeps its words and takes the live overall and
 * the live weakest pillar. Stored rows are not rewritten.
 */
export function preferLiveHealthProse(text: string, live?: LiveHealthQuote | null): string {
  if (!text || !live || isHistoricalScoreNote(text)) return text;
  let next = text;
  let rewroteWeakest = false;
  if (live.weakestLabel && live.weakestScore != null && Number.isFinite(live.weakestScore)) {
    const score = String(Math.round(live.weakestScore));
    const label = live.weakestLabel;
    const at = new RegExp(
      `\\b(?:${PILLAR_WORD})\\b(\\s+is the weakest pillar at\\s+)\\d{1,3}\\b`,
      "gi",
    );
    const withWeak = new RegExp(
      `\\bwith\\s+(?:${PILLAR_WORD})\\s+weakest at\\s+\\d{1,3}\\b`,
      "gi",
    );
    const afterAt = next.replace(at, `${label}$1${score}`);
    const afterWith = afterAt.replace(withWeak, `with ${label} weakest at ${score}`);
    rewroteWeakest = afterWith !== next;
    next = afterWith;
  }
  if (live.overall != null && Number.isFinite(live.overall)) {
    const n = String(Math.round(live.overall));
    next = next.replace(/\bHealth is\s+\d{1,3}\b/gi, `Health is ${n}`);
    next = next.replace(/\boverall score of\s+\d{1,3}\b/gi, `overall score of ${n}`);
  }
  if (rewroteWeakest) {
    next = next.replace(/,?\s*tied with\s+[A-Za-z][A-Za-z &/]*\s+at\s+\d{1,3}\b/gi, "");
  }
  return next.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();
}

/**
 * Pack body. The stored section keeps its words. The overall and the weakest
 * pillar take the live score. A two-period sentence stays as it was written.
 */
export function overlayLiveHealthProse(text: string, live?: LiveHealthQuote | null): string {
  if (!text || !live || isHistoricalScoreNote(text)) return text;
  let next = preferLiveHealthProse(text, live);
  if (live.overall != null && Number.isFinite(live.overall)) {
    const n = String(Math.round(live.overall));
    const band = (live.label ?? "").trim().toLowerCase();
    if (band === "critical" || band === "watch" || band === "healthy") {
      next = next.replace(
        /\bscores\s+\d{1,3}\s*\((?:critical|watch|healthy)\)/gi,
        `scores ${n} (${band})`,
      );
      next = next.replace(/\b(?:critical|watch|healthy) at\s+\d{1,3}\b/gi, `${band} at ${n}`);
    }
    next = next.replace(/\bscores\s+\d{1,3}\b/gi, `scores ${n}`);
  }
  if (live.weakestLabel && live.weakestScore != null && Number.isFinite(live.weakestScore)) {
    const score = String(Math.round(live.weakestScore));
    const label = live.weakestLabel;
    next = next.replace(
      new RegExp(`\\bWeakest:\\s*(?:${PILLAR_WORD})\\s*\\(\\d{1,3}\\)`, "gi"),
      `Weakest: ${label} (${score})`,
    );
    next = next.replace(
      new RegExp(`\\b(?:${PILLAR_WORD})\\s+is the weakest pillar\\b`, "gi"),
      `${label} is the weakest pillar`,
    );
  }
  for (const pillar of live.pillars ?? []) {
    if (pillar.score == null || !Number.isFinite(pillar.score) || !pillar.label.trim()) continue;
    const score = String(Math.round(pillar.score));
    const label = pillar.label.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    next = next.replace(new RegExp(`\\b${label}\\s*\\(\\d{1,3}\\)`, "gi"), `${pillar.label.trim()} (${score})`);
  }
  return next.replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim();
}

/** "Bottom-Line Strength" → "Bottom-line strength". */
export function factorDisplayName(ratioName: string): string {
  const words = ratioName.trim().split(/\s+/).filter(Boolean);
  return words
    .map((word, index) =>
      word
        .split("-")
        .map((part, partIndex) => {
          const lower = part.toLowerCase();
          if (!lower) return lower;
          if (index === 0 && partIndex === 0) return lower.charAt(0).toUpperCase() + lower.slice(1);
          return lower;
        })
        .join("-"),
    )
    .join(" ");
}
