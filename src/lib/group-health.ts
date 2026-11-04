/**
 * Group Health / ratios **stub** for group consolidation preview.
 *
 * Metadata and copy only. Does not compute group ratios, call Analyst, or
 * change combined totals.
 */

import { GROUP_ADDITIVE_SCALAR_KEYS } from "./group-consolidation";
import { PILLAR_RATIO_NAMES } from "./health-catalogue";

export type GroupHealthStub = {
  /** Always empty until real group Health / ratio compute exists. */
  appliedHealth: readonly [];
  headline: string;
  detail: string;
  notAppliedReasons: readonly string[];
  /** Canonical per-company ratio names planned for a future group compute path. */
  plannedRatioLabels: readonly string[];
  /** Additive combined lines on file when consolidation succeeded (labels only). */
  combinedInputLabels: readonly string[];
  /** True when a multi-company group would eventually show group Health. */
  healthPlanned: boolean;
  /** True when combined totals are not available yet (but group Health is in scope). */
  blocked: boolean;
};

const NOT_APPLIED_REASONS = [
  "No group-level ratio compute",
  "No group Health ring",
  "Analyst stays per company",
  "No narrative at group scope",
] as const;

const ADDITIVE_FIGURE_LABELS: Record<string, string> = {
  revenue: "Revenue",
  cogs: "COGS",
  fixedCosts: "Fixed costs",
  variableCosts: "Variable costs",
  laborCost: "Labor cost",
  ebitda: "EBITDA",
  ebit: "EBIT",
  ebt: "EBT",
  netIncome: "Net income",
  operatingCashflow: "Operating cash flow",
  totalAssets: "Total assets",
  equity: "Equity",
  totalLiabilities: "Total liabilities",
  currentAssets: "Current assets",
  currentLiabilities: "Current liabilities",
  nonCurrentLiabilities: "Non-current liabilities",
  cash: "Cash",
  receivables: "Receivables",
  inventory: "Inventory",
  payables: "Payables",
};

function allCatalogueRatioLabels(): string[] {
  return (Object.keys(PILLAR_RATIO_NAMES) as (keyof typeof PILLAR_RATIO_NAMES)[]).flatMap(
    (pillar) => [...PILLAR_RATIO_NAMES[pillar]],
  );
}

function combinedInputLabelsFromMap(
  combined: Readonly<Record<string, string>> | null | undefined,
): string[] {
  if (!combined) return [];
  return GROUP_ADDITIVE_SCALAR_KEYS.filter((key) => combined[key] != null).map(
    (key) => ADDITIVE_FIGURE_LABELS[key] ?? key,
  );
}

export type BuildGroupHealthStubInput = {
  memberCount: number;
  consolidationOk: boolean;
  combined?: Readonly<Record<string, string>> | null;
};

/**
 * Surface planned group Health copy and explicit “not applied” reasons. Never mutates figures.
 */
export function buildGroupHealthStub(input: BuildGroupHealthStubInput): GroupHealthStub {
  const plannedRatioLabels = allCatalogueRatioLabels();
  const combinedInputLabels = combinedInputLabelsFromMap(input.combined);

  if (input.memberCount < 2) {
    return {
      appliedHealth: [],
      headline: "Group Health: not needed",
      detail:
        "Health scores and ratios stay on each company. Combined preview does not apply with fewer than two companies.",
      notAppliedReasons: NOT_APPLIED_REASONS,
      plannedRatioLabels: [],
      combinedInputLabels: [],
      healthPlanned: false,
      blocked: false,
    };
  }

  if (!input.consolidationOk) {
    return {
      appliedHealth: [],
      headline: "Group Health: blocked until combined figures are available",
      detail:
        "Resolve consolidation blockers above first. Group ratios and a group Health ring need combined statement inputs — nothing is computed in preview yet.",
      notAppliedReasons: NOT_APPLIED_REASONS,
      plannedRatioLabels,
      combinedInputLabels: [],
      healthPlanned: true,
      blocked: true,
    };
  }

  return {
    appliedHealth: [],
    headline: "Group Health: none applied yet",
    detail:
      combinedInputLabels.length > 0
        ? `Combined additive lines below could feed group ratios later. Per-company Health and Analyst narrative are unchanged — no group score is calculated in preview.`
        : "Per-company Health and Analyst narrative are unchanged — no group score or ratios are calculated in preview.",
    notAppliedReasons: NOT_APPLIED_REASONS,
    plannedRatioLabels,
    combinedInputLabels,
    healthPlanned: true,
    blocked: false,
  };
}

/** Locks preview behaviour: Health stub must not alter additive combined totals. */
export function combinedFiguresUnchanged(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): boolean {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of keys) {
    if ((before[key] ?? "") !== (after[key] ?? "")) return false;
  }
  return true;
}
