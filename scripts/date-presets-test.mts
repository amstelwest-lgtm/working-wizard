/**
 * Calendar presets for ZA and US, and a source scan that keeps new date
 * bypasses out of the app and the edge functions.
 * Run: pnpm test:date-presets
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { ZA_MARKET } from "../src/lib/market/resolve";
import {
  formatCalendarDay,
  formatDateTime,
  formatMonthLabel,
  formatMonthRange,
  formatMonthYear,
  formatReviewDateTime,
  formatWeekHeader,
} from "../src/lib/market/format";

const US = { locale: "en-US", timezone: "America/New_York", currency: "USD" as const };

assert.equal(formatCalendarDay("2026-11-02", ZA_MARKET), "2 Nov 2026");
assert.equal(formatCalendarDay("2026-11-02", US), "Nov 2, 2026");
assert.equal(formatCalendarDay("2026-09-08", ZA_MARKET), "8 Sep 2026");
assert.equal(formatCalendarDay("2026-09-08", US), "Sep 8, 2026");
assert.equal(formatCalendarDay("not-a-date", ZA_MARKET), "—");
assert.doesNotMatch(formatCalendarDay("2026-09-08", ZA_MARKET), /Sept/);

assert.equal(formatWeekHeader("2026-10-19", ZA_MARKET), "19 Oct");
assert.equal(formatWeekHeader("2026-10-19", US), "Oct 19");
assert.equal(formatWeekHeader("2026-09-08", ZA_MARKET), "8 Sep");
assert.equal(formatWeekHeader("2026-09-08", US), "Sep 8");

assert.equal(formatMonthLabel("2026-10", ZA_MARKET), "Oct 26");
assert.equal(formatMonthLabel("2026-10", US), "Oct 26");
assert.equal(formatMonthLabel("2026-09", ZA_MARKET), "Sep 26");

assert.equal(formatMonthRange("2026-03", "2027-02"), "Mar 2026 \u2013 Feb 2027");
assert.equal(formatMonthRange("2026-01", "2026-09"), "Jan 2026 \u2013 Sep 2026");
assert.equal(formatMonthRange("2026-03", "2026-03"), "Mar 2026");
assert.equal(formatMonthYear("2026-10-19T12:00:00.000Z", "UTC"), "Oct 2026");
assert.equal(formatMonthYear("2026-09-08T12:00:00.000Z", "UTC"), "Sep 2026");

const zaClock = formatDateTime("2026-11-02T07:54:00.000Z", ZA_MARKET);
assert.equal(zaClock, "2 Nov 2026, 09:54 SAST", zaClock);
assert.doesNotMatch(zaClock, /Sept|AM|PM|UTC/);

const usClock = formatDateTime("2026-11-02T14:54:00.000Z", US);
assert.equal(usClock, "Nov 2, 2026, 9:54 AM ET", usClock);

const review = formatReviewDateTime("2026-10-07T22:14:47.000Z", US);
assert.equal(review, "Oct 7, 2026, 6:14 PM ET");

assert.equal(
  formatDateTime("2026-11-02T15:54:00.000Z", { locale: "en-US", timezone: "America/Chicago" }),
  "Nov 2, 2026, 9:54 AM CT",
);
assert.equal(
  formatDateTime("2026-11-02T16:54:00.000Z", { locale: "en-US", timezone: "America/Denver" }),
  "Nov 2, 2026, 9:54 AM MT",
);
assert.equal(
  formatDateTime("2026-11-02T16:54:00.000Z", { locale: "en-US", timezone: "America/Phoenix" }),
  "Nov 2, 2026, 9:54 AM MT",
);
assert.equal(
  formatDateTime("2026-11-02T17:54:00.000Z", { locale: "en-US", timezone: "America/Los_Angeles" }),
  "Nov 2, 2026, 9:54 AM PT",
);
assert.equal(
  formatDateTime("2026-10-07T22:14:00.000Z", { locale: "en-US", timezone: "America/Chicago" }),
  "Oct 7, 2026, 5:14 PM CT",
);
assert.equal(
  formatDateTime("2026-10-07T22:14:00.000Z", { locale: "en-US", timezone: "America/Detroit" }),
  "Oct 7, 2026, 6:14 PM ET",
);

const root = process.cwd();
const roots = ["src", "supabase/functions"];

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walk(abs, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(abs);
  }
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

const files: string[] = [];
for (const dir of roots) walk(join(root, dir), files);

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function monthTable(src: string): boolean {
  const arrays = src.match(/\[[^\[\]]{0,2500}\]/g) ?? [];
  return arrays.some((body) => {
    const shorts = SHORT.filter((name) => body.includes(`"${name}"`) || body.includes(`'${name}'`)).length;
    const longs = LONG.filter((name) => body.includes(`"${name}"`) || body.includes(`'${name}'`)).length;
    const lower = LONG.filter((name) => body.toLowerCase().includes(`"${name.toLowerCase()}"`)).length;
    return shorts >= 8 || longs >= 8 || lower >= 8;
  });
}

/**
 * Explicit allowlist. A file is here because it is not one of the printed
 * plan, note, budget-window, or sign-off dates. format.ts may use
 * Intl.DateTimeFormat for numeric parts and zone names only.
 */
const ALLOW_TO_LOCALE_DATE = new Set([
  // Day-picker data-day attribute. A machine value, not visible copy.
  "src/components/ui/calendar.tsx",
]);

/**
 * Intl.DateTimeFormat( without `new`. These validate a zone or read
 * resolvedOptions().timeZone. They do not print a date.
 */
const ALLOW_BARE_INTL = new Set([
  "src/lib/trial-call-slots.ts",
  "src/components/source-documents-panel.tsx",
]);

const ALLOW_INTL = new Set([
  "src/lib/market/format.ts",
  "src/lib/advisory-signoff.ts",
  "src/lib/client-metrics.ts",
  "src/lib/firm-client-cap.ts",
  "src/lib/lighthouse-send-windows.ts",
  "src/lib/lighthouse.functions.ts",
  "src/lib/source-documents-ui.ts",
  "src/lib/statement-period.ts",
  "src/lib/trial-call-slots.ts",
  "src/lib/workflow-coach.ts",
  "src/routes/_authenticated/settings.team.tsx",
]);

const ALLOW_MONTH_TABLE = new Set([
  // Bank-line parser. Includes Afrikaans month words and "sept", not a display preset.
  "src/lib/cash-from-banks.pattern.ts",
]);

/** JSX may show a raw ISO date only when it is a machine value, not visible copy. */
const ALLOW_JSX_ISO = new Set<string>();

const problems: string[] = [];

for (const abs of files) {
  const rel = relative(root, abs).split("\\").join("/");
  const raw = readFileSync(abs, "utf8");
  const src = stripComments(raw);
  const printsLocaleDate =
    src.includes("toLocaleDateString") ||
    /toLocale(?:String|TimeString)\s*\(\s*(?:[^,{)]+,\s*)?\{[^}]{0,500}?(?:month|day|year|hour)\s*:/.test(src);
  if (printsLocaleDate && !ALLOW_TO_LOCALE_DATE.has(rel)) {
    problems.push(`${rel} formats a date with toLocaleString`);
  }
  if (src.includes("new Intl.DateTimeFormat") && !ALLOW_INTL.has(rel)) {
    problems.push(`${rel} constructs Intl.DateTimeFormat`);
  }
  if (/(?<!new\s)(?<![\w.])Intl\.DateTimeFormat\s*\(/.test(src) && !ALLOW_BARE_INTL.has(rel)) {
    problems.push(`${rel} calls Intl.DateTimeFormat without new`);
  }
  if (monthTable(src) && rel !== "src/lib/market/date-presets.ts" && !ALLOW_MONTH_TABLE.has(rel)) {
    problems.push(`${rel} has a private month-name array`);
  }
  if (!rel.endsWith(".tsx")) continue;
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const iso = /\b(?:19|20)\d{2}-\d{2}-\d{2}\b/.test(line);
    const machine =
      /type=["']date["']|value=|dateTime=|toISOString|placeholder|defaultValue|pattern=/.test(line);
    if (iso && !machine && !ALLOW_JSX_ISO.has(rel)) {
      problems.push(`${rel}:${i + 1} renders a raw YYYY-MM-DD`);
    }
    const printsDue =
      /\{[A-Za-z0-9_.?]*dueDate\}|\{[A-Za-z0-9_.?]*due_date\}/.test(line) &&
      !line.includes("formatCalendarDay") &&
      !line.includes("shownDue(") &&
      !/value=/.test(line) &&
      !/dueDate\s*:/.test(line);
    if (printsDue && !ALLOW_JSX_ISO.has(rel)) {
      problems.push(`${rel}:${i + 1} prints a due date without formatCalendarDay`);
    }
  }
}

for (const rel of ALLOW_TO_LOCALE_DATE) {
  const src = stripComments(readFileSync(join(root, rel), "utf8"));
  if (!src.includes("toLocaleDateString")) problems.push(`${rel} is allowlisted but no longer calls toLocaleDateString`);
}
for (const rel of ALLOW_INTL) {
  const src = stripComments(readFileSync(join(root, rel), "utf8"));
  if (!src.includes("new Intl.DateTimeFormat")) {
    problems.push(`${rel} is allowlisted but no longer constructs Intl.DateTimeFormat`);
  }
}
for (const rel of ALLOW_BARE_INTL) {
  const src = stripComments(readFileSync(join(root, rel), "utf8"));
  if (!/(?<!new\s)(?<![\w.])Intl\.DateTimeFormat\s*\(/.test(src)) {
    problems.push(`${rel} is allowlisted but no longer calls Intl.DateTimeFormat without new`);
  }
}

assert.deepEqual(problems, [], problems.join("\n"));

console.log("date-presets ok");
