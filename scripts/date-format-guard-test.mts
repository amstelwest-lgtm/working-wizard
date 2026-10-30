/**
 * Date-format guard. Outcome-shaped: a canonical helper called with the
 * wrong market or the wrong preset fails here.
 * Run: pnpm test:date-format-guard
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { formatAssignmentNote, handoffProgressCaption } from "../src/lib/action-handoff.ts";
import { formatDate, formatDateRange, formatEventTime } from "../src/lib/market/format.ts";
import { marketForClient, marketForFirm } from "../src/lib/market/scope.ts";
import { dataAsOfLabel } from "../src/lib/portfolio-dashboard.ts";
import {
  figuresPeriodLabelFrom,
  readStatementMeta,
  reportDataPeriodLabel,
  statementSpanLabel,
} from "../src/lib/statement-period.ts";

const ROOT = process.cwd();
const ROOTS = ["src", "supabase/functions", "api", "emails", "mobile"];
const SKIP_FILES = new Set(["src/lib/market/format.ts", "src/lib/market/date-presets.ts"]);
const SLOT_CLOCK_FILE = "src/lib/trial-call-slots.ts";

const FORMATTERS = [
  "formatSignedOffDateTime",
  "formatReviewDateTime",
  "formatCalendarDay",
  "formatEventTime",
  "formatDateTime",
  "formatWeekHeader",
  "formatMonthDay",
  "formatNamedDay",
  "formatMonthLabel",
  "formatIssuedOn",
  "formatDecisionWhen",
  "formatInviteExpiry",
  "trialEndDateLabel",
  "dataAsOfLabel",
  "handoffClock",
  "formatAssignmentNote",
  "formatSyncStamp",
  "formatIsoDateUTC",
  "formatIsoDates",
  "formatOwnerReply",
  "humanCalendarDay",
  "humanizeIsoDates",
  "calendarDayFromIso",
  "calendarDayLabel",
  "dateTimeLabel",
  "weekHeaderFromIso",
  "weekHeaderLabel",
  "clockLabel",
  "formatAsOf",
  "figuresCheckedLine",
  "storedYearToDateEnd",
  "formatClock",
  "formatDate",
  "formatDateRange",
  "formatStatementPeriodLabel",
  "reportDataPeriodLabel",
  "figuresPeriodLabelFrom",
  "readStatementMeta",
  "statementYearLine",
  "budgetActualFromFinancials",
  "budgetVersusStatement",
].sort((a, b) => b.length - a.length);

/** Range and statement helpers take the market as a required trailing arg. */
const MIN_ARGS: Record<string, number> = {
  formatDateRange: 3,
  formatStatementPeriodLabel: 3,
  figuresPeriodLabelFrom: 3,
  budgetVersusStatement: 3,
};

function minArgs(name: string): number {
  return MIN_ARGS[name] ?? 2;
}

const PRESET_LITERALS = new Set([
  "calendarDayFromIso",
  "calendarDayLabel",
  "dateTimeLabel",
  "clockLabel",
  "weekHeaderLabel",
]);

const DATE_OK = /\/\/\s*date-ok:\s*(.*)$/;

type Finding = { line: number; endLine: number; message: string };

function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "'" || c === '"') {
      const end = readQuoted(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (c === "`") {
      const end = skipTemplateOpaque(src, i);
      out += src.slice(i, end);
      i = end;
      continue;
    }
    if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
      continue;
    }
    if (src.startsWith("//", i)) {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += " ".repeat(stop - i);
      i = stop;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

function lineAt(src: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < src.length; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

function dateOkReason(line: string): string | null {
  const match = DATE_OK.exec(line);
  if (!match) return null;
  return match[1].trim();
}

function readQuoted(src: string, i: number): number {
  const quote = src[i]!;
  i++;
  while (i < src.length && src[i] !== quote) {
    if (src[i] === "\\") i++;
    i++;
  }
  return Math.min(src.length, i + 1);
}

function skipTemplateOpaque(src: string, i: number): number {
  i++;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (src[i] === "`") return i + 1;
    if (src[i] === "$" && src[i + 1] === "{") {
      i = skipBraceOpaque(src, i + 1);
      continue;
    }
    i++;
  }
  return i;
}

function skipBraceOpaque(src: string, i: number): number {
  let depth = 1;
  i++;
  while (i < src.length && depth > 0) {
    const c = src[i];
    if (c === "'" || c === '"') {
      i = readQuoted(src, i);
      continue;
    }
    if (c === "`") {
      i = skipTemplateOpaque(src, i);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

function readCall(src: string, open: number): { text: string; end: number; argCount: number } | null {
  let i = open + 1;
  let depth = 1;
  let brace = 0;
  let bracket = 0;
  let commas = 0;
  const start = i;
  while (i < src.length) {
    const c = src[i]!;
    if (c === "'" || c === '"') {
      i = readQuoted(src, i);
      continue;
    }
    if (c === "`") {
      i = skipTemplateOpaque(src, i);
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") {
      depth--;
      if (depth === 0) {
        const text = src.slice(start, i);
        return { text, end: i, argCount: text.trim() === "" ? 0 : commas + 1 };
      }
    } else if (c === "{") brace++;
    else if (c === "}") brace = Math.max(0, brace - 1);
    else if (c === "[") bracket++;
    else if (c === "]") bracket = Math.max(0, bracket - 1);
    else if (c === "," && depth === 1 && brace === 0 && bracket === 0) commas++;
    i++;
  }
  return null;
}

function templateSpans(src: string): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"') {
      i = readQuoted(src, i);
      continue;
    }
    if (c === "`") {
      const start = i;
      const end = skipTemplateOpaque(src, i);
      spans.push([start, end]);
      i = end;
      continue;
    }
    i++;
  }
  return spans;
}

function inTemplate(spans: Array<[number, number]>, index: number): boolean {
  return spans.some(([start, end]) => index >= start && index < end);
}

function scanSource(rel: string, raw: string): Finding[] {
  const src = stripComments(raw);
  const findings: Finding[] = [];
  const lines = src.split("\n");
  lines.forEach((line, index) => {
    const lineNo = index + 1;
    const push = (message: string) => findings.push({ line: lineNo, endLine: lineNo, message: `${rel}:${lineNo} ${message}` });
    if (line.includes("toLocaleDateString")) push("formats a date with toLocaleDateString");
    if (/toLocaleDateString\s*\(\s*['"]en-(?:ZA|GB)['"]/.test(line)) {
      push("formats a date day-first with toLocaleDateString");
    }
    if (/(['"])d MMM yyyy\1/i.test(line)) push("uses a day-first date format literal");
    const printsStoredLabel =
      /\$\{[^}\n]*\.period_label\b/.test(line) || /\{[^}\n]*\.period_label\b/.test(line);
    const formatsStoredLabel =
      /statementSpanLabel|formatDateRange|readStatementMeta|figuresPeriodLabelFrom|formatStatementPeriodLabel|reportDataPeriodLabel|datedPeriodLabel|homeStatementsLine/.test(
        line,
      );
    if (printsStoredLabel && !formatsStoredLabel) push("prints a stored period label");
    if (line.includes("toLocaleTimeString")) push("formats a date with toLocaleTimeString");
    if (/(?:date|Date|At|at|_at|time)\w*\.toLocaleString\(/.test(line)) {
      push("formats a date with toLocaleString");
    }
    if (/toLocale(?:String|TimeString)\s*\([^)\n]{0,200}\{(?:[^}\n]{0,400})(?:month|day|year|hour)\s*:/.test(line)) {
      push("formats a date with toLocaleString options");
    }
    if (/\bIntl\.DateTimeFormat\b/.test(line)) push("uses Intl.DateTimeFormat");
    if (/from\s+["'](?:date-fns|dayjs)["']|require\(\s*["'](?:date-fns|dayjs)["']/.test(line)) {
      push("imports date-fns or dayjs");
    }
    if (/padStart\(\s*2\b/.test(line) && /hour|minute/i.test(line)) {
      push("pads an hour or minute by hand");
    }
    if (/\b[\w$]*(?:iso|date|Date|At|_at|time)\w*\.slice\(\s*(?:0\s*,\s*16|11)\b/.test(line)) {
      push("slices an ISO string");
    }
  });

  const spans = templateSpans(src);
  const clock = /(?:getHours|getMinutes|getUTCHours|getUTCMinutes)\s*\(/g;
  for (const match of src.matchAll(clock)) {
    const index = match.index ?? 0;
    if (!inTemplate(spans, index)) continue;
    const lineNo = lineAt(src, index);
    findings.push({
      line: lineNo,
      endLine: lineNo,
      message: `${rel}:${lineNo} builds a clock inside a template string`,
    });
  }

  const printedDay = /getUTCDate\s*\(/g;
  for (const match of src.matchAll(printedDay)) {
    const index = match.index ?? 0;
    if (!inTemplate(spans, index)) continue;
    const lineNo = lineAt(src, index);
    findings.push({
      line: lineNo,
      endLine: lineNo,
      message: `${rel}:${lineNo} prints a calendar day inside a template string`,
    });
  }

  for (const [start, end] of spans) {
    let i = start + 1;
    let staticText = "";
    while (i < end) {
      if (src[i] === "`") break;
      if (src[i] === "\\") {
        staticText += src[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (src[i] === "$" && src[i + 1] === "{") {
        const exprEnd = skipBraceOpaque(src, i + 1) - 1;
        const expr = src.slice(i + 2, exprEnd).trim();
        if (/as of\s*$/i.test(staticText)) {
          const name = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(expr)?.[1];
          if (!name || !FORMATTERS.includes(name)) {
            const lineNo = lineAt(src, i);
            findings.push({
              line: lineNo,
              endLine: lineNo,
              message: `${rel}:${lineNo} interpolates an ISO date into as-of copy`,
            });
          }
        }
        staticText = "";
        i = exprEnd + 1;
        continue;
      }
      staticText += src[i];
      i++;
    }
  }

  function walkTemplateExprs(i: number): number {
    i++;
    while (i < src.length) {
      if (src[i] === "\\") {
        i += 2;
        continue;
      }
      if (src[i] === "`") return i + 1;
      if (src[i] === "$" && src[i + 1] === "{") {
        const close = skipBraceOpaque(src, i + 1) - 1;
        visit(i + 2, close);
        i = close + 1;
        continue;
      }
      i++;
    }
    return i;
  }

  const rangeCalls: Array<{ start: number; end: number }> = [];

  function visit(from: number, to: number) {
    let i = from;
    while (i < to) {
      const c = src[i]!;
      if (c === "'" || c === '"') {
        i = readQuoted(src, i);
        continue;
      }
      if (c === "`") {
        i = walkTemplateExprs(i);
        continue;
      }
      if (!/[A-Za-z_]/.test(c)) {
        i++;
        continue;
      }
      const nameStart = i;
      let j = i + 1;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j]!)) j++;
      const name = src.slice(i, j);
      let k = j;
      while (k < to && /\s/.test(src[k]!)) k++;
      if (FORMATTERS.includes(name) && src[k] === "(") {
        const before = src.slice(Math.max(0, nameStart - 30), nameStart);
        const definition = /\bfunction\s*$/.test(before);
        const call = readCall(src, k);
        if (call) {
          const lineNo = lineAt(src, nameStart);
          const endLine = lineAt(src, call.end);
          const where = `${rel}:${lineNo}`;
          if (definition) {
            if (/=\s*ZA_MARKET\b/.test(call.text)) {
              findings.push({
                line: lineNo,
                endLine,
                message: `${where} ${name} still defaults the market to ZA_MARKET`,
              });
            }
          } else {
            rangeCalls.push({ start: nameStart, end: call.end });
            if (name === "formatClock" && rel !== SLOT_CLOCK_FILE) {
              findings.push({ line: lineNo, endLine, message: `${where} formatClock is only for slot buttons` });
            }
            const need = minArgs(name);
            if (call.argCount < need) {
              findings.push({
                line: lineNo,
                endLine,
                message: `${where} ${name} is called with fewer than ${need} args`,
              });
            }
            if (/\bZA_MARKET\b|["']en-ZA["']|["']en-US["']|["']Africa\/Johannesburg["']/.test(call.text)) {
              findings.push({
                line: lineNo,
                endLine,
                message: `${where} ${name} is called with a hard-coded market or zone`,
              });
            }
            if (PRESET_LITERALS.has(name) && /["'](?:za|us)["']/.test(call.text)) {
              findings.push({
                line: lineNo,
                endLine,
                message: `${where} ${name} is called with a hard-coded order`,
              });
            }
            if (/\bfirmMarket\b/.test(call.text) && /\brow\.|\bclient\b/.test(call.text)) {
              findings.push({
                line: lineNo,
                endLine,
                message: `${where} ${name} formats a client row with firmMarket`,
              });
            }
          }
        }
        i = call ? call.end + 1 : k + 1;
        continue;
      }
      i = j;
    }
  }
  visit(0, src.length);
  const JOIN = /(?:\u2013|\u2014|\s-\s|\bto\b)/i;
  for (let i = 0; i < rangeCalls.length; i++) {
    const left = rangeCalls[i]!;
    for (let j = i + 1; j < rangeCalls.length; j++) {
      const right = rangeCalls[j]!;
      const gapStart = left.end + 1;
      const gapEnd = right.start;
      if (gapEnd - gapStart > 120) break;
      if (gapEnd <= gapStart) continue;
      const gap = src.slice(gapStart, gapEnd);
      if (!JOIN.test(gap)) continue;
      if (gap.includes(";")) continue;
      const lineNo = lineAt(src, left.start);
      const endLine = lineAt(src, right.end);
      findings.push({
        line: lineNo,
        endLine,
        message: `${rel}:${lineNo} joins two date formatters into a range`,
      });
      break;
    }
  }
  scanStoredPeriodReads(rel, src, findings);
  return findings;
}

const PERIOD_FORMATTERS =
  /^(?:statementSpanLabel|figuresPeriodLabelFrom|readStatementMeta|formatStatementPeriodLabel|reportDataPeriodLabel|datedPeriodLabel|parseStoredPeriodSpan|formatDateRange|homeStatementsLine|resolveSnapshotPeriodLabel|storedPeriodSpan|evidenceMetrics)$/;

function insidePeriodFormatter(src: string, index: number): boolean {
  let depth = 0;
  for (let i = index - 1; i >= 0; i--) {
    const c = src[i]!;
    if (c === ")" || c === "}" || c === "]") {
      depth++;
      continue;
    }
    if (c === "(" || c === "{" || c === "[") {
      if (depth === 0 && c === "(") {
        let j = i - 1;
        while (j >= 0 && /\s/.test(src[j]!)) j--;
        const end = j + 1;
        while (j >= 0 && /[\w$]/.test(src[j]!)) j--;
        if (PERIOD_FORMATTERS.test(src.slice(j + 1, end))) return true;
      } else if (depth > 0) {
        depth--;
      }
      continue;
    }
    if (depth === 0 && c === ";") return false;
  }
  return false;
}

function scanStoredPeriodReads(rel: string, src: string, findings: Finding[]) {
  if (/(?:^|\/)statement-period\.ts$/.test(rel)) return;
  const note = (index: number) => {
    if (insidePeriodFormatter(src, index)) return;
    const lineNo = lineAt(src, index);
    findings.push({
      line: lineNo,
      endLine: lineNo,
      message: `${rel}:${lineNo} reads a stored period_label`,
    });
  };
  const visit = (from: number, to: number) => {
    let i = from;
    while (i < to) {
      const c = src[i]!;
      if (c === "'" || c === '"') {
        i = Math.min(readQuoted(src, i), to);
        continue;
      }
      if (c === "`") {
        i = visitTemplate(i, to);
        continue;
      }
      if (c === "." && src.startsWith(".period_label", i)) {
        const next = src[i + ".period_label".length];
        if (next == null || /\W/.test(next)) note(i);
        i += ".period_label".length;
        continue;
      }
      if (c === "[" && /^\[\s*["']period_label["']\s*\]/.test(src.slice(i, i + 24))) note(i);
      i++;
    }
  };
  const visitTemplate = (i: number, limit: number) => {
    i++;
    while (i < src.length && i < limit) {
      if (src[i] === "\\") {
        i += 2;
        continue;
      }
      if (src[i] === "`") return i + 1;
      if (src[i] === "$" && src[i + 1] === "{") {
        const close = skipBraceOpaque(src, i + 1);
        visit(i + 2, close - 1);
        i = close;
        continue;
      }
      i++;
    }
    return i;
  };
  visit(0, src.length);
}

function fresh(rawLines: string[], finding: Finding): boolean {
  for (let line = finding.line - 1; line <= finding.endLine; line++) {
    if (line < 1) continue;
    const reason = dateOkReason(rawLines[line - 1] ?? "");
    if (reason != null && reason.length >= 8) return true;
  }
  return false;
}

function problemsFor(rel: string, raw: string): string[] {
  const rawLines = raw.split("\n");
  const findings = scanSource(rel, raw);
  const problems = findings.filter((finding) => !fresh(rawLines, finding)).map((finding) => finding.message);
  rawLines.forEach((line, index) => {
    const reason = dateOkReason(line);
    if (reason == null) return;
    const lineNo = index + 1;
    if (reason.length < 8) {
      problems.push(`${rel}:${lineNo} date-ok reason is shorter than 8 characters`);
      return;
    }
    const used = findings.some(
      (finding) => lineNo === finding.line - 1 || (lineNo >= finding.line && lineNo <= finding.endLine),
    );
    if (!used) problems.push(`${rel}:${lineNo} date-ok comment is stale`);
  });
  return problems;
}

function assertScan(rel: string, raw: string, expected: string[]) {
  assert.deepEqual(problemsFor(rel, raw), expected);
}

assertScan("src/example.ts", "formatDate(when)\n", ["src/example.ts:1 formatDate is called with fewer than 2 args"]);
assertScan("src/example.ts", "formatDate(when, market)\n", []);
assertScan(
  "src/example.ts",
  "formatDate(when) // date-ok: internal fixture clock\n",
  [],
);
assertScan("src/example.ts", "formatDate(when) // date-ok: short\n", [
  "src/example.ts:1 formatDate is called with fewer than 2 args",
  "src/example.ts:1 date-ok reason is shorter than 8 characters",
]);
assertScan("src/example.ts", "const kept = 1; // date-ok: nothing here matches\n", [
  "src/example.ts:1 date-ok comment is stale",
]);
assertScan(
  "src/example.ts",
  "// date-ok: zone probe only, not a printed date\nIntl.DateTimeFormat()\n",
  [],
);
assertScan("src/example.ts", "formatClock(start, market)\n", [
  "src/example.ts:1 formatClock is only for slot buttons",
]);
assertScan(SLOT_CLOCK_FILE, "formatClock(start, market)\n", []);
assertScan("src/example.ts", "row.createdAt.toLocaleDateString()\n", [
  "src/example.ts:1 formats a date with toLocaleDateString",
]);
assertScan("src/example.ts", "calendarDayFromIso(iso, \"za\")\n", [
  "src/example.ts:1 calendarDayFromIso is called with a hard-coded order",
]);
assertScan("src/example.ts", "formatDate(row.createdAt, firmMarket)\n", [
  "src/example.ts:1 formatDate formats a client row with firmMarket",
]);
assertScan("src/example.ts", "const hh = String(hour).padStart(2, \"0\")\n", [
  "src/example.ts:1 pads an hour or minute by hand",
]);
assertScan("src/example.ts", "iso.slice(0, 16)\n", ["src/example.ts:1 slices an ISO string"]);
assertScan("src/example.ts", "const label = `${d.getHours()}:${d.getMinutes()}`\n", [
  "src/example.ts:1 builds a clock inside a template string",
  "src/example.ts:1 builds a clock inside a template string",
]);
assertScan("src/example.ts", "return `added ${date.getUTCDate()} ${month} ${date.getUTCFullYear()}`\n", [
  "src/example.ts:1 prints a calendar day inside a template string",
]);
assertScan(
  "src/example.ts",
  "return `Aged receivables as of ${snap.asOf} · nothing outstanding`\n",
  ["src/example.ts:1 interpolates an ISO date into as-of copy"],
);
assertScan(
  "src/example.ts",
  "return `Aged receivables as of ${formatIsoDateUTC(snap.asOf, market)} · nothing outstanding`\n",
  [],
);
assertScan(
  "src/example.ts",
  "return `Balance sheet as of ${formatIsoDateUTC(asOf, market)}`\n",
  [],
);
assertScan("src/example.ts", "const h = now.getHours()\n", []);
assertScan("src/example.ts", "token.slice(0, 16)\n", []);
assertScan(
  "src/example.ts",
  "formatDateTime(d, ZA_MARKET); // date-ok: internal IT board has no client or firm market\n",
  [],
);
assert.ok(ROOTS.includes("supabase/functions"), "the guard scans supabase/functions");
assert.ok(ROOTS.includes("src") && ROOTS.includes("api") && ROOTS.includes("emails") && ROOTS.includes("mobile"));
assertScan(
  "src/example.ts",
  "const label = `${formatDate(a, market)} – ${formatDate(b, market)}`\n",
  ["src/example.ts:1 joins two date formatters into a range"],
);
assertScan(
  "src/example.ts",
  "const label = formatDate(a, market) + \" – \" + formatDate(b, market)\n",
  ["src/example.ts:1 joins two date formatters into a range"],
);
assertScan(
  "supabase/functions/example.ts",
  "const label = `${formatIsoDateUTC(a, market)} to ${formatIsoDateUTC(b, market)}`\n",
  ["supabase/functions/example.ts:1 joins two date formatters into a range"],
);
assertScan("src/example.ts", "formatDateRange(a, b, market)\n", []);
assertScan("src/example.ts", "formatDateRange(a, b)\n", [
  "src/example.ts:1 formatDateRange is called with fewer than 3 args",
]);
assertScan("src/example.ts", "const fmt = \"d MMM yyyy\"\n", [
  "src/example.ts:1 uses a day-first date format literal",
]);
assertScan("src/example.ts", "const fmt = 'D MMM YYYY'\n", [
  "src/example.ts:1 uses a day-first date format literal",
]);
assertScan("src/example.ts", "d.toLocaleDateString('en-ZA')\n", [
  "src/example.ts:1 formats a date with toLocaleDateString",
  "src/example.ts:1 formats a date day-first with toLocaleDateString",
]);
assertScan("src/example.ts", "d.toLocaleDateString('en-GB')\n", [
  "src/example.ts:1 formats a date with toLocaleDateString",
  "src/example.ts:1 formats a date day-first with toLocaleDateString",
]);
assertScan(
  "src/example.ts",
  "const fmt = \"d MMM yyyy\" // date-ok: parser token, not a printed date\n",
  [],
);
assertScan("src/example.ts", "const text = `Xero sync · ${row.period_label}`\n", [
  "src/example.ts:1 prints a stored period label",
  "src/example.ts:1 reads a stored period_label",
]);
assertScan(
  "src/example.ts",
  "const text = `Xero sync · ${statementSpanLabel({ periodLabel: row.period_label, market })}`\n",
  [],
);
assertScan(
  "src/example.ts",
  "const text = `Xero sync · ${row.period_label}` // date-ok: month stamp, not a day range\n",
  [],
);
assertScan(
  "src/example.ts",
  "const payload = { periodLabel: row.period_label };\nconst text = `CURRENT PERIOD: ${payload.periodLabel}`;\n",
  [
    "src/example.ts:1 prints a stored period label",
    "src/example.ts:1 reads a stored period_label",
  ],
);
assertScan(
  "src/example.ts",
  "const payload = {\n  periodLabel: row.period_label,\n};\nconst text = `CURRENT PERIOD: ${payload.periodLabel}`;\n",
  ["src/example.ts:2 reads a stored period_label"],
);
assertScan(
  "src/example.ts",
  "const payload = { periodLabel: statementSpanLabel({ periodLabel: row.period_label, market }) };\nconst text = `CURRENT PERIOD: ${payload.periodLabel}`;\n",
  [],
);

const ISO_SPAN = "2026-09-01/2026-09-21";
const US_SPAN = "Sep 1\u201321, 2026";
const ZA_SPAN = "1\u201321 Sep 2026";
const usMarket = marketForClient({ market: { country: "US", regionCode: "NY" } });
const zaMarket = marketForClient(null);
assert.equal(figuresPeriodLabelFrom(null, ISO_SPAN, usMarket), US_SPAN);
assert.equal(figuresPeriodLabelFrom(null, ISO_SPAN, zaMarket), ZA_SPAN);
assert.equal(figuresPeriodLabelFrom({ periodLabel: ISO_SPAN }, null, usMarket), US_SPAN);
assert.equal(figuresPeriodLabelFrom({ periodLabel: ISO_SPAN }, null, zaMarket), ZA_SPAN);
assert.equal(statementSpanLabel({ periodLabel: ISO_SPAN, market: usMarket }), US_SPAN);
assert.equal(statementSpanLabel({ periodLabel: ISO_SPAN, market: zaMarket }), ZA_SPAN);
assert.equal(readStatementMeta({ periodLabel: ISO_SPAN }, usMarket).periodLabel, US_SPAN);
assert.equal(readStatementMeta({ periodLabel: ISO_SPAN }, zaMarket).periodLabel, ZA_SPAN);
assert.equal(
  readStatementMeta({ periodStart: "2026-01-01", periodEnd: "2026-01-31", ytdPeriodLabel: ISO_SPAN }, usMarket)
    .ytdPeriodLabel,
  US_SPAN,
);
assert.equal(
  readStatementMeta({ periodStart: "2026-01-01", periodEnd: "2026-01-31", ytdPeriodLabel: ISO_SPAN }, zaMarket)
    .ytdPeriodLabel,
  ZA_SPAN,
);
assert.equal(reportDataPeriodLabel({ periodLabel: ISO_SPAN }, usMarket), US_SPAN);
assert.equal(reportDataPeriodLabel({ periodLabel: ISO_SPAN }, zaMarket), ZA_SPAN);

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (name === "__tests__") continue;
      walk(abs, out);
    } else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.(test|spec)\./.test(name)) out.push(abs);
  }
}

const files: string[] = [];
for (const dir of ROOTS) {
  const abs = join(ROOT, dir);
  try {
    statSync(abs);
  } catch {
    continue;
  }
  walk(abs, files);
}

const problems: string[] = [];
for (const abs of files) {
  const rel = relative(ROOT, abs).split("\\").join("/");
  if (SKIP_FILES.has(rel)) continue;
  const raw = readFileSync(abs, "utf8");
  problems.push(...problemsFor(rel, raw));
}
assert.deepEqual(problems, [], problems.join("\n"));

const NOW = new Date("2026-10-20T05:37:00.000Z");
const EARLIER = "2026-10-19T05:37:00.000Z";
const QUERY_AT = new Date("2026-09-02T12:00:00.000Z");
const zaFirm = marketForFirm(null);
const zaFirmNull = marketForFirm({ market: null });
const usFirm = marketForFirm({ market: { country: "US", regionCode: "NY" } });
const zaClient = marketForClient({ market: { country: "ZA" } });
const usClient = marketForClient({ market: { country: "US", regionCode: "NY" } });

let nullThrew = false;
let nullLabel = "";
try {
  nullLabel = dataAsOfLabel(NOW, zaFirmNull);
} catch {
  nullThrew = true;
}

const outputs = [
  dataAsOfLabel(NOW, zaFirm),
  dataAsOfLabel(NOW, usFirm),
  nullLabel,
  formatDate(QUERY_AT, zaClient),
  formatDate(QUERY_AT, usClient),
  formatEventTime(NOW, zaClient, NOW) ?? "",
  formatEventTime(NOW, usClient, NOW) ?? "",
  formatEventTime(EARLIER, zaClient, NOW) ?? "",
  formatEventTime(EARLIER, usClient, NOW) ?? "",
  handoffProgressCaption("financial_manager", "succeeded", { at: NOW.toISOString(), draftId: "draft-1", market: zaClient, now: NOW }) ?? "",
  handoffProgressCaption("advisor", "succeeded", { at: NOW.toISOString(), draftId: "draft-1", market: usClient, now: NOW }) ?? "",
  handoffProgressCaption("financial_manager", "succeeded", { at: EARLIER, draftId: "draft-1", market: zaClient, now: NOW }) ?? "",
  handoffProgressCaption("advisor", "succeeded", { at: EARLIER, draftId: "draft-1", market: usClient, now: NOW }) ?? "",
  formatAssignmentNote(
    {
      note: "Handed to Financial Manager.",
      at: NOW.toISOString(),
      actorLabel: "Milōn Financial Manager",
      actorType: "system",
    },
    zaClient,
    NOW,
  ),
  formatAssignmentNote(
    {
      note: "Handed to Advisor.",
      at: NOW.toISOString(),
      actorLabel: "Milōn Advisor",
      actorType: "system",
    },
    usClient,
    NOW,
  ),
];

assert.equal(nullThrew, false, "a null firm market must not throw");
assert.equal(outputs[0], "20 Oct 2026", "ZA firm data-as-of");
assert.equal(outputs[1], "Oct 20, 2026", "US firm data-as-of");
assert.equal(outputs[2], "20 Oct 2026", "null firm market renders as ZA");
assert.equal(marketForFirm({ market: null }).locale, zaFirm.locale);
assert.equal(outputs[3], "2 Sep 2026", "ZA client inside a US firm keeps ZA order");
assert.equal(dataAsOfLabel(NOW, usFirm), "Oct 20, 2026", "the US firm header stays US");
assert.equal(outputs[4], "Sep 2, 2026", "US client inside a ZA firm keeps US order");
assert.equal(dataAsOfLabel(NOW, zaFirm), "20 Oct 2026", "the ZA firm header stays ZA");
assert.equal(outputs[9], "Done by Financial Manager · 07:37 SAST. See result.");
assert.equal(outputs[10], "Done by Advisor · 1:37 AM ET. See result.");
assert.equal(outputs[11], "Done by Financial Manager · 19 Oct 2026, 07:37 SAST. See result.");
assert.equal(outputs[12], "Done by Advisor · Oct 19, 2026, 1:37 AM ET. See result.");
assert.equal(outputs[13], "Assigned to Financial Manager · 07:37 SAST");
assert.equal(outputs[14], "Assigned to Advisor · 1:37 AM ET");
assert.match(outputs[11] ?? "", /\d{1,2} \w+ \d{4}, \d{2}:\d{2} SAST/);
assert.match(outputs[12] ?? "", /\w+ \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M ET/);

for (const line of outputs) {
  assert.doesNotMatch(line, /\bSept\b/, line);
  assert.doesNotMatch(line, /UTC\+2/, line);
  assert.doesNotMatch(line, /\bEDT\b|\bEST\b/, line);
}

const zaRange = { locale: "en-ZA", timezone: "Africa/Johannesburg" };
const usRange = { locale: "en-US", timezone: "America/New_York" };
assert.equal(formatDateRange("2026-09-01", "2026-09-21", usRange), "Sep 1\u201321, 2026", "US same month");
assert.equal(formatDateRange("2026-09-01", "2026-09-21", zaRange), "1\u201321 Sep 2026", "ZA same month");
assert.equal(formatDateRange("2026-04-01", "2026-09-21", usRange), "Apr 1 \u2013 Sep 21, 2026", "US cross month");
assert.equal(formatDateRange("2026-04-01", "2026-09-21", zaRange), "1 Apr \u2013 21 Sep 2026", "ZA cross month");
assert.equal(formatDateRange("2025-10-01", "2026-09-30", usRange), "Oct 1, 2025 \u2013 Sep 30, 2026", "US cross year");
assert.equal(formatDateRange("2025-10-01", "2026-09-30", zaRange), "1 Oct 2025 \u2013 30 Sep 2026", "ZA cross year");
assert.equal(formatDateRange("2026-09-01", "2026-09-01", usRange), "Sep 1, 2026", "US same day");
assert.equal(formatDateRange("2026-09-01", "2026-09-01", zaRange), "1 Sep 2026", "ZA same day");
assert.equal(
  reportDataPeriodLabel({ periodStart: "2026-09-01", periodEnd: "2026-09-21" }, usRange),
  "Sep 1\u201321, 2026 (part month)",
  "US part month",
);
assert.equal(
  reportDataPeriodLabel({ periodStart: "2026-09-01", periodEnd: "2026-09-21" }, zaRange),
  "1\u201321 Sep 2026 (part month)",
  "ZA part month",
);
assert.equal(
  reportDataPeriodLabel({ periodStart: "2026-09-01", periodEnd: "2026-09-30" }, usRange),
  "September 2026",
  "US full month stays a month name",
);
assert.equal(
  reportDataPeriodLabel({ periodStart: "2026-09-01", periodEnd: "2026-09-30" }, zaRange),
  "September 2026",
  "ZA full month stays a month name",
);
assert.equal(formatDateRange("not-a-date", "2026-09-21", usRange), "\u2014");

console.log("date-format-guard ok");
for (const line of outputs) console.log(`  ${line}`);
