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

export type BudgetCostShape = "variable" | "fixed" | "balanced";

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
  | "hybrid_primary";

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
  payModel: "products" | "services" | "subscription" | "mix";
  subtype: string;
  driverKind: BudgetDriverKind;
  costShape: BudgetCostShape;
  debtorDaysDefault: number;
  capexMode: BudgetCapexMode;
  confirmedAt: string;
};

export type BudgetDocument = {
  version: 1;
  qualification: BudgetQualification;
  templateId: BudgetTemplateId;
  /** FY start month 1–12 */
  fyStartMonth: number;
  /** First month of the FY this budget covers, YYYY-MM */
  fyStart: string;
  vatMode: BudgetVatMode;
  /** SA standard rate — editable (Phase 2). */
  vatRate: number;
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
