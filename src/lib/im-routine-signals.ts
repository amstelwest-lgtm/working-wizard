/**
 * IM routine schedule signals from existing book reads — no new tables.
 */
import { DEBTOR_DAYS_AGEING_THRESHOLD } from "@/lib/data-requests";
import { computedDaysAr } from "@/lib/deliverable-input-config";

export function imCashCollectionsRiskFromFinancials(financials: unknown): boolean {
  const row = financials && typeof financials === "object" && !Array.isArray(financials) ? financials : null;
  const debtorDays = computedDaysAr(row as Record<string, unknown> | null);
  if (debtorDays != null && Number.isFinite(debtorDays) && debtorDays > DEBTOR_DAYS_AGEING_THRESHOLD) {
    return true;
  }
  const ratios = row && typeof (row as Record<string, unknown>).ratios === "object"
    ? ((row as Record<string, unknown>).ratios as Record<string, unknown>)
    : null;
  const stored = ratios?.["Debtor Days"];
  if (typeof stored === "number" && Number.isFinite(stored) && stored > DEBTOR_DAYS_AGEING_THRESHOLD) {
    return true;
  }
  return false;
}