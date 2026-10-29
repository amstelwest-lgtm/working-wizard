/**
 * Which DuPont lever is weakest. Lives outside the PDF narrative module so
 * the advisory pack can freeze the same sentence from an edge function,
 * which cannot import the report renderer.
 */
import { formatReportAmount } from "./market/format.ts";
import { ZA_MARKET } from "./market/resolve.ts";
import { leverBand } from "./report-coherence.ts";
import { healthBandLabel, type HealthTier } from "./ratios.ts";

export type DuPontLevers = {
  roe: number;
  netMargin: number;
  assetTurnover: number;
  equityMultiplier: number;
};

export type DuPontDiagnosis = {
  /** Which lever is dragging ROE. */
  weakLever: "margin" | "turnover" | "leverage" | null;
  weakLeverLabel: string;
  sentence: string;
};

const LEVER_RATIO: Record<"margin" | "turnover" | "leverage", { name: string; label: string }> = {
  margin: { name: "Net Margin", label: "Net Profit Margin" },
  turnover: { name: "Asset Turnover", label: "Asset Turnover" },
  leverage: { name: "Equity Multiplier", label: "Equity Multiplier" },
};

const TIER_RANK: Record<HealthTier, number> = { healthy: 0, at_risk: 1, critical: 2 };

function fmtPct(value: number, dp = 1): string {
  return formatReportAmount(value, ZA_MARKET, { style: "percent", dp, missing: "n/m" });
}

/**
 * "All three healthy" is only true when every lever's band is Healthy.
 * The band comes from `leverBand` (`scoreRatio` and the shared cutoff table).
 */
export function diagnoseDuPont(l: DuPontLevers): DuPontDiagnosis {
  const values = {
    margin: l.netMargin,
    turnover: l.assetTurnover,
    leverage: l.equityMultiplier,
  };
  const ranked = (Object.keys(LEVER_RATIO) as Array<keyof typeof LEVER_RATIO>)
    .map((lever) => {
      const spec = LEVER_RATIO[lever];
      const value = values[lever];
      const tier = leverBand(spec.name, value);
      return { lever, label: spec.label, value, tier };
    })
    .filter((row) => row.tier != null);
  if (!ranked.length) {
    return {
      weakLever: null,
      weakLeverLabel: "",
      sentence: "The ROE levers cannot be scored from the figures on file.",
    };
  }
  if (ranked.length === 3 && ranked.every((row) => row.tier === "healthy")) {
    return {
      weakLever: null,
      weakLeverLabel: "",
      sentence:
        "All three ROE levers — margin, asset efficiency, and leverage — are in the Healthy band.",
    };
  }
  ranked.sort((a, b) => TIER_RANK[b.tier!] - TIER_RANK[a.tier!]);
  const worst = ranked[0];
  const band = healthBandLabel(worst.tier!);
  const detail =
    worst.lever === "margin"
      ? `net margin ${fmtPct(worst.value)}`
      : worst.lever === "turnover"
        ? `turnover ${worst.value.toFixed(2)}×`
        : `equity multiplier ${worst.value.toFixed(2)}×`;
  return {
    weakLever: worst.lever,
    weakLeverLabel: worst.label,
    sentence: `Of the three ROE levers, ${worst.label.toLowerCase()} is ${band} (${detail}).`,
  };
}
