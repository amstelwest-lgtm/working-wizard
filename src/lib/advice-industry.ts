/**
 * Industry label for advice context. Names and the stored template only.
 * Persona files stay untouched.
 */
import { hospitalityLines } from "./hospitality-display.ts";
import { BUDGET_TEMPLATES } from "./budget.templates.ts";

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

const GENERIC_PRODUCT = /^product\s*\d+$/i;

/** Revenue drivers only. Housekeeping and rent are costs, not products. */
const HOTEL_CHAT_LINES = hospitalityLines("revenue").map((line) =>
  line.name === "Rooms" ? "Rooms · Room-nights · ADR · Occupancy" : line.name,
);

function chatTemplateId(input: {
  clientName?: string | null;
  templateId?: string | null;
  businessType?: string | null;
}): string {
  const label = adviceIndustryLabel(input);
  if (label === "Hotels & accommodation") return "hospitality_rooms";
  const stored = (input.templateId ?? "").trim();
  return stored in BUDGET_TEMPLATES ? stored : "";
}

/**
 * Prompt data for the Financial Manager. A hotel kept on another kit still
 * names rooms, occupancy and ADR. Generic "product 2" lines take the template.
 */
export function adviceChatVolumeUnit(input: {
  clientName?: string | null;
  templateId?: string | null;
  businessType?: string | null;
  volumeUnit?: string | null;
}): string {
  if (chatTemplateId(input) === "hospitality_rooms") return "Room-nights × ADR × occupancy";
  return String(input.volumeUnit ?? "");
}

export function adviceChatProductName(input: {
  clientName?: string | null;
  templateId?: string | null;
  businessType?: string | null;
  index: number;
  name: string;
}): string {
  const stored = input.name.trim();
  if (!GENERIC_PRODUCT.test(stored)) return stored;
  const templateId = chatTemplateId(input);
  if (templateId === "hospitality_rooms") return HOTEL_CHAT_LINES[input.index] ?? stored;
  const seed = templateId ? BUDGET_TEMPLATES[templateId as keyof typeof BUDGET_TEMPLATES]?.revenueSeeds[input.index] : null;
  if (!seed) return stored;
  return [seed.name, seed.volumeLabel, seed.priceLabel].filter(Boolean).join(" · ");
}
