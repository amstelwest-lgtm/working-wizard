/**
 * Single numbering source for report cards, ZIP filenames, and PDF kickers.
 * Card order is the number. PDFs must call reportKicker — do not hardcode one.
 */

export const REPORT_CATALOG = [
  { key: "scorecard", number: 1 },
  { key: "intervention", number: 2 },
  { key: "forecast", number: 3 },
  { key: "cycle", number: 4 },
  { key: "waterfall", number: 5 },
  { key: "leverage", number: 6 },
  { key: "assets", number: 7 },
  { key: "labor", number: 8 },
  { key: "movement", number: 9 },
  { key: "benchmark", number: 10 },
  { key: "budget", number: 11 },
] as const;

export type ReportCatalogKey = (typeof REPORT_CATALOG)[number]["key"];

export function reportNumber(key: string): number {
  const row = REPORT_CATALOG.find((r) => r.key === key);
  if (!row) throw new Error(`Unknown report: ${key}`);
  return row.number;
}

/** "Advisory Report 02" or "Advisory Report 03 · Base". */
export function reportKicker(key: string, extra?: string): string {
  const n = String(reportNumber(key)).padStart(2, "0");
  const base = `Advisory Report ${n}`;
  const tail = extra?.trim();
  return tail ? `${base} · ${tail}` : base;
}
