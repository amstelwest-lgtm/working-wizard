import type { SpherePillar } from "@/components/sphere-hero";

/**
 * Maps the existing app.tsx health data into SphereHero props.
 *
 * This intentionally does NOT recompute anything — it reads the same
 * healthMap / pillarHealths already produced in app.tsx and regroups the
 * per-ratio scores into the four pillars' drivers, deriving each pillar's
 * drivers from its underlying ratios (as specified). Friendly labels come
 * from RATIO_META so the UI wording stays consistent with the rest of the app.
 */

// The ratio keys that make up each pillar's drivers. These mirror the grouping
// used by pillarHealths in app.tsx so the sphere score and its drivers agree.
// Adjust here (not in the component) if you re-balance a pillar.
export const PILLAR_DRIVER_KEYS: Record<SpherePillar["id"], string[]> = {
  profit: ["grossMargin", "operatingMargin", "netMargin", "revenueGrowth", "directCostsRatio", "fixedCostRatio"],
  assets: ["assetTurnover", "roa", "inventoryDays", "fixedCapitalUtilization", "workingCapitalUtilization", "salesPerEmployee"],
  financing: ["fundingStructure", "debtToEquity", "debtToAssets", "equityMultiplier", "interestBurden"],
  cash: ["debtorDays", "creditorDays", "currentRatio", "workingCapitalFunding", "ocfToEbitda"],
};

const PILLAR_LABEL: Record<SpherePillar["id"], string> = {
  profit: "Profit",
  assets: "Assets",
  financing: "Financing",
  cash: "Cash",
};

function blurbFor(id: SpherePillar["id"], health: number): string {
  const good = isFinite(health) && health >= 65;
  const bad = isFinite(health) && health < 40;
  switch (id) {
    case "profit":
      return bad ? "Your profitability needs attention." : good ? "Your profitability is strong." : "Your profitability is average.";
    case "assets":
      return bad ? "Your assets are underused." : good ? "Your assets are working hard." : "Your asset efficiency is average.";
    case "financing":
      return bad ? "Your financing structure is holding you back." : good ? "Your financing structure is solid." : "Your financing structure is workable.";
    case "cash":
      return bad ? "Your cash position is tight." : good ? "Strong cash position gives you flexibility." : "Your cash position is adequate.";
  }
}

export type BuildSphereArgs = {
  /** avgHealth from app.tsx (overall business health score) */
  overallHealth: number;
  overallDelta?: number;
  /** pillarHealths object from app.tsx */
  pillarHealths: Record<SpherePillar["id"], number>;
  /** per-pillar deltas, if you track them; otherwise omit */
  pillarDeltas?: Partial<Record<SpherePillar["id"], number>>;
  /** healthMap from app.tsx: ratioKey -> 0..100 */
  healthMap: Record<string, number>;
  /** RATIO_META from app.tsx (for friendly labels/descriptions) */
  ratioMeta: Record<string, { friendly?: string; techName?: string }>;
};

export function buildSpherePillars(args: BuildSphereArgs): SpherePillar[] {
  const { pillarHealths, pillarDeltas, healthMap, ratioMeta } = args;
  return (Object.keys(PILLAR_DRIVER_KEYS) as SpherePillar["id"][]).map((id) => {
    const drivers = PILLAR_DRIVER_KEYS[id]
      .filter((k) => k in healthMap)
      .map((k) => ({
        key: k,
        label: ratioMeta[k]?.friendly ?? ratioMeta[k]?.techName ?? k,
        description: ratioMeta[k]?.techName,
        health: healthMap[k],
      }));
    const health = pillarHealths[id];
    return {
      id,
      label: PILLAR_LABEL[id],
      health,
      delta: pillarDeltas?.[id],
      blurb: blurbFor(id, health),
      drivers,
    };
  });
}
