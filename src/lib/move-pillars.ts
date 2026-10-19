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

/** "Profit · Profit power". The nickname is the sub-factor, not the score. */
export function moveFactorLabel(move: { key: string; ratioName: string }): string {
  const factor = factorDisplayName(move.ratioName);
  const id = strategicMovePillar(move.key);
  return id ? `${PILLAR_LABELS[id]} · ${factor}` : factor;
}
