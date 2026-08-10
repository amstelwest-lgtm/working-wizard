/**
 * Client operating profile — answers from the 10-question Milōn intro funnel.
 * Shared across health, cash, budget, reports, pulse, and advisory.
 */

import type {
  BudgetCostShape,
  BudgetPayMotion,
  BudgetSeasonality,
  BudgetVolumeUnit,
  BudgetInventoryProfile,
  BudgetQualification,
  BudgetTemplateId,
  BudgetCapexMode,
} from "@/lib/budget.types";
import { resolveTemplateId } from "@/lib/budget.templates";
import { findVolumeOption } from "@/lib/budget.taxonomy";

export type TeamSizeBand = "solo" | "small" | "medium" | "large";
export type RevenueBand = "pre_revenue" | "under_100k" | "100k_500k" | "500k_2m" | "over_2m";
/** Monthly ZAR revenue bands — labels in the funnel. */
export type InventoryIntensity = "none" | "light" | "heavy";
export type PrimaryPressure =
  | "cash"
  | "profit"
  | "growth"
  | "working_capital"
  | "people";

export type ClientOperatingProfile = {
  version: 1;
  payMotion: BudgetPayMotion;
  volumeUnit: BudgetVolumeUnit;
  /** Template kit resolved at save time (handles specialised units). */
  templateId: BudgetTemplateId;
  secondaryVolumeUnits: BudgetVolumeUnit[];
  debtorDaysDefault: number;
  costShape: BudgetCostShape;
  seasonality: BudgetSeasonality;
  inventoryIntensity: InventoryIntensity;
  teamSize: TeamSizeBand;
  revenueBand: RevenueBand;
  primaryPressure: PrimaryPressure;
  fyStartMonth: number;
  /** Derived legacy id for MODEL_TUNING / benchmarks */
  businessTypeId: string;
  confirmedAt: string;
};

export function inventoryToProfile(
  intensity: InventoryIntensity,
): BudgetInventoryProfile {
  if (intensity === "none") return "none";
  if (intensity === "light") return "short_life";
  return "standard";
}

/** Map operating profile → budget qualification (capex left open for the UI section). */
export function profileToBudgetQualification(
  profile: ClientOperatingProfile,
  capexMode: BudgetCapexMode = "none",
): BudgetQualification {
  const opt = findVolumeOption(profile.volumeUnit, profile.templateId);
  return {
    payMotion: profile.payMotion,
    volumeUnit: profile.volumeUnit,
    secondaryVolumeUnits: profile.secondaryVolumeUnits,
    payModel:
      profile.payMotion === "goods"
        ? "products"
        : profile.payMotion === "time_delivery"
          ? "services"
          : profile.payMotion === "recurring_rights"
            ? "subscription"
            : "mix",
    subtype: profile.volumeUnit,
    driverKind: opt?.driverKind ?? "units_price",
    costShape: profile.costShape,
    debtorDaysDefault: profile.debtorDaysDefault,
    capexMode,
    seasonality: profile.seasonality,
    inventoryProfile: inventoryToProfile(profile.inventoryIntensity),
    confirmedAt: profile.confirmedAt,
  };
}

/**
 * Derive legacy business_type id so health scores / benchmarks keep working.
 */
export function deriveBusinessTypeId(input: {
  payMotion: BudgetPayMotion;
  volumeUnit: BudgetVolumeUnit;
  templateId?: BudgetTemplateId;
}): string {
  const { payMotion, volumeUnit, templateId } = input;
  if (templateId === "construction_contracts" || volumeUnit === "construction_certified")
    return "construction";
  if (templateId === "healthcare_visits" || volumeUnit === "patients_visits") return "healthcare";
  if (templateId === "logistics_trips" || volumeUnit === "loads_trips") return "logistics";
  if (templateId === "hospitality_rooms" || volumeUnit === "rooms_adr") return "hospitality";
  if (templateId === "hospitality_covers" || volumeUnit === "covers_spend") return "hospitality";
  if (templateId === "marketplace_take" || volumeUnit === "gmv_take") return "marketplace";
  if (templateId === "saas_arpu" || volumeUnit === "subscribers_arpu") return "saas";
  if (templateId === "telecom_arpu" || volumeUnit === "telecom_subscribers") return "subscription";
  if (templateId === "membership_club" || volumeUnit === "members_fee") return "subscription";
  if (templateId === "retail_units" || volumeUnit === "units_sku") return "retail";
  if (templateId === "wholesale_units" || volumeUnit === "wholesale_volume") return "distribution";
  if (templateId === "manufacturing_units" || volumeUnit === "production_output")
    return "manufacturing";
  if (templateId === "property_rent" || volumeUnit === "units_rent") return "asset_heavy";
  if (templateId === "agency_deals" || volumeUnit === "deals_commission") return "agency";
  if (templateId === "media_agency" || volumeUnit === "media_spend_fee") return "agency";
  if (templateId === "services_projects" || volumeUnit === "projects_fee") return "project";
  if (templateId === "professional_wip" || volumeUnit === "professional_hours") return "agency";
  if (templateId === "retainer_contracts" || volumeUnit === "contracts_mrr") return "agency";
  if (templateId === "field_jobs" || volumeUnit === "jobs_ticket") return "service";
  if (templateId === "day_labour" || volumeUnit === "day_shift") return "service";
  if (templateId === "services_hours" || volumeUnit === "billable_hours") return "service";
  if (templateId === "security_posts" || volumeUnit === "posts_hours") return "service";
  if (templateId === "facilities_sites" || volumeUnit === "sites_fee") return "service";
  if (payMotion === "mix") return "hybrid";
  if (payMotion === "funding") return "hybrid";
  if (payMotion === "goods") return "product";
  if (payMotion === "take_rate") return "marketplace";
  if (payMotion === "recurring_rights") return "subscription";
  if (payMotion === "access_capacity") return "hospitality";
  return "hybrid";
}

export function buildOperatingProfile(input: {
  payMotion: BudgetPayMotion;
  volumeUnit: BudgetVolumeUnit;
  templateId: BudgetTemplateId;
  secondaryVolumeUnits: BudgetVolumeUnit[];
  debtorDaysDefault: number;
  costShape: BudgetCostShape;
  seasonality: BudgetSeasonality;
  inventoryIntensity: InventoryIntensity;
  teamSize: TeamSizeBand;
  revenueBand: RevenueBand;
  primaryPressure: PrimaryPressure;
  fyStartMonth: number;
}): ClientOperatingProfile {
  const businessTypeId = deriveBusinessTypeId(input);
  return {
    version: 1,
    ...input,
    businessTypeId,
    confirmedAt: new Date().toISOString(),
  };
}

export function resolveProfileTemplateId(input: {
  payMotion: BudgetPayMotion;
  volumeUnit: BudgetVolumeUnit;
  templateHint?: BudgetTemplateId;
}): BudgetTemplateId {
  return resolveTemplateId({
    payMotion: input.payMotion,
    volumeUnit: input.volumeUnit,
    templateHint: input.templateHint,
  });
}

export function profileShortLabel(profile: ClientOperatingProfile | null | undefined): string {
  if (!profile) return "Set up profile";
  const opt = findVolumeOption(profile.volumeUnit, profile.templateId);
  return opt?.label.split("×")[0]?.trim() || profile.businessTypeId;
}

export function parseOperatingProfile(raw: unknown): ClientOperatingProfile | null {
  if (!raw || typeof raw !== "object") return null;
  const p = raw as Partial<ClientOperatingProfile>;
  if (p.version !== 1 || !p.payMotion || !p.volumeUnit || !p.templateId) return null;
  return p as ClientOperatingProfile;
}
