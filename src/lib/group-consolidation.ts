/**
 * First-pass **group consolidation** helpers for parent P2.
 *
 * Sums the same scalar financial blob the ratio grid reads. This is additive
 * rollup only — no intercompany eliminations, FX, ownership/NCI, or pro-rata
 * across mismatched period lengths. UI wiring is a follow-up PR.
 */

import type { RatioInputs } from "./ratios.ts";

/** Scalars summed for a naive combined group total (stocks and flows). */
export const GROUP_ADDITIVE_SCALAR_KEYS = [
  "revenue",
  "cogs",
  "fixedCosts",
  "variableCosts",
  "laborCost",
  "ebitda",
  "ebit",
  "ebt",
  "netIncome",
  "operatingCashflow",
  "totalAssets",
  "equity",
  "totalLiabilities",
  "currentAssets",
  "currentLiabilities",
  "nonCurrentLiabilities",
  "cash",
  "receivables",
  "inventory",
  "payables",
] as const satisfies readonly (keyof RatioInputs | string)[];

export type GroupAdditiveScalarKey = (typeof GROUP_ADDITIVE_SCALAR_KEYS)[number];

export type CompanyConsolidationInput = {
  clientId: string;
  name: string;
  /** From clients.currency or the statement blob. */
  currency: string | null;
  periodDate: string | null;
  periodLabel?: string | null;
  financials: Record<string, string | undefined>;
};

export type GroupConsolidationBlocker =
  | { kind: "currency_mismatch"; currencies: string[] }
  | { kind: "period_mismatch"; periodDates: string[] }
  | { kind: "missing_period"; clientIds: string[] }
  | { kind: "no_figures"; clientIds: string[] };

export type GroupConsolidationResult =
  | {
      ok: true;
      currency: string | null;
      periodDate: string;
      periodLabel: string | null;
      combined: Record<string, string>;
      memberClientIds: string[];
    }
  | { ok: false; blockers: GroupConsolidationBlocker[] };

function normalizeCurrency(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

function parseMoney(raw: string | undefined): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const n = Number(text.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function formatMoney(n: number): string {
  return String(n);
}

function hasAnyFigure(financials: Record<string, string | undefined>): boolean {
  return GROUP_ADDITIVE_SCALAR_KEYS.some((key) => parseMoney(financials[key]) != null);
}

export function groupConsolidationBlockers(
  members: readonly CompanyConsolidationInput[],
): GroupConsolidationBlocker[] {
  const blockers: GroupConsolidationBlocker[] = [];
  if (members.length < 2) return blockers;

  const currencies = [
    ...new Set(members.map((m) => normalizeCurrency(m.currency)).filter((c): c is string => !!c)),
  ];
  if (currencies.length > 1) {
    blockers.push({ kind: "currency_mismatch", currencies });
  }

  const missingPeriod = members.filter((m) => !m.periodDate?.trim()).map((m) => m.clientId);
  if (missingPeriod.length > 0) {
    blockers.push({ kind: "missing_period", clientIds: missingPeriod });
  }

  const periodDates = [
    ...new Set(members.map((m) => m.periodDate?.trim()).filter((d): d is string => !!d)),
  ];
  if (periodDates.length > 1) {
    blockers.push({ kind: "period_mismatch", periodDates });
  }

  const noFigures = members.filter((m) => !hasAnyFigure(m.financials)).map((m) => m.clientId);
  if (noFigures.length > 0) {
    blockers.push({ kind: "no_figures", clientIds: noFigures });
  }

  return blockers;
}

/** Hard-stop blockers — preview must not show combined totals when any of these are present. */
export function groupConsolidationHardStop(blockers: readonly GroupConsolidationBlocker[]): boolean {
  return blockers.some(
    (b) =>
      b.kind === "currency_mismatch" ||
      b.kind === "period_mismatch" ||
      b.kind === "missing_period",
  );
}

export function sumGroupAdditiveScalars(
  members: readonly CompanyConsolidationInput[],
): Record<string, string> {
  const combined: Record<string, string> = {};
  for (const key of GROUP_ADDITIVE_SCALAR_KEYS) {
    let sum = 0;
    let any = false;
    for (const member of members) {
      const n = parseMoney(member.financials[key]);
      if (n == null) continue;
      sum += n;
      any = true;
    }
    if (any) combined[key] = formatMoney(sum);
  }
  return combined;
}

/**
 * Build a pilot group total when every member shares currency and period_date.
 * Returns blockers instead of silent wrong totals.
 */
export function buildGroupConsolidation(
  members: readonly CompanyConsolidationInput[],
): GroupConsolidationResult {
  const blockers = groupConsolidationBlockers(members);
  if (members.length < 2) {
    return { ok: false, blockers: [{ kind: "no_figures", clientIds: [] }] };
  }
  if (groupConsolidationHardStop(blockers)) {
    return { ok: false, blockers };
  }

  const periodDate = members[0]?.periodDate?.trim() ?? "";
  const periodLabel = members.map((m) => m.periodLabel?.trim()).find(Boolean) ?? null;
  const currency = normalizeCurrency(members[0]?.currency ?? null);

  return {
    ok: true,
    currency,
    periodDate,
    periodLabel,
    combined: sumGroupAdditiveScalars(members),
    memberClientIds: members.map((m) => m.clientId),
  };
}

/** Documented limits for product copy and the next UI slice. */
export const GROUP_CONSOLIDATION_LIMITS = [
  "No intercompany eliminations",
  "No foreign-exchange conversion",
  "No non-controlling interest / ownership weighting",
  "No pro-rata across different period lengths",
  "Agents and Budget stay on one company",
] as const;
