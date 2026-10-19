/**
 * One hospitality line list for the budget screen and the advice prompt.
 * Revenue is rooms and food. Housekeeping and rent are costs.
 * Kept free of profile-signals so the ask-ai edge can import it.
 */

export type HospitalityLineSection = "revenue" | "cost";

export type HospitalityDisplayLine = {
  name: string;
  section: HospitalityLineSection;
  detail: string;
  value: string;
};

export const HOSPITALITY_DISPLAY_LINES: readonly HospitalityDisplayLine[] = [
  { name: "Rooms", section: "revenue", detail: "Room-nights × ADR × Occupancy", value: "Occupancy —" },
  { name: "Food & beverage", section: "revenue", detail: "Food & beverage", value: "—" },
  { name: "Housekeeping and staff", section: "cost", detail: "Housekeeping and staff", value: "—" },
  { name: "Rent", section: "cost", detail: "Rent", value: "—" },
];

export function hospitalityLines(section?: HospitalityLineSection): HospitalityDisplayLine[] {
  if (!section) return [...HOSPITALITY_DISPLAY_LINES];
  return HOSPITALITY_DISPLAY_LINES.filter((line) => line.section === section);
}
