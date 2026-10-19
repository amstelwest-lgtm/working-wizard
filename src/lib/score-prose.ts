/**
 * One score on screen is the bare number. Legacy pillar names in stored
 * notes become Profit, Assets, Financing, or Cash. A ratio nickname stays
 * a sub-factor, never the pillar title.
 */

const LEGACY_PILLAR: readonly [RegExp, string][] = [
  [/\bProfit Drivers\b/g, "Profit"],
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
