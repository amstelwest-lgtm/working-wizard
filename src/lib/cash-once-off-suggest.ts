/**
 * Once-off rows suggested from bank history already on file.
 * Amounts are the stored bank lines. Nothing here is invented, and nothing
 * is written until the accountant saves or confirms the forecast.
 */
import { buildDraftLinesFromExtract } from "./cash-from-banks.pattern.ts";
import type { CashBankExtract, CashBucket, CashForecastDraftLine } from "./cash-from-banks.types.ts";
import { displayForecastFrequency } from "./cash-forecast-rows.ts";
import { distributeForecastLine } from "./client-metrics.ts";

export type SuggestedOnceOffLine = {
  id: string;
  name: string;
  amount: string;
  frequency: "once-off";
  startWeek: number;
  splitCount: number;
  side: "revenue" | "expenses" | "other";
};

export type OnceOffSuggestResult = {
  lines: SuggestedOnceOffLine[];
  /** Set when there is nothing new to place on the forecast. */
  empty: string | null;
};

const EXPENSE_BUCKETS = new Set<CashBucket>(["cos", "opex", "payroll", "rent", "interest", "tax"]);

const EMPTY = "No once-off bank lines are on file.";
const ALREADY = "Those once-off bank lines are already on the forecast.";

type ExistingLine = { id?: string; name?: string; amount?: string; frequency?: string };

export type ForecastGridLine = {
  id: string;
  name: string;
  amount: string;
  frequency: string;
  startWeek?: number;
  splitCount?: number;
  weekOverrides?: Record<string, number> | null;
  side: "revenue" | "expenses" | "other";
};

/** Save is on once a once-off is staged, even when that row was already stored. */
export function onceOffSaveEnabled(input: { dirty: boolean; staged: number }): boolean {
  return input.dirty || input.staged > 0;
}

/**
 * Bank-tagged grid rows that land in a single week. The amount is that
 * week's figure, which is already on the line. Recurring rows are left out.
 */
export function onceOffsOnBankForecast(lines: readonly ForecastGridLine[]): SuggestedOnceOffLine[] {
  const out: SuggestedOnceOffLine[] = [];
  for (const line of lines) {
    const name = line.name.trim();
    if (!name || !line.id) continue;
    const vals = distributeForecastLine(
      {
        amount: line.amount,
        frequency: displayForecastFrequency(line.name, line.frequency),
        startWeek: line.startWeek,
        splitCount: line.splitCount,
        weekOverrides: line.weekOverrides ?? undefined,
      },
      13,
    );
    const hits: { week: number; amount: number }[] = [];
    vals.forEach((value, index) => {
      if (Math.abs(value) > 0.005) hits.push({ week: index + 1, amount: value });
    });
    if (hits.length !== 1) continue;
    const amount = Math.round(hits[0]!.amount * 100) / 100;
    if (!(amount > 0)) continue;
    out.push({
      id: line.id,
      name,
      amount: String(amount),
      frequency: "once-off",
      startWeek: hits[0]!.week,
      splitCount: 1,
      side: line.side,
    });
  }
  return out;
}

/** The button is on the cash page when the forecast already has figures. */
export function showSuggestOnceOffs(input: {
  suggestionCount: number;
  lineAmounts: readonly number[];
}): boolean {
  if (input.suggestionCount > 0) return true;
  return input.lineAmounts.some((amount) => Number.isFinite(amount) && amount !== 0);
}

function norm(name: string): string {
  return name.trim().toLowerCase();
}

function money(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return String(rounded);
}

function slug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return base || "line";
}

function allocateId(name: string, used: Set<string>): string {
  const base = `suggested-once-off-${slug(name)}`;
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

function sideFor(line: Pick<CashForecastDraftLine, "side" | "bucket">): SuggestedOnceOffLine["side"] {
  if (line.side === "inflow") return "revenue";
  if (EXPENSE_BUCKETS.has(line.bucket)) return "expenses";
  return "other";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object";
}

function asDraftLine(value: unknown): CashForecastDraftLine | null {
  if (!isRecord(value)) return null;
  if (value.cadence !== "once_off" && value.frequency !== "once-off") return null;
  if (value.status === "excluded") return null;
  const amount = typeof value.amount === "number" ? value.amount : Number(value.amount);
  if (!Number.isFinite(amount) || !(amount > 0)) return null;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return null;
  const side = value.side === "inflow" || value.side === "outflow" ? value.side : null;
  const bucket = typeof value.bucket === "string" ? (value.bucket as CashBucket) : "other";
  if (!side) return null;
  const start = typeof value.start_week === "number" ? value.start_week : typeof value.startWeek === "number" ? value.startWeek : 1;
  return {
    id: typeof value.id === "string" ? value.id : "",
    side,
    bucket,
    name,
    amount,
    cadence: "once_off",
    start_week: Math.max(1, Math.min(13, Math.round(start) || 1)),
    split_count: 1,
    status: "proposed",
    confidence: 1,
    source: "ai",
    txn_count: 1,
    sample_descriptions: [],
  };
}

function draftLinesFromHistory(bankDraft: unknown): CashForecastDraftLine[] {
  if (!isRecord(bankDraft)) return [];
  if (Array.isArray(bankDraft.lines)) {
    const parsed = bankDraft.lines.map(asDraftLine).filter((line): line is CashForecastDraftLine => line != null);
    if (parsed.length || bankDraft.lines.length) return parsed;
  }
  const extract = bankDraft.extract;
  if (isRecord(extract) && Array.isArray(extract.transactions)) {
    return buildDraftLinesFromExtract(extract as CashBankExtract).filter((line) => line.cadence === "once_off" && line.status !== "excluded" && line.amount > 0);
  }
  const fromSections: CashForecastDraftLine[] = [];
  for (const key of ["revenue", "expenses", "other"] as const) {
    const rows = bankDraft[key];
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!isRecord(row) || row.frequency !== "once-off") continue;
      const amount = typeof row.amount === "number" ? row.amount : Number(row.amount);
      const name = typeof row.name === "string" ? row.name.trim() : "";
      if (!name || !Number.isFinite(amount) || !(amount > 0)) continue;
      const side = key === "revenue" ? "inflow" : "outflow";
      const bucket: CashBucket = key === "expenses" ? "opex" : "other";
      fromSections.push({
        id: typeof row.id === "string" ? row.id : "",
        side,
        bucket,
        name,
        amount,
        cadence: "once_off",
        start_week: Math.max(1, Math.min(13, typeof row.startWeek === "number" ? row.startWeek : 1)),
        split_count: 1,
        status: "proposed",
        confidence: 1,
        source: "manual",
        txn_count: 1,
        sample_descriptions: [],
      });
    }
  }
  return fromSections;
}

export function suggestOnceOffRows(input: {
  bankDraft: unknown;
  existing: readonly ExistingLine[];
  /** Lines already on the 13-week grid. Used when those rows are the bank source. */
  forecastLines?: readonly ForecastGridLine[];
  bankSourced?: boolean;
}): OnceOffSuggestResult {
  const onGrid = input.bankSourced ? onceOffsOnBankForecast(input.forecastLines ?? []) : [];
  const history = draftLinesFromHistory(input.bankDraft);
  const names = new Set<string>();
  const used = new Set<string>();
  const lines: SuggestedOnceOffLine[] = [];
  for (const row of onGrid) {
    names.add(norm(row.name));
    used.add(row.id);
    lines.push(row);
  }
  for (const row of history) {
    if (names.has(norm(row.name))) continue;
    if (row.id && used.has(row.id)) continue;
    if (input.existing.some((line) => norm(line.name ?? "") === norm(row.name))) continue;
    if (row.id && input.existing.some((line) => line.id === row.id)) continue;
    const id = allocateId(row.name, used);
    names.add(norm(row.name));
    lines.push({
      id,
      name: row.name,
      amount: money(row.amount),
      frequency: "once-off",
      startWeek: row.start_week,
      splitCount: 1,
      side: sideFor(row),
    });
  }
  if (!lines.length) return { lines: [], empty: history.length ? ALREADY : EMPTY };
  return { lines, empty: null };
}
