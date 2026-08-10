/**
 * Profile-driven weighting so deliverables reflect the client's answers,
 * not just ratio scores.
 */

import { GOAL_TO_PRESSURE } from "@/lib/client-profile";
import type { ClientOperatingProfile, PrimaryPressure } from "@/lib/client-profile";

/** Ratio families each pressure should surface first. */
const PRESSURE_BOOSTS: Record<PrimaryPressure, string[]> = {
  cash: [
    "OCF / EBITDA",
    "Debtor Days",
    "Working Capital Days",
    "Cash Conversion Cycle",
    "Creditor Days",
  ],
  profit: [
    "Gross Margin",
    "Operating Margin",
    "Net Margin",
    "Fixed Cost Ratio",
    "Degree of Operating Leverage",
  ],
  growth: [
    "Asset Turnover",
    "Return on Assets",
    "Sales-per-Employee Ratio",
    "Top-5 Customer Share",
  ],
  working_capital: [
    "Debtor Days",
    "Inventory Days",
    "Creditor Days",
    "Working Capital Days",
    "Cash Conversion Cycle",
  ],
  people: ["Gross Profit / Labor", "Sales-per-Employee Ratio", "Fixed Cost Ratio"],
};

/** Answers that make a ratio structurally irrelevant (e.g. stock for a SaaS). */
function isMuted(profile: ClientOperatingProfile, ratioName: string): boolean {
  if (profile.inventoryIntensity === "none" && ratioName === "Inventory Days") return true;
  if (profile.debtorDaysDefault === 0 && ratioName === "Debtor Days") return true;
  return false;
}

/**
 * Multiplier applied to a Next Move's priority score.
 * >1 pushes the move up the list, <1 pushes structurally-irrelevant moves down.
 */
export function profilePriorityWeight(
  profile: ClientOperatingProfile | null | undefined,
  ratioName: string,
): number {
  if (!profile) return 1;
  if (isMuted(profile, ratioName)) return 0.4;

  let weight = 1;
  const pressure = profile.primaryPressure ?? GOAL_TO_PRESSURE[profile.ownerGoal];
  if (PRESSURE_BOOSTS[pressure]?.includes(ratioName)) {
    weight *= 1.45;
  }
  if (profile.costShape === "payroll_heavy" && PRESSURE_BOOSTS.people.includes(ratioName)) {
    weight *= 1.2;
  }
  if (profile.costShape === "fixed" && ratioName === "Fixed Cost Ratio") {
    weight *= 1.2;
  }
  if (profile.inventoryIntensity === "heavy" && ratioName === "Inventory Days") {
    weight *= 1.25;
  }
  if (profile.debtorDaysDefault >= 45 && ratioName === "Debtor Days") {
    weight *= 1.3;
  }
  if (profile.seasonality === "strong" && ratioName === "Working Capital Days") {
    weight *= 1.15;
  }
  if (
    (profile.customerConcentration === "concentrated" ||
      profile.customerConcentration === "single_dominant") &&
    ratioName === "Top-5 Customer Share"
  ) {
    weight *= profile.customerConcentration === "single_dominant" ? 1.6 : 1.35;
  }
  if (
    (profile.debtPosition === "heavy" || profile.debtPosition === "seeking") &&
    DEBT_RATIOS.includes(ratioName)
  ) {
    weight *= profile.debtPosition === "heavy" ? 1.4 : 1.25;
  }
  if (profile.debtPosition === "none" && DEBT_RATIOS.includes(ratioName)) {
    weight *= 0.7;
  }
  if (profile.ownerGoal === "build_to_exit" && EXIT_RATIOS.includes(ratioName)) {
    weight *= 1.3;
  }
  return weight;
}

const DEBT_RATIOS = [
  "Debt-to-Equity",
  "Equity Multiplier",
  "Interest Burden",
  "Interest Cover",
  "Return on Equity",
];

const EXIT_RATIOS = [
  "Net Margin",
  "Return on Assets",
  "Top-5 Customer Share",
  "Gross Profit / Labor",
];

const TEMPLATE_INDUSTRY_LABEL: Record<string, string> = {
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

/** Human-readable industry label for pulse / news / report headers. */
export function profileIndustryLabel(
  profile: ClientOperatingProfile | null | undefined,
  fallback: string,
): string {
  if (!profile) return fallback;
  return TEMPLATE_INDUSTRY_LABEL[profile.templateId] ?? fallback;
}

const CONCENTRATION_LABEL: Record<ClientOperatingProfile["customerConcentration"], string> = {
  diverse: "Spread wide — no customer is critical",
  moderate: "Top few are meaningful (~25% of sales)",
  concentrated: "Top 3 are about half of sales",
  single_dominant: "One customer / payer dominates",
};

const DEBT_LABEL: Record<ClientOperatingProfile["debtPosition"], string> = {
  none: "No debt — self-funded",
  light: "Small facilities only",
  moderate: "Real repayments each month",
  heavy: "Debt is a strain",
  seeking: "Looking to raise funding this year",
};

const GOAL_LABEL: Record<ClientOperatingProfile["ownerGoal"], string> = {
  survive_cash: "Get through a cash squeeze",
  lift_margins: "Make more from the same revenue",
  grow_revenue: "Grow sales / win more work",
  free_working_capital: "Free up cash stuck in the business",
  reduce_founder_dependence: "Get the business to run without me",
  build_to_exit: "Build value for a sale or handover",
};

const STOCK_LABEL: Record<ClientOperatingProfile["inventoryIntensity"], string> = {
  none: "Little or no stock",
  light: "Some short-life stock",
  heavy: "Material inventory or WIP",
};

const COST_LABEL: Record<ClientOperatingProfile["costShape"], string> = {
  variable: "Mostly variable with sales",
  fixed: "Mostly fixed",
  payroll_heavy: "Payroll-heavy",
  balanced: "Balanced mix",
};

const SEASON_LABEL: Record<ClientOperatingProfile["seasonality"], string> = {
  flat: "Fairly even through the year",
  mild: "Mild peaks",
  strong: "Strong peaks and troughs",
};

const PAY_MOTION_LABEL: Record<ClientOperatingProfile["payMotion"], string> = {
  goods: "Sells physical goods",
  time_delivery: "Sells time, jobs, or delivered work",
  access_capacity: "Sells access to space / seats / capacity",
  recurring_rights: "Recurring fee for ongoing access",
  take_rate: "Earns a cut / commission on flow",
  mix: "Material mix of models",
  funding: "Grant / donation / programme funded",
};

/** Display rows for accountant / owner profile summary. */
export function profileDisplayRows(
  profile: ClientOperatingProfile,
): Array<{ label: string; value: string }> {
  const payTiming =
    profile.debtorDaysDefault === 0
      ? "Cash / card on sale"
      : profile.debtorDaysDefault <= 30
        ? `Around ${profile.debtorDaysDefault} days`
        : profile.debtorDaysDefault <= 45
          ? "Milestone / ~45 days"
          : `${profile.debtorDaysDefault}+ days`;

  const secondary =
    profile.secondaryVolumeUnits?.length > 0
      ? profile.secondaryVolumeUnits.map((u) => u.replace(/_/g, " ")).join(", ")
      : "None";

  return [
    { label: "Model", value: profileIndustryLabel(profile, profile.businessTypeId) },
    { label: "How they earn", value: PAY_MOTION_LABEL[profile.payMotion] },
    { label: "Sales unit", value: profile.volumeUnit.replace(/_/g, " ") },
    { label: "Second stream", value: secondary },
    { label: "Customer pay", value: payTiming },
    { label: "Cost base", value: COST_LABEL[profile.costShape] },
    { label: "Seasonality", value: SEASON_LABEL[profile.seasonality] },
    { label: "Stock", value: STOCK_LABEL[profile.inventoryIntensity] },
    { label: "Concentration", value: CONCENTRATION_LABEL[profile.customerConcentration] },
    { label: "Debt / funding", value: DEBT_LABEL[profile.debtPosition] },
    { label: "Owner goal", value: GOAL_LABEL[profile.ownerGoal] },
    {
      label: "FY starts",
      value: new Date(2000, profile.fyStartMonth - 1, 1).toLocaleString("en-ZA", {
        month: "long",
      }),
    },
  ];
}

/** Compact context string for AI prompts / advisory drafting. */
export function profileAiContext(
  profile: ClientOperatingProfile | null | undefined,
): string | null {
  if (!profile) return null;
  const payTiming =
    profile.debtorDaysDefault === 0
      ? "paid cash on sale"
      : `customers pay around ${profile.debtorDaysDefault} days`;
  return [
    `Business model: ${profileIndustryLabel(profile, profile.businessTypeId)}`,
    `Revenue driver: ${profile.volumeUnit.replace(/_/g, " ")}`,
    `Cash timing: ${payTiming}`,
    `Cost base: ${profile.costShape.replace(/_/g, " ")}`,
    `Seasonality: ${profile.seasonality}`,
    `Inventory: ${STOCK_LABEL[profile.inventoryIntensity].toLowerCase()}`,
    `Customer concentration: ${CONCENTRATION_LABEL[profile.customerConcentration].toLowerCase()}`,
    `Debt position: ${DEBT_LABEL[profile.debtPosition].toLowerCase()}`,
    `Owner's goal: ${GOAL_LABEL[profile.ownerGoal].toLowerCase()}`,
  ].join(" · ");
}
