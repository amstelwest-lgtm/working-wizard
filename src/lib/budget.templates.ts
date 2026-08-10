/**
 * Budget templates — driver kits keyed by qualification path.
 */

import type {
  BudgetDriverKind,
  BudgetRevenueLine,
  BudgetTemplateId,
  BudgetOverheadLine,
  BudgetWc,
} from "@/lib/budget.types";

export type TemplateDef = {
  id: BudgetTemplateId;
  label: string;
  description: string;
  driverKind: BudgetDriverKind;
  showInventoryDays: boolean;
  defaultGpPct: number;
  defaultWc: BudgetWc;
  revenueSeeds: Array<{
    driverKey: string;
    name: string;
    volumeLabel: string;
    priceLabel: string;
  }>;
};

export const BUDGET_TEMPLATES: Record<BudgetTemplateId, TemplateDef> = {
  retail_units: {
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
  },
  wholesale_units: {
    id: "wholesale_units",
    label: "Wholesale / distribution",
    description: "Volume × wholesale price",
    driverKind: "units_price",
    showInventoryDays: true,
    defaultGpPct: 28,
    defaultWc: { debtorDays: 45, creditorDays: 30, inventoryDays: 40 },
    revenueSeeds: [
      { driverKey: "units_sold", name: "Wholesale lines", volumeLabel: "Units", priceLabel: "Unit price" },
    ],
  },
  manufacturing_units: {
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
  },
  services_hours: {
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
  },
  services_projects: {
    id: "services_projects",
    label: "Fixed-price projects",
    description: "Projects × average fee",
    driverKind: "projects_fee",
    showInventoryDays: false,
    defaultGpPct: 40,
    defaultWc: { debtorDays: 30, creditorDays: 20, inventoryDays: 0 },
    revenueSeeds: [
      { driverKey: "active_projects", name: "Project delivery", volumeLabel: "Projects (equiv.)", priceLabel: "Avg fee recognised" },
    ],
  },
  retainer_contracts: {
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
  },
  saas_arpu: {
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
  },
  hospitality_covers: {
    id: "hospitality_covers",
    label: "Hospitality",
    description: "Covers × average spend",
    driverKind: "units_price",
    showInventoryDays: true,
    defaultGpPct: 65,
    defaultWc: { debtorDays: 3, creditorDays: 21, inventoryDays: 14 },
    revenueSeeds: [
      { driverKey: "covers", name: "Food & beverage", volumeLabel: "Covers", priceLabel: "Avg spend" },
    ],
  },
  construction_contracts: {
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
  },
  hybrid_primary: {
    id: "hybrid_primary",
    label: "Hybrid (primary stream)",
    description: "Primary volume × price with room for a second stream later",
    driverKind: "units_price",
    showInventoryDays: true,
    defaultGpPct: 40,
    defaultWc: { debtorDays: 30, creditorDays: 30, inventoryDays: 30 },
    revenueSeeds: [
      { driverKey: "units_sold", name: "Primary revenue", volumeLabel: "Volume", priceLabel: "Price / fee" },
      { driverKey: "secondary_stream", name: "Secondary stream", volumeLabel: "Volume", priceLabel: "Price / fee" },
    ],
  },
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

/** Map qualification answers → template id */
export function resolveTemplateId(input: {
  payModel: string;
  subtype: string;
}): BudgetTemplateId {
  const { payModel, subtype } = input;
  if (payModel === "products") {
    if (subtype === "retail") return "retail_units";
    if (subtype === "wholesale") return "wholesale_units";
    if (subtype === "manufacturing") return "manufacturing_units";
    if (subtype === "online") return "retail_units";
  }
  if (payModel === "services") {
    if (subtype === "hours") return "services_hours";
    if (subtype === "projects") return "services_projects";
    if (subtype === "retainers") return "retainer_contracts";
    if (subtype === "day_rate") return "services_hours";
  }
  if (payModel === "subscription") {
    if (subtype === "saas") return "saas_arpu";
    if (subtype === "membership") return "saas_arpu";
    if (subtype === "professional_retainer") return "retainer_contracts";
    if (subtype === "managed") return "retainer_contracts";
  }
  if (payModel === "mix") return "hybrid_primary";
  if (subtype === "hospitality") return "hospitality_covers";
  if (subtype === "construction") return "construction_contracts";
  return "hybrid_primary";
}
