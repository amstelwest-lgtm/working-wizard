import { t, formatMoneyCompact, localizeCopy, type ResolvedMarket } from "./market";
import { playbookKeyForUiKey } from "./playbook-key";
import { ratioActualLine } from "./ratio-actuals";
import type { RatioInputs } from "./ratios";

export type BriefingMarket = Pick<ResolvedMarket, "copyPack" | "currency" | "locale">;

/** Annualised live figures from the owner board (`n` in app.tsx). */
export type BriefingFigures = {
  revenue: number;
  cogs: number;
  ebit: number;
  receivables: number;
  inventory: number;
  payables: number;
  currentAssets: number;
  currentLiabilities: number;
};

export type RatioBriefingTab = "cash" | "waterfall" | "budget";

export type RatioSoWhat = {
  /** Plain-English money sentence in the company's currency. */
  line: string;
  /** Optional second line (e.g. "that's about R12k a day"). */
  detail?: string;
  kind: "cash-trapped" | "cash-funding" | "profit-gap" | "leverage" | "neutral";
};

export type RatioRelatedTab = {
  tab: RatioBriefingTab;
  label: string;
};

const DAYS_IN_YEAR = 365;
const DEFAULT_DEBTOR_DAYS = 45;
const DEFAULT_INVENTORY_DAYS = 45;
const DEFAULT_WC_DAYS = 40;

const MARGIN_MONEY_KEYS = new Set([
  "grossMargin",
  "netMargin",
  "operatingMargin",
  "contributionMargin",
  "ebitdaMargin",
  "fixedCostRatio",
  "directCostsRatio",
  "customerConcentration",
  "revenueGrowth",
  "capexIntensity",
]);

export function relatedTabForRatio(key: string): RatioRelatedTab | null {
  switch (key) {
    case "debtorDays":
    case "creditorDays":
    case "workingCapitalDays":
    case "inventoryDays":
    case "ocfToEbitda":
    case "currentRatio":
      return { tab: "cash", label: "See it on Cash" };
    case "grossMargin":
    case "netMargin":
    case "operatingMargin":
    case "contributionMargin":
    case "ebitdaMargin":
    case "fixedCostRatio":
    case "dol":
    case "gpToLabor":
    case "customerConcentration":
    case "directCostsRatio":
      return { tab: "waterfall", label: "See it on Profit" };
    case "revenueGrowth":
    case "capexIntensity":
    case "assetReinvestmentRatio":
      return { tab: "budget", label: "See it on Budget" };
    default:
      return null;
  }
}

function money(n: number, market: BriefingMarket): string {
  return formatMoneyCompact(n, market);
}

export function currencyWord(market: BriefingMarket, plural = false): string {
  return t(plural ? "currencyWordPlural" : "currencyWord", market);
}

export function ratioPlaybookKey(key: string): string {
  return playbookKeyForUiKey(key);
}

export function ratioBriefingTitle(market: BriefingMarket): string {
  return `This ratio in your ${currencyWord(market, true)}`;
}

export function ratioFriendlyName(name: string, market: BriefingMarket): string {
  return localizeCopy(name, market);
}

export function ratioFormulaLine(
  key: string,
  v: RatioInputs,
  market: BriefingMarket,
): { formula: string; hint?: string; calculation: string | null } {
  const fmt = (n: number) => formatMoneyCompact(n, market);
  const line = ratioActualLine(key, v, fmt);
  const need = line.missing.length ? `Need: ${line.missing.join(", ")}` : null;
  return {
    formula: localizeCopy(line.formula, market),
    hint: line.hint ? localizeCopy(line.hint, market) : undefined,
    calculation: line.calculation ?? need,
  };
}

/**
 * Translate a ratio into one money sentence the owner can feel.
 * Uses live annualised numbers + optional balance-sheet stocks.
 */
export function soWhatInMoney(opts: {
  key: string;
  value: number | null | undefined;
  n: BriefingFigures;
  market: BriefingMarket;
  p50?: number | null;
  higherIsBetter?: boolean;
}): RatioSoWhat | null {
  const { key, value, n, market, p50, higherIsBetter = true } = opts;
  if (value == null || !Number.isFinite(value)) return null;

  const dailyRevenue = n.revenue > 0 ? n.revenue / DAYS_IN_YEAR : 0;
  const dailyCogs = n.cogs > 0 ? n.cogs / DAYS_IN_YEAR : 0;
  const words = currencyWord(market, true);

  if (key === "debtorDays") {
    const stock = n.receivables > 0 ? n.receivables : value * dailyRevenue;
    const targetDays = p50 != null && Number.isFinite(p50) ? p50 : DEFAULT_DEBTOR_DAYS;
    const extraDays = value - targetDays;
    const extraCash = extraDays * dailyRevenue;
    if (dailyRevenue <= 0 && stock <= 0) return null;
    if (extraDays > 1 && extraCash > 0) {
      return {
        kind: "cash-trapped",
        line: `Customers currently owe you about ${money(stock, market)}. That's ${Math.round(extraDays)} days slower than a typical company in your industry.`,
        detail: `Collecting at the median (${Math.round(targetDays)} days) would free about ${money(extraCash, market)} of ${words} — roughly ${money(dailyRevenue, market)} a day.`,
      };
    }
    if (extraDays < -1) {
      return {
        kind: "cash-funding",
        line: `Customers currently owe you about ${money(stock, market)}. You collect ${Math.round(Math.abs(extraDays))} days faster than the industry median.`,
        detail: `That discipline is keeping about ${money(Math.abs(extraCash), market)} out of ${t("receivables", market).toLowerCase()} versus a typical peer.`,
      };
    }
    return {
      kind: "neutral",
      line: `Customers currently owe you about ${money(stock, market)} — sitting close to the industry median of ${Math.round(targetDays)} days.`,
    };
  }

  if (key === "inventoryDays") {
    const stock = n.inventory > 0 ? n.inventory : value * dailyCogs;
    const targetDays = p50 != null && Number.isFinite(p50) ? p50 : DEFAULT_INVENTORY_DAYS;
    const extraDays = value - targetDays;
    const extraCash = extraDays * dailyCogs;
    if (dailyCogs <= 0 && stock <= 0) return null;
    if (extraDays > 1 && extraCash > 0) {
      return {
        kind: "cash-trapped",
        line: `Stock on the floor is about ${money(stock, market)} — ${Math.round(extraDays)} days more than a typical peer.`,
        detail: `Getting back to ${Math.round(targetDays)} days would unlock about ${money(extraCash, market)} of ${words}.`,
      };
    }
    return {
      kind: "neutral",
      line: `Stock on the floor is about ${money(stock, market)}, close to the industry median of ${Math.round(targetDays)} days.`,
    };
  }

  if (key === "creditorDays") {
    const stock = value * dailyCogs;
    if (dailyCogs <= 0) return null;
    const targetDays = p50 != null && Number.isFinite(p50) ? p50 : 30;
    const extraDays = value - targetDays;
    if (extraDays > 1) {
      return {
        kind: "cash-funding",
        line: `Suppliers are currently funding about ${money(stock, market)} of your operation (${Math.round(value)} days of purchases).`,
        detail: `That's ${Math.round(extraDays)} days longer than the median — useful float, as long as relationships stay healthy.`,
      };
    }
    if (extraDays < -1) {
      return {
        kind: "cash-trapped",
        line: `You're paying suppliers about ${Math.round(Math.abs(extraDays))} days faster than a typical peer.`,
        detail: `Matching the median would keep about ${money(Math.abs(extraDays) * dailyCogs, market)} in the business a little longer.`,
      };
    }
    return {
      kind: "neutral",
      line: `Suppliers are funding about ${money(stock, market)} — in line with the industry median.`,
    };
  }

  if (key === "workingCapitalDays") {
    const stock = n.receivables + n.inventory - n.payables;
    const targetDays = p50 != null && Number.isFinite(p50) ? p50 : DEFAULT_WC_DAYS;
    const extraDays = value - targetDays;
    const extraCash = extraDays * dailyRevenue;
    if (dailyRevenue <= 0) return null;
    if (extraDays > 1 && extraCash > 0) {
      const stockBit =
        stock !== 0
          ? `Net working capital on the books is about ${money(stock, market)}. `
          : "";
      return {
        kind: "cash-trapped",
        line: `${stockBit}You're ${Math.round(extraDays)} days slower than the industry median (${Math.round(targetDays)} days).`,
        detail: `Closing that gap would free about ${money(extraCash, market)} of ${words} — money currently sitting in ${t("receivables", market).toLowerCase()} and stock instead of the bank.`,
      };
    }
    return {
      kind: "neutral",
      line: `Working capital is sitting close to the industry median of ${Math.round(targetDays)} days.`,
    };
  }

  if (key === "currentRatio") {
    const currentAssets = n.currentAssets > 0 ? n.currentAssets : n.receivables + n.inventory;
    const currentLiab = n.currentLiabilities > 0 ? n.currentLiabilities : n.payables;
    if (currentAssets <= 0 && currentLiab <= 0) {
      return {
        kind: "neutral",
        line: `Your current ratio is ${value.toFixed(2)}× — current assets versus current liabilities.`,
      };
    }
    return {
      kind: value < 1 ? "cash-trapped" : "neutral",
      line:
        currentLiab > 0
          ? `You have about ${money(currentAssets, market)} of near-term assets against ${money(currentLiab, market)} due to suppliers and other short-term bills (${value.toFixed(2)}×).`
          : `Current assets on the books are about ${money(currentAssets, market)}.`,
    };
  }

  if (key === "dol") {
    const dip = Math.abs(n.ebit * value * 0.1);
    if (dip <= 0) return null;
    return {
      kind: "leverage",
      line: `A 10% dip in sales would move operating profit by about ${money(dip, market)} at this leverage (${value.toFixed(1)}×).`,
      detail: `High operating leverage cuts both ways — the same 10% upswing would add roughly the same ${words} back.`,
    };
  }

  if (MARGIN_MONEY_KEYS.has(key) && n.revenue > 0 && p50 != null && Number.isFinite(p50)) {
    const gapPts = higherIsBetter ? p50 - value : value - p50;
    const gapMoney = gapPts * n.revenue;
    const pts = Math.abs(gapPts) * 100;
    if (Math.abs(gapPts) < 0.002) {
      return {
        kind: "neutral",
        line: `You're sitting on the industry median. On ${money(n.revenue, market)} of annualised revenue that's a solid place to be.`,
      };
    }
    if (gapMoney > 0) {
      const verb = higherIsBetter ? "below" : "above";
      return {
        kind: "profit-gap",
        line: `You're ${pts.toFixed(1)} points ${verb} the industry median.`,
        detail: `On ${money(n.revenue, market)} of annualised revenue, closing that gap is worth about ${money(gapMoney, market)} a year.`,
      };
    }
    const verb = higherIsBetter ? "above" : "below";
    return {
      kind: "neutral",
      line: `You're ${pts.toFixed(1)} points ${verb} the industry median — that's about ${money(Math.abs(gapMoney), market)} a year versus a typical peer on ${money(n.revenue, market)} of revenue.`,
    };
  }

  if (MARGIN_MONEY_KEYS.has(key) && n.revenue > 0) {
    const implied = Math.abs(value) * n.revenue;
    return {
      kind: "neutral",
      line: `On ${money(n.revenue, market)} of annualised revenue, this ratio represents about ${money(implied, market)} a year.`,
    };
  }

  if (Math.abs(value) >= 1000) {
    return {
      kind: "neutral",
      line: `Your current reading is ${money(value, market)}.`,
    };
  }

  return {
    kind: "neutral",
    line: `Your current reading is ${Number.isInteger(value) ? String(value) : value.toFixed(2)}.`,
  };
}

export function fallbackMove(steps: string[] | undefined, market: BriefingMarket): string | null {
  const step = steps?.[0];
  return step ? localizeCopy(step, market) : null;
}
