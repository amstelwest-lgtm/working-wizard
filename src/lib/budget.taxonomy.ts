/**
 * Budget qualifying taxonomy — pay motion → volume unit → template kit.
 * Funnel UI copies live here so owners see concrete business examples.
 */

import type {
  BudgetDriverKind,
  BudgetPayMotion,
  BudgetTemplateId,
  BudgetVolumeUnit,
} from "@/lib/budget.types";

export type FunnelOption<T extends string> = {
  id: T;
  label: string;
  /** Short plain-English hint */
  hint: string;
  /** Concrete business examples so founders self-classify correctly */
  examples: string;
};

export const PAY_MOTION_OPTIONS: FunnelOption<BudgetPayMotion>[] = [
  {
    id: "goods",
    label: "We sell physical goods",
    hint: "Stock, materials, or finished products change hands",
    examples: "Shops, wholesalers, factories, bakeries, fuel stations, farms, importers",
  },
  {
    id: "time_delivery",
    label: "We sell time, jobs, or delivered work",
    hint: "People deliver an outcome — hours, tickets, projects, trips, or visits",
    examples: "Consultants, trades, clinics, couriers, cleaners, construction, lawyers",
  },
  {
    id: "access_capacity",
    label: "We sell access to space, seats, or capacity",
    hint: "Customers pay to use rooms, tables, chairs, venues, or rental units",
    examples: "Hotels, restaurants, gyms/salons (walk-in), venues, training, property rentals",
  },
  {
    id: "recurring_rights",
    label: "Customers pay a recurring fee for ongoing access",
    hint: "Subscription, membership, retainer, or contracted monthly service",
    examples: "SaaS, gym memberships, retainers, fibre/ISP, managed security contracts",
  },
  {
    id: "take_rate",
    label: "We earn a cut / commission on deals or flow",
    hint: "Revenue is a % or fee on someone else’s transaction",
    examples: "Marketplaces, estate agents, brokers/IFAs, media agencies on spend",
  },
  {
    id: "mix",
    label: "Material mix of the above",
    hint: "Two or more real revenue engines (we’ll set a primary + secondary)",
    examples: "Dealership + workshop, hotel + restaurant, forecourt + shop, agency + retainers",
  },
  {
    id: "funding",
    label: "We are funded mainly by grants, donations, or programmes",
    hint: "Not a classic sell motion — common for NPOs and community orgs",
    examples: "NPOs, churches, foundations, grant-funded programmes",
  },
];

export type VolumeUnitOption = FunnelOption<BudgetVolumeUnit> & {
  payMotions: BudgetPayMotion[];
  templateId: BudgetTemplateId;
  driverKind: BudgetDriverKind;
  /** Suggest asking seasonality on confirm */
  suggestSeasonality?: boolean;
};

export const VOLUME_UNIT_OPTIONS: VolumeUnitOption[] = [
  // goods
  {
    id: "units_sku",
    label: "Units / items sold × average selling price",
    hint: "Classic retail or DTC product sales",
    examples: "Clothing shop, hardware, online store, convenience shop (non-fuel)",
    payMotions: ["goods", "mix"],
    templateId: "retail_units",
    driverKind: "units_price",
  },
  {
    id: "wholesale_volume",
    label: "Wholesale volume × unit/case price",
    hint: "You sell to other businesses, not end consumers",
    examples: "Distributors, cash-and-carry, B2B product suppliers",
    payMotions: ["goods", "mix"],
    templateId: "wholesale_units",
    driverKind: "units_price",
  },
  {
    id: "production_output",
    label: "Units produced / sold × selling price",
    hint: "You make what you sell (or make-to-order)",
    examples: "Manufacturing, food production, ghost kitchens selling wholesale",
    payMotions: ["goods", "mix"],
    templateId: "manufacturing_units",
    driverKind: "units_price",
  },
  {
    id: "fuel_litres",
    label: "Litres pumped × margin / pump price",
    hint: "Fuel is the core; shop is usually a second stream",
    examples: "Petrol / diesel forecourts",
    payMotions: ["goods", "mix"],
    templateId: "fuel_forecourt",
    driverKind: "units_price",
  },
  {
    id: "harvest_batch",
    label: "Harvest / livestock volume × price",
    hint: "Biological / seasonal production cycles",
    examples: "Crop farming, livestock, horticulture",
    payMotions: ["goods", "mix"],
    templateId: "agri_seasonal",
    driverKind: "units_price",
    suggestSeasonality: true,
  },
  {
    id: "shipment_lot",
    label: "Shipments / consignments × margin",
    hint: "Trading lots with FX, LCs, and long payment chains",
    examples: "Import/export houses, commodity traders",
    payMotions: ["goods", "mix"],
    templateId: "trade_shipment",
    driverKind: "units_price",
  },
  // time_delivery
  {
    id: "billable_hours",
    label: "Billable hours × average rate",
    hint: "Time & materials — clocks drive revenue",
    examples: "Consultancies, IT T&M, some legal/accounting work",
    payMotions: ["time_delivery", "mix"],
    templateId: "services_hours",
    driverKind: "hours_rate",
  },
  {
    id: "day_shift",
    label: "Days or shifts × day rate",
    hint: "Crew or labour sold by the day/shift",
    examples: "Labour hire, some industrial contractors, shift staffing",
    payMotions: ["time_delivery", "mix"],
    templateId: "day_labour",
    driverKind: "hours_rate",
  },
  {
    id: "jobs_ticket",
    label: "Jobs / call-outs × average ticket",
    hint: "Each completed job is the unit — not pure hours",
    examples: "Plumbers, HVAC, electricians, auto workshops (labour)",
    payMotions: ["time_delivery", "mix"],
    templateId: "field_jobs",
    driverKind: "units_price",
  },
  {
    id: "patients_visits",
    label: "Patients / consults × average fee",
    hint: "Visit-based clinical revenue (often slow medical-aid pay)",
    examples: "GP practices, dental, physio, specialist rooms",
    payMotions: ["time_delivery", "mix"],
    templateId: "healthcare_visits",
    driverKind: "units_price",
  },
  {
    id: "projects_fee",
    label: "Projects × fee recognised each month",
    hint: "Fixed-price or milestone delivery",
    examples: "Build projects, fixed-fee IT, design agencies, construction certifications",
    payMotions: ["time_delivery", "mix"],
    templateId: "services_projects",
    driverKind: "projects_fee",
  },
  {
    id: "loads_trips",
    label: "Trips / loads / km × rate",
    hint: "Movement is the product",
    examples: "Courier, trucking, last-mile logistics",
    payMotions: ["time_delivery", "mix"],
    templateId: "logistics_trips",
    driverKind: "units_price",
  },
  {
    id: "sites_fee",
    label: "Sites / locations × monthly fee",
    hint: "Recurring site coverage sold as delivery",
    examples: "Contract cleaning, facilities management, garden services",
    payMotions: ["time_delivery", "mix"],
    templateId: "facilities_sites",
    driverKind: "contracts_fee",
  },
  // access_capacity
  {
    id: "rooms_adr",
    label: "Room-nights × average daily rate (ADR)",
    hint: "Occupied rooms drive the core — F&B is often secondary",
    examples: "Hotels, guesthouses, lodges, B&Bs",
    payMotions: ["access_capacity", "mix"],
    templateId: "hospitality_rooms",
    driverKind: "units_price",
    suggestSeasonality: true,
  },
  {
    id: "covers_spend",
    label: "Covers / guests × average spend",
    hint: "Food & beverage covers, not rooms",
    examples: "Restaurants, cafés, bars, hotel F&B",
    payMotions: ["access_capacity", "mix"],
    templateId: "hospitality_covers",
    driverKind: "units_price",
    suggestSeasonality: true,
  },
  {
    id: "appointments_ticket",
    label: "Appointments / bookings × average ticket",
    hint: "Diary-driven personal services",
    examples: "Salons, barbers, spas, beauty studios",
    payMotions: ["access_capacity", "mix"],
    templateId: "appointments_ticket",
    driverKind: "units_price",
  },
  {
    id: "seats_course",
    label: "Seats / learners × course or term fee",
    hint: "Education capacity sold in cohorts or terms",
    examples: "Training providers, colleges, tutoring centres",
    payMotions: ["access_capacity", "mix"],
    templateId: "education_seats",
    driverKind: "units_price",
    suggestSeasonality: true,
  },
  {
    id: "events_booking",
    label: "Events × average booking value",
    hint: "Venue or event packages — deposits and long lead times",
    examples: "Wedding venues, conference centres, event companies",
    payMotions: ["access_capacity", "mix"],
    templateId: "events_bookings",
    driverKind: "projects_fee",
    suggestSeasonality: true,
  },
  {
    id: "units_rent",
    label: "Units let × rent",
    hint: "Rental income from space or assets on lease",
    examples: "Residential/commercial landlords, self-storage, equipment rental fleets",
    payMotions: ["access_capacity", "mix"],
    templateId: "property_rent",
    driverKind: "contracts_fee",
  },
  {
    id: "posts_hours",
    label: "Guard posts × hours × rate",
    hint: "Security capacity deployed as posts/hours",
    examples: "Guarding companies, site security contractors",
    payMotions: ["access_capacity", "time_delivery", "mix"],
    templateId: "security_posts",
    driverKind: "hours_rate",
  },
  // recurring_rights
  {
    id: "subscribers_arpu",
    label: "Subscribers × ARPU (avg revenue per user)",
    hint: "Software or connectivity seats billed recurring",
    examples: "SaaS products, fibre/ISP, software seats",
    payMotions: ["recurring_rights", "mix"],
    templateId: "saas_arpu",
    driverKind: "subscribers_arpu",
  },
  {
    id: "members_fee",
    label: "Members × membership fee",
    hint: "Club/gym-style membership base",
    examples: "Gyms, studios with membership, clubs",
    payMotions: ["recurring_rights", "mix"],
    templateId: "membership_club",
    driverKind: "subscribers_arpu",
  },
  {
    id: "contracts_mrr",
    label: "Active contracts × monthly fee",
    hint: "Retainers and managed outcomes billed monthly",
    examples: "Professional retainers, managed IT, contracted security SLAs",
    payMotions: ["recurring_rights", "mix"],
    templateId: "retainer_contracts",
    driverKind: "contracts_fee",
  },
  {
    id: "policies_trail",
    label: "Policies / book × commission or trail",
    hint: "Ongoing commission on a book of business",
    examples: "Insurance brokers, IFAs with trail income",
    payMotions: ["recurring_rights", "take_rate", "mix"],
    templateId: "commission_trail",
    driverKind: "contracts_fee",
  },
  // take_rate
  {
    id: "gmv_take",
    label: "GMV (gross merchandise value) × take rate %",
    hint: "Platform cut of transaction flow — enter take as “price” (e.g. 0.12 for 12%)",
    examples: "Marketplaces, booking platforms, payment/commerce platforms",
    payMotions: ["take_rate", "mix"],
    templateId: "marketplace_take",
    driverKind: "units_price",
  },
  {
    id: "deals_commission",
    label: "Deals closed × average commission",
    hint: "Lumpy, deal-led agency income",
    examples: "Estate agencies, deal brokers, some franchise resales",
    payMotions: ["take_rate", "mix"],
    templateId: "agency_deals",
    driverKind: "projects_fee",
  },
  {
    id: "media_spend_fee",
    label: "Campaigns / spend × fee or %",
    hint: "Agency fee on media or campaign delivery",
    examples: "Media agencies, performance marketing shops",
    payMotions: ["take_rate", "mix"],
    templateId: "media_agency",
    driverKind: "projects_fee",
  },
  // funding
  {
    id: "grants_donations",
    label: "Grants / donations / programme fees recognised",
    hint: "Funding inflows treated as the revenue driver",
    examples: "NPOs, churches, foundations, grant programmes",
    payMotions: ["funding", "mix"],
    templateId: "nonprofit_funding",
    driverKind: "projects_fee",
  },
  // mix fallback
  {
    id: "hybrid_primary",
    label: "Primary volume × price (we’ll add a second line)",
    hint: "Use when nothing above is a clean fit",
    examples: "Unusual hybrids — you’ll name both streams next",
    payMotions: ["mix"],
    templateId: "hybrid_primary",
    driverKind: "units_price",
  },
  {
    id: "construction_certified",
    label: "Construction certifications × monthly certified value",
    hint: "Progress billing on active site contracts",
    examples: "Building contractors, civils, specialist trade contractors on site",
    payMotions: ["time_delivery", "mix"],
    templateId: "construction_contracts",
    driverKind: "projects_fee",
  },
  {
    id: "telecom_subscribers",
    label: "Connectivity subscribers × ARPU (install-heavy)",
    hint: "Like SaaS ARPU but with heavier install / network capex",
    examples: "Fibre ISPs, WISP, reseller connectivity",
    payMotions: ["recurring_rights", "mix"],
    templateId: "telecom_arpu",
    driverKind: "subscribers_arpu",
  },
  {
    id: "professional_hours",
    label: "Professional hours × rate (WIP / slower collections)",
    hint: "Hours billed with WIP and trust money in mind",
    examples: "Law firms, accounting practices, audit firms",
    payMotions: ["time_delivery", "mix"],
    templateId: "professional_wip",
    driverKind: "hours_rate",
  },
];

/** @deprecated kept as aliases — prefer VOLUME_UNIT_OPTIONS entries above */
export const CONSTRUCTION_VOLUME = VOLUME_UNIT_OPTIONS.find(
  (o) => o.id === "construction_certified",
)!;
export const TELECOM_VOLUME = VOLUME_UNIT_OPTIONS.find((o) => o.id === "telecom_subscribers")!;
export const PROFESSIONAL_WIP_VOLUME = VOLUME_UNIT_OPTIONS.find(
  (o) => o.id === "professional_hours",
)!;

/** Options shown for a pay motion. */
export function volumeOptionsForMotion(motion: BudgetPayMotion): VolumeUnitOption[] {
  return VOLUME_UNIT_OPTIONS.filter((o) => o.payMotions.includes(motion));
}

export function findVolumeOption(
  volumeUnit: BudgetVolumeUnit,
  templateId?: BudgetTemplateId,
): VolumeUnitOption | undefined {
  if (templateId) {
    const byTpl = VOLUME_UNIT_OPTIONS.find((o) => o.templateId === templateId);
    if (byTpl) return byTpl;
  }
  return VOLUME_UNIT_OPTIONS.find((o) => o.id === volumeUnit);
}

export function resolveKitFromPath(input: {
  payMotion: BudgetPayMotion;
  volumeUnit: BudgetVolumeUnit;
  templateHint?: BudgetTemplateId;
}): BudgetTemplateId {
  if (input.templateHint) {
    const known = VOLUME_UNIT_OPTIONS.some((o) => o.templateId === input.templateHint);
    if (known) return input.templateHint;
  }
  const hit = VOLUME_UNIT_OPTIONS.find((o) => o.id === input.volumeUnit);
  return hit?.templateId ?? "hybrid_primary";
}

/** Migrate legacy payModel + subtype → new path. */
export function migrateLegacyQualification(input: {
  payModel?: string;
  subtype?: string;
}): { payMotion: BudgetPayMotion; volumeUnit: BudgetVolumeUnit; templateId: BudgetTemplateId } {
  const { payModel, subtype } = input;
  if (payModel === "products") {
    if (subtype === "wholesale")
      return { payMotion: "goods", volumeUnit: "wholesale_volume", templateId: "wholesale_units" };
    if (subtype === "manufacturing")
      return { payMotion: "goods", volumeUnit: "production_output", templateId: "manufacturing_units" };
    return { payMotion: "goods", volumeUnit: "units_sku", templateId: "retail_units" };
  }
  if (payModel === "services") {
    if (subtype === "projects")
      return { payMotion: "time_delivery", volumeUnit: "projects_fee", templateId: "services_projects" };
    if (subtype === "retainers")
      return { payMotion: "recurring_rights", volumeUnit: "contracts_mrr", templateId: "retainer_contracts" };
    if (subtype === "day_rate")
      return { payMotion: "time_delivery", volumeUnit: "day_shift", templateId: "day_labour" };
    return { payMotion: "time_delivery", volumeUnit: "billable_hours", templateId: "services_hours" };
  }
  if (payModel === "subscription") {
    if (subtype === "professional_retainer" || subtype === "managed")
      return { payMotion: "recurring_rights", volumeUnit: "contracts_mrr", templateId: "retainer_contracts" };
    return { payMotion: "recurring_rights", volumeUnit: "subscribers_arpu", templateId: "saas_arpu" };
  }
  if (payModel === "mix")
    return { payMotion: "mix", volumeUnit: "hybrid_primary", templateId: "hybrid_primary" };
  if (subtype === "hospitality")
    return { payMotion: "access_capacity", volumeUnit: "covers_spend", templateId: "hospitality_covers" };
  if (subtype === "construction")
    return {
      payMotion: "time_delivery",
      volumeUnit: "construction_certified",
      templateId: "construction_contracts",
    };
  return { payMotion: "mix", volumeUnit: "hybrid_primary", templateId: "hybrid_primary" };
}

/** Suggested secondary streams for common primary kits. */
export const SUGGESTED_SECONDARIES: Partial<Record<BudgetTemplateId, BudgetVolumeUnit[]>> = {
  hospitality_rooms: ["covers_spend"],
  fuel_forecourt: ["units_sku"],
  appointments_ticket: ["units_sku"],
  membership_club: ["appointments_ticket"],
  field_jobs: ["units_sku"],
  hybrid_primary: ["units_sku", "billable_hours", "contracts_mrr", "subscribers_arpu"],
};
