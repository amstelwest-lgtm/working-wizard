/**
 * Prior-period helpers — resolve a comparable snapshot and build variance chips.
 */

import { scoreTier } from "@/lib/ratios";

export type SnapshotRow = {
  id?: string;
  period_label: string;
  period_date: string;
  financials?: Record<string, unknown> | null;
  ratios?: Record<string, number> | null;
};

/** Lightweight per-ratio score (aligned with reports.index scoreForRatio). */
function scorePriorRatio(name: string, val: number): number {
  if (!Number.isFinite(val)) return 50;
  const clamp = (n: number) => Math.min(100, Math.max(0, n));
  if (name === "Net Margin") return clamp((val / 0.15) * 100);
  if (name === "Operating Margin") return clamp((val / 0.2) * 100);
  if (name === "Gross Margin") return clamp((val / 0.4) * 100);
  if (name === "Return on Assets") return clamp((val / 0.12) * 100);
  if (name === "Return on Equity") return clamp((val / 0.2) * 100);
  if (name === "Asset Turnover") return clamp((val / 1.5) * 100);
  if (name === "Debtor Days") return clamp(((90 - val) / 90) * 100);
  if (name === "Inventory Days") return clamp(((90 - val) / 90) * 100);
  if (name === "Creditor Days") return clamp((val / 60) * 100);
  if (name === "Working Capital Days") return clamp(((90 - val) / 90) * 100);
  if (name === "OCF / EBITDA") return clamp(val * 100);
  if (name === "Interest Burden") return clamp(val * 100);
  if (name === "Equity Multiplier") return clamp(((4 - val) / 3) * 100);
  return 50;
}

/**
 * Pick the best prior snapshot relative to `asOf` (default today).
 * Prefers ~11–14 months back (YoY); else nearest older distinct period_date.
 */
export function resolvePriorSnapshot(
  snapshots: SnapshotRow[],
  asOf: Date = new Date(),
): SnapshotRow | null {
  if (!snapshots.length) return null;
  const asOfMs = asOf.getTime();
  const older = snapshots
    .filter((s) => {
      const t = Date.parse(s.period_date);
      return Number.isFinite(t) && t < asOfMs - 14 * 24 * 3600 * 1000;
    })
    .sort((a, b) => Date.parse(b.period_date) - Date.parse(a.period_date));

  if (!older.length) return null;

  const target = asOfMs - 365 * 24 * 3600 * 1000;
  let best = older[0];
  let bestDist = Math.abs(Date.parse(best.period_date) - target);
  for (const s of older) {
    const dist = Math.abs(Date.parse(s.period_date) - target);
    if (dist < bestDist) {
      best = s;
      bestDist = dist;
    }
  }
  if (bestDist <= 75 * 24 * 3600 * 1000) return best;
  return older[0];
}

export type VarianceChip = {
  key: string;
  label: string;
  current: number | null;
  prior: number | null;
  delta: number | null;
  higherIsBetter: boolean;
  unit: "pct" | "days" | "score" | "number";
  status: "up" | "down" | "flat" | "na";
};

function numFromFin(fin: Record<string, unknown> | null | undefined, key: string): number | null {
  if (!fin) return null;
  const v = fin[key];
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function margin(rev: number | null, part: number | null): number | null {
  if (rev == null || part == null || rev === 0) return null;
  return part / rev;
}

export function buildVarianceChips(input: {
  currentFinancials: Record<string, unknown> | null | undefined;
  currentRatios: Record<string, number> | null | undefined;
  prior: SnapshotRow | null;
  healthScore?: number | null;
  priorHealthScore?: number | null;
  cashRunwayWeeks?: number | null;
  priorCashRunwayWeeks?: number | null;
}): VarianceChip[] {
  const curFin = input.currentFinancials ?? {};
  const priorFin = (input.prior?.financials as Record<string, unknown> | null) ?? null;
  const curRatios = input.currentRatios ?? {};
  const priorRatios = input.prior?.ratios ?? {};

  const curRev = numFromFin(curFin, "revenue");
  const priorRev = numFromFin(priorFin, "revenue");
  const curEbit = numFromFin(curFin, "ebit");
  const priorEbit = numFromFin(priorFin, "ebit");
  const curCogs = numFromFin(curFin, "cogs");
  const priorCogs = numFromFin(priorFin, "cogs");

  const curGm = Number.isFinite(curRatios["Gross Margin"])
    ? curRatios["Gross Margin"]
    : margin(curRev, curRev != null && curCogs != null ? curRev - curCogs : null);
  const priorGm = Number.isFinite(priorRatios["Gross Margin"])
    ? priorRatios["Gross Margin"]
    : margin(priorRev, priorRev != null && priorCogs != null ? priorRev - priorCogs : null);

  const curOm = Number.isFinite(curRatios["Operating Margin"])
    ? curRatios["Operating Margin"]
    : margin(curRev, curEbit);
  const priorOm = Number.isFinite(priorRatios["Operating Margin"])
    ? priorRatios["Operating Margin"]
    : margin(priorRev, priorEbit);

  const curDd = Number.isFinite(curRatios["Debtor Days"]) ? curRatios["Debtor Days"] : null;
  const priorDd = Number.isFinite(priorRatios["Debtor Days"]) ? priorRatios["Debtor Days"] : null;

  const mk = (
    key: string,
    label: string,
    current: number | null,
    prior: number | null,
    higherIsBetter: boolean,
    unit: VarianceChip["unit"],
  ): VarianceChip => {
    const delta = current != null && prior != null ? current - prior : null;
    let status: VarianceChip["status"] = "na";
    if (delta != null) {
      const eps = unit === "pct" ? 0.002 : 0.5;
      if (Math.abs(delta) < eps) status = "flat";
      else status = delta > 0 ? "up" : "down";
    }
    return { key, label, current, prior, delta, higherIsBetter, unit, status };
  };

  return [
    mk("revenue", "Revenue", curRev, priorRev, true, "number"),
    mk("gm", "Gross margin", curGm, priorGm, true, "pct"),
    mk("om", "Operating margin", curOm, priorOm, true, "pct"),
    mk("dd", "Debtor days", curDd, priorDd, false, "days"),
    mk(
      "runway",
      "Cash runway (wk)",
      input.cashRunwayWeeks ?? null,
      input.priorCashRunwayWeeks ?? null,
      true,
      "number",
    ),
    mk(
      "health",
      "Health score",
      input.healthScore ?? null,
      input.priorHealthScore ?? null,
      true,
      "score",
    ),
  ].filter((c) => c.current != null || c.prior != null);
}

export function withPriorRatioScores<
  T extends {
    ratio_name: string;
    current_value: number;
    health_score: number;
    prior_period_value?: number;
    prior_period_score?: number;
  },
>(results: T[], priorRatios: Record<string, number> | null | undefined): T[] {
  if (!priorRatios) return results;
  return results.map((r) => {
    const priorVal = priorRatios[r.ratio_name];
    if (!Number.isFinite(priorVal)) return r;
    return {
      ...r,
      prior_period_value: priorVal,
      prior_period_score: Math.round(scorePriorRatio(r.ratio_name, priorVal)),
    };
  });
}

export { scoreTier };
