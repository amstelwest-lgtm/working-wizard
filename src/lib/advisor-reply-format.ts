/**
 * Shared reply split for every bot. Labels jammed against values ("Health78")
 * and follow-ups glued into the sentence stay out of the body.
 */

export const ADVISOR_FOLLOW_UPS = [
  "Explain this ratio in plain terms",
  "What's the industry benchmark?",
  "How can I speed up collections?",
  "What's my cash conversion cycle?",
  "Which cost line is growing fastest?",
  "How do I cut fixed costs?",
  "What's my sales per employee?",
  "Can I afford an extra hire next quarter?",
  "What should I focus on this month?",
  "Where am I weakest vs industry?",
] as const;

const FIGURE_LABELS = [
  "Gross margin",
  "Operating margin",
  "Net margin",
  "Profit before tax",
  "Operating profit",
  "Gross profit",
  "Net profit",
  "Total liabilities",
  "Total assets",
  "Total equity",
  "Debtor days",
  "Creditor days",
  "Inventory days",
  "Cash runway",
  "Opening cash",
  "Health",
  "Revenue",
  "Cash",
  "Runway",
];

export type AdvisorFigure = { label: string; value: string };

export type AdvisorReplyParts = {
  prose: string;
  figures: AdvisorFigure[];
  suggestions: string[];
};

export type AdvisorReplyBlock =
  | { kind: "p"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] };

const SUGGESTION_CAP = 4;

function tidy(text: string): string {
  return text
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^\s*[,:;]+\s*/, "")
    .trim();
}

function extractKnownFollowUps(raw: string): { text: string; suggestions: string[] } {
  const suggestions: string[] = [];
  const lower = raw.toLowerCase();
  let cursor = 0;
  let rest = "";
  while (cursor < raw.length) {
    let best: { at: number; phrase: string } | null = null;
    for (const phrase of ADVISOR_FOLLOW_UPS) {
      const at = lower.indexOf(phrase.toLowerCase(), cursor);
      if (at >= 0 && (best == null || at < best.at)) best = { at, phrase };
    }
    if (!best) {
      rest += raw.slice(cursor);
      break;
    }
    rest += raw.slice(cursor, best.at);
    if (!suggestions.includes(best.phrase)) suggestions.push(best.phrase);
    cursor = best.at + best.phrase.length;
  }
  return { text: rest, suggestions };
}

function extractGluedQuestions(raw: string): { text: string; suggestions: string[] } {
  const suggestions: string[] = [];
  const text = raw.replace(/([a-z])([A-Z][^?\n]{6,100}\?)/g, (_full, prev: string, question: string) => {
    const clean = question.trim();
    if (clean && !suggestions.includes(clean)) suggestions.push(clean);
    return prev;
  });
  return { text, suggestions };
}

function labelAt(text: string, from: number, label: string): number {
  const lower = text.toLowerCase();
  const needle = label.toLowerCase();
  let at = from;
  while (at < text.length) {
    const found = lower.indexOf(needle, at);
    if (found < 0) return -1;
    const before = found === 0 ? "" : text[found - 1] ?? "";
    if (!before || !/[A-Za-z]/.test(before)) return found;
    at = found + 1;
  }
  return -1;
}

function jammedValue(after: string): { value: string; length: number } | null {
  if (/^:\s/.test(after)) return null;
  const match = after.match(
    /^(?::)?((?:R|\$|€|£)\s?\d[\d \u00a0]*(?:[.,]\d+)?|\d[\d \u00a0]*(?:[.,]\d+)?%?)/,
  );
  if (!match?.[1]) return null;
  const value = match[1].replace(/\s+/g, " ").trim();
  if (!/\d/.test(value)) return null;
  return { value, length: match[0].length };
}

function extractJammedFigures(raw: string): { text: string; figures: AdvisorFigure[] } {
  const figures: AdvisorFigure[] = [];
  let rest = "";
  let i = 0;
  while (i < raw.length) {
    let hit: { at: number; label: string; value: string; end: number } | null = null;
    for (const label of FIGURE_LABELS) {
      const at = labelAt(raw, i, label);
      if (at < 0) continue;
      const after = raw.slice(at + label.length);
      const value = jammedValue(after);
      if (!value) continue;
      if (!hit || at < hit.at || (at === hit.at && label.length > hit.label.length)) {
        hit = { at, label, value: value.value, end: at + label.length + value.length };
      }
    }
    if (!hit) {
      rest += raw.slice(i);
      break;
    }
    rest += raw.slice(i, hit.at);
    if (!figures.some((figure) => figure.label === hit.label)) {
      figures.push({ label: hit.label, value: hit.value });
    }
    i = hit.end;
  }
  return { text: rest, figures };
}

/** Pull follow-ups and jammed figures out of one reply. The prose is what remains. */
export function parseAdvisorReply(raw: string): AdvisorReplyParts {
  const source = (typeof raw === "string" ? raw : "").replace(/[’‘]/g, "'").replace(/\r\n?/g, "\n");
  const known = extractKnownFollowUps(source);
  const glued = extractGluedQuestions(known.text);
  const figures = extractJammedFigures(glued.text);
  const suggestions = [...known.suggestions, ...glued.suggestions].slice(0, SUGGESTION_CAP);
  return { prose: tidy(figures.text), figures: figures.figures, suggestions };
}

/** Paragraphs and lists, keeping each source line so a break stays a break. */
export function advisorReplyBlocks(text: string): AdvisorReplyBlock[] {
  const lines = (typeof text === "string" ? text : "").replace(/\r\n?/g, "\n").split("\n");
  const blocks: AdvisorReplyBlock[] = [];
  let list: { kind: "ul" | "ol"; items: string[] } | null = null;
  const flushList = () => {
    if (list && list.items.length) blocks.push(list);
    list = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      flushList();
      continue;
    }
    const ul = line.match(/^[-•]\s+(.*)$/);
    const ol = line.match(/^\d+[.)]\s+(.*)$/);
    if (ul) {
      if (!list || list.kind !== "ul") {
        flushList();
        list = { kind: "ul", items: [] };
      }
      list.items.push(ul[1] ?? "");
      continue;
    }
    if (ol) {
      if (!list || list.kind !== "ol") {
        flushList();
        list = { kind: "ol", items: [] };
      }
      list.items.push(ol[1] ?? "");
      continue;
    }
    flushList();
    blocks.push({ kind: "p", text: line });
  }
  flushList();
  return blocks;
}
