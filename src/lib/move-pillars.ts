/**
 * Which strategic-move key sits under which health pillar.
 * No profile or market imports, so the ask-ai edge function can use it.
 */
import { PILLAR_LABELS, type HealthPillarId } from "./health-score.ts";
import { factorDisplayName } from "./score-prose.ts";

const MOVE_PILLAR: Record<string, HealthPillarId> = {
  operatingMargin: "profit",
  netMargin: "profit",
  grossMargin: "profit",
  directCostsRatio: "profit",
  fixedCostRatio: "profit",
  dol: "profit",
  gpToLabor: "profit",
  customerConcentration: "profit",
  revenueGrowth: "profit",
  assetTurnover: "assets",
  roa: "assets",
  inventoryDays: "assets",
  salesPerEmployee: "assets",
  fixedCapitalUtilization: "assets",
  assetReinvestmentRatio: "assets",
  capexIntensity: "assets",
  taxBurden: "financing",
  interestBurden: "financing",
  equityMultiplier: "financing",
  roe: "financing",
  fundingStructure: "financing",
  debtToEquity: "financing",
  debtToAssets: "financing",
  debtorDays: "cash",
  creditorDays: "cash",
  workingCapitalDays: "cash",
  workingCapitalUtilization: "cash",
  workingCapitalFunding: "cash",
  ocfToEbitda: "cash",
  currentRatio: "cash",
};

export function strategicMovePillar(key: string): HealthPillarId | null {
  return MOVE_PILLAR[key] ?? null;
}

const TITLE_PILLAR: readonly [RegExp, HealthPillarId][] = [
  [/supplier|net-60|net-90|creditor|payable/i, "cash"],
  [/receivable|debtor|collect|invoice the same day/i, "cash"],
  [/current ratio|working capital|\bcash\b/i, "cash"],
  [/price|margin|pricing/i, "profit"],
  [/asset|equipment|inventory|stock|idle/i, "assets"],
  [/equity|interest|refinanc|loan|\bdebt\b/i, "financing"],
];

/** Which pillar a proposed title is aimed at. Null when the title does not say. */
export function stepPillarFromTitle(title: string): HealthPillarId | null {
  for (const [pattern, id] of TITLE_PILLAR) {
    if (pattern.test(title)) return id;
  }
  return null;
}

/** The first move when a proposal round did not already target that pillar. */
export function weakestPillarLead(pillar: HealthPillarId): { title: string; rationale: string } {
  switch (pillar) {
    case "cash":
      return {
        title: "Negotiate Net-60 or Net-90 terms with key suppliers",
        rationale: "Cash is the weakest pillar on the live score.",
      };
    case "assets":
      return {
        title: "Sell or lease idle equipment and unused property",
        rationale: "Assets is the weakest pillar on the live score.",
      };
    case "financing":
      return {
        title: "Reinvest profits to grow equity organically",
        rationale: "Financing is the weakest pillar on the live score.",
      };
    case "profit":
      return {
        title: "Increase prices where customers are loyal",
        rationale: "Profit is the weakest pillar on the live score.",
      };
  }
}

/** "Profit · Profit power". The nickname is the sub-factor, not the score. */
export function moveFactorLabel(move: { key: string; ratioName: string }): string {
  const factor = factorDisplayName(move.ratioName);
  const id = strategicMovePillar(move.key);
  return id ? `${PILLAR_LABELS[id]} · ${factor}` : factor;
}
