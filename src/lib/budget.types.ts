/**
 * Budget document types — living FY budget shared by owner + accountant.
 */

export type BudgetScenarioId = "base" | "upside" | "downside";

export type BudgetDriverKind =
  | "units_price"
  | "hours_rate"
  | "contracts_fee"
  | "subscribers_arpu"
  | "projects_fee";

export type BudgetCogsMode = "gp_pct" | "per_unit";

export type BudgetVatMode = "exclusive" | "inclusive";

export type BudgetCapexMode = "none" | "light" | "significant";

export type BudgetCostShape = "variable" | "fixed" | "balanced" | "payroll_heavy";

export type BudgetSeasonality = "flat" | "mild" | "strong";

export type BudgetInventoryProfile = "none" | "short_life" | "standard" | "wip_heavy";

/** How money mostly arrives — root of the qualifying funnel. */
export type BudgetPayMotion =
  | "goods"
  | "time_delivery"
  | "access_capacity"
  | "recurring_rights"
  | "take_rate"
  | "mix"
  | "funding";

/** The volume unit founders think in — maps to a driver kit. */
export type BudgetVolumeUnit =
  | "units_sku"
  | "wholesale_volume"
  | "production_output"
  | "fuel_litres"
  | "harvest_batch"
  | "shipment_lot"
  | "billable_hours"
  | "day_shift"
  | "jobs_ticket"
  | "patients_visits"
  | "projects_fee"
  | "loads_trips"
  | "sites_fee"
  | "rooms_adr"
  | "covers_spend"
  | "appointments_ticket"
  | "seats_course"
  | "events_booking"
  | "units_rent"
  | "posts_hours"
  | "subscribers_arpu"
  | "members_fee"
  | "contracts_mrr"
  | "policies_trail"
  | "gmv_take"
  | "deals_commission"
  | "media_spend_fee"
  | "grants_donations"
  | "hybrid_primary"
  | "construction_certified"
  | "telecom_subscribers"
  | "professional_hours";

export type BudgetTemplateId =
  | "retail_units"
  | "wholesale_units"
  | "manufacturing_units"
  | "services_hours"
  | "services_projects"
  | "retainer_contracts"
  | "saas_arpu"
  | "hospitality_covers"
  | "construction_contracts"
  | "hybrid_primary"
  | "fuel_forecourt"
  | "agri_seasonal"
  | "trade_shipment"
  | "field_jobs"
  | "healthcare_visits"
  | "logistics_trips"
  | "facilities_sites"
  | "security_posts"
  | "hospitality_rooms"
  | "membership_club"
  | "appointments_ticket"
  | "education_seats"
  | "events_bookings"
  | "property_rent"
  | "telecom_arpu"
  | "commission_trail"
  | "marketplace_take"
  | "agency_deals"
  | "media_agency"
  | "professional_wip"
  | "nonprofit_funding"
  | "day_labour";

/** Per-month volume × price (or fee) cell. */
export type BudgetMonthCell = {
  volume: number;
  price: number;
};

export type BudgetRevenueLine = {
  id: string;
  /** Stable slug used when remapping across templates */
  driverKey: string;
  name: string;
  kind: BudgetDriverKind;
  volumeLabel: string;
  priceLabel: string;
  months: Record<string, BudgetMonthCell>; // YYYY-MM
};

export type BudgetOverheadLine = {
  id: string;
  bucket: "people" | "premises" | "ops" | "sales" | "other";
  name: string;
  months: Record<string, number>;
};

export type BudgetCapexLine = {
  id: string;
  name: string;
  month: string; // YYYY-MM
  amount: number;
  funding: "cash" | "finance";
  /** Straight-line life in months (Phase 3). Default 36. */
  usefulLifeMonths?: number;
  /** Residual value for depreciation (default 0). */
  residual?: number;
};

export type BudgetWc = {
  debtorDays: number;
  creditorDays: number;
  inventoryDays: number;
};

export type BudgetScenarioPayload = {
  /** Multipliers applied to base driver volumes/prices (1 = unchanged) */
  volumeFactor: number;
  priceFactor: number;
  overheadFactor: number;
  /** Added to WC debtor days for this scenario (Phase 2/3 sensitivity). */
  debtorDaysDelta?: number;
  label: string;
};

export type BudgetQualification = {
  /** New funnel root */
  payMotion: BudgetPayMotion;
  /** Primary volume unit */
  volumeUnit: BudgetVolumeUnit;
  /** Optional ancillary streams (hotel F&B, forecourt shop, etc.) */
  secondaryVolumeUnits?: BudgetVolumeUnit[];
  /** @deprecated legacy funnel — kept for saved docs */
  payModel?: "products" | "services" | "subscription" | "mix";
  /** @deprecated legacy funnel */
  subtype?: string;
  driverKind: BudgetDriverKind;
  costShape: BudgetCostShape;
  debtorDaysDefault: number;
  capexMode: BudgetCapexMode;
  seasonality?: BudgetSeasonality;
  inventoryProfile?: BudgetInventoryProfile;
  confirmedAt: string;
};

import type { IndirectTaxProfile } from "@/lib/market/types";

export type BudgetDocument = {
  version: 1;
  qualification: BudgetQualification;
  templateId: BudgetTemplateId;
  /** FY start month 1–12 */
  fyStartMonth: number;
  /** First month of the FY this budget covers, YYYY-MM */
  fyStart: string;
  vatMode: BudgetVatMode;
  /** SA standard rate — editable (Phase 2). Also the US combined sales-tax rate when tax.regime is sales_tax. */
  vatRate: number;
  /**
   * Indirect tax engine. Missing on legacy ZA docs — treat as VAT at vatRate.
   * US sales tax does not reclaim input tax.
   */
  tax?: IndirectTaxProfile;
  /** Opening bank balance at FY start (Phase 2). */
  openingCash: number;
  activeScenario: BudgetScenarioId;
  scenarios: Record<BudgetScenarioId, BudgetScenarioPayload>;
  revenueLines: BudgetRevenueLine[];
  cogsMode: BudgetCogsMode;
  gpPct: number;
  /** Used when cogsMode === per_unit — keyed by revenue line id */
  cogsPerUnit: Record<string, number>;
  overheads: BudgetOverheadLine[];
  wc: BudgetWc;
  capex: BudgetCapexLine[];
  showInventoryDays: boolean;
  /** Participative challenge / note log (Phase 4). */
  notes?: Array<{
    id: string;
    at: string;
    by: string;
    text: string;
    kind: "note" | "challenge";
  }>;
  updatedAt: string;
};

export type BudgetMonthResult = {
  month: string;
  /** P&L revenue (ex-VAT when exclusive; stripped when inclusive) */
  revenue: number;
  cogs: number;
  grossProfit: number;
  gpPct: number;
  overheads: number;
  depreciation: number;
  ebitda: number;
  ebit: number;
  capexCash: number;
  inventoryBuild: number;
  vatNet: number;
  cashIn: number;
  cashOut: number;
  netCash: number;
  closingCash: number;
};

export type BudgetActuals = {
  label: string;
  revenue: number;
  cogs: number;
  fixedCosts: number;
};

export type UnmappedDriver = {
  id: string;
  driverKey: string;
  name: string;
  kind: BudgetDriverKind;
  months: Record<string, BudgetMonthCell>;
};

export const DEFAULT_VAT_RATE = 0.15;
