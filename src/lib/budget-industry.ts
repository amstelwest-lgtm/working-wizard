/**
 * Industry display for a budget that was stored under a different kit.
 * Kept out of budget.templates: that module is on the ask-ai edge graph via
 * client-profile, and profile-signals pulls the market barrel.
 */

import { hospitalityLines, type HospitalityDisplayLine } from "./hospitality-display.ts";
import { BUDGET_TEMPLATES } from "./budget.templates.ts";
import type { BudgetTemplateId } from "./budget.types.ts";
import { clientIndustryDisplay } from "./profile-signals.ts";

const INDUSTRY_BUDGET_TEMPLATE: Record<string, BudgetTemplateId> = {
  "Hotels & accommodation": "hospitality_rooms",
};

/**
 * The budget driver follows the client's industry when the stored template
 * names a different sector. A hotel kept on the labour kit shows room-nights,
 * not days and shifts.
 */
export function industryBudgetTemplate(
  businessName: string | null | undefined,
  profile: { templateId?: string | null; businessTypeId?: string | null } | null | undefined,
  businessType?: string | null,
): BudgetTemplateId | null {
  const industry = clientIndustryDisplay(businessName, profile, businessType ?? profile?.businessTypeId);
  return INDUSTRY_BUDGET_TEMPLATE[industry] ?? null;
}

const SERVICE_VOLUME = new Set(["Days / shifts", "Hours", "Jobs", "Volume"]);
const SERVICE_PRICE = new Set(["Day rate", "Avg rate", "Avg ticket", "Price"]);
const SERVICE_DRIVER = /day\s*\/\s*shift labour|billable work|jobs\s*\/\s*call-?outs/i;

export function budgetVolumeLabel(
  storedTemplate: BudgetTemplateId,
  displayTemplate: BudgetTemplateId,
  lineLabel: string | null | undefined,
): string {
  const storedSeed = BUDGET_TEMPLATES[storedTemplate]?.revenueSeeds[0]?.volumeLabel ?? "Volume";
  const displaySeed = BUDGET_TEMPLATES[displayTemplate]?.revenueSeeds[0]?.volumeLabel ?? storedSeed;
  if (displayTemplate === "hospitality_rooms" && (!lineLabel || lineLabel === storedSeed || SERVICE_VOLUME.has(lineLabel))) {
    return "Room-nights";
  }
  if (displayTemplate !== storedTemplate && (!lineLabel || lineLabel === storedSeed)) return displaySeed;
  return lineLabel || displaySeed;
}

export function budgetPriceLabel(
  storedTemplate: BudgetTemplateId,
  displayTemplate: BudgetTemplateId,
  lineLabel: string | null | undefined,
): string {
  const storedSeed = BUDGET_TEMPLATES[storedTemplate]?.revenueSeeds[0]?.priceLabel ?? "Price";
  const displaySeed = BUDGET_TEMPLATES[displayTemplate]?.revenueSeeds[0]?.priceLabel ?? storedSeed;
  if (displayTemplate === "hospitality_rooms" && (!lineLabel || lineLabel === storedSeed || SERVICE_PRICE.has(lineLabel))) {
    return "ADR";
  }
  if (displayTemplate !== storedTemplate && (!lineLabel || lineLabel === storedSeed)) return displaySeed;
  return lineLabel || displaySeed;
}

export function serviceDriverName(name: string | null | undefined): boolean {
  return SERVICE_DRIVER.test(name ?? "");
}

export type HotelTemplateRow = HospitalityDisplayLine;

/** Hotel drivers. Rooms and food are revenue. Housekeeping and rent are costs. */
export function hotelTemplateRows(displayTemplate: BudgetTemplateId | null | undefined): HotelTemplateRow[] | null {
  if (displayTemplate !== "hospitality_rooms") return null;
  return hospitalityLines();
}

/**
 * Room-nights, ADR and occupancy are on file only when the stored kit is the
 * hotel kit and the volume is not the statement seed (1 × monthly revenue).
 * A labour kit relabelled as rooms is not a hotel driver.
 */
export function hotelDriversOnFile(
  storedTemplate: BudgetTemplateId,
  displayTemplate: BudgetTemplateId | null | undefined,
  line: { months?: Record<string, { volume?: number; price?: number }> } | null | undefined,
): boolean {
  if (displayTemplate !== "hospitality_rooms") return true;
  if (storedTemplate !== "hospitality_rooms") return false;
  const cells = Object.values(line?.months ?? {});
  if (cells.length === 0) return false;
  return cells.some((cell) => {
    const volume = Number(cell.volume) || 0;
    return volume > 0 && Math.abs(volume - 1) > 0.001;
  });
}

export function hotelLineDisplayName(
  displayTemplate: BudgetTemplateId | null | undefined,
  name: string,
  index: number,
): string | null {
  if (displayTemplate !== "hospitality_rooms" || !serviceDriverName(name)) return name;
  if (index === 0) return "Rooms";
  return null;
}
