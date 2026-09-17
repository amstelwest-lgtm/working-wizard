/**
 * Per-deliverable analysis inputs: sources, outstanding questions, and
 * assumptions. Cash forecast is the complete map; other tabs reuse the same
 * shape with honest defaults for fields the engine does not yet read.
 */

import {
  parseOperatingProfile,
  profileNeedsCompletion,
  type ClientOperatingProfile,
} from "@/lib/client-profile";
import { periodMonthsOf } from "@/lib/ratios";
import type { BudgetSeasonality } from "@/lib/budget.types";
import { CASH_RUNWAY_THRESHOLD_RAND } from "@/lib/cash-runway";

export const DELIVERABLE_INPUT_IDS = [
  "cash",
  "ratios",
  "profit",
  "budget",
  "plan",
  "next",
  "reports",
  "advisory",
  "summary",
] as const;

export type DeliverableInputId = (typeof DELIVERABLE_INPUT_IDS)[number];

export type DeliverableSource = {
  id: string;
  label: string;
  hint?: string;
  /** True when this workspace currently has data for the source. */
  available: boolean;
};

export type DeliverableQuestion = {
  id: string;
  prompt: string;
};

export type AssumptionKind = "number" | "boolean" | "select";

export type DeliverableAssumption = {
  id: string;
  label: string;
  kind: AssumptionKind;
  /**
   * True when changing this value is read by the current analysis engine.
   * False values are saved for the deliverable but do not rewrite figures.
   */
  engineBound: boolean;
  /** Shown when the product has no first-class field yet. */
  defaultLabel?: string;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  options?: { value: string; label: string }[];
};

export type DeliverableInputDefinition = {
  id: DeliverableInputId;
  label: string;
  sources: DeliverableSource[];
  questions: DeliverableQuestion[];
  assumptions: DeliverableAssumption[];
};

export type DeliverableInputState = {
  checkedSources: Record<string, boolean>;
  assumptionValues: Record<string, string | number | boolean>;
  /** Fingerprint of the last state treated as "current analysis". */
  appliedFingerprint?: string;
};

export type BankAccountOption = {
  id: string;
  label: string;
};

export function bankAccountsFromDraft(raw: unknown): BankAccountOption[] {
  if (!raw || typeof raw !== "object") return [];
  const extract = (raw as { extract?: { accounts?: Array<{ account_label?: string | null }> } })
    .extract;
  const accounts = extract?.accounts;
  if (!Array.isArray(accounts)) return [];
  const out: BankAccountOption[] = [];
  const seen = new Set<string>();
  accounts.forEach((a, i) => {
    const label = typeof a?.account_label === "string" ? a.account_label.trim() : "";
    if (!label) return;
    const id =
      label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "") || `acct-${i}`;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ id, label });
  });
  return out;
}

export type DeliverableInputContext = {
  financials?: Record<string, string | number | null | undefined> | null;
  operatingProfile?: ClientOperatingProfile | null;
  bankAccounts?: BankAccountOption[];
  hasBankDraft?: boolean;
  hasCashLines?: boolean;
  budgetWc?: { debtorDays: number; creditorDays: number; inventoryDays: number } | null;
  budgetSeasonality?: BudgetSeasonality | null;
  collectDelay?: number;
  revGrowthPct?: number;
  openingBalance?: number | string | null;
  openRatioQueryLabels?: string[];
  productMixIncomplete?: boolean;
  hasPriorPeriod?: boolean;
  hasWeeklyInputs?: boolean;
};

export const SEASONALITY_OPTIONS: { value: BudgetSeasonality; label: string }[] = [
  { value: "flat", label: "Fairly even through the year" },
  { value: "mild", label: "Mild peaks" },
  { value: "strong", label: "Strong peaks and troughs" },
];

export const SPEND_TREND_OPTIONS = [
  { value: "stable", label: "Stable" },
  { value: "increasing", label: "Increasing" },
  { value: "decreasing", label: "Decreasing" },
] as const;

export const DEFAULT_SPEND_TREND_DAYS = 90;
export const DEFAULT_DAYS_AP = 30;
export const DEFAULT_DAYS_AR = 30;

const SOURCE_HINT = {
  pl: "Period P&L used to sense-check receipts, costs and margins",
  balance: "Point-in-time assets, equity, receivables, payables and inventory",
  banks: "Uploaded statements that seed weekly cash movements",
  arAp: "Receivables and payables from the balance sheet. A full aging schedule is not in this workspace yet.",
  ocf: "Operating cash flow used in the cash-conversion ratios",
  profile: "How the business makes money, pays, and aims to improve",
  cashForecast: "13-week cash forecast already on this workspace",
  budget: "FY driver plan, including working-capital days",
  productMix: "Named product or service lines behind the waterfall",
  weekly: "Weekly profit figures entered on the owner board",
  health: "Health score and ratio set",
  notes: "Open queries and engagement notes",
} as const;

function num(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function hasField(financials: DeliverableInputContext["financials"], key: string): boolean {
  return num(financials?.[key]) !== 0 || String(financials?.[key] ?? "").trim() !== "";
}

function hasPl(financials: DeliverableInputContext["financials"]): boolean {
  return (
    hasField(financials, "revenue") ||
    hasField(financials, "cogs") ||
    hasField(financials, "fixedCosts")
  );
}

function hasBalanceSheet(financials: DeliverableInputContext["financials"]): boolean {
  return (
    hasField(financials, "totalAssets") ||
    hasField(financials, "equity") ||
    hasField(financials, "receivables") ||
    hasField(financials, "payables") ||
    hasField(financials, "inventory")
  );
}

function hasArAp(financials: DeliverableInputContext["financials"]): boolean {
  return hasField(financials, "receivables") || hasField(financials, "payables");
}

/** Debtor days from the period P&L + AR, same annualisation as the ratio engine. */
export function computedDaysAr(financials: DeliverableInputContext["financials"]): number | null {
  const rec = num(financials?.receivables);
  const rev = num(financials?.revenue);
  if (rev <= 0) return null;
  const months = periodMonthsOf(financials as Record<string, unknown> | null);
  const annualRev = months > 0 && months < 12 ? rev * (12 / months) : rev;
  if (annualRev <= 0) return null;
  return Math.round((rec / annualRev) * 365);
}

export function computedDaysAp(financials: DeliverableInputContext["financials"]): number | null {
  const pay = num(financials?.payables);
  const cogs = num(financials?.cogs);
  if (cogs <= 0) return null;
  const months = periodMonthsOf(financials as Record<string, unknown> | null);
  const annualCogs = months > 0 && months < 12 ? cogs * (12 / months) : cogs;
  if (annualCogs <= 0) return null;
  return Math.round((pay / annualCogs) * 365);
}

export function defaultDaysAr(ctx: DeliverableInputContext): number {
  if (ctx.operatingProfile?.debtorDaysDefault != null)
    return ctx.operatingProfile.debtorDaysDefault;
  if (ctx.budgetWc?.debtorDays != null) return ctx.budgetWc.debtorDays;
  return computedDaysAr(ctx.financials) ?? DEFAULT_DAYS_AR;
}

export function defaultDaysAp(ctx: DeliverableInputContext): number {
  if (ctx.budgetWc?.creditorDays != null) return ctx.budgetWc.creditorDays;
  return computedDaysAp(ctx.financials) ?? DEFAULT_DAYS_AP;
}

function source(id: string, label: string, available: boolean, hint?: string): DeliverableSource {
  return { id, label, available, hint };
}

function cashSources(ctx: DeliverableInputContext): DeliverableSource[] {
  const banks = ctx.bankAccounts ?? [];
  const out: DeliverableSource[] = [
    source("pl", "Profit & loss", hasPl(ctx.financials), SOURCE_HINT.pl),
    source("balance_sheet", "Balance sheet", hasBalanceSheet(ctx.financials), SOURCE_HINT.balance),
    source(
      "bank_accounts",
      "Bank accounts",
      Boolean(ctx.hasBankDraft || banks.length || ctx.hasCashLines),
      SOURCE_HINT.banks,
    ),
    source("ar_ap", "AR / AP aging", hasArAp(ctx.financials), SOURCE_HINT.arAp),
  ];
  for (const acct of banks) {
    out.push(source(`bank:${acct.id}`, acct.label, true, "Included in the uploaded bank pack"));
  }
  return out;
}

function cashQuestions(ctx: DeliverableInputContext): DeliverableQuestion[] {
  const out: DeliverableQuestion[] = [];
  if (!ctx.hasBankDraft && !ctx.bankAccounts?.length && !ctx.hasCashLines) {
    out.push({
      id: "cash.banks",
      prompt:
        "Upload bank statements covering every operating account so weekly receipts and payments are grounded in actual movements.",
    });
  }
  if (!hasField(ctx.financials, "receivables")) {
    out.push({
      id: "cash.ar",
      prompt: "Add receivables so customer collection timing can be checked against the forecast.",
    });
  }
  if (!hasField(ctx.financials, "payables")) {
    out.push({
      id: "cash.ap",
      prompt: "Add payables so supplier payment timing can be checked against the forecast.",
    });
  }
  const profile = ctx.operatingProfile;
  if (!profile) {
    out.push({
      id: "cash.profile",
      prompt: "Confirm how quickly customers typically pay, so collection lag is not guessed.",
    });
  } else if (profileNeedsCompletion(profile)) {
    const confirmed = new Set(profile.confirmedExtraKeys ?? []);
    if (!confirmed.has("operating_profile.seasonality")) {
      out.push({
        id: "cash.seasonality",
        prompt:
          "How seasonal is demand through the year? A flat weekly run-rate may hide peak-week swings.",
      });
    }
    if (!confirmed.has("operating_profile.debtPosition")) {
      out.push({
        id: "cash.debt",
        prompt:
          "How heavy are debt repayments each month? That protects the minimum cash threshold.",
      });
    }
  }
  return out;
}

function cashAssumptions(): DeliverableAssumption[] {
  return [
    {
      id: "daysAr",
      label: "Days AR (customer payment)",
      kind: "number",
      engineBound: false,
      unit: "days",
      min: 0,
      max: 180,
      step: 1,
      defaultLabel:
        "Saved for this forecast. The 13-week engine currently uses collection delay in weeks, not debtor days.",
    },
    {
      id: "daysAp",
      label: "Days AP (supplier payment)",
      kind: "number",
      engineBound: false,
      unit: "days",
      min: 0,
      max: 180,
      step: 1,
      defaultLabel:
        "Saved for this forecast. Supplier timing is not a first-class 13-week input yet.",
    },
    {
      id: "collectDelay",
      label: "Collection delay",
      kind: "number",
      engineBound: true,
      unit: "weeks",
      min: 0,
      max: 6,
      step: 1,
    },
    {
      id: "revGrowthPct",
      label: "Average weekly growth trend",
      kind: "number",
      engineBound: true,
      unit: "% / week",
      min: -10,
      max: 10,
      step: 0.5,
    },
    {
      id: "spendTrendDays",
      label: "Spending trend lookback",
      kind: "number",
      engineBound: false,
      unit: "days",
      min: 7,
      max: 365,
      step: 1,
      defaultLabel: `Default ${DEFAULT_SPEND_TREND_DAYS} days — the forecast does not yet scale costs from a lookback window.`,
    },
    {
      id: "spendTrend",
      label: "Recent spending trend",
      kind: "select",
      engineBound: false,
      options: [...SPEND_TREND_OPTIONS],
      defaultLabel: "Noted here only — weekly outflows still follow the line items you entered.",
    },
    {
      id: "seasonality",
      label: "Seasonality",
      kind: "select",
      engineBound: false,
      options: [...SEASONALITY_OPTIONS],
      defaultLabel:
        "From the operating profile. The 13-week engine uses a flat run-rate plus any weekly growth you set.",
    },
    {
      id: "applySeasonality",
      label: "Scale weekly receipts for seasonality",
      kind: "boolean",
      engineBound: false,
      defaultLabel: "Default off — there is no seasonality toggle on the forecast engine yet.",
    },
    {
      id: "runwayThreshold",
      label: "Minimum cash threshold",
      kind: "number",
      engineBound: false,
      min: 0,
      step: 1000,
      defaultLabel: `Workspace default (${CASH_RUNWAY_THRESHOLD_RAND.toLocaleString("en-ZA")}) used for runway.`,
    },
  ];
}

function ratiosSources(ctx: DeliverableInputContext): DeliverableSource[] {
  return [
    source("pl", "Profit & loss", hasPl(ctx.financials), SOURCE_HINT.pl),
    source("balance_sheet", "Balance sheet", hasBalanceSheet(ctx.financials), SOURCE_HINT.balance),
    source(
      "ocf",
      "Operating cash flow",
      hasField(ctx.financials, "operatingCashflow"),
      SOURCE_HINT.ocf,
    ),
    source("ar_ap", "AR / AP (receivables & payables)", hasArAp(ctx.financials), SOURCE_HINT.arAp),
    source("profile", "Operating profile", Boolean(ctx.operatingProfile), SOURCE_HINT.profile),
  ];
}

function ratiosQuestions(ctx: DeliverableInputContext): DeliverableQuestion[] {
  const out: DeliverableQuestion[] = [];
  if (!hasPl(ctx.financials)) {
    out.push({
      id: "ratios.financials",
      prompt:
        "Add period financials so the health score is computed from real figures, not blanks.",
    });
  }
  if (!ctx.hasPriorPeriod) {
    out.push({
      id: "ratios.prior",
      prompt:
        "Add a prior period so this score can be compared with last time, not only with itself.",
    });
  }
  for (const label of ctx.openRatioQueryLabels ?? []) {
    out.push({
      id: `ratios.query.${label}`,
      prompt: `Open query on ${label} — resolve it so the scorecard is not carrying an unanswered point.`,
    });
  }
  return out;
}

function profitSources(ctx: DeliverableInputContext): DeliverableSource[] {
  return [
    source("pl", "Profit & loss", hasPl(ctx.financials), SOURCE_HINT.pl),
    source(
      "product_mix",
      "Product lines",
      !(ctx.productMixIncomplete ?? true),
      SOURCE_HINT.productMix,
    ),
    source("weekly", "Weekly profit figures", Boolean(ctx.hasWeeklyInputs), SOURCE_HINT.weekly),
    source("profile", "Operating profile", Boolean(ctx.operatingProfile), SOURCE_HINT.profile),
  ];
}

function profitQuestions(ctx: DeliverableInputContext): DeliverableQuestion[] {
  const out: DeliverableQuestion[] = [];
  if (!hasPl(ctx.financials)) {
    out.push({
      id: "profit.pl",
      prompt: "Add period revenue, COGS and operating expenses so the waterfall is not empty.",
    });
  }
  if (ctx.productMixIncomplete) {
    out.push({
      id: "profit.mix",
      prompt:
        "Name the product or service lines if more than one material stream sits behind revenue.",
    });
  }
  return out;
}

function budgetSources(ctx: DeliverableInputContext): DeliverableSource[] {
  return [
    source("pl", "Profit & loss", hasPl(ctx.financials), SOURCE_HINT.pl),
    source("balance_sheet", "Balance sheet", hasBalanceSheet(ctx.financials), SOURCE_HINT.balance),
    source("profile", "Operating profile", Boolean(ctx.operatingProfile), SOURCE_HINT.profile),
    source(
      "cash_forecast",
      "13-week cash forecast",
      Boolean(ctx.hasCashLines),
      SOURCE_HINT.cashForecast,
    ),
  ];
}

function budgetQuestions(ctx: DeliverableInputContext): DeliverableQuestion[] {
  const out: DeliverableQuestion[] = [];
  if (!ctx.operatingProfile) {
    out.push({
      id: "budget.profile",
      prompt:
        "Set the business profile so volume × price drivers match how this client actually sells.",
    });
  }
  if (!hasPl(ctx.financials)) {
    out.push({
      id: "budget.pl",
      prompt:
        "Add period financials so the year plan can be seeded from actual run-rate, not zeros.",
    });
  }
  return out;
}

function budgetAssumptions(): DeliverableAssumption[] {
  return [
    {
      id: "daysAr",
      label: "Days AR (customer payment)",
      kind: "number",
      engineBound: true,
      unit: "days",
      min: 0,
      max: 180,
      step: 1,
    },
    {
      id: "daysAp",
      label: "Days AP (supplier payment)",
      kind: "number",
      engineBound: true,
      unit: "days",
      min: 0,
      max: 180,
      step: 1,
    },
    {
      id: "inventoryDays",
      label: "Inventory days",
      kind: "number",
      engineBound: true,
      unit: "days",
      min: 0,
      max: 365,
      step: 1,
    },
    {
      id: "seasonality",
      label: "Seasonality",
      kind: "select",
      engineBound: false,
      options: [...SEASONALITY_OPTIONS],
      defaultLabel:
        "From the operating profile. Confirm it on the profile if the year is strongly seasonal.",
    },
  ];
}

function planSources(ctx: DeliverableInputContext): DeliverableSource[] {
  return [
    source("health", "Health score & ratios", hasPl(ctx.financials), SOURCE_HINT.health),
    source(
      "cash_forecast",
      "13-week cash forecast",
      Boolean(ctx.hasCashLines),
      SOURCE_HINT.cashForecast,
    ),
    source("budget", "FY budget", Boolean(ctx.budgetWc), SOURCE_HINT.budget),
    source("profile", "Operating profile", Boolean(ctx.operatingProfile), SOURCE_HINT.profile),
    source("notes", "Open queries", (ctx.openRatioQueryLabels?.length ?? 0) > 0, SOURCE_HINT.notes),
  ];
}

function planQuestions(ctx: DeliverableInputContext): DeliverableQuestion[] {
  const out: DeliverableQuestion[] = [];
  if (!hasPl(ctx.financials) && !ctx.hasCashLines) {
    out.push({
      id: "plan.figures",
      prompt:
        "Add figures or a cash forecast so recommended work is ranked from this client's position.",
    });
  }
  if (!ctx.operatingProfile) {
    out.push({
      id: "plan.goal",
      prompt: "Confirm the owner's goal so the plan is aimed at what they actually want to change.",
    });
  }
  return out;
}

function reportsSources(ctx: DeliverableInputContext): DeliverableSource[] {
  return [
    source("pl", "Profit & loss", hasPl(ctx.financials), SOURCE_HINT.pl),
    source("balance_sheet", "Balance sheet", hasBalanceSheet(ctx.financials), SOURCE_HINT.balance),
    source(
      "cash_forecast",
      "13-week cash forecast",
      Boolean(ctx.hasCashLines),
      SOURCE_HINT.cashForecast,
    ),
    source("budget", "FY budget", Boolean(ctx.budgetWc), SOURCE_HINT.budget),
    source("profile", "Operating profile", Boolean(ctx.operatingProfile), SOURCE_HINT.profile),
  ];
}

function advisorySources(ctx: DeliverableInputContext): DeliverableSource[] {
  return [
    ...reportsSources(ctx),
    source("notes", "Open queries", (ctx.openRatioQueryLabels?.length ?? 0) > 0, SOURCE_HINT.notes),
  ];
}

function summarySources(ctx: DeliverableInputContext): DeliverableSource[] {
  return [
    source("profile", "Operating profile", Boolean(ctx.operatingProfile), SOURCE_HINT.profile),
    source("pl", "Profit & loss", hasPl(ctx.financials), SOURCE_HINT.pl),
    source(
      "cash_forecast",
      "13-week cash forecast",
      Boolean(ctx.hasCashLines),
      SOURCE_HINT.cashForecast,
    ),
    source("budget", "FY budget", Boolean(ctx.budgetWc), SOURCE_HINT.budget),
    source("notes", "Open queries", (ctx.openRatioQueryLabels?.length ?? 0) > 0, SOURCE_HINT.notes),
  ];
}

const LABELS: Record<DeliverableInputId, string> = {
  cash: "13-week cash forecast",
  ratios: "Health score & ratios",
  profit: "Profitability",
  budget: "FY budget",
  plan: "Action plan",
  next: "Recommended next moves",
  reports: "Board reports",
  advisory: "Advisory note",
  summary: "Client summary",
};

export function buildDeliverableInputDefinition(
  id: DeliverableInputId,
  ctx: DeliverableInputContext = {},
): DeliverableInputDefinition {
  switch (id) {
    case "cash":
      return {
        id,
        label: LABELS[id],
        sources: cashSources(ctx),
        questions: cashQuestions(ctx),
        assumptions: cashAssumptions(),
      };
    case "ratios":
      return {
        id,
        label: LABELS[id],
        sources: ratiosSources(ctx),
        questions: ratiosQuestions(ctx),
        assumptions: [
          {
            id: "periodMonths",
            label: "Figures cover",
            kind: "number",
            engineBound: true,
            unit: "months",
            min: 1,
            max: 12,
            step: 1,
          },
          {
            id: "daysAr",
            label: "Days AR (computed)",
            kind: "number",
            engineBound: false,
            unit: "days",
            defaultLabel:
              "Shown from receivables ÷ annualised revenue. Edit the financials to change it.",
          },
          {
            id: "daysAp",
            label: "Days AP (computed)",
            kind: "number",
            engineBound: false,
            unit: "days",
            defaultLabel:
              "Shown from payables ÷ annualised COGS. Edit the financials to change it.",
          },
        ],
      };
    case "profit":
      return {
        id,
        label: LABELS[id],
        sources: profitSources(ctx),
        questions: profitQuestions(ctx),
        assumptions: [
          {
            id: "periodMonths",
            label: "Figures cover",
            kind: "number",
            engineBound: false,
            unit: "months",
            min: 1,
            max: 12,
            step: 1,
            defaultLabel:
              "The waterfall uses the period P&L as entered; it is not re-annualised here.",
          },
        ],
      };
    case "budget":
      return {
        id,
        label: LABELS[id],
        sources: budgetSources(ctx),
        questions: budgetQuestions(ctx),
        assumptions: budgetAssumptions(),
      };
    case "plan":
    case "next":
      return {
        id,
        label: LABELS[id],
        sources: planSources(ctx),
        questions: planQuestions(ctx),
        assumptions: [
          {
            id: "ownerGoal",
            label: "Owner goal (from profile)",
            kind: "select",
            engineBound: false,
            options: [
              { value: "survive_cash", label: "Get through a cash squeeze" },
              { value: "lift_margins", label: "Make more from the same revenue" },
              { value: "grow_revenue", label: "Grow sales / win more work" },
              { value: "free_working_capital", label: "Free up cash stuck in the business" },
              { value: "reduce_founder_dependence", label: "Get the business to run without me" },
              { value: "build_to_exit", label: "Build value for a sale or handover" },
            ],
            defaultLabel:
              "Taken from the operating profile. Retake the profile to change the goal.",
          },
        ],
      };
    case "reports":
      return {
        id,
        label: LABELS[id],
        sources: reportsSources(ctx),
        questions: !hasPl(ctx.financials)
          ? [
              {
                id: "reports.figures",
                prompt:
                  "Add financials or a cash forecast so the pack is built from this client's figures.",
              },
            ]
          : [],
        assumptions: [],
      };
    case "advisory":
      return {
        id,
        label: LABELS[id],
        sources: advisorySources(ctx),
        questions: !ctx.operatingProfile
          ? [
              {
                id: "advisory.profile",
                prompt:
                  "Confirm the operating profile so the note is aimed at this client's goal and cash timing.",
              },
            ]
          : [],
        assumptions: [
          {
            id: "seasonality",
            label: "Seasonality",
            kind: "select",
            engineBound: false,
            options: [...SEASONALITY_OPTIONS],
            defaultLabel:
              "From the operating profile — used as context for the note, not as a model toggle.",
          },
        ],
      };
    case "summary":
      return {
        id,
        label: LABELS[id],
        sources: summarySources(ctx),
        questions: !ctx.operatingProfile
          ? [
              {
                id: "summary.profile",
                prompt:
                  "Finish the operating profile so the summary is not inferring how this business works.",
              },
            ]
          : [],
        assumptions: [],
      };
  }
}

export function defaultAssumptionValues(
  def: DeliverableInputDefinition,
  ctx: DeliverableInputContext = {},
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const a of def.assumptions) {
    switch (a.id) {
      case "daysAr":
        out[a.id] = defaultDaysAr(ctx);
        break;
      case "daysAp":
        out[a.id] = defaultDaysAp(ctx);
        break;
      case "inventoryDays":
        out[a.id] = ctx.budgetWc?.inventoryDays ?? 0;
        break;
      case "collectDelay":
        out[a.id] = ctx.collectDelay ?? 0;
        break;
      case "revGrowthPct":
        out[a.id] = ctx.revGrowthPct ?? 0;
        break;
      case "spendTrendDays":
        out[a.id] = DEFAULT_SPEND_TREND_DAYS;
        break;
      case "spendTrend":
        out[a.id] = "stable";
        break;
      case "seasonality":
        out[a.id] = ctx.budgetSeasonality ?? ctx.operatingProfile?.seasonality ?? "flat";
        break;
      case "applySeasonality":
        out[a.id] = false;
        break;
      case "runwayThreshold":
        out[a.id] = CASH_RUNWAY_THRESHOLD_RAND;
        break;
      case "periodMonths":
        out[a.id] = periodMonthsOf(ctx.financials as Record<string, unknown> | null);
        break;
      case "ownerGoal":
        out[a.id] = ctx.operatingProfile?.ownerGoal ?? "lift_margins";
        break;
      default:
        if (a.kind === "boolean") out[a.id] = false;
        else if (a.kind === "number") out[a.id] = 0;
        else out[a.id] = a.options?.[0]?.value ?? "";
    }
  }
  return out;
}

export function defaultCheckedSources(def: DeliverableInputDefinition): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const s of def.sources) out[s.id] = true;
  return out;
}

export function liveAssumptionOverlay(
  def: DeliverableInputDefinition,
  ctx: DeliverableInputContext,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const a of def.assumptions) {
    if (!a.engineBound) continue;
    if (a.id === "collectDelay" && ctx.collectDelay != null) out[a.id] = ctx.collectDelay;
    if (a.id === "revGrowthPct" && ctx.revGrowthPct != null) out[a.id] = ctx.revGrowthPct;
    if (a.id === "daysAr" && ctx.budgetWc?.debtorDays != null) out[a.id] = ctx.budgetWc.debtorDays;
    if (a.id === "daysAp" && ctx.budgetWc?.creditorDays != null)
      out[a.id] = ctx.budgetWc.creditorDays;
    if (a.id === "inventoryDays" && ctx.budgetWc?.inventoryDays != null) {
      out[a.id] = ctx.budgetWc.inventoryDays;
    }
    if (a.id === "periodMonths" && ctx.financials) {
      out[a.id] = periodMonthsOf(ctx.financials as Record<string, unknown>);
    }
  }
  return out;
}

export function mergeDeliverableInputState(
  def: DeliverableInputDefinition,
  stored: DeliverableInputState | null | undefined,
  ctx: DeliverableInputContext = {},
): DeliverableInputState {
  const checked = { ...defaultCheckedSources(def), ...(stored?.checkedSources ?? {}) };
  // Drop stale source ids that are no longer on the definition; keep known ones.
  const nextChecked: Record<string, boolean> = {};
  for (const s of def.sources) nextChecked[s.id] = checked[s.id] !== false;
  const values = {
    ...defaultAssumptionValues(def, ctx),
    ...(stored?.assumptionValues ?? {}),
    ...liveAssumptionOverlay(def, ctx),
  };
  return {
    checkedSources: nextChecked,
    assumptionValues: values,
    appliedFingerprint: stored?.appliedFingerprint,
  };
}

export function deliverableInputFingerprint(state: {
  checkedSources: Record<string, boolean>;
  assumptionValues: Record<string, string | number | boolean>;
}): string {
  const sources = Object.keys(state.checkedSources)
    .sort()
    .map((k) => [k, Boolean(state.checkedSources[k])]);
  const assumptions = Object.keys(state.assumptionValues)
    .sort()
    .map((k) => [k, state.assumptionValues[k]]);
  return JSON.stringify({ s: sources, a: assumptions });
}

export function countCheckedSources(
  def: DeliverableInputDefinition,
  state: DeliverableInputState,
): { checked: number; total: number } {
  const total = def.sources.length;
  const checked = def.sources.filter((s) => state.checkedSources[s.id] !== false).length;
  return { checked, total };
}

export function configNeedsRefresh(state: DeliverableInputState): boolean {
  if (!state.appliedFingerprint) return false;
  return deliverableInputFingerprint(state) !== state.appliedFingerprint;
}

export function markConfigApplied(state: DeliverableInputState): DeliverableInputState {
  return { ...state, appliedFingerprint: deliverableInputFingerprint(state) };
}

export function onlyLiveEngineValuesChanged(
  prev: DeliverableInputState,
  next: DeliverableInputState,
  def: DeliverableInputDefinition,
): boolean {
  const prevSrc = Object.keys(prev.checkedSources)
    .sort()
    .map((k) => [k, Boolean(prev.checkedSources[k])]);
  const nextSrc = Object.keys(next.checkedSources)
    .sort()
    .map((k) => [k, Boolean(next.checkedSources[k])]);
  if (JSON.stringify(prevSrc) !== JSON.stringify(nextSrc)) return false;
  const engineIds = new Set(def.assumptions.filter((a) => a.engineBound).map((a) => a.id));
  const keys = new Set([
    ...Object.keys(prev.assumptionValues),
    ...Object.keys(next.assumptionValues),
  ]);
  let any = false;
  for (const key of keys) {
    if (prev.assumptionValues[key] === next.assumptionValues[key]) continue;
    if (!engineIds.has(key)) return false;
    any = true;
  }
  return any;
}

export function parseOperatingProfileUnknown(raw: unknown): ClientOperatingProfile | null {
  return parseOperatingProfile(raw);
}

const FORBIDDEN_COPY = /\b(claude|seeding ai|seed(?:ing)? the (?:bot|model)|language model)\b/i;

export function catalogCopyIsClientFacing(text: string): boolean {
  return !FORBIDDEN_COPY.test(text);
}

export function isDeliverableInputId(raw: string): raw is DeliverableInputId {
  return (DELIVERABLE_INPUT_IDS as readonly string[]).includes(raw);
}

/** Stable key so callers can pass an inline context object without re-render loops. */
export function deliverableInputContextKey(
  id: DeliverableInputId,
  ctx: DeliverableInputContext,
): string {
  return JSON.stringify({
    id,
    rec: ctx.financials?.receivables ?? null,
    pay: ctx.financials?.payables ?? null,
    rev: ctx.financials?.revenue ?? null,
    cogs: ctx.financials?.cogs ?? null,
    ocf: ctx.financials?.operatingCashflow ?? null,
    assets: ctx.financials?.totalAssets ?? null,
    months: ctx.financials?.periodMonths ?? null,
    banks: (ctx.bankAccounts ?? []).map((a) => a.id),
    hasBankDraft: Boolean(ctx.hasBankDraft),
    hasCashLines: Boolean(ctx.hasCashLines),
    collectDelay: ctx.collectDelay ?? null,
    revGrowthPct: ctx.revGrowthPct ?? null,
    opening: ctx.openingBalance ?? null,
    wc: ctx.budgetWc ?? null,
    budgetSeasonality: ctx.budgetSeasonality ?? null,
    season: ctx.operatingProfile?.seasonality ?? null,
    goal: ctx.operatingProfile?.ownerGoal ?? null,
    debtor: ctx.operatingProfile?.debtorDaysDefault ?? null,
    depth: ctx.operatingProfile?.depth ?? null,
    confirmed: ctx.operatingProfile?.confirmedExtraKeys ?? null,
    queries: ctx.openRatioQueryLabels ?? null,
    mix: ctx.productMixIncomplete ?? null,
    prior: ctx.hasPriorPeriod ?? null,
    weekly: ctx.hasWeeklyInputs ?? null,
  });
}
