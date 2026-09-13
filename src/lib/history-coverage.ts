/**
 * Past-period coverage for trend lines and movement figures.
 * Live `clients.financials` stays the current board; extra periods live on snapshots.
 */

export type HistorySnapshot = {
  period_label?: string | null;
  period_date?: string | null;
  ratios?: Record<string, number> | null;
};

/** Snapshot JSON keys that computeRatios actually writes, plus older aliases. */
export const SNAPSHOT_RATIO_ALIASES: Record<string, string[]> = {
  "Gross Margin": ["Gross Margin", "Gross Profit Margin"],
  "Gross Profit Margin": ["Gross Margin", "Gross Profit Margin"],
};

export function periodKeyOf(row: HistorySnapshot): string {
  const date = (row.period_date ?? "").trim().slice(0, 10);
  if (date) return date;
  return (row.period_label ?? "").trim();
}

export function distinctPeriodCount(snapshots: HistorySnapshot[] | null | undefined): number {
  const keys = new Set<string>();
  for (const row of snapshots ?? []) {
    const key = periodKeyOf(row);
    if (key) keys.add(key);
  }
  return keys.size;
}

export function needsPastPeriodPrompt(opts: {
  hasLiveFigures: boolean;
  firstRunBusy?: boolean;
  snapshots: HistorySnapshot[] | null | undefined;
}): boolean {
  if (!opts.hasLiveFigures || opts.firstRunBusy) return false;
  return distinctPeriodCount(opts.snapshots) < 2;
}

export function ratioFromSnapshot(
  ratios: Record<string, number> | null | undefined,
  preferred: string,
): number {
  if (!ratios) return NaN;
  const aliases = SNAPSHOT_RATIO_ALIASES[preferred] ?? [preferred];
  for (const key of aliases) {
    const n = Number(ratios[key]);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
}

/**
 * Oldest → newest series. Appends the live board value when it is finite so
 * one saved snapshot + current figures can already draw a line.
 */
export function buildRatioSeries(
  history: HistorySnapshot[],
  snapshotKey: string,
  liveValue?: number,
): number[] {
  const fromHist = history
    .map((row) => ratioFromSnapshot(row.ratios, snapshotKey))
    .filter((n) => Number.isFinite(n));
  if (liveValue == null || !Number.isFinite(liveValue)) return fromHist;
  if (fromHist.length === 0) return [liveValue];
  const last = fromHist[fromHist.length - 1]!;
  if (Math.abs(last - liveValue) < 1e-9) return fromHist;
  return [...fromHist, liveValue];
}

export const PAST_PERIOD_UPLOAD_TITLE = "Add a past period";

export const PAST_PERIOD_UPLOAD_LEAD =
  "Another period’s figures turn trend lines and comparison movement on. Whatever you already have is useful — we will read what we can.";

export const PAST_PERIOD_UPLOAD_ACCEPTS = [
  "A prior-year P&L or annual financial statements",
  "A management pack, trial balance, or accountant’s workbook",
  "Excel, CSV, PDF, or a scan of paper statements",
  "A quarter or half-year if you do not have a full year yet",
  "Bank statements that cover an earlier stretch (they help even when they are not a formal P&L)",
];

export const PAST_PERIOD_UPLOAD_NOTE =
  "This saves as history by default. The board you are looking at stays on the current figures unless you choose to replace them.";

export function historyCoverageQuestionStates(opts: {
  snapshotCount: number;
  hasLiveFigures: boolean;
  deferForCoreProfile?: boolean;
}): {
  key: string;
  prompt: string;
  audience: "owner" | "accountant" | "both";
  answered: boolean;
  answer: string | null;
  source: "stored";
}[] {
  if (!opts.hasLiveFigures || opts.deferForCoreProfile) return [];
  const answered = opts.snapshotCount >= 2;
  return [
    {
      key: "history.prior_period",
      prompt:
        "Do you have figures from a prior year or another period we can add?",
      audience: "both",
      answered,
      answer: answered ? `${opts.snapshotCount} periods on file` : null,
      source: "stored",
    },
  ];
}
