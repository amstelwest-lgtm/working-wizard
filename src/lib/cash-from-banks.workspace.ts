/**
 * Accountant workspace helpers: move buckets, merge, split, reorder.
 */

import type { CashBucket, CashCadence, CashForecastDraftLine } from "@/lib/cash-from-banks.types";

function newId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/** Buckets that typically mean money in */
const INFLOW_BUCKETS = new Set<CashBucket>(["trading"]);

export function sideForBucket(bucket: CashBucket, fallback: "inflow" | "outflow"): "inflow" | "outflow" {
  if (INFLOW_BUCKETS.has(bucket)) return "inflow";
  if (bucket === "transfer") return fallback;
  // loan/owner/other can be either — keep current side unless forcing trading
  return fallback;
}

export function moveLineToBucket(
  lines: CashForecastDraftLine[],
  lineId: string,
  bucket: CashBucket,
): CashForecastDraftLine[] {
  return lines.map((l) => {
    if (l.id !== lineId) return l;
    const side = bucket === "trading" ? "inflow" : bucket === "transfer" ? l.side : sideForBucket(bucket, l.side);
    return {
      ...l,
      bucket,
      side: bucket === "trading" ? "inflow" : side,
      status: bucket === "transfer" ? "excluded" : l.status === "excluded" ? "proposed" : l.status,
      source: l.source === "ai" ? "manual" : l.source,
    };
  });
}

export function mergeDraftLines(
  lines: CashForecastDraftLine[],
  ids: string[],
): CashForecastDraftLine[] {
  const unique = [...new Set(ids)];
  if (unique.length < 2) return lines;
  const selected = lines.filter((l) => unique.includes(l.id));
  if (selected.length < 2) return lines;

  const primary = selected[0]!;
  const merged: CashForecastDraftLine = {
    id: newId(),
    side: primary.side,
    bucket: primary.bucket,
    name: selected.map((l) => l.name).join(" + ").slice(0, 80),
    amount: Math.round(median(selected.map((l) => l.amount)) * 100) / 100,
    cadence: majorityCadence(selected),
    start_week: Math.min(...selected.map((l) => l.start_week || 1)),
    split_count: Math.max(...selected.map((l) => l.split_count || 3)),
    status: selected.every((l) => l.status === "excluded") ? "excluded" : "confirmed",
    confidence: Math.max(...selected.map((l) => l.confidence)),
    source: "merged",
    txn_count: selected.reduce((s, l) => s + l.txn_count, 0),
    sample_descriptions: selected.flatMap((l) => l.sample_descriptions).slice(0, 5),
  };

  const drop = new Set(unique);
  const rest = lines.filter((l) => !drop.has(l.id));
  // Insert merged where the first selected line was
  const insertAt = lines.findIndex((l) => l.id === unique[0]);
  const next = [...rest];
  next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, merged);
  return next;
}

function majorityCadence(lines: CashForecastDraftLine[]): CashCadence {
  const counts = new Map<CashCadence, number>();
  for (const l of lines) counts.set(l.cadence, (counts.get(l.cadence) ?? 0) + 1);
  let best: CashCadence = lines[0]!.cadence;
  let n = 0;
  for (const [c, v] of counts) {
    if (v > n) {
      best = c;
      n = v;
    }
  }
  return best;
}

export function splitDraftLine(
  lines: CashForecastDraftLine[],
  lineId: string,
): CashForecastDraftLine[] {
  const idx = lines.findIndex((l) => l.id === lineId);
  if (idx < 0) return lines;
  const line = lines[idx]!;
  const half = Math.round((line.amount / 2) * 100) / 100;
  const a: CashForecastDraftLine = {
    ...line,
    id: newId(),
    name: `${line.name} (A)`,
    amount: half,
    source: "manual",
    status: line.status === "excluded" ? "proposed" : "confirmed",
    txn_count: Math.max(1, Math.floor(line.txn_count / 2)),
  };
  const b: CashForecastDraftLine = {
    ...line,
    id: newId(),
    name: `${line.name} (B)`,
    amount: Math.round((line.amount - half) * 100) / 100,
    source: "manual",
    status: line.status === "excluded" ? "proposed" : "confirmed",
    txn_count: Math.max(1, line.txn_count - a.txn_count),
  };
  const next = [...lines];
  next.splice(idx, 1, a, b);
  return next;
}

export function reorderDraftLine(
  lines: CashForecastDraftLine[],
  fromId: string,
  toId: string,
): CashForecastDraftLine[] {
  if (fromId === toId) return lines;
  const from = lines.findIndex((l) => l.id === fromId);
  const to = lines.findIndex((l) => l.id === toId);
  if (from < 0 || to < 0) return lines;
  const next = [...lines];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

export function confirmAllProposed(lines: CashForecastDraftLine[]): CashForecastDraftLine[] {
  return lines.map((l) =>
    l.status === "proposed" ? { ...l, status: "confirmed" as const } : l,
  );
}

export const BUCKET_LANES: Array<{ bucket: CashBucket; label: string; tone: string }> = [
  { bucket: "trading", label: "Trading in", tone: "emerald" },
  { bucket: "cos", label: "Cost of sales", tone: "rose" },
  { bucket: "opex", label: "Operating", tone: "amber" },
  { bucket: "payroll", label: "Payroll", tone: "amber" },
  { bucket: "rent", label: "Rent", tone: "amber" },
  { bucket: "interest", label: "Interest", tone: "rose" },
  { bucket: "tax", label: "Tax", tone: "rose" },
  { bucket: "vat", label: "VAT", tone: "slate" },
  { bucket: "loan", label: "Loan / finance", tone: "blue" },
  { bucket: "owner", label: "Owner", tone: "blue" },
  { bucket: "capex", label: "Capex", tone: "blue" },
  { bucket: "other", label: "Other", tone: "slate" },
  { bucket: "transfer", label: "Transfers (excluded)", tone: "slate" },
];
