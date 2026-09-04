/**
 * Budget P&L + monthly cash (WC, VAT / sales tax, inventory, capex depreciation).
 */

import type {
  BudgetDocument,
  BudgetMonthResult,
  BudgetScenarioId,
  BudgetCapexLine,
} from "@/lib/budget.types";
import { DEFAULT_VAT_RATE } from "@/lib/budget.types";
import { fyMonths } from "@/lib/budget.months";
import { BUDGET_TEMPLATES, resolveTemplateId } from "@/lib/budget.templates";
import { migrateLegacyQualification } from "@/lib/budget.taxonomy";
import { formatMoney, type IndirectTaxProfile } from "@/lib/market";
import { ZA_MARKET } from "@/lib/market";

function documentTax(doc: BudgetDocument): IndirectTaxProfile {
  if (doc.tax) return doc.tax;
  const rate = doc.vatRate > 0 ? doc.vatRate : DEFAULT_VAT_RATE;
  return { regime: "vat", vatRate: rate, vatMode: doc.vatMode ?? "exclusive" };
}

function salesTaxRate(tax: IndirectTaxProfile): number {
  if (tax.regime === "sales_tax" && tax.collects) return tax.combinedRate;
  if (tax.regime === "vat") return tax.vatRate;
  return 0;
}

function scenarioFactors(doc: BudgetDocument, scenario: BudgetScenarioId) {
  return doc.scenarios[scenario] ?? doc.scenarios.base;
}

function monthIndex(months: string[], ym: string): number {
  return months.indexOf(ym);
}

/** Monthly straight-line depreciation for one asset in a given FY month index. */
export function depreciationForMonth(
  asset: BudgetCapexLine,
  months: string[],
  monthIdx: number,
): number {
  const life = Math.max(1, asset.usefulLifeMonths ?? 36);
  const residual = Math.max(0, asset.residual ?? 0);
  const depreciable = Math.max(0, (asset.amount || 0) - residual);
  if (depreciable <= 0) return 0;
  const startIdx = monthIndex(months, asset.month);
  if (startIdx < 0 || monthIdx < startIdx) return 0;
  if (monthIdx >= startIdx + life) return 0;
  return depreciable / life;
}

/**
 * Convert entered revenue/COGS to P&L ex-VAT amounts.
 * exclusive: figures already ex-VAT.
 * inclusive: strip VAT from tax-inclusive inputs.
 */
function toExVat(amount: number, vatMode: BudgetDocument["vatMode"], rate: number): number {
  if (vatMode === "inclusive") {
    return amount / (1 + rate);
  }
  return amount;
}

/** Cash movement includes VAT on taxable supplies when exclusive; inclusive uses gross. */
function withOutputVat(exVat: number, vatMode: BudgetDocument["vatMode"], rate: number): number {
  if (vatMode === "exclusive") return exVat * (1 + rate);
  return exVat * (1 + rate); // inclusive path: exVat already stripped, restore gross for cash
}

function withInputVat(exVat: number, vatMode: BudgetDocument["vatMode"], rate: number): number {
  return withOutputVat(exVat, vatMode, rate);
}

export function computeBudgetMonths(
  doc: BudgetDocument,
  scenario: BudgetScenarioId = doc.activeScenario,
): BudgetMonthResult[] {
  const months = fyMonths(doc.fyStart);
  const f = scenarioFactors(doc, scenario);
  const tax = documentTax(doc);
  const vatMode = tax.regime === "vat" ? tax.vatMode : (doc.vatMode ?? "exclusive");
  const rate =
    tax.regime === "vat" ? (tax.vatRate > 0 ? tax.vatRate : DEFAULT_VAT_RATE) : salesTaxRate(tax);
  const opening = doc.openingCash || 0;
  const results: BudgetMonthResult[] = [];
  let cash = opening;

  const debtorDays = Math.max(0, (doc.wc.debtorDays || 0) + (f.debtorDaysDelta || 0));
  const creditorDays = Math.max(0, doc.wc.creditorDays || 0);
  const inventoryDays = doc.showInventoryDays ? Math.max(0, doc.wc.inventoryDays || 0) : 0;

  const receiptLag = Math.max(0, Math.round(debtorDays / 30));
  const payLag = Math.max(0, Math.round(creditorDays / 30));

  const revenueByMonth: number[] = [];
  const cogsByMonth: number[] = [];
  const overheadByMonth: number[] = [];
  const depByMonth: number[] = [];

  for (let i = 0; i < months.length; i++) {
    const mo = months[i];
    let revenueEntered = 0;
    let cogsEntered = 0;
    for (const line of doc.revenueLines) {
      const cell = line.months[mo] ?? { volume: 0, price: 0 };
      const vol = (cell.volume || 0) * f.volumeFactor;
      const price = (cell.price || 0) * f.priceFactor;
      const lineRev = vol * price;
      revenueEntered += lineRev;
      if (doc.cogsMode === "per_unit") {
        cogsEntered += vol * (doc.cogsPerUnit[line.id] || 0);
      }
    }
    if (doc.cogsMode === "gp_pct") {
      const gp = Math.min(100, Math.max(0, doc.gpPct)) / 100;
      cogsEntered = revenueEntered * (1 - gp);
    }

    const revenue = toExVat(revenueEntered, vatMode, rate);
    const cogs =
      doc.cogsMode === "gp_pct"
        ? revenue * (1 - Math.min(100, Math.max(0, doc.gpPct)) / 100)
        : toExVat(cogsEntered, vatMode, rate);

    let overheads = 0;
    for (const oh of doc.overheads) {
      overheads += (oh.months[mo] || 0) * f.overheadFactor;
    }

    let depreciation = 0;
    for (const asset of doc.capex) {
      depreciation += depreciationForMonth(asset, months, i);
    }

    revenueByMonth.push(revenue);
    cogsByMonth.push(cogs);
    overheadByMonth.push(overheads);
    depByMonth.push(depreciation);
  }

  let prevInventoryStock = 0;
  let accruedSalesTax = 0;

  for (let i = 0; i < months.length; i++) {
    const mo = months[i];
    const revenue = revenueByMonth[i];
    const cogs = cogsByMonth[i];
    const overheads = overheadByMonth[i];
    const depreciation = depByMonth[i];
    const grossProfit = revenue - cogs;
    const gpPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const ebitda = grossProfit - overheads;
    const ebit = ebitda - depreciation;

    const capexCash = doc.capex
      .filter((c) => c.month === mo && c.funding === "cash")
      .reduce((s, c) => s + (c.amount || 0), 0);

    // Inventory stock ≈ COGS cover for inventoryDays; Δstock is cash tied up / released
    const inventoryStock = inventoryDays > 0 ? cogs * (inventoryDays / 30) : 0;
    const inventoryBuild = inventoryStock - prevInventoryStock;
    prevInventoryStock = inventoryStock;

    const laggedRev = revenueByMonth[Math.max(0, i - receiptLag)] ?? 0;
    const laggedCogs = cogsByMonth[Math.max(0, i - payLag)] ?? 0;

    const purchaseExVat = laggedCogs + Math.max(0, inventoryBuild);
    const overheadCash = overheads;
    const salesTax = tax.regime === "sales_tax" && tax.collects && rate > 0;

    let cashIn: number;
    let cashOutPurchases: number;
    let vatNet: number;

    if (salesTax) {
      // US: collections are a liability, not income. Purchases get no input credit.
      cashIn = laggedRev * (1 + rate);
      cashOutPurchases = purchaseExVat + Math.min(0, inventoryBuild);
      const collected = laggedRev * rate;
      accruedSalesTax += collected;
      let remitted = 0;
      const cadence = tax.remittance;
      if (cadence === "monthly") {
        remitted = collected;
        accruedSalesTax -= collected;
      } else if (cadence === "quarterly" && (i + 1) % 3 === 0) {
        remitted = accruedSalesTax;
        accruedSalesTax = 0;
      }
      vatNet = remitted;
      const cashOut = cashOutPurchases + overheadCash + capexCash + remitted;
      const netCash = cashIn - cashOut;
      cash += netCash;
      results.push({
        month: mo,
        revenue,
        cogs,
        grossProfit,
        gpPct,
        overheads,
        depreciation,
        ebitda,
        ebit,
        capexCash,
        inventoryBuild,
        vatNet,
        cashIn,
        cashOut,
        netCash,
        closingCash: cash,
      });
      continue;
    }

    if (tax.regime === "none" || rate <= 0) {
      cashIn = laggedRev;
      cashOutPurchases = purchaseExVat + Math.min(0, inventoryBuild);
      vatNet = 0;
      const cashOut = cashOutPurchases + overheadCash + capexCash;
      const netCash = cashIn - cashOut;
      cash += netCash;
      results.push({
        month: mo,
        revenue,
        cogs,
        grossProfit,
        gpPct,
        overheads,
        depreciation,
        ebitda,
        ebit,
        capexCash,
        inventoryBuild,
        vatNet,
        cashIn,
        cashOut,
        netCash,
        closingCash: cash,
      });
      continue;
    }

    // ZA VAT: cash includes VAT; input VAT is reclaimable.
    cashIn = withOutputVat(laggedRev, vatMode, rate);
    cashOutPurchases = withInputVat(purchaseExVat, vatMode, rate) + Math.min(0, inventoryBuild);
    const vatOnReceipts = cashIn - laggedRev;
    const vatOnPurchases = withInputVat(purchaseExVat, vatMode, rate) - purchaseExVat;
    vatNet = vatOnReceipts - vatOnPurchases;

    const cashOut = cashOutPurchases + overheadCash + capexCash;
    const netCash = cashIn - cashOut;
    cash += netCash;

    results.push({
      month: mo,
      revenue,
      cogs,
      grossProfit,
      gpPct,
      overheads,
      depreciation,
      ebitda,
      ebit,
      capexCash,
      inventoryBuild,
      vatNet,
      cashIn,
      cashOut,
      netCash,
      closingCash: cash,
    });
  }

  return results;
}

export function lowestCashTrough(results: BudgetMonthResult[]): {
  month: string;
  closingCash: number;
} | null {
  if (!results.length) return null;
  return results.reduce(
    (min, r) =>
      r.closingCash < min.closingCash ? { month: r.month, closingCash: r.closingCash } : min,
    { month: results[0].month, closingCash: results[0].closingCash },
  );
}

export function fmtZar(n: number): string {
  return formatMoney(n, ZA_MARKET);
}

export function fmtBudgetMoney(n: number, market = ZA_MARKET): string {
  return formatMoney(n, market);
}

/** Ensure older saved budgets get Phase 2/3 defaults + new qualification fields. */
export function normalizeBudgetDocument(raw: BudgetDocument): BudgetDocument {
  const scenarios = { ...raw.scenarios };
  for (const id of ["base", "upside", "downside"] as const) {
    const prev = scenarios[id];
    scenarios[id] = {
      label: prev?.label ?? id[0].toUpperCase() + id.slice(1),
      volumeFactor: prev?.volumeFactor ?? 1,
      priceFactor: prev?.priceFactor ?? 1,
      overheadFactor: prev?.overheadFactor ?? 1,
      debtorDaysDelta: prev?.debtorDaysDelta ?? 0,
    };
  }

  const q = raw.qualification ?? ({} as BudgetDocument["qualification"]);
  let qualification = q;
  if (!q.payMotion || !q.volumeUnit) {
    const migrated = migrateLegacyQualification({
      payModel: q.payModel,
      subtype: q.subtype,
    });
    qualification = {
      ...q,
      payMotion: migrated.payMotion,
      volumeUnit: migrated.volumeUnit,
      secondaryVolumeUnits: q.secondaryVolumeUnits ?? [],
      driverKind:
        q.driverKind ?? BUDGET_TEMPLATES[migrated.templateId]?.driverKind ?? "units_price",
      costShape: q.costShape ?? "balanced",
      debtorDaysDefault: q.debtorDaysDefault ?? 30,
      capexMode: q.capexMode ?? "none",
      confirmedAt: q.confirmedAt ?? new Date().toISOString(),
    };
  }

  const templateId =
    raw.templateId && raw.templateId in BUDGET_TEMPLATES
      ? raw.templateId
      : resolveTemplateId({
          payMotion: qualification.payMotion,
          volumeUnit: qualification.volumeUnit,
        });

  return {
    ...raw,
    templateId,
    qualification,
    vatRate: raw.vatRate > 0 ? raw.vatRate : DEFAULT_VAT_RATE,
    tax: raw.tax ?? {
      regime: "vat" as const,
      vatRate: raw.vatRate > 0 ? raw.vatRate : DEFAULT_VAT_RATE,
      vatMode: raw.vatMode ?? "exclusive",
    },
    openingCash: raw.openingCash ?? 0,
    scenarios,
    capex: (raw.capex ?? []).map((c) => ({
      ...c,
      usefulLifeMonths: c.usefulLifeMonths ?? 36,
      residual: c.residual ?? 0,
    })),
    notes: raw.notes ?? [],
  };
}
