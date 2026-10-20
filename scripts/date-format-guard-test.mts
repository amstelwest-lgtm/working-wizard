/**
 * Date-format guard. Outcome-shaped: a canonical helper called with the
 * wrong market or the wrong preset fails here.
 * Run: pnpm test:date-format-guard
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { formatAssignmentNote, handoffProgressCaption } from "../src/lib/action-handoff.ts";
import { formatDate, formatEventTime } from "../src/lib/market/format.ts";
import { marketForClient, marketForFirm } from "../src/lib/market/scope.ts";
import { dataAsOfLabel } from "../src/lib/portfolio-dashboard.ts";

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
].sort((a, b) => b.length - a.length);

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
            if (name === "formatClock" && rel !== SLOT_CLOCK_FILE) {
              findings.push({ line: lineNo, endLine, message: `${where} formatClock is only for slot buttons` });
            }
            if (call.argCount < 2) {
              findings.push({ line: lineNo, endLine, message: `${where} ${name} is called with fewer than 2 args` });
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
  return findings;
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
assertScan("src/example.ts", "const h = now.getHours()\n", []);
assertScan("src/example.ts", "token.slice(0, 16)\n", []);
assertScan(
  "src/example.ts",
  "formatDateTime(d, ZA_MARKET); // date-ok: internal IT board has no client or firm market\n",
  [],
);

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
  handoffProgressCaption("financial_manager", "succeeded", { at: NOW.toISOString(), market: zaClient, now: NOW }) ?? "",
  handoffProgressCaption("advisor", "succeeded", { at: NOW.toISOString(), market: usClient, now: NOW }) ?? "",
  handoffProgressCaption("financial_manager", "succeeded", { at: EARLIER, market: zaClient, now: NOW }) ?? "",
  handoffProgressCaption("advisor", "succeeded", { at: EARLIER, market: usClient, now: NOW }) ?? "",
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
assert.equal(outputs[9], "Financial Manager finished · 07:37 SAST");
assert.equal(outputs[10], "Advisor finished · 1:37 AM ET");
assert.equal(outputs[11], "Financial Manager finished · 19 Oct 2026, 07:37 SAST");
assert.equal(outputs[12], "Advisor finished · Oct 19, 2026, 1:37 AM ET");
assert.equal(outputs[13], "Handed to Financial Manager · 07:37 SAST");
assert.equal(outputs[14], "Handed to Advisor · 1:37 AM ET");
assert.match(outputs[11] ?? "", /\d{1,2} \w+ \d{4}, \d{2}:\d{2} SAST/);
assert.match(outputs[12] ?? "", /\w+ \d{1,2}, \d{4}, \d{1,2}:\d{2} [AP]M ET/);

for (const line of outputs) {
  assert.doesNotMatch(line, /\bSept\b/, line);
  assert.doesNotMatch(line, /UTC\+2/, line);
  assert.doesNotMatch(line, /\bEDT\b|\bEST\b/, line);
}

console.log("date-format-guard ok");
for (const line of outputs) console.log(`  ${line}`);
