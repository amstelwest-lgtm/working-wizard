/**
 * Safe layout for an owner-agent reply.
 * The model may send a headline, "- Label: value" lines, and a Next actions list.
 * Free text, including one blob with inline " - " bullets, still renders.
 * Output is text runs only. Callers must not turn it into HTML.
 */

export type TextRun = { text: string; bold: boolean };

export type OwnerReplyBlock =
  | { type: "p"; runs: TextRun[] }
  | { type: "ul"; items: TextRun[][] }
  | { type: "ol"; items: TextRun[][] };

export type OwnerReplyStat = { label: string; value: TextRun[] };

export type OwnerReplyModel = {
  headline: TextRun[];
  stats: OwnerReplyStat[];
  body: OwnerReplyBlock[];
  actions: TextRun[][];
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Theo's raw reply: one paragraph, raw bold, and inline " - " actions. */
export const OWNER_REPLY_BLOB =
  "Overall, healthy: **80/100** for Sep 2026, with revenue of R4,200,000 and net profit of R540,000 (net margin 12.9%). Gross margin is 50.0%, ahead of the 45% industry median. The weak spot is **operating margin at 2.9%** (industry median 10.0%), and operating profit of R120,000 against profit before tax of R45,000 shows how much interest is eating. Profit Drivers is your weakest pillar at 72/100. On the balance sheet, assets are R2,110,000 and equity R1,550,000 (liabilities are a derived R560,000, so treat that as an estimate). Debtor days are 33 (peer median 40), creditor days 45 (inside the 30\u201360 healthy band), and inventory days 37. The 13-week cash forecast stays in the black with zero negative weeks, and the advisory pack is still in Draft. Next actions: - Look at why operating costs and interest are squeezing operating margin, starting with refinancing the high-interest debt. - Get the action plan moving: nothing is started yet, and the capex benchmark task is due 2026-09-08.";

/** Eng1 shape with a bold Next actions heading and an ISO date. */
export const OWNER_REPLY_STRUCTURED_BOLD = [
  "Overall, healthy: **80/100** for Sep 2026.",
  "",
  "- Score: 80/100",
  "- Revenue: R4,200,000",
  "- Net profit: R540,000",
  "- Gross margin: 50.0%",
  "- Operating margin: 2.9%",
  "",
  "**Next actions**",
  "1. Look at why operating costs and interest are squeezing the margin.",
  "2. Get the action plan moving. The capex benchmark is due 2026-09-08.",
  "3. Ask the accountant to take the advisory pack out of Draft.",
].join("\n");

/** Same shape with a plain Next actions heading and a date that is already friendly. */
export const OWNER_REPLY_STRUCTURED_PLAIN = [
  "Cash stays in the black through the next quarter.",
  "",
  "- Opening cash: R420,000",
  "- Low point: R180,000",
  "- Negative weeks: 0",
  "",
  "Next actions",
  "1. Collect the two largest invoices by 8 Sep 2026.",
  "2. Hold the optional hire until cash clears the floor.",
].join("\n");

export function stripUnsafeMarkup(input: string): string {
  return input
    .replace(/\u0000/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\/?[a-zA-Z][^>]*>/g, "")
    .replace(/javascript\s*:/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
}

/** ISO dates become "8 Sep 2026". A date that is already friendly is left as written. */
export function formatIsoDates(input: string): string {
  return input.replace(/\b(\d{4})-(\d{2})-(\d{2})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?\b/g, (full, year, month, day) => {
    const y = Number(year);
    const m = Number(month);
    const d = Number(day);
    if (m < 1 || m > 12 || d < 1 || d > 31) return full;
    const stamp = new Date(Date.UTC(y, m - 1, d));
    if (stamp.getUTCFullYear() !== y || stamp.getUTCMonth() !== m - 1 || stamp.getUTCDate() !== d) return full;
    return `${d} ${MONTHS[m - 1]} ${y}`;
  });
}

export function parseRuns(input: string): TextRun[] {
  const runs: TextRun[] = [];
  const pattern = /\*\*([^*]+)\*\*/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input))) {
    if (match.index > last) runs.push({ text: input.slice(last, match.index), bold: false });
    if (match[1]) runs.push({ text: match[1], bold: true });
    last = match.index + match[0].length;
  }
  if (last < input.length) runs.push({ text: input.slice(last), bold: false });
  return runs.filter((run) => run.text.length > 0);
}

export function runsText(runs: TextRun[]): string {
  return runs.map((run) => run.text).join("");
}

export function ownerReplyPlainText(model: OwnerReplyModel): string {
  const parts = [
    runsText(model.headline),
    ...model.stats.map((stat) => `${stat.label}: ${runsText(stat.value)}`),
    ...model.body.flatMap((block) =>
      block.type === "p" ? [runsText(block.runs)] : block.items.map((item) => runsText(item)),
    ),
    ...model.actions.map((item) => runsText(item)),
  ].filter((part) => part.trim());
  return parts.join(" ");
}

function emptyModel(): OwnerReplyModel {
  return { headline: [], stats: [], body: [], actions: [] };
}

function isBlank(line: string): boolean {
  return line.trim() === "";
}

function isNextHeading(line: string): boolean {
  const plain = line.replace(/\*/g, "").trim().replace(/:$/, "").trim();
  return /^next actions$/i.test(plain);
}

function isStatLine(line: string): { label: string; value: string } | null {
  const match = line.match(/^\s*-\s+([^:\n]{1,48}):\s+(\S.*)$/);
  if (!match) return null;
  const label = match[1].trim();
  const value = match[2].trim();
  if (!label || !value) return null;
  return { label, value };
}

function numberedItem(line: string): string | null {
  const match = line.match(/^\s*\d+\.\s+(.+)$/);
  return match ? match[1].trim() : null;
}

function splitSentences(text: string): string[] {
  const parts = text
    .trim()
    .split(/(?<=[.!?])["')\]]*\s+(?=[A-Z*])/)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length ? parts : [text.trim()].filter(Boolean);
}

function peelNextActions(text: string): { prose: string; actions: string[] } | null {
  const lines = text.split("\n");
  const heading = lines.findIndex((line) => isNextHeading(line));
  let prose = "";
  let rest = "";
  if (heading > 0) {
    prose = lines.slice(0, heading).join("\n").trim();
    rest = lines.slice(heading + 1).join("\n").trim();
  } else {
    const inline = text.match(/^(.*\S)\s+(?:\*\*)?Next actions(?:\*\*)?\s*:\s*([\s\S]+)$/i);
    if (!inline) return null;
    prose = inline[1].trim();
    rest = inline[2].trim();
  }
  if (!prose || !rest) return null;
  let items: string[] = [];
  if (/^\s*\d+\.\s+/m.test(rest)) {
    items = rest
      .split("\n")
      .map((line) => numberedItem(line) ?? "")
      .filter(Boolean);
  } else if (/(?:^|\s)-\s+/.test(rest)) {
    items = rest
      .split(/\s+-\s+/)
      .map((item) => item.replace(/^[-–]\s*/, "").trim())
      .filter(Boolean);
  } else {
    return null;
  }
  if (!items.length) return null;
  return { prose, actions: items.slice(0, 3) };
}

function tryStructured(text: string): OwnerReplyModel | null {
  const lines = text.split("\n");
  let index = 0;
  while (index < lines.length && isBlank(lines[index])) index += 1;
  if (index >= lines.length) return null;
  const headlineLine = lines[index].trim();
  if (!headlineLine || isStatLine(headlineLine) || numberedItem(headlineLine) || isNextHeading(headlineLine)) {
    return null;
  }
  if (headlineLine.startsWith("- ") || /^\d+\.\s/.test(headlineLine)) return null;
  index += 1;
  while (index < lines.length && isBlank(lines[index])) index += 1;

  const stats: { label: string; value: string }[] = [];
  while (index < lines.length) {
    if (isBlank(lines[index])) break;
    const stat = isStatLine(lines[index]);
    if (!stat) break;
    stats.push(stat);
    index += 1;
  }
  if (stats.length < 3 || stats.length > 5) return null;

  while (index < lines.length && isBlank(lines[index])) index += 1;
  const actions: string[] = [];
  if (index < lines.length && isNextHeading(lines[index])) {
    index += 1;
    while (index < lines.length && isBlank(lines[index])) index += 1;
    while (index < lines.length && actions.length < 3) {
      if (isBlank(lines[index])) {
        index += 1;
        continue;
      }
      const item = numberedItem(lines[index]);
      if (!item) break;
      actions.push(item);
      index += 1;
    }
    while (index < lines.length && (isBlank(lines[index]) || numberedItem(lines[index]))) index += 1;
    if (!actions.length) return null;
  }

  while (index < lines.length && isBlank(lines[index])) index += 1;
  if (index < lines.length) return null;

  return {
    headline: parseRuns(headlineLine),
    stats: stats.map((stat) => ({ label: stat.label, value: parseRuns(stat.value) })),
    body: [],
    actions: actions.map((item) => parseRuns(item)),
  };
}

function pushParagraphs(body: OwnerReplyBlock[], sentences: string[]) {
  for (let i = 0; i < sentences.length; i += 2) {
    const text = sentences.slice(i, i + 2).join(" ");
    if (text.trim()) body.push({ type: "p", runs: parseRuns(text) });
  }
}

function parseProse(prose: string): { headline: TextRun[]; body: OwnerReplyBlock[] } {
  const lines = prose.split("\n");
  const hasBreak = lines.some((line, index) => index > 0 && (isBlank(line) || line.trim().startsWith("- ")));
  if (!hasBreak) {
    const sentences = splitSentences(prose);
    const [first, ...rest] = sentences;
    return {
      headline: first ? parseRuns(first) : [],
      body: rest.length ? groupSentences(rest) : [],
    };
  }

  let index = 0;
  while (index < lines.length && isBlank(lines[index])) index += 1;
  const headlineLine = lines[index]?.trim() ?? "";
  const headlineIsList = headlineLine.startsWith("- ") || Boolean(numberedItem(headlineLine));
  const headline = headlineIsList ? [] : parseRuns(headlineLine);
  if (!headlineIsList) index += 1;

  const body: OwnerReplyBlock[] = [];
  let paragraph: string[] = [];
  let bullets: string[] = [];

  function flushParagraph() {
    if (!paragraph.length) return;
    pushParagraphs(body, splitSentences(paragraph.join(" ").replace(/\s+/g, " ").trim()));
    paragraph = [];
  }
  function flushBullets() {
    if (!bullets.length) return;
    body.push({ type: "ul", items: bullets.map((item) => parseRuns(item)) });
    bullets = [];
  }

  for (; index < lines.length; index += 1) {
    const line = lines[index];
    if (isBlank(line)) {
      flushBullets();
      flushParagraph();
      continue;
    }
    const bullet = line.match(/^\s*-\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      bullets.push(bullet[1].trim());
      continue;
    }
    const numbered = numberedItem(line);
    if (numbered) {
      flushParagraph();
      flushBullets();
      const items = [numbered];
      while (index + 1 < lines.length) {
        const next = numberedItem(lines[index + 1]);
        if (!next) break;
        items.push(next);
        index += 1;
      }
      body.push({ type: "ol", items: items.map((item) => parseRuns(item)) });
      continue;
    }
    flushBullets();
    paragraph.push(line.trim());
  }
  flushBullets();
  flushParagraph();
  return { headline, body };
}

function groupSentences(sentences: string[]): OwnerReplyBlock[] {
  const body: OwnerReplyBlock[] = [];
  pushParagraphs(body, sentences);
  return body;
}

function expandInlineBullets(text: string): string {
  if (text.includes("\n") || !/\s-\s+/.test(text)) return text;
  const [head, ...rest] = text.split(/\s+-\s+/);
  const items = rest.map((item) => item.trim()).filter(Boolean);
  if (!head.trim() || !items.length) return text;
  return `${head.trim()}\n\n${items.map((item) => `- ${item}`).join("\n")}`;
}

export function formatOwnerReply(raw: string): OwnerReplyModel {
  const clean = formatIsoDates(stripUnsafeMarkup(raw)).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!clean) return emptyModel();
  const structured = tryStructured(clean);
  if (structured) return structured;

  const peeled = peelNextActions(clean);
  if (peeled) {
    const prose = parseProse(peeled.prose);
    return {
      headline: prose.headline,
      stats: [],
      body: prose.body,
      actions: peeled.actions.map((item) => parseRuns(item)),
    };
  }

  const expanded = expandInlineBullets(clean);
  const prose = parseProse(expanded);
  return { headline: prose.headline, stats: [], body: prose.body, actions: [] };
}
