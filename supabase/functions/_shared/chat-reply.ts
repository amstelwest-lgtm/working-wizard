/**
 * Chat reply shape for the Financial Manager, Analyst and Advisor chats
 * (ask-ai and milon-bot, owner and accountant).
 *
 * Shape agreed with the renderer:
 *   Headline sentence (no markdown heading)
 *
 *   - Label: value          (3–5 lines, skipped when there are no figures)
 *
 *   **Next actions**
 *   1. …                    (at most 3)
 *
 * Pure functions only, so the edge functions and the Node tests share them.
 */

export type ChatAgent = "financial_manager" | "analyst" | "advisor";

export function parseChatAgent(raw: unknown): ChatAgent | null {
  return raw === "financial_manager" || raw === "analyst" || raw === "advisor" ? raw : null;
}

/** Prompt block that fixes the reply shape. */
export function chatReplyFormatRules(copyPack: "za" | "us" | null = null): string {
  const money =
    copyPack === "us"
      ? "Amounts use the US dollar format, for example $4,200,000."
      : copyPack === "za"
        ? "Amounts use the South African rand format, for example R4,200,000."
        : "Amounts use the currency format already shown in the figures you were given, for example R4,200,000 or $4,200,000.";
  return `Reply format (always, unless the user asks for more detail):
- Line 1: one plain sentence that answers the question. No heading marks, no bold.
- Then a blank line, then 3–5 key figures, one per line, each as "- Label: value". ${money} Percentages have one decimal place, for example 12.9%.
- Then a blank line, then the line **Next actions** on its own, then at most 3 numbered items ("1. ", "2. ", "3. "), each one short plain sentence.
- Skip the figures section when there are no figures (for example small talk or a definition). Skip Next actions when there is nothing to do.
- Dates look like 8 Sep 2026. Never write ISO dates such as 2026-09-08.
- Plain words. No jargon dumps. About 120 words in total.
- Use bold sparingly and never for whole sentences. No tables, no code blocks, no headings.
- Never put list items inline in a sentence. Each bullet or numbered item is on its own line.`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 2026-09-08 → 8 Sep 2026. Returns null for anything that is not a real calendar date. */
export function humanDate(iso: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return null;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day > daysInMonth) return null;
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

const ISO_DATE = /(?<![\d\-/.])(\d{4})-(\d{2})-(\d{2})(?![\d\-/:T])/g;

function humanizeDates(text: string): string {
  // Leave inline code spans alone.
  return text
    .split(/(`[^`\n]*`)/)
    .map((part) =>
      part.startsWith("`") && part.endsWith("`") && part.length > 1
        ? part
        : part.replace(ISO_DATE, (whole, y, mo, d) => humanDate(`${y}-${mo}-${d}`) ?? whole),
    )
    .join("");
}

const NEXT_ACTIONS_TAIL =
  /(?:^|\s)(?:#{1,6}\s*)?(?:\*\*|__)?\s*next (?:actions|steps)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i;
const NEXT_ACTIONS_LINE =
  /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*next (?:actions|steps)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i;
// " - " that starts a list item: after sentence punctuation (or line start),
// followed by a capital letter, a quote or bold. "R5 - R6" and "2025 - 2026" stay.
const INLINE_BULLET = /(^|[:.!?)])\s+[-•*]\s+(?=[A-Z"'“*])/g;

function isBullet(line: string): boolean {
  return /^\s*- \S/.test(line);
}
function isNumbered(line: string): boolean {
  return /^\s*\d{1,2}[.)] \S/.test(line);
}
function isListLine(line: string): boolean {
  return isBullet(line) || isNumbered(line);
}

/** Split one prose line that carries inline " - item - item" runs. */
function splitInlineBullets(line: string): string[] {
  if (isListLine(line) || /^\s*\|/.test(line)) return [line];
  const marks: number[] = [];
  INLINE_BULLET.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_BULLET.exec(line))) {
    marks.push(m.index + m[1].length);
  }
  if (marks.length === 0) return [line];
  const head = line.slice(0, marks[0]).trimEnd();
  const items: string[] = [];
  for (let i = 0; i < marks.length; i++) {
    const seg = line.slice(marks[i], marks[i + 1] ?? line.length).trim();
    items.push(seg.replace(/^[-•*]\s+/, "- "));
  }
  // A single inline dash is only a list when a "Next actions:" lead-in or a colon introduces it.
  if (items.length === 1 && !/:\s*$/.test(head)) return [line];
  const out: string[] = [];
  const tail = NEXT_ACTIONS_TAIL.exec(head);
  if (tail) {
    const before = head.slice(0, tail.index).trim();
    if (before) out.push(before);
    out.push("**Next actions**");
  } else if (head) {
    out.push(head);
  }
  out.push(...items);
  return out;
}

/**
 * Light clean-up of a model reply into the agreed shape. It only moves line
 * breaks, rewrites ISO dates, list markers and the Next actions heading.
 * Numbers, words and fenced code are left alone.
 */
export function normalizeChatReply(raw: string): string {
  if (typeof raw !== "string" || !raw.trim()) return raw;
  const text = raw.replace(/\r\n?/g, "\n");

  // Keep fenced code blocks out of every rule.
  const chunks = text.split(/(^```[\s\S]*?^```[ \t]*$)/m);
  const lines: string[] = [];
  const FENCE = "\u0000FENCE";
  const fences: string[] = [];
  for (const chunk of chunks) {
    if (/^```/.test(chunk)) {
      fences.push(chunk);
      lines.push(`${FENCE}${fences.length - 1}`);
      continue;
    }
    for (const rawLine of humanizeDates(chunk).split("\n")) {
      lines.push(...splitInlineBullets(rawLine));
    }
  }

  // Line-level shape: list markers, headings, the Next actions heading.
  let inNext = false;
  let nextCount = 0;
  const shaped: string[] = [];
  let seenText = false;
  for (let line of lines) {
    if (line.startsWith(FENCE)) {
      shaped.push(line);
      inNext = false;
      continue;
    }
    line = line.replace(/\s+$/, "");
    if (NEXT_ACTIONS_LINE.test(line)) {
      shaped.push("**Next actions**");
      inNext = true;
      nextCount = 0;
      seenText = true;
      continue;
    }
    // "* item" / "• item" → "- item"
    line = line.replace(/^(\s*)[*•]\s+(?=\S)/, "$1- ");
    // Headline must not be a markdown heading.
    if (!seenText && /^#{1,6}\s+\S/.test(line)) line = line.replace(/^#{1,6}\s+/, "");
    if (inNext) {
      if (isBullet(line) || isNumbered(line)) {
        nextCount += 1;
        line = line.replace(/^\s*(?:- |\d{1,2}[.)] )/, `${nextCount}. `);
      } else if (line.trim() && !isListLine(line)) {
        inNext = false;
      }
    }
    if (line.trim()) seenText = true;
    shaped.push(line);
  }

  // Blank lines: one before a list block and before the Next actions heading,
  // none between the heading and its first item, and no runs of blanks.
  const out: string[] = [];
  for (let i = 0; i < shaped.length; i++) {
    const line = shaped[i];
    const prev = out.length ? out[out.length - 1] : "";
    const prevBlank = !prev.trim();
    if (line === "**Next actions**") {
      if (out.length && !prevBlank) out.push("");
      out.push(line);
      continue;
    }
    if (isListLine(line)) {
      const prevIsList = isListLine(prev);
      const prevIsHeading = prev === "**Next actions**";
      if (out.length && !prevBlank && !prevIsList && !prevIsHeading) out.push("");
      if (prevBlank && out.length >= 2 && out[out.length - 2] === "**Next actions**") out.pop();
      out.push(line);
      continue;
    }
    if (!line.trim()) {
      if (out.length && !prevBlank) out.push("");
      continue;
    }
    // Prose straight after a list starts a new block.
    if (out.length && isListLine(prev)) out.push("");
    out.push(line);
  }
  while (out.length && !out[out.length - 1].trim()) out.pop();

  return out
    .map((line) => (line.startsWith(FENCE) ? fences[Number(line.slice(FENCE.length))] : line))
    .join("\n");
}

export type TaggedTurn = { role?: unknown; content?: unknown; agent?: unknown };

/**
 * History the client sent, kept only when it belongs to this agent's thread.
 * A turn tagged with another agent is dropped. When the request names an
 * agent, untagged turns are kept (the client already scopes the thread);
 * a request without an agent drops every agent-tagged turn.
 */
export function scopeHistoryToAgent<T extends TaggedTurn>(
  history: T[] | undefined | null,
  agent: ChatAgent | null,
): T[] {
  if (!Array.isArray(history)) return [];
  return history.filter((turn) => {
    if (!turn || typeof turn !== "object") return false;
    const tag = turn.agent;
    if (tag === undefined || tag === null || tag === "") return true;
    return agent !== null && tag === agent;
  });
}

/** Cache key scope: one definitional answer per audience + agent, never shared across agents. */
export function chatCacheScope(
  audience: "owner" | "accountant",
  agent: ChatAgent | null,
  copyPack: string | null = null,
): string {
  return `${audience}|${agent ?? "none"}|${copyPack ?? "any"}`;
}
