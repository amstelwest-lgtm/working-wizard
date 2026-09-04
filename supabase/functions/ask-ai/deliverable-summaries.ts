/**
 * Pure helpers that turn filled owner-board outputs into Ask AI context.
 * No raw statement line items or currency amounts — percentages, weeks, and text.
 * Keep Deno-free so scripts can import this file directly.
 */

import type {
  ActionPlanSummary,
  ActionTaskSummary,
  CashForecastSummary,
  DeliverableFill,
  NextStepSummary,
  ProductLineSummary,
  ProfileQuestionRow,
  RatioRow,
  WaterfallSummary,
} from "./types.ts";

const HORIZON = 13;
const RUNWAY_FLOOR = 50_000;

const INDUSTRY_LABEL: Record<string, string> = {
  hospitality_rooms: "Hotels & accommodation",
  hospitality_covers: "Restaurants & hospitality",
  healthcare_visits: "Healthcare practices",
  logistics_trips: "Transport & logistics",
  property_rent: "Property rental",
  fuel_forecourt: "Fuel retail",
  agri_seasonal: "Agriculture",
  trade_shipment: "Import & export trade",
  field_jobs: "Trades & field service",
  facilities_sites: "Cleaning & facilities",
  security_posts: "Security services",
  membership_club: "Gyms & memberships",
  appointments_ticket: "Salons & personal services",
  education_seats: "Education & training",
  events_bookings: "Events & venues",
  marketplace_take: "Marketplaces & platforms",
  commission_trail: "Insurance & brokers",
  agency_deals: "Estate & deal agencies",
  media_agency: "Media & marketing agencies",
  telecom_arpu: "Fibre & connectivity",
  professional_wip: "Professional practices",
  nonprofit_funding: "Non-profits & funded programmes",
  construction_contracts: "Construction & contracting",
  saas_arpu: "SaaS & software",
  retail_units: "Retail",
  wholesale_units: "Wholesale & distribution",
  manufacturing_units: "Manufacturing",
  services_hours: "Professional services",
  services_projects: "Project-based services",
  retainer_contracts: "Retainer services",
  day_labour: "Labour & staffing",
};

const CONCENTRATION_LABEL: Record<string, string> = {
  diverse: "Spread wide — no customer is critical",
  moderate: "Top few are meaningful (~25% of sales)",
  concentrated: "Top 3 are about half of sales",
  single_dominant: "One customer / payer dominates",
};

const DEBT_LABEL: Record<string, string> = {
  none: "No debt — self-funded",
  light: "Small facilities only",
  moderate: "Real repayments each month",
  heavy: "Debt is a strain",
  seeking: "Looking to raise funding this year",
};

const GOAL_LABEL: Record<string, string> = {
  survive_cash: "Get through a cash squeeze",
  lift_margins: "Make more from the same revenue",
  grow_revenue: "Grow sales / win more work",
  free_working_capital: "Free up cash stuck in the business",
  reduce_founder_dependence: "Get the business to run without me",
  build_to_exit: "Build value for a sale or handover",
};

const STOCK_LABEL: Record<string, string> = {
  none: "Little or no stock",
  light: "Some short-life stock",
  heavy: "Material inventory or WIP",
};

const COST_LABEL: Record<string, string> = {
  variable: "Mostly variable with sales",
  fixed: "Mostly fixed",
  payroll_heavy: "Payroll-heavy",
  balanced: "Balanced mix",
};

const SEASON_LABEL: Record<string, string> = {
  flat: "Fairly even through the year",
  mild: "Mild peaks",
  strong: "Strong peaks and troughs",
};

const PAY_MOTION_LABEL: Record<string, string> = {
  goods: "Sells physical goods",
  time_delivery: "Sells time, jobs, or delivered work",
  access_capacity: "Sells access to space / seats / capacity",
  recurring_rights: "Recurring fee for ongoing access",
  take_rate: "Earns a cut / commission on flow",
  mix: "Material mix of models",
  funding: "Grant / donation / programme funded",
};

const RATIO_FRIENDLY: Record<string, string> = {
  netMargin: "Bottom-Line Strength",
  operatingMargin: "Profit Power",
  grossMargin: "Gross Profit Margin",
  roe: "Shareholder Return",
  roa: "Asset Productivity",
  assetTurnover: "Asset Engine",
  equityMultiplier: "Leverage Level",
  interestBurden: "Debt Drag",
  taxBurden: "Tax Survival Rate",
  debtorDays: "Customer Pay Speed",
  inventoryDays: "Stock Sitting Time",
  creditorDays: "Supplier Pay Window",
  workingCapitalDays: "Cash Trapped Days",
  fixedCostRatio: "Fixed-Cost Burden",
  dol: "Downturn Risk",
  customerConcentration: "Customer Dependency",
  ocfToEbitda: "Cash Quality",
};

const RATIO_FIRST_STEP: Record<string, string> = {
  netMargin: "Increase prices where customers are loyal",
  operatingMargin: "Raise prices on your best-selling products",
  grossMargin: "Raise prices by 3–5% on your top-selling product lines",
  roe: "Raise margins (price, mix, cost control)",
  roa: "Sell underperforming assets",
  assetTurnover: "Sell or lease idle equipment and unused property",
  equityMultiplier: "Reinvest profits to grow equity organically",
  interestBurden: "Refinance high-interest loans at lower rates",
  taxBurden: "Claim every legal deduction and credit you qualify for",
  debtorDays: "Invoice the same day work is done",
  inventoryDays: "Move to just-in-time ordering",
  creditorDays: "Negotiate Net-60 or Net-90 terms with key suppliers",
  workingCapitalDays: "Get customers to pay faster (deposits, autopay)",
  fixedCostRatio: "Move fixed contracts to variable / usage-based pricing",
  dol: "Convert fixed costs into variable where possible",
  customerConcentration: "Run a deliberate small-customer acquisition campaign",
  ocfToEbitda: "Tighten receivables collection to release trapped cash",
};

const RATIO_IMPACT: Record<string, number> = {
  operatingMargin: 10,
  netMargin: 10,
  grossMargin: 10,
  roe: 9,
  workingCapitalDays: 9,
  dol: 9,
  customerConcentration: 9,
  ocfToEbitda: 9,
  debtorDays: 8,
  interestBurden: 8,
  fixedCostRatio: 8,
  inventoryDays: 7,
  equityMultiplier: 7,
  roa: 7,
  assetTurnover: 6,
  taxBurden: 6,
  creditorDays: 6,
};

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
}

function finiteOrNull(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

function pctOf(part: number, whole: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(whole) || whole === 0) return null;
  return (part / whole) * 100;
}

function labelOrRaw(map: Record<string, string>, raw: unknown): string {
  const key = String(raw ?? "").trim();
  if (!key) return "";
  return map[key] ?? key.replace(/_/g, " ");
}

function monthName(month: unknown): string {
  const n = Number(month);
  if (!Number.isFinite(n) || n < 1 || n > 12) return "";
  return new Date(2000, n - 1, 1).toLocaleString("en-ZA", { month: "long" });
}

export function profileQuestionsFromOperating(
  op: Record<string, unknown> | null | undefined,
): ProfileQuestionRow[] {
  if (!op || op.version !== 1) return [];
  const payTiming =
    Number(op.debtorDaysDefault) === 0
      ? "Cash / card on sale"
      : Number(op.debtorDaysDefault) <= 30
        ? `Around ${Number(op.debtorDaysDefault)} days`
        : Number(op.debtorDaysDefault) <= 45
          ? "Milestone / ~45 days"
          : `${Number(op.debtorDaysDefault)}+ days`;
  const secondary = Array.isArray(op.secondaryVolumeUnits)
    ? op.secondaryVolumeUnits.map((u) => String(u).replace(/_/g, " ")).join(", ")
    : "";
  const rows: Array<{ label: string; value: string }> = [
    { label: "Model", value: labelOrRaw(INDUSTRY_LABEL, op.templateId) },
    { label: "How they earn", value: labelOrRaw(PAY_MOTION_LABEL, op.payMotion) },
    { label: "Sales unit", value: String(op.volumeUnit ?? "").replace(/_/g, " ") },
    { label: "Second stream", value: secondary || "None" },
    { label: "Customer pay", value: payTiming },
    { label: "Cost base", value: labelOrRaw(COST_LABEL, op.costShape) },
    { label: "Seasonality", value: labelOrRaw(SEASON_LABEL, op.seasonality) },
    { label: "Stock", value: labelOrRaw(STOCK_LABEL, op.inventoryIntensity) },
    { label: "Concentration", value: labelOrRaw(CONCENTRATION_LABEL, op.customerConcentration) },
    { label: "Debt / funding", value: labelOrRaw(DEBT_LABEL, op.debtPosition) },
    { label: "Owner goal", value: labelOrRaw(GOAL_LABEL, op.ownerGoal) },
    { label: "FY starts", value: monthName(op.fyStartMonth) },
  ];
  return rows.filter((r) => r.value);
}

export type WaterfallFigures = {
  revenue: number;
  costOfSales: number;
  fixedCosts: number;
  interest: number;
  tax: number;
  source: "weekly" | "period";
};

export function extractWaterfallFigures(financials: Record<string, unknown> | null): WaterfallFigures {
  const weeklyRaw = financials?.weeklyInputs;
  const weeks =
    weeklyRaw && typeof weeklyRaw === "object" && !Array.isArray(weeklyRaw)
      ? (weeklyRaw as { weeks?: Record<string, Record<string, unknown>> }).weeks ?? {}
      : {};
  let wRev = 0;
  let wCogs = 0;
  let wFixed = 0;
  let wInt = 0;
  let wTax = 0;
  for (const row of Object.values(weeks)) {
    if (!row || typeof row !== "object") continue;
    wRev += num(row.revenue);
    wCogs += num(row.costOfSales);
    wFixed += num(row.fixedCosts);
    wInt += num(row.interest);
    wTax += num(row.tax);
  }
  const hasWeekly = wRev > 0 || wCogs > 0;
  if (hasWeekly) {
    return {
      revenue: wRev,
      costOfSales: wCogs,
      fixedCosts: wFixed,
      interest: wInt,
      tax: wTax,
      source: "weekly",
    };
  }

  const revenue = num(financials?.revenue);
  const cogs = num(financials?.cogs);
  const gross = revenue - cogs;
  const hasFixed = financials?.fixedCosts != null && String(financials.fixedCosts) !== "";
  const hasEbit = financials?.ebit != null && String(financials.ebit) !== "";
  const hasEbt = financials?.ebt != null && String(financials.ebt) !== "";
  const hasNi = financials?.netIncome != null && String(financials.netIncome) !== "";
  const fixedCosts = hasFixed
    ? num(financials?.fixedCosts)
    : hasEbit
      ? gross - num(financials?.ebit)
      : 0;
  const interest = hasEbit && hasEbt ? num(financials?.ebit) - num(financials?.ebt) : 0;
  const tax = hasEbt && hasNi ? num(financials?.ebt) - num(financials?.netIncome) : 0;
  return { revenue, costOfSales: cogs, fixedCosts, interest, tax, source: "period" };
}

export function summarizeWaterfall(figures: WaterfallFigures): WaterfallSummary | null {
  const { revenue, costOfSales, fixedCosts, interest, tax, source } = figures;
  if (!(revenue > 0 || costOfSales > 0)) return null;
  const gp = revenue - costOfSales;
  const ebit = gp - fixedCosts;
  const ebt = ebit - interest;
  const ni = ebt - tax;
  const step = (label: string, amount: number): { label: string; pctOfRevenue: number | null } => ({
    label,
    pctOfRevenue: pctOf(amount, revenue),
  });
  return {
    source,
    hasData: true,
    steps: [
      step("Revenue", revenue),
      step("Cost of sales", costOfSales),
      step("Gross profit", gp),
      step("Fixed / operating costs", fixedCosts),
      step("EBIT", ebit),
      step("Interest", interest),
      step("EBT", ebt),
      step("Tax", tax),
      step("Net income", ni),
    ],
  };
}

type CashLine = {
  amount?: string;
  frequency?: string;
  startWeek?: number;
  splitCount?: number;
};

export type SavedCashflow = {
  openingBalance?: string;
  revenue?: CashLine[];
  expenses?: CashLine[];
  other?: CashLine[];
  revAdj?: number;
  expAdj?: number;
  collectDelay?: number;
  headcountDelta?: number;
  avgSalary?: string;
  fixedCostDelta?: string;
  revGrowthPct?: number;
  capexAmount?: string;
  capexWeek?: number;
};

function distributeLine(l: CashLine, weeks: number): number[] {
  const out = new Array(weeks).fill(0);
  const amt = parseFloat(l.amount ?? "0") || 0;
  if (amt === 0) return out;
  const start = Math.max(1, Math.min(weeks, l.startWeek ?? 1)) - 1;
  const freq = l.frequency ?? "recurring-monthly";
  switch (freq) {
    case "recurring-weekly":
    case "weekly":
      for (let i = start; i < weeks; i++) out[i] = amt;
      break;
    case "once-off":
    case "once":
      out[start] = amt;
      break;
    case "split-weeks":
    case "split": {
      const n = Math.max(1, l.splitCount ?? 3);
      const per = amt / n;
      for (let i = start; i < Math.min(weeks, start + n); i++) out[i] = per;
      break;
    }
    case "split-months": {
      const n = Math.max(1, l.splitCount ?? 3);
      const per = amt / n;
      for (let i = 0; i < n; i++) {
        const w = start + i * 4;
        if (w < weeks) out[w] = per;
      }
      break;
    }
    default:
      for (let i = start; i < weeks; i += 4) out[i] = amt;
  }
  return out;
}

export function closingBalancesFromCashflow(cf: SavedCashflow | null | undefined): number[] | null {
  if (!cf) return null;
  const revenue = cf.revenue ?? [];
  const expenses = cf.expenses ?? [];
  const other = cf.other ?? [];
  const hasAmount = [...revenue, ...expenses, ...other].some(
    (l) => (parseFloat(l.amount ?? "0") || 0) !== 0,
  );
  if (!hasAmount) return null;

  const revAdj = (cf.revAdj ?? 100) / 100;
  const expAdj = (cf.expAdj ?? 100) / 100;
  const collectDelay = Math.max(0, Math.min(HORIZON - 1, Math.round(cf.collectDelay ?? 0)));
  const headDelta = cf.headcountDelta ?? 0;
  const avgSal = parseFloat(cf.avgSalary ?? "0") || 0;
  const fixedDelta = parseFloat(cf.fixedCostDelta ?? "0") || 0;
  const revGrowth = cf.revGrowthPct ?? 0;
  const capexAmt = parseFloat(cf.capexAmount ?? "0") || 0;
  const capexWk = cf.capexWeek ?? 1;

  const shiftVals = (vals: number[]) => {
    if (!collectDelay) return vals;
    const out = new Array(HORIZON).fill(0);
    for (let i = 0; i < HORIZON; i++) {
      const j = i + collectDelay;
      if (j < HORIZON) out[j] += vals[i];
    }
    return out;
  };
  const growthMul = (i: number) => Math.pow(1 + revGrowth / 100, i);

  const inflow = new Array(HORIZON).fill(0) as number[];
  const outflow = new Array(HORIZON).fill(0) as number[];
  revenue.forEach((l) => {
    shiftVals(distributeLine(l, HORIZON).map((v) => v * revAdj)).forEach(
      (v, i) => (inflow[i] += v * growthMul(i)),
    );
  });
  [...expenses, ...other].forEach((l) => {
    distributeLine(l, HORIZON)
      .map((v) => v * expAdj)
      .forEach((v, i) => (outflow[i] += v));
  });
  if (headDelta !== 0) {
    const weekly = (headDelta * avgSal) / 4.33;
    for (let i = 0; i < HORIZON; i++) outflow[i] += weekly;
  }
  if (fixedDelta !== 0) {
    const weekly = fixedDelta / 4.33;
    for (let i = 0; i < HORIZON; i++) outflow[i] += weekly;
  }
  if (capexAmt !== 0) {
    const w = Math.max(1, Math.min(HORIZON, capexWk)) - 1;
    outflow[w] += capexAmt;
  }

  const opening = parseFloat(cf.openingBalance ?? "0") || 0;
  const closings: number[] = [];
  let bal = opening;
  for (let i = 0; i < HORIZON; i++) {
    bal += inflow[i] - outflow[i];
    closings.push(bal);
  }
  return closings;
}

export function summarizeCashForecast(
  cf: SavedCashflow | null | undefined,
  storedRunway: number | null | undefined,
): CashForecastSummary | null {
  const closings = closingBalancesFromCashflow(cf);
  if (!closings) return null;
  const opening = parseFloat(cf?.openingBalance ?? "0") || 0;
  const lowest = Math.min(...closings);
  const lowestWeek = closings.indexOf(lowest) + 1;
  const negativeWeeks = closings.filter((c) => c < 0).length;
  const closing = closings[closings.length - 1] ?? opening;
  const breach = closings.findIndex((c) => c < RUNWAY_FLOOR);
  const derivedRunway = breach === -1 ? HORIZON : breach;
  const runway =
    storedRunway != null && Number.isFinite(Number(storedRunway))
      ? Number(storedRunway)
      : derivedRunway;
  const delta = closing - opening;
  const traj = Math.abs(delta) < 1 ? "flat" : delta > 0 ? "up" : "down";
  return {
    hasData: true,
    runwayWeeks: runway,
    horizonWeeks: HORIZON,
    shortfall: lowest < 0,
    lowestWeek,
    negativeWeeks,
    trajectory: traj,
    closingVsOpening: traj === "up" ? "higher" : traj === "down" ? "lower" : "flat",
  };
}

export function summarizeProductLines(raw: unknown): ProductLineSummary[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const mix = raw as {
    active?: unknown;
    lines?: unknown;
    bestLineId?: unknown;
    worstLineId?: unknown;
  };
  if (mix.active !== true || !Array.isArray(mix.lines)) return [];
  const lines = mix.lines
    .map((item, index) => {
      if (!item || typeof item !== "object") return null;
      const l = item as Record<string, unknown>;
      const name = typeof l.name === "string" ? l.name.trim() : "";
      if (!name) return null;
      const id = typeof l.id === "string" && l.id ? l.id : `pl-${index}`;
      return {
        id,
        name,
        marginPct: finiteOrNull(l.marginPct),
        revenueSharePct: finiteOrNull(l.revenueSharePct),
        gpSharePct: finiteOrNull(l.gpSharePct),
      };
    })
    .filter((l): l is NonNullable<typeof l> => l != null)
    .slice(0, 5);
  if (lines.length === 0) return [];
  const bestId = typeof mix.bestLineId === "string" ? mix.bestLineId : "";
  const worstId = typeof mix.worstLineId === "string" ? mix.worstLineId : "";
  return lines.map((l) => ({
    name: l.name,
    marginPct: l.marginPct,
    revenueSharePct: l.revenueSharePct,
    gpSharePct: l.gpSharePct,
    isBest: l.id === bestId,
    isWorst: l.id === worstId,
  }));
}

function urgencyFromBenchmark(r: RatioRow): number {
  if (r.value == null || !Number.isFinite(r.value)) return 50;
  if (r.p50 == null || !Number.isFinite(r.p50)) return 55;
  const higher = r.higher_is_better !== false;
  const val = r.format === "pct" ? r.value * 100 : r.value;
  const bench = r.p50;
  if (higher) {
    if (val >= bench) return 28;
    const gap = bench === 0 ? 1 : (bench - val) / Math.abs(bench);
    return Math.min(95, 55 + gap * 40);
  }
  if (val <= bench) return 28;
  const gap = bench === 0 ? 1 : (val - bench) / Math.abs(bench);
  return Math.min(95, 55 + gap * 40);
}

export function rankNextSteps(ratios: RatioRow[], limit = 5): NextStepSummary[] {
  const ranked = ratios
    .filter((r) => r.value != null && Number.isFinite(r.value) && RATIO_FIRST_STEP[r.key])
    .map((r) => {
      const impact = RATIO_IMPACT[r.key] ?? 5;
      const score = urgencyFromBenchmark(r) * impact;
      return {
        key: r.key,
        title: RATIO_FIRST_STEP[r.key],
        ratioName: RATIO_FRIENDLY[r.key] ?? r.key,
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
  return ranked.map((r, i) => ({
    rank: i + 1,
    title: r.title,
    ratioName: r.ratioName,
  }));
}

export function summarizeActionPlan(
  plan: { outcome_goal?: string | null } | null,
  items: Array<{
    title?: string | null;
    status?: string | null;
    due_date?: string | null;
    progress_pct?: number | null;
  }>,
): ActionPlanSummary | null {
  if (!plan && items.length === 0) return null;
  const open: ActionTaskSummary[] = [];
  let doneCount = 0;
  for (const it of items) {
    const title = (it.title ?? "").trim();
    if (!title) continue;
    const status = it.status ?? "not_started";
    if (status === "done") {
      doneCount += 1;
      continue;
    }
    open.push({
      title,
      status,
      dueDate: it.due_date ?? null,
      progressPct: Number.isFinite(Number(it.progress_pct)) ? Number(it.progress_pct) : 0,
    });
  }
  return {
    outcomeGoal: plan?.outcome_goal?.trim() || null,
    open,
    doneCount,
  };
}

export function buildDeliverableFills(input: {
  hasRatios: boolean;
  hasScore: boolean;
  hasWaterfall: boolean;
  hasCash: boolean;
  hasProductLines: boolean;
  hasNextSteps: boolean;
  hasActionPlan: boolean;
  signedScopes: Set<string>;
}): DeliverableFill[] {
  const row = (
    scope: string,
    label: string,
    filled: boolean,
    signScope?: string,
  ): DeliverableFill => ({
    scope,
    label,
    filled,
    signedOff: input.signedScopes.has(signScope ?? scope),
  });
  return [
    row("health", "Business Health", input.hasRatios || input.hasScore, "financials"),
    row("profit", "Profit waterfall", input.hasWaterfall, "profitability"),
    row("cash", "Cash forecast", input.hasCash, "cash_forecast"),
    row("product_mix", "Product lines", input.hasProductLines, "profitability"),
    row("next", "Next moves", input.hasNextSteps),
    row("action_plan", "Action plan", input.hasActionPlan, "action_plan"),
  ];
}

export function fmtPct(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return "n/a";
  return `${n.toFixed(digits)}%`;
}
