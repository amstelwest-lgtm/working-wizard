/**
 * Profit-bridge steps the waterfall PDF draws.
 * Kept out of the react-pdf module so the advisory pack can freeze the
 * same steps without importing the PDF renderer.
 */
import { derivedProfitStepsAreFacts } from "@/lib/period-profit";

export type BridgeStep = {
  label: string;
  /** Absolute delta (negative = cost step). */
  delta: number;
  /** Running total after this step. */
  runningEnd: number;
  kind: "total" | "decrease" | "subtotal";
};

export type ProfitBridgeInput = {
  revenue: number;
  gross_profit: number;
  operating_profit: number;
  ebt: number;
  tax: number;
  net_profit: number;
  depreciation?: number;
};

/** A missing depreciation figure is not a zero bar. A stored 0 stays 0. */
export function statedDepreciation(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return Math.max(0, value);
}

/** The same steps the waterfall chart draws. */
export function buildBridgeSteps(d: ProfitBridgeInput): BridgeStep[] {
  const cogs = d.revenue - d.gross_profit;
  const statedDep = statedDepreciation(d.depreciation);
  const opexIfSplit = statedDep == null ? null : d.gross_profit - d.operating_profit - statedDep;
  const depreciation =
    statedDep != null && opexIfSplit != null && opexIfSplit >= -1 ? statedDep : 0;
  const opex = d.gross_profit - d.operating_profit - depreciation;
  const afterOpex = d.gross_profit - opex;
  const interest = d.operating_profit - d.ebt;
  const stepsAreFacts = derivedProfitStepsAreFacts({
    operatingProfit: d.operating_profit,
    interest,
    tax: d.tax,
    netIncome: d.net_profit,
  });

  return [
    { label: "Revenue", delta: d.revenue, runningEnd: d.revenue, kind: "total" },
    { label: "COGS", delta: -cogs, runningEnd: d.gross_profit, kind: "decrease" },
    { label: "Gross profit", delta: d.gross_profit, runningEnd: d.gross_profit, kind: "subtotal" },
    {
      label: "Operating\nExpenses",
      delta: -opex,
      runningEnd: depreciation > 0 ? afterOpex : d.operating_profit,
      kind: "decrease",
    },
    ...(depreciation > 0
      ? [
          {
            label: "Depreciation",
            delta: -depreciation,
            runningEnd: d.operating_profit,
            kind: "decrease" as const,
          },
        ]
      : []),
    {
      label: "Operating\nProfit",
      delta: d.operating_profit,
      runningEnd: d.operating_profit,
      kind: "subtotal" as const,
    },
    ...(stepsAreFacts
      ? [
          { label: "Interest", delta: -interest, runningEnd: d.ebt, kind: "decrease" as const },
          { label: "Tax", delta: -d.tax, runningEnd: d.net_profit, kind: "decrease" as const },
        ]
      : []),
    { label: "Net\nProfit", delta: d.net_profit, runningEnd: d.net_profit, kind: "subtotal" },
  ];
}
