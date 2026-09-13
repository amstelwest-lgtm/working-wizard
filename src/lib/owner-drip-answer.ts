/**
 * Apply a Health-tab drip answer to profile, product mix, or weekly inputs.
 */

import type { BudgetPayMotion, BudgetVolumeUnit } from "@/lib/budget.types";
import { PAY_MOTION_OPTIONS, volumeOptionsForMotion } from "@/lib/budget.taxonomy";
import {
  CORE_PROFILE_KEYS,
  DEFERRED_PROFILE_CONFIRM_KEYS,
} from "@/lib/client-brain-questions";
import {
  GOAL_TO_PRESSURE,
  deriveBusinessTypeId,
  resolveProfileTemplateId,
  type ClientOperatingProfile,
  type CustomerConcentration,
  type DebtPosition,
  type InventoryIntensity,
  type OwnerGoal,
} from "@/lib/client-profile";
import {
  PRODUCT_MIX_VERSION,
  applyUnitEconomics,
  canAdvanceFromNames,
  declinedProductMix,
  linesFromNames,
  namedProductLines,
  parseMoney,
  type ProductMix,
} from "@/lib/product-mix";
import {
  DEFAULT_WEEKLY_ROW,
  getISOWeekKey,
  type WeeklyInputs,
} from "@/lib/weekly-inputs";

export type DripChoice = { id: string; label: string };

export const PAY_TIMING_CHOICES: DripChoice[] = [
  { id: "0", label: "Cash / card on sale" },
  { id: "30", label: "Around 30 days" },
  { id: "45", label: "Milestone / progress billing (~45 days)" },
  { id: "60", label: "60+ days" },
];

export const COST_SHAPE_CHOICES: DripChoice[] = [
  { id: "variable", label: "Mostly variable with sales" },
  { id: "fixed", label: "Mostly fixed" },
  { id: "payroll_heavy", label: "Payroll-heavy" },
  { id: "balanced", label: "Balanced mix" },
];

export const SEASON_CHOICES: DripChoice[] = [
  { id: "flat", label: "Fairly even through the year" },
  { id: "mild", label: "Mild peaks" },
  { id: "strong", label: "Strong peaks and troughs" },
];

export const STOCK_CHOICES: DripChoice[] = [
  { id: "none", label: "Little or no stock" },
  { id: "light", label: "Some stock / short shelf-life" },
  { id: "heavy", label: "Material inventory or WIP" },
];

export const CONCENTRATION_CHOICES: DripChoice[] = [
  { id: "diverse", label: "Spread wide — no customer is critical" },
  { id: "moderate", label: "Top few are meaningful (roughly a quarter of sales)" },
  { id: "concentrated", label: "Top 3 are about half of sales" },
  { id: "single_dominant", label: "One customer dominates (or one payer/funder)" },
];

export const DEBT_CHOICES: DripChoice[] = [
  { id: "none", label: "No debt — self-funded" },
  { id: "light", label: "Small facilities only" },
  { id: "moderate", label: "Real repayments each month" },
  { id: "heavy", label: "Debt is a strain" },
  { id: "seeking", label: "Looking to raise funding this year" },
];

export const GOAL_CHOICES: DripChoice[] = [
  { id: "survive_cash", label: "Get through a cash squeeze" },
  { id: "lift_margins", label: "Make more from the same revenue" },
  { id: "grow_revenue", label: "Grow sales / win more work" },
  { id: "free_working_capital", label: "Free up cash stuck in the business" },
  { id: "reduce_founder_dependence", label: "Get the business to run without me" },
  { id: "build_to_exit", label: "Build value for a sale or handover" },
];

export const OPT_IN_CHOICES: DripChoice[] = [
  { id: "yes", label: "Yes — a few lines matter" },
  { id: "no", label: "No — one main line covers it" },
];

export function profileDripChoices(
  key: string,
  profile: ClientOperatingProfile | null,
): DripChoice[] {
  if (key === "operating_profile.payMotion") {
    return PAY_MOTION_OPTIONS.map((o) => ({ id: o.id, label: o.label }));
  }
  if (key === "operating_profile.volumeUnit" || key === "operating_profile.secondaryVolumeUnits") {
    const motion = (profile?.payMotion ?? "goods") as BudgetPayMotion;
    const units = volumeOptionsForMotion(motion).map((o) => ({ id: o.id, label: o.label }));
    if (key === "operating_profile.secondaryVolumeUnits") {
      return [{ id: "none", label: "No — just the main one" }, ...units];
    }
    return units;
  }
  if (key === "operating_profile.debtorDaysDefault") return PAY_TIMING_CHOICES;
  if (key === "operating_profile.costShape") return COST_SHAPE_CHOICES;
  if (key === "operating_profile.seasonality") return SEASON_CHOICES;
  if (key === "operating_profile.inventoryIntensity") return STOCK_CHOICES;
  if (key === "operating_profile.customerConcentration") return CONCENTRATION_CHOICES;
  if (key === "operating_profile.debtPosition") return DEBT_CHOICES;
  if (key === "operating_profile.ownerGoal") return GOAL_CHOICES;
  return [];
}

function markConfirmedExtra(
  profile: ClientOperatingProfile,
  key: string,
): ClientOperatingProfile {
  if (CORE_PROFILE_KEYS.has(key) || key === "operating_profile.secondaryVolumeUnits") {
    return profile;
  }
  const confirmed = new Set(profile.confirmedExtraKeys ?? []);
  confirmed.add(key);
  const confirmedExtraKeys = [...confirmed];
  const depth = DEFERRED_PROFILE_CONFIRM_KEYS.every((k) => confirmed.has(k))
    ? "full"
    : profile.depth;
  return { ...profile, confirmedExtraKeys, depth };
}

export function applyOperatingProfileDripAnswer(
  profile: ClientOperatingProfile,
  key: string,
  value: string,
): ClientOperatingProfile {
  const next = { ...profile };
  if (key === "operating_profile.payMotion") {
    const payMotion = value as BudgetPayMotion;
    const options = volumeOptionsForMotion(payMotion);
    const keep = options.find((o) => o.id === profile.volumeUnit);
    const volumeUnit = (keep?.id ?? options[0]?.id ?? profile.volumeUnit) as BudgetVolumeUnit;
    const templateId = keep?.templateId ?? options[0]?.templateId ?? profile.templateId;
    next.payMotion = payMotion;
    next.volumeUnit = volumeUnit;
    next.templateId = templateId;
  } else if (key === "operating_profile.volumeUnit") {
    const volumeUnit = value as BudgetVolumeUnit;
    next.volumeUnit = volumeUnit;
    next.templateId = resolveProfileTemplateId({
      payMotion: profile.payMotion,
      volumeUnit,
      templateHint: profile.templateId,
    });
  } else if (key === "operating_profile.secondaryVolumeUnits") {
    next.secondaryVolumeUnits = value && value !== "none" ? [value as BudgetVolumeUnit] : [];
  } else if (key === "operating_profile.debtorDaysDefault") {
    const days = Number(value);
    if (!Number.isFinite(days)) throw new Error("Pick how quickly customers typically pay.");
    next.debtorDaysDefault = days;
  } else if (key === "operating_profile.costShape") {
    next.costShape = value as ClientOperatingProfile["costShape"];
  } else if (key === "operating_profile.seasonality") {
    next.seasonality = value as ClientOperatingProfile["seasonality"];
  } else if (key === "operating_profile.inventoryIntensity") {
    next.inventoryIntensity = value as InventoryIntensity;
  } else if (key === "operating_profile.customerConcentration") {
    next.customerConcentration = value as CustomerConcentration;
  } else if (key === "operating_profile.debtPosition") {
    next.debtPosition = value as DebtPosition;
  } else if (key === "operating_profile.ownerGoal") {
    next.ownerGoal = value as OwnerGoal;
    next.primaryPressure = GOAL_TO_PRESSURE[value as OwnerGoal];
  } else {
    throw new Error("This question needs a choice.");
  }
  next.businessTypeId = deriveBusinessTypeId(next);
  return markConfirmedExtra(next, key);
}

export function parseLineNames(raw: string): string[] {
  return raw
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function applyProductMixDripAnswer(
  mix: ProductMix,
  key: string,
  payload: { choice?: string; names?: string[]; lineValues?: Record<string, string> },
): ProductMix {
  if (key === "product_mix.opt_in") {
    if (payload.choice === "no") return declinedProductMix();
    if (payload.choice === "yes") {
      return {
        ...mix,
        version: PRODUCT_MIX_VERSION,
        confirmedAt: mix.confirmedAt ?? new Date().toISOString(),
        active: true,
      };
    }
    throw new Error("Choose whether more than one line matters.");
  }
  if (key === "product_mix.lines") {
    const names = payload.names ?? [];
    if (!canAdvanceFromNames(names)) {
      throw new Error("Name at least two product or service lines.");
    }
    return applyUnitEconomics({
      ...mix,
      version: PRODUCT_MIX_VERSION,
      confirmedAt: mix.confirmedAt ?? new Date().toISOString(),
      active: true,
      lines: linesFromNames(names, mix.lines),
    });
  }
  const field =
    key === "product_mix.prices"
      ? "sellPrice"
      : key === "product_mix.costs"
        ? "unitCost"
        : key === "product_mix.revenue"
          ? "revenueAmount"
          : null;
  if (!field) throw new Error("This product question is not fillable here.");
  const values = payload.lineValues ?? {};
  const named = namedProductLines(mix);
  if (named.length < 2) throw new Error("Name your lines first, then we can add prices.");
  const lines = mix.lines.map((line) => {
    if (!line.name.trim()) return line;
    const parsed = parseMoney(values[line.id]);
    if (parsed == null) return line;
    return { ...line, [field]: parsed };
  });
  const patched = { ...mix, lines, confirmedAt: mix.confirmedAt ?? new Date().toISOString(), active: true };
  const next = applyUnitEconomics(patched);
  const filled = namedProductLines(next);
  const ok =
    field === "sellPrice"
      ? filled.every((l) => l.sellPrice != null && l.sellPrice > 0)
      : field === "unitCost"
        ? filled.every((l) => l.unitCost != null)
        : filled.every((l) => l.revenueAmount != null);
  if (!ok) {
    throw new Error(
      field === "sellPrice"
        ? "Enter a selling price for each line."
        : field === "unitCost"
          ? "Enter the direct cost for each line."
          : "Enter how much revenue comes from each line.",
    );
  }
  return next;
}

export function applyWeeklyDripAnswer(
  weekly: WeeklyInputs,
  revenue: number,
  costOfSales: number,
  weekKey = getISOWeekKey(),
): WeeklyInputs {
  if (!Number.isFinite(revenue) || revenue < 0 || !Number.isFinite(costOfSales) || costOfSales < 0) {
    throw new Error("Enter this week’s revenue and cost of sales.");
  }
  if (revenue <= 0 && costOfSales <= 0) {
    throw new Error("Enter this week’s revenue and cost of sales.");
  }
  const prev = weekly.weeks[weekKey] ?? DEFAULT_WEEKLY_ROW;
  return {
    weeks: {
      ...weekly.weeks,
      [weekKey]: { ...prev, revenue, costOfSales },
    },
  };
}
