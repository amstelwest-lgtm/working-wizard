/**
 * Catalog + derived outstanding questions for the Client Brain Summary tab.
 * Structure only — does not write rows or call Claude.
 */

import type { ClientOperatingProfile } from "@/lib/client-profile";
import {
  canAdvanceFromCosts,
  canAdvanceFromNames,
  canAdvanceFromPrices,
  canAdvanceFromRevenue,
  hasProductMixAnswer,
  namedProductLines,
  type ProductMix,
} from "@/lib/product-mix";
import { hasWeeklyProfitFigures, type WeeklyInputs } from "@/lib/weekly-inputs";
import type { ClientBrainQuestion } from "@/lib/client-brain";

export type QuestionState = {
  key: string;
  prompt: string;
  audience: "owner" | "accountant" | "both";
  answered: boolean;
  answer: string | null;
  source: "operating_profile" | "product_mix" | "weekly_inputs" | "stored";
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

const STOCK_LABEL: Record<string, string> = {
  none: "Little or no stock",
  light: "Some short-life stock",
  heavy: "Material inventory or WIP",
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

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** Core four asked on first run. Deferred six are unanswered when depth === "core". */
const CORE_PROFILE_KEYS = new Set([
  "operating_profile.payMotion",
  "operating_profile.volumeUnit",
  "operating_profile.debtorDaysDefault",
  "operating_profile.ownerGoal",
]);

export const OPERATING_PROFILE_PROMPTS: Array<{
  key: string;
  prompt: string;
  core: boolean;
}> = [
  { key: "operating_profile.payMotion", prompt: "How do you mostly make money?", core: true },
  { key: "operating_profile.volumeUnit", prompt: "What counts as one unit of sales?", core: true },
  {
    key: "operating_profile.secondaryVolumeUnits",
    prompt: "Any important second revenue stream?",
    core: false,
  },
  {
    key: "operating_profile.debtorDaysDefault",
    prompt: "How quickly do customers typically pay?",
    core: true,
  },
  { key: "operating_profile.costShape", prompt: "What does your cost base look like?", core: false },
  { key: "operating_profile.seasonality", prompt: "How seasonal is demand?", core: false },
  {
    key: "operating_profile.inventoryIntensity",
    prompt: "How important is stock / inventory?",
    core: false,
  },
  {
    key: "operating_profile.customerConcentration",
    prompt: "How concentrated is your revenue?",
    core: false,
  },
  {
    key: "operating_profile.debtPosition",
    prompt: "Where do you stand on debt and funding?",
    core: false,
  },
  {
    key: "operating_profile.ownerGoal",
    prompt: "What are you actually trying to achieve?",
    core: true,
  },
];

function profileFieldAnswered(profile: ClientOperatingProfile | null, key: string): boolean {
  if (!profile) return false;
  if (profile.depth === "core" && !CORE_PROFILE_KEYS.has(key)) return false;
  if (key === "operating_profile.payMotion") return !!profile.payMotion;
  if (key === "operating_profile.volumeUnit") return !!profile.volumeUnit;
  if (key === "operating_profile.secondaryVolumeUnits") return true;
  if (key === "operating_profile.debtorDaysDefault") return profile.debtorDaysDefault != null;
  if (key === "operating_profile.costShape") return !!profile.costShape;
  if (key === "operating_profile.seasonality") return !!profile.seasonality;
  if (key === "operating_profile.inventoryIntensity") return !!profile.inventoryIntensity;
  if (key === "operating_profile.customerConcentration") return !!profile.customerConcentration;
  if (key === "operating_profile.debtPosition") return !!profile.debtPosition;
  if (key === "operating_profile.ownerGoal") return !!profile.ownerGoal;
  return false;
}

function profileFieldLabel(profile: ClientOperatingProfile, key: string): string | null {
  if (key === "operating_profile.payMotion") return PAY_MOTION_LABEL[profile.payMotion] ?? profile.payMotion;
  if (key === "operating_profile.volumeUnit") return profile.volumeUnit.replace(/_/g, " ");
  if (key === "operating_profile.secondaryVolumeUnits") {
    return profile.secondaryVolumeUnits?.length
      ? profile.secondaryVolumeUnits.map((u) => u.replace(/_/g, " ")).join(", ")
      : "None";
  }
  if (key === "operating_profile.debtorDaysDefault") {
    if (profile.debtorDaysDefault === 0) return "Cash / card on sale";
    if (profile.debtorDaysDefault <= 30) return `Around ${profile.debtorDaysDefault} days`;
    if (profile.debtorDaysDefault <= 45) return "Milestone / ~45 days";
    return `${profile.debtorDaysDefault}+ days`;
  }
  if (key === "operating_profile.costShape") return COST_LABEL[profile.costShape] ?? profile.costShape;
  if (key === "operating_profile.seasonality") {
    return SEASON_LABEL[profile.seasonality] ?? profile.seasonality;
  }
  if (key === "operating_profile.inventoryIntensity") {
    return STOCK_LABEL[profile.inventoryIntensity] ?? profile.inventoryIntensity;
  }
  if (key === "operating_profile.customerConcentration") {
    return CONCENTRATION_LABEL[profile.customerConcentration] ?? profile.customerConcentration;
  }
  if (key === "operating_profile.debtPosition") {
    return DEBT_LABEL[profile.debtPosition] ?? profile.debtPosition;
  }
  if (key === "operating_profile.ownerGoal") {
    const goal = GOAL_LABEL[profile.ownerGoal] ?? profile.ownerGoal;
    const month = MONTHS[profile.fyStartMonth - 1];
    return month ? `${goal} · FY starts ${month}` : goal;
  }
  return null;
}

export function operatingProfileQuestionStates(
  profile: ClientOperatingProfile | null,
): QuestionState[] {
  return OPERATING_PROFILE_PROMPTS.map((q) => {
    const answered = profileFieldAnswered(profile, q.key);
    return {
      key: q.key,
      prompt: q.prompt,
      audience: "both" as const,
      answered,
      answer: answered && profile ? profileFieldLabel(profile, q.key) : null,
      source: "operating_profile" as const,
    };
  });
}

export function productLineQuestionStates(
  mix: ProductMix,
  weekly: WeeklyInputs,
): QuestionState[] {
  const confirmed = hasProductMixAnswer(mix);
  const declined = confirmed && !mix.active;
  const named = namedProductLines(mix);
  const namesOk = canAdvanceFromNames(named.map((l) => l.name));
  const pricesOk = canAdvanceFromPrices(mix.lines);
  const costsOk = canAdvanceFromCosts(mix.lines);
  const revenueOk = canAdvanceFromRevenue(mix.lines);
  const weeklyOk = hasWeeklyProfitFigures(weekly);
  const weekCount = Object.keys(weekly.weeks).length;

  const optInAnswer = !confirmed
    ? null
    : declined
      ? "No — one main line covers it"
      : named.length
        ? `Yes — ${named.map((l) => l.name).join(", ")}`
        : "Yes — a few lines matter";

  return [
    {
      key: "product_mix.opt_in",
      prompt: "Do you sell more than one product or service that matters?",
      audience: "both",
      answered: confirmed,
      answer: optInAnswer,
      source: "product_mix",
    },
    {
      key: "product_mix.lines",
      prompt: "Name the lines that matter",
      audience: "both",
      answered: declined || namesOk,
      answer: declined ? "Skipped — one main line" : namesOk ? named.map((l) => l.name).join(", ") : null,
      source: "product_mix",
    },
    {
      key: "product_mix.prices",
      prompt: "Selling price per unit",
      audience: "both",
      answered: declined || pricesOk,
      answer: declined
        ? "Skipped — one main line"
        : pricesOk
          ? named
              .map((l) => (l.sellPrice != null ? `${l.name}: ${l.sellPrice}` : null))
              .filter(Boolean)
              .join(" · ")
          : null,
      source: "product_mix",
    },
    {
      key: "product_mix.costs",
      prompt: "Direct cost per unit",
      audience: "both",
      answered: declined || costsOk,
      answer: declined
        ? "Skipped — one main line"
        : costsOk
          ? named
              .map((l) => (l.unitCost != null ? `${l.name}: ${l.unitCost}` : null))
              .filter(Boolean)
              .join(" · ")
          : null,
      source: "product_mix",
    },
    {
      key: "product_mix.revenue",
      prompt: "Of total revenue, how much is from each line",
      audience: "both",
      answered: declined || revenueOk,
      answer: declined
        ? "Skipped — one main line"
        : revenueOk
          ? named
              .map((l) => (l.revenueAmount != null ? `${l.name}: ${l.revenueAmount}` : null))
              .filter(Boolean)
              .join(" · ")
          : null,
      source: "product_mix",
    },
    {
      key: "weekly_inputs.weeks",
      prompt: "Weekly P&L figures on the Profit tab",
      audience: "both",
      answered: weeklyOk,
      answer: weeklyOk ? `${weekCount} week${weekCount === 1 ? "" : "s"} with figures` : null,
      source: "weekly_inputs",
    },
  ];
}

export function mergeOutstandingQuestions(
  derived: QuestionState[],
  stored: ClientBrainQuestion[],
): QuestionState[] {
  const byKey = new Map<string, QuestionState>();
  for (const q of derived) {
    if (!q.answered) byKey.set(q.key, q);
  }
  for (const row of stored) {
    if (row.status !== "unanswered") continue;
    byKey.set(row.question_key, {
      key: row.question_key,
      prompt: row.prompt_text?.trim() || row.question_key,
      audience: row.audience,
      answered: false,
      answer: null,
      source: "stored",
    });
  }
  return [...byKey.values()];
}
