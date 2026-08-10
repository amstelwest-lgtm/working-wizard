/**
 * Budget templates — driver kits keyed by qualification path.
 */

import type {
  BudgetDriverKind,
  BudgetOverheadLine,
  BudgetPayMotion,
  BudgetTemplateId,
  BudgetVolumeUnit,
  BudgetWc,
} from "@/lib/budget.types";
import {
  migrateLegacyQualification,
  resolveKitFromPath,
} from "@/lib/budget.taxonomy";

export type TemplateDef = {
  id: BudgetTemplateId;
  label: string;
  description: string;
  driverKind: BudgetDriverKind;
  showInventoryDays: boolean;
  defaultGpPct: number;
  defaultWc: BudgetWc;
  defaultSeasonality?: "flat" | "mild" | "strong";
  revenueSeeds: Array<{
    driverKey: string;
    name: string;
    volumeLabel: string;
    priceLabel: string;
  }>;
};

function tpl(
  partial: TemplateDef,
): TemplateDef {
  return partial;
}

export const BUDGET_TEMPLATES: Record<BudgetTemplateId, TemplateDef> = {
  retail_units: tpl({
    id: "retail_units",
    label: "Retail / shopfront",
    description: "Units sold × selling price",
    driverKind: "units_price",
    showInventoryDays: true,
    defaultGpPct: 35,
    defaultWc: { debtorDays: 7, creditorDays: 30, inventoryDays: 45 },
    revenueSeeds: [
      { driverKey: "units_sold", name: "Core product sales", volumeLabel: "Units", priceLabel: "Avg selling price" },
      { driverKey: "avg_basket", name: "Add-on / basket uplift", volumeLabel: "Baskets", priceLabel: "Avg basket" },
    ],
  }),
  wholesale_units: tpl({
    id: "wholesale_units",
    label: "Wholesale / distribution",
    description: "Volume × wholesale price",
    driverKind: "units_price",
    showInventoryDays: true,
    defaultGpPct: 28,
    defaultWc: { debtorDays: 45, creditorDays: 30, inventoryDays: 40 },
    revenueSeeds: [
      { driverKey: "units_sold", name: "Wholesale lines", volumeLabel: "Units / cases", priceLabel: "Unit price" },
    ],
  }),
  manufacturing_units: tpl({
    id: "manufacturing_units",
    label: "Manufacturing",
    description: "Units produced/sold × price",
    driverKind: "units_price",
    showInventoryDays: true,
    defaultGpPct: 32,
    defaultWc: { debtorDays: 45, creditorDays: 35, inventoryDays: 60 },
    revenueSeeds: [
      { driverKey: "units_sold", name: "Finished goods", volumeLabel: "Units", priceLabel: "Selling price" },
    ],
  }),
  fuel_forecourt: tpl({
    id: "fuel_forecourt",
    label: "Fuel / forecourt",
    description: "Litres × pump margin (shop as optional second stream)",
    driverKind: "units_price",
    showInventoryDays: true,
    defaultGpPct: 8,
    defaultWc: { debtorDays: 2, creditorDays: 14, inventoryDays: 7 },
    revenueSeeds: [
      { driverKey: "litres_pumped", name: "Fuel", volumeLabel: "Litres", priceLabel: "Margin / litre (or pump price)" },
    ],
  }),
  agri_seasonal: tpl({
    id: "agri_seasonal",
    label: "Agriculture / farming",
    description: "Harvest or livestock volume × price",
    driverKind: "units_price",
    showInventoryDays: true,
    defaultGpPct: 30,
    defaultSeasonality: "strong",
    defaultWc: { debtorDays: 30, creditorDays: 30, inventoryDays: 90 },
    revenueSeeds: [
      { driverKey: "harvest_volume", name: "Harvest / livestock sales", volumeLabel: "Tonnes / heads", priceLabel: "Price" },
    ],
  }),
  trade_shipment: tpl({
    id: "trade_shipment",
    label: "Import / export trading",
    description: "Shipments × margin",
    driverKind: "units_price",
    showInventoryDays: true,
    defaultGpPct: 18,
    defaultWc: { debtorDays: 60, creditorDays: 45, inventoryDays: 45 },
    revenueSeeds: [
      { driverKey: "shipments", name: "Trading shipments", volumeLabel: "Shipments", priceLabel: "Avg margin / shipment" },
    ],
  }),
  services_hours: tpl({
    id: "services_hours",
    label: "Billable hours / T&M",
    description: "Hours × rate",
    driverKind: "hours_rate",
    showInventoryDays: false,
    defaultGpPct: 55,
    defaultWc: { debtorDays: 45, creditorDays: 20, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "billable_hours", name: "Billable work", volumeLabel: "Hours", priceLabel: "Avg rate" },
    ],
  }),
  day_labour: tpl({
    id: "day_labour",
    label: "Day-rate / shift labour",
    description: "Days or shifts × day rate",
    driverKind: "hours_rate",
    showInventoryDays: false,
    defaultGpPct: 35,
    defaultWc: { debtorDays: 30, creditorDays: 14, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "billable_days", name: "Day / shift labour", volumeLabel: "Days / shifts", priceLabel: "Day rate" },
    ],
  }),
  field_jobs: tpl({
    id: "field_jobs",
    label: "Field service / trades",
    description: "Jobs × average ticket",
    driverKind: "units_price",
    showInventoryDays: true,
    defaultGpPct: 45,
    defaultWc: { debtorDays: 21, creditorDays: 30, inventoryDays: 21 },
    revenueSeeds: [
      { driverKey: "jobs_completed", name: "Jobs / call-outs", volumeLabel: "Jobs", priceLabel: "Avg ticket" },
    ],
  }),
  healthcare_visits: tpl({
    id: "healthcare_visits",
    label: "Healthcare / clinics",
    description: "Patients or consults × fee",
    driverKind: "units_price",
    showInventoryDays: false,
    defaultGpPct: 60,
    defaultWc: { debtorDays: 60, creditorDays: 30, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "patient_visits", name: "Consults / patients", volumeLabel: "Visits", priceLabel: "Avg fee" },
    ],
  }),
  services_projects: tpl({
    id: "services_projects",
    label: "Fixed-price projects",
    description: "Projects × average fee recognised",
    driverKind: "projects_fee",
    showInventoryDays: false,
    defaultGpPct: 40,
    defaultWc: { debtorDays: 30, creditorDays: 20, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "active_projects", name: "Project delivery", volumeLabel: "Projects (equiv.)", priceLabel: "Avg fee recognised" },
    ],
  }),
  construction_contracts: tpl({
    id: "construction_contracts",
    label: "Construction / contracting",
    description: "Active contracts × monthly certified",
    driverKind: "contracts_fee",
    showInventoryDays: false,
    defaultGpPct: 22,
    defaultWc: { debtorDays: 45, creditorDays: 30, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "active_contracts", name: "Contract certifications", volumeLabel: "Active contracts", priceLabel: "Monthly certified" },
    ],
  }),
  logistics_trips: tpl({
    id: "logistics_trips",
    label: "Transport / logistics",
    description: "Trips or loads × rate",
    driverKind: "units_price",
    showInventoryDays: false,
    defaultGpPct: 25,
    defaultWc: { debtorDays: 30, creditorDays: 21, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "trips_loads", name: "Trips / loads", volumeLabel: "Trips / loads", priceLabel: "Avg rate" },
    ],
  }),
  facilities_sites: tpl({
    id: "facilities_sites",
    label: "Cleaning / facilities",
    description: "Sites × monthly fee",
    driverKind: "contracts_fee",
    showInventoryDays: false,
    defaultGpPct: 35,
    defaultWc: { debtorDays: 30, creditorDays: 21, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "active_sites", name: "Contracted sites", volumeLabel: "Sites", priceLabel: "Monthly fee" },
    ],
  }),
  security_posts: tpl({
    id: "security_posts",
    label: "Security / guarding",
    description: "Posts × hours × rate (enter post-hours as volume)",
    driverKind: "hours_rate",
    showInventoryDays: false,
    defaultGpPct: 28,
    defaultWc: { debtorDays: 45, creditorDays: 14, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "post_hours", name: "Guard post-hours", volumeLabel: "Post-hours", priceLabel: "Hourly rate" },
    ],
  }),
  professional_wip: tpl({
    id: "professional_wip",
    label: "Professional practice (WIP)",
    description: "Billable hours × rate — slower collections / WIP aware",
    driverKind: "hours_rate",
    showInventoryDays: false,
    defaultGpPct: 55,
    defaultWc: { debtorDays: 60, creditorDays: 21, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "billable_hours", name: "Billable hours", volumeLabel: "Hours", priceLabel: "Avg rate" },
    ],
  }),
  retainer_contracts: tpl({
    id: "retainer_contracts",
    label: "Retainers / contracts",
    description: "Contract count × monthly fee",
    driverKind: "contracts_fee",
    showInventoryDays: false,
    defaultGpPct: 50,
    defaultWc: { debtorDays: 30, creditorDays: 20, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "active_contracts", name: "Retainer clients", volumeLabel: "Contracts", priceLabel: "Monthly fee" },
    ],
  }),
  saas_arpu: tpl({
    id: "saas_arpu",
    label: "SaaS / subscription",
    description: "Subscribers × ARPU",
    driverKind: "subscribers_arpu",
    showInventoryDays: false,
    defaultGpPct: 70,
    defaultWc: { debtorDays: 15, creditorDays: 20, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "subscribers", name: "Subscriptions", volumeLabel: "Subscribers", priceLabel: "ARPU" },
    ],
  }),
  telecom_arpu: tpl({
    id: "telecom_arpu",
    label: "Fibre / ISP / connectivity",
    description: "Subscribers × ARPU (install-heavy cash)",
    driverKind: "subscribers_arpu",
    showInventoryDays: false,
    defaultGpPct: 55,
    defaultWc: { debtorDays: 21, creditorDays: 30, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "subscribers", name: "Connectivity subscribers", volumeLabel: "Subscribers", priceLabel: "ARPU" },
    ],
  }),
  membership_club: tpl({
    id: "membership_club",
    label: "Gym / membership club",
    description: "Members × membership fee",
    driverKind: "subscribers_arpu",
    showInventoryDays: false,
    defaultGpPct: 65,
    defaultWc: { debtorDays: 7, creditorDays: 21, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "members", name: "Memberships", volumeLabel: "Members", priceLabel: "Monthly fee" },
    ],
  }),
  hospitality_rooms: tpl({
    id: "hospitality_rooms",
    label: "Hotels / accommodation",
    description: "Room-nights × ADR",
    driverKind: "units_price",
    showInventoryDays: true,
    defaultGpPct: 70,
    defaultSeasonality: "strong",
    defaultWc: { debtorDays: 7, creditorDays: 21, inventoryDays: 10 },
    revenueSeeds: [
      { driverKey: "room_nights", name: "Rooms", volumeLabel: "Room-nights", priceLabel: "ADR" },
    ],
  }),
  hospitality_covers: tpl({
    id: "hospitality_covers",
    label: "Restaurant / F&B",
    description: "Covers × average spend",
    driverKind: "units_price",
    showInventoryDays: true,
    defaultGpPct: 65,
    defaultSeasonality: "mild",
    defaultWc: { debtorDays: 3, creditorDays: 21, inventoryDays: 14 },
    revenueSeeds: [
      { driverKey: "covers", name: "Food & beverage", volumeLabel: "Covers", priceLabel: "Avg spend" },
    ],
  }),
  appointments_ticket: tpl({
    id: "appointments_ticket",
    label: "Salon / appointments",
    description: "Appointments × average ticket",
    driverKind: "units_price",
    showInventoryDays: true,
    defaultGpPct: 55,
    defaultWc: { debtorDays: 0, creditorDays: 21, inventoryDays: 21 },
    revenueSeeds: [
      { driverKey: "appointments", name: "Appointments", volumeLabel: "Bookings", priceLabel: "Avg ticket" },
    ],
  }),
  education_seats: tpl({
    id: "education_seats",
    label: "Education / training",
    description: "Seats or learners × fee",
    driverKind: "units_price",
    showInventoryDays: false,
    defaultGpPct: 55,
    defaultSeasonality: "strong",
    defaultWc: { debtorDays: 15, creditorDays: 21, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "seats_learners", name: "Course / term fees", volumeLabel: "Seats / learners", priceLabel: "Fee" },
    ],
  }),
  events_bookings: tpl({
    id: "events_bookings",
    label: "Events / venues",
    description: "Events × average booking value",
    driverKind: "projects_fee",
    showInventoryDays: false,
    defaultGpPct: 45,
    defaultSeasonality: "strong",
    defaultWc: { debtorDays: 14, creditorDays: 21, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "events_booked", name: "Event bookings", volumeLabel: "Events", priceLabel: "Avg booking value" },
    ],
  }),
  property_rent: tpl({
    id: "property_rent",
    label: "Property / rentals",
    description: "Units let × rent",
    driverKind: "contracts_fee",
    showInventoryDays: false,
    defaultGpPct: 75,
    defaultWc: { debtorDays: 7, creditorDays: 14, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "units_let", name: "Rental units", volumeLabel: "Units let", priceLabel: "Monthly rent" },
    ],
  }),
  commission_trail: tpl({
    id: "commission_trail",
    label: "Broker / trail commission",
    description: "Policies or book × commission",
    driverKind: "contracts_fee",
    showInventoryDays: false,
    defaultGpPct: 80,
    defaultWc: { debtorDays: 45, creditorDays: 14, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "policies_book", name: "Trail / commission book", volumeLabel: "Policies (equiv.)", priceLabel: "Avg commission" },
    ],
  }),
  marketplace_take: tpl({
    id: "marketplace_take",
    label: "Marketplace take-rate",
    description: "GMV × take rate (enter take as decimal price, e.g. 0.12)",
    driverKind: "units_price",
    showInventoryDays: false,
    defaultGpPct: 85,
    defaultWc: { debtorDays: 14, creditorDays: 21, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "gmv_take", name: "Platform take", volumeLabel: "GMV", priceLabel: "Take rate (e.g. 0.12)" },
    ],
  }),
  agency_deals: tpl({
    id: "agency_deals",
    label: "Agency / deal commission",
    description: "Deals × average commission",
    driverKind: "projects_fee",
    showInventoryDays: false,
    defaultGpPct: 70,
    defaultWc: { debtorDays: 30, creditorDays: 14, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "deals_closed", name: "Deals closed", volumeLabel: "Deals", priceLabel: "Avg commission" },
    ],
  }),
  media_agency: tpl({
    id: "media_agency",
    label: "Media / campaign agency",
    description: "Campaigns × fee (or % of spend)",
    driverKind: "projects_fee",
    showInventoryDays: false,
    defaultGpPct: 40,
    defaultWc: { debtorDays: 45, creditorDays: 30, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "campaigns", name: "Campaign fees", volumeLabel: "Campaigns", priceLabel: "Avg fee" },
    ],
  }),
  nonprofit_funding: tpl({
    id: "nonprofit_funding",
    label: "NPO / grant funding",
    description: "Grants, donations, and programme fees recognised",
    driverKind: "projects_fee",
    showInventoryDays: false,
    defaultGpPct: 90,
    defaultWc: { debtorDays: 30, creditorDays: 21, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "funding_inflows", name: "Grants & donations", volumeLabel: "Awards / inflows", priceLabel: "Avg recognised" },
      { driverKey: "programme_fees", name: "Programme / fee income", volumeLabel: "Programmes", priceLabel: "Fee" },
    ],
  }),
  hybrid_primary: tpl({
    id: "hybrid_primary",
    label: "Hybrid (primary stream)",
    description: "Primary volume × price with room for a second stream",
    driverKind: "units_price",
    showInventoryDays: true,
    defaultGpPct: 40,
    defaultWc: { debtorDays: 30, creditorDays: 30, inventoryDays: 30 },
    revenueSeeds: [
      { driverKey: "units_sold", name: "Primary revenue", volumeLabel: "Volume", priceLabel: "Price / fee" },
      { driverKey: "secondary_stream", name: "Secondary stream", volumeLabel: "Volume", priceLabel: "Price / fee" },
    ],
  }),
};

export const OVERHEAD_BUCKETS: Array<{ bucket: BudgetOverheadLine["bucket"]; name: string }> = [
  { bucket: "people", name: "People / salaries" },
  { bucket: "premises", name: "Premises / rent" },
  { bucket: "ops", name: "Ops / admin" },
  { bucket: "sales", name: "Sales & marketing" },
  { bucket: "other", name: "Other fixed" },
];

export function newId(prefix = "b"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

/** Resolve template from new funnel path. */
export function resolveTemplateId(input: {
  payMotion?: BudgetPayMotion | string;
  volumeUnit?: BudgetVolumeUnit | string;
  templateHint?: BudgetTemplateId;
  /** @deprecated legacy */
  payModel?: string;
  /** @deprecated legacy */
  subtype?: string;
}): BudgetTemplateId {
  if (input.templateHint && input.templateHint in BUDGET_TEMPLATES) {
    return input.templateHint;
  }
  if (input.payMotion && input.volumeUnit) {
    return resolveKitFromPath({
      payMotion: input.payMotion as BudgetPayMotion,
      volumeUnit: input.volumeUnit as BudgetVolumeUnit,
      templateHint: input.templateHint,
    });
  }
  return migrateLegacyQualification({
    payModel: input.payModel,
    subtype: input.subtype,
  }).templateId;
}

/** Seeds for secondary volume units (deduped by driverKey). */
export function seedsForSecondary(volumeUnit: BudgetVolumeUnit): TemplateDef["revenueSeeds"] {
  const id = resolveKitFromPath({
    payMotion: "mix",
    volumeUnit,
  });
  const tplDef = BUDGET_TEMPLATES[id];
  return tplDef.revenueSeeds.map((s) => ({
    ...s,
    driverKey: `sec_${s.driverKey}`,
    name: `${s.name} (secondary)`,
  }));
}
