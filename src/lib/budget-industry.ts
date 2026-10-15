/**
 * Industry display for a budget that was stored under a different kit.
 * Kept out of budget.templates: that module is on the ask-ai edge graph via
 * client-profile, and profile-signals pulls the market barrel.
 */

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

export function budgetVolumeLabel(
  storedTemplate: BudgetTemplateId,
  displayTemplate: BudgetTemplateId,
  lineLabel: string | null | undefined,
): string {
  const storedSeed = BUDGET_TEMPLATES[storedTemplate]?.revenueSeeds[0]?.volumeLabel ?? "Volume";
  const displaySeed = BUDGET_TEMPLATES[displayTemplate]?.revenueSeeds[0]?.volumeLabel ?? storedSeed;
  if (displayTemplate !== storedTemplate && (!lineLabel || lineLabel === storedSeed)) return displaySeed;
  return lineLabel || displaySeed;
}
