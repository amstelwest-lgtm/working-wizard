import { annualiseFinancials, operatingCycleDays, type RatioInputs } from "@/lib/ratios";
import { costMagnitude } from "@/lib/period-profit";
import { RATIO_NAME_TO_KEY, pillarForRatioName, type HealthPillarId } from "@/lib/health-score";
import { PERIOD_MONEY_RATIOS, RATIO_EXPLAIN } from "./ratio-explain.ts";

export type RatioExplain = {
  name: string;
  key: string;
  pillar: HealthPillarId;
  formula: string;
  hint: string;
  needed: string[];
  steps: string[];
};

export type RatioActualLine = {
  formula: string;
  hint: string;
  calculation: string | null;
  missing: string[];
  steps: string[];
};

const FIELD_LABEL: Record<string, string> = {
  revenue: "Revenue",
  cogs: "COGS",
  ebit: "EBIT",
  ebt: "EBT",
  netIncome: "Net income",
  ebitda: "EBITDA",
  operatingCashflow: "Operating cash flow",
  totalAssets: "Total assets",
  equity: "Equity",
  receivables: "Receivables",
  inventory: "Inventory",
  payables: "Payables",
  fixedCosts: "Fixed costs",
  variableCosts: "Variable costs",
  top5Revenue: "Top-5 customer revenue",
  laborCost: "Labor cost",
  employees: "Employees",
  founderHours: "Founder hours",
  priorRevenue: "Prior revenue",
  currentAssets: "Current assets",
  currentLiabilities: "Current liabilities",
  totalLiabilities: "Total liabilities",
  capex: "Capex",
};

/** Owner-board camelCase keys + techName variants → RATIO_EXPLAIN names. */
const RATIO_ACTUAL_ALIASES: Record<string, string> = {
  ...Object.fromEntries(
    Object.entries(RATIO_NAME_TO_KEY)
      .filter(([name]) => Boolean(RATIO_EXPLAIN[name]))
      .map(([name, key]) => [key, name]),
  ),
  "Fixed Costs / Revenue": "Fixed Cost Ratio",
  "Gross Profit / Labor Cost": "Gross Profit / Labor",
  "Sales-per-Employee Ratio (SER)": "Sales-per-Employee Ratio",
  "Operating Cash Flow / EBITDA": "OCF / EBITDA",
  revenuePerFounderHour: "Revenue / Founder Hours",
  "Revenue / Founder Hours": "Revenue / Founder Hours",
  directCostsRatio: "COGS Ratio",
  fundingStructure: "Equity Ratio",
  workingCapitalUtilization: "Working Capital Turnover",
  fixedCapitalUtilization: "Fixed Asset Turnover",
  workingCapitalFunding: "WC-to-Revenue",
  revenueGrowth: "Revenue Growth Rate",
  capexIntensity: "Capex Intensity",
  assetReinvestmentRatio: "Asset Reinvestment Ratio",
  currentRatio: "Current Ratio",
  debtToEquity: "Debt-to-Equity",
  debtToAssets: "Debt-to-Assets",
};

function canonicalRatioName(name: string): string {
  if (RATIO_EXPLAIN[name]) return name;
  const aliased = RATIO_ACTUAL_ALIASES[name];
  if (aliased && RATIO_EXPLAIN[aliased]) return aliased;
  return name;
}

function parseField(raw: string | undefined): number {
  if (raw == null || raw === "") return NaN;
  const n = parseFloat(String(raw));
  return Number.isFinite(n) ? n : NaN;
}

function money(n: number, fmt: (n: number) => string): string {
  return fmt(n);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function days(n: number): string {
  return `${Math.round(n)} days`;
}

function times(n: number): string {
  return `${n.toFixed(2)}×`;
}

function missingLabels(keys: string[], values: Record<string, number>): string[] {
  return keys.filter((k) => !Number.isFinite(values[k])).map((k) => FIELD_LABEL[k] ?? k);
}

function explainFor(name: string): RatioExplain {
  const pack = RATIO_EXPLAIN[name];
  return {
    name,
    key: RATIO_NAME_TO_KEY[name] ?? name,
    pillar: pillarForRatioName(name),
    formula: pack?.formula ?? name,
    hint: pack?.hint ?? "Derived from the period figures on file.",
    needed: pack?.needed ?? [],
    steps: pack?.steps?.length
      ? pack.steps
      : [
          "Open the figures and confirm the inputs that feed this ratio.",
          "Compare the result with the last signed-off snapshot.",
          "Name the one input that would change the story most.",
          "Agree an owner action with a date.",
          "Re-score after the next upload.",
        ],
  };
}

/**
 * Formula + mini actual calculation for one `computeRatios()` name,
 * owner-board camelCase key, or techName variant.
 * Day-count lines use the same annualisation as the live ratio.
 * Scale-free ratios print the period amounts.
 */
export function ratioActualLine(
  name: string,
  inputs: RatioInputs & { totalLiabilities?: string },
  formatMoney: (n: number) => string,
): RatioActualLine {
  name = canonicalRatioName(name);
  const explained = explainFor(name);
  const parsed = (source: object) =>
    Object.fromEntries(
      Object.entries(source).map(([k, val]) => [k, parseField(String(val ?? ""))]),
    ) as Record<string, number>;
  const annual = parsed(annualiseFinancials(inputs));
  const n = PERIOD_MONEY_RATIOS.has(name) ? parsed(inputs) : annual;

  const missing = missingLabels(explained.needed, n);
  const fmt = (v: number) => money(v, formatMoney);

  let calculation: string | null = null;
  const r = n.revenue;
  const cogs = n.cogs;
  const ni = n.netIncome;
  const ebit = n.ebit;
  const ebt = n.ebt;
  const assets = n.totalAssets;
  const equity = n.equity;
  const rec = n.receivables;
  const inv = n.inventory;
  const pay = n.payables;

  if (name === "Net Margin" && missing.length === 0) {
    calculation = `${fmt(ni)} / ${fmt(r)} = ${pct(ni / r)}`;
  } else if (name === "Operating Margin" && missing.length === 0) {
    calculation = `${fmt(ebit)} / ${fmt(r)} = ${pct(ebit / r)}`;
  } else if (name === "Gross Margin" && missing.length === 0) {
    const cost = r > 0 ? costMagnitude(cogs) : cogs;
    calculation = `(${fmt(r)} − ${fmt(cost)}) / ${fmt(r)} = ${pct(r ? (r - cost) / r : 0)}`;
  } else if (name === "Return on Equity" && missing.length === 0) {
    calculation =
      equity > 0 ? `${fmt(ni)} / ${fmt(equity)} = ${pct(ni / equity)}` : "n/m — equity is not positive";
  } else if (name === "Return on Assets" && missing.length === 0) {
    const nm = ni / r;
    const at = r / assets;
    calculation = `${pct(nm)} × ${times(at)} = ${pct(nm * at)}`;
  } else if (name === "Asset Turnover" && missing.length === 0) {
    calculation = `${fmt(r)} / ${fmt(assets)} = ${times(r / assets)}`;
  } else if (name === "Equity Multiplier" && missing.length === 0) {
    calculation = `${fmt(assets)} / ${fmt(equity)} = ${times(assets / equity)}`;
  } else if (name === "Interest Burden" && missing.length === 0) {
    calculation =
      ebit > 0 ? `${fmt(ebt)} / ${fmt(ebit)} = ${pct(ebt / ebit)}` : "n/m — EBIT is not positive";
  } else if (name === "Tax Burden" && missing.length === 0) {
    calculation =
      ebt > 0 ? `${fmt(ni)} / ${fmt(ebt)} = ${pct(ni / ebt)}` : "n/m — EBT is not positive";
  } else if (name === "Debtor Days" && missing.length === 0) {
    calculation = `(${fmt(rec)} / ${fmt(r)}) × 365 = ${days((rec / r) * 365)}`;
  } else if (name === "Inventory Days" && missing.length === 0) {
    const cycle = operatingCycleDays({
      revenue: r,
      cogs,
      receivables: rec,
      inventory: inv,
      payables: pay,
    });
    const cost = r > 0 ? costMagnitude(cogs) : cogs;
    calculation = Number.isFinite(cycle.inventoryDays)
      ? `(${fmt(inv)} / ${fmt(cost)}) × 365 = ${days(cycle.inventoryDays)}`
      : "not meaningful";
  } else if (name === "Creditor Days" && missing.length === 0) {
    const cycle = operatingCycleDays({
      revenue: r,
      cogs,
      receivables: rec,
      inventory: inv,
      payables: pay,
    });
    const cost = r > 0 ? costMagnitude(cogs) : cogs;
    calculation = Number.isFinite(cycle.creditorDays)
      ? `(${fmt(pay)} / ${fmt(cost)}) × 365 = ${days(cycle.creditorDays)}`
      : "not meaningful";
  } else if (name === "Working Capital Days" && missing.length === 0) {
    const cycle = operatingCycleDays({
      revenue: r,
      cogs,
      receivables: rec,
      inventory: inv,
      payables: pay,
    });
    calculation =
      Number.isFinite(cycle.workingCapitalDays) &&
      Number.isFinite(cycle.inventoryDays) &&
      Number.isFinite(cycle.creditorDays)
        ? `${days(cycle.debtorDays)} + ${days(cycle.inventoryDays)} - ${days(cycle.creditorDays)} = ${days(cycle.workingCapitalDays)}`
        : "not meaningful";
  } else if (name === "Fixed Cost Ratio" && missing.length === 0) {
    const periodFixed = parseField(String(inputs.fixedCosts ?? ""));
    const periodRevenue = parseField(String(inputs.revenue ?? ""));
    const fixed = Number.isFinite(periodFixed) ? periodFixed : n.fixedCosts;
    const revenue = Number.isFinite(periodRevenue) ? periodRevenue : r;
    calculation = `${fmt(fixed)} / ${fmt(revenue)} = ${pct(revenue ? fixed / revenue : 0)}`;
  } else if (name === "Degree of Operating Leverage" && missing.length === 0) {
    const cm = r - n.variableCosts;
    calculation = `(${fmt(r)} − ${fmt(n.variableCosts)}) / ${fmt(ebit)} = ${times(cm / ebit)}`;
  } else if (name === "Top-5 Customer Share" && missing.length === 0) {
    calculation = `${fmt(n.top5Revenue)} / ${fmt(r)} = ${pct(n.top5Revenue / r)}`;
  } else if (name === "Gross Profit / Labor" && missing.length === 0) {
    const cost = r > 0 ? costMagnitude(cogs) : cogs;
    calculation = `(${fmt(r)} − ${fmt(cost)}) / ${fmt(n.laborCost)} = ${times(n.laborCost ? (r - cost) / n.laborCost : 0)}`;
  } else if (name === "Sales-per-Employee Ratio" && missing.length === 0) {
    calculation = `${fmt(r)} / ${n.employees} people = ${fmt(r / n.employees)} / head`;
  } else if (name === "OCF / EBITDA" && missing.length === 0) {
    calculation = `${fmt(n.operatingCashflow)} / ${fmt(n.ebitda)} = ${times(n.operatingCashflow / n.ebitda)}`;
  } else if (name === "Revenue / Founder Hours" && missing.length === 0) {
    calculation = `${fmt(r)} / ${n.founderHours} h = ${fmt(r / n.founderHours)} / hour`;
  } else if (name === "COGS Ratio" && missing.length === 0) {
    calculation = `${fmt(cogs)} / ${fmt(r)} = ${pct(cogs / r)}`;
  } else if (name === "Equity Ratio" && missing.length === 0) {
    calculation = `${fmt(equity)} / ${fmt(assets)} = ${pct(equity / assets)}`;
  } else if (name === "Working Capital Turnover" && missing.length === 0) {
    const wc = rec + inv - pay;
    calculation = `${fmt(r)} / ${fmt(wc)} = ${times(r / Math.max(wc, 1))}`;
  } else if (name === "Fixed Asset Turnover" && missing.length === 0) {
    const fixed = assets - rec - inv;
    calculation = `${fmt(r)} / ${fmt(fixed)} = ${times(r / Math.max(fixed, 1))}`;
  } else if (name === "WC-to-Revenue" && missing.length === 0) {
    const wc = rec + inv - pay;
    calculation = `(${fmt(rec)} + ${fmt(inv)} − ${fmt(pay)}) / ${fmt(r)} = ${pct(wc / r)}`;
  } else if (name === "Revenue Growth Rate" && missing.length === 0) {
    const prior = n.priorRevenue;
    calculation =
      prior > 0
        ? `(${fmt(r)} − ${fmt(prior)}) / ${fmt(prior)} = ${pct((r - prior) / prior)}`
        : "n/m — prior revenue is missing";
  } else if (name === "Capex Intensity" && missing.length === 0) {
    calculation = `${fmt(n.capex)} / ${fmt(r)} = ${pct(n.capex / r)}`;
  } else if (name === "Asset Reinvestment Ratio" && missing.length === 0) {
    const da = n.ebitda - ebit;
    calculation =
      da > 0
        ? `${fmt(n.capex)} / ${fmt(da)} = ${times(n.capex / da)}`
        : "n/m — depreciation is not positive";
  } else if (name === "Current Ratio" && missing.length === 0) {
    calculation =
      n.currentLiabilities > 0
        ? `${fmt(n.currentAssets)} / ${fmt(n.currentLiabilities)} = ${times(n.currentAssets / n.currentLiabilities)}`
        : "n/m — current liabilities are not positive";
  } else if (name === "Debt-to-Equity" && missing.length === 0) {
    const liabilities = n.totalLiabilities;
    calculation =
      equity !== 0
        ? `${fmt(liabilities)} / ${fmt(equity)} = ${times(liabilities / equity)}`
        : "n/m — equity is not positive";
  } else if (name === "Debt-to-Assets" && missing.length === 0) {
    const debt = Math.max(0, assets - equity);
    calculation = `${fmt(debt)} / ${fmt(assets)} = ${pct(debt / assets)}`;
  } else if (missing.length) {
    calculation = null;
  }

  return {
    formula: explained.formula,
    hint: explained.hint,
    calculation,
    missing,
    steps: explained.steps,
  };
}

export function explainRatio(name: string): RatioExplain {
  return explainFor(name);
}
