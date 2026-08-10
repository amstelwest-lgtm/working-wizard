/**
 * Budget P&L + simplified monthly cash from WC assumptions.
 */

import type {
  BudgetDocument,
  BudgetMonthResult,
  BudgetScenarioId,
} from "@/lib/budget.types";
import { fyMonths } from "@/lib/budget.months";

function scenarioFactors(doc: BudgetDocument, scenario: BudgetScenarioId) {
  return doc.scenarios[scenario] ?? doc.scenarios.base;
}

export function computeBudgetMonths(
  doc: BudgetDocument,
  scenario: BudgetScenarioId = doc.activeScenario,
  openingCash = 0,
): BudgetMonthResult[] {
  const months = fyMonths(doc.fyStart);
  const f = scenarioFactors(doc, scenario);
  const results: BudgetMonthResult[] = [];
  let cash = openingCash;

  // Lag receipts/payments by debtor/creditor days (approx months)
  const receiptLag = Math.max(0, Math.round(doc.wc.debtorDays / 30));
  const payLag = Math.max(0, Math.round(doc.wc.creditorDays / 30));

  const revenueByMonth: number[] = [];
  const cogsByMonth: number[] = [];
  const overheadByMonth: number[] = [];

  for (const mo of months) {
    let revenue = 0;
    let cogs = 0;
    for (const line of doc.revenueLines) {
      const cell = line.months[mo] ?? { volume: 0, price: 0 };
      const vol = (cell.volume || 0) * f.volumeFactor;
      const price = (cell.price || 0) * f.priceFactor;
      const lineRev = vol * price;
      revenue += lineRev;
      if (doc.cogsMode === "per_unit") {
        cogs += vol * (doc.cogsPerUnit[line.id] || 0);
      }
    }
    if (doc.cogsMode === "gp_pct") {
      const gp = Math.min(100, Math.max(0, doc.gpPct)) / 100;
      cogs = revenue * (1 - gp);
    }
    let overheads = 0;
    for (const oh of doc.overheads) {
      overheads += (oh.months[mo] || 0) * f.overheadFactor;
    }
    revenueByMonth.push(revenue);
    cogsByMonth.push(cogs);
    overheadByMonth.push(overheads);
  }

  for (let i = 0; i < months.length; i++) {
    const mo = months[i];
    const revenue = revenueByMonth[i];
    const cogs = cogsByMonth[i];
    const overheads = overheadByMonth[i];
    const grossProfit = revenue - cogs;
    const gpPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;
    const ebitda = grossProfit - overheads;

    const capexCash = doc.capex
      .filter((c) => c.month === mo && c.funding === "cash")
      .reduce((s, c) => s + (c.amount || 0), 0);

    // Cash: receive revenue lagged; pay COGS lagged; overheads same month; capex cash
    const cashIn = revenueByMonth[Math.max(0, i - receiptLag)] ?? 0;
    const cashOutCogs = cogsByMonth[Math.max(0, i - payLag)] ?? 0;
    const cashOut = cashOutCogs + overheads + capexCash;
    const netCash = cashIn - cashOut;
    cash += netCash;

    // VAT note: exclusive mode treats figures as ex-VAT (no cash VAT plug in v1)
    results.push({
      month: mo,
      revenue,
      cogs,
      grossProfit,
      gpPct,
      overheads,
      ebitda,
      capexCash,
      cashIn,
      cashOut,
      netCash,
      closingCash: cash,
    });
  }

  return results;
}

export function fmtZar(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.round(n));
  return `${sign}R${abs.toLocaleString("en-ZA")}`;
}
