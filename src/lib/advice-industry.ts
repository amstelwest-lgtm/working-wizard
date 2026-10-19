/**
 * Industry label for advice context. Names and the stored template only.
 * Persona files stay untouched.
 */

const INDUSTRY_LABEL: Record<string, string> = {
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

const HOTEL_NAME = /\b(hotels?|lodges?|guesthouses?|b\s*&\s*b)\b/i;
const SERVICE_LABEL = /labour|staffing|professional services|project-based|retainer/i;

export function adviceIndustryLabel(input: {
  clientName?: string | null;
  templateId?: string | null;
  businessType?: string | null;
}): string {
  const name = (input.clientName ?? "").trim();
  if (HOTEL_NAME.test(name)) return "Hotels & accommodation";
  const templateId = (input.templateId ?? "").trim();
  const label = templateId ? INDUSTRY_LABEL[templateId] : "";
  const businessType = (input.businessType ?? "").trim().toLowerCase();
  if (label && businessType === "hospitality" && SERVICE_LABEL.test(label)) return "Hospitality";
  if (label) return label;
  if (businessType === "hospitality") return "Hospitality";
  return templateId;
}
