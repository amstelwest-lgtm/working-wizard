/**
 * Audit inputs for Budget. Approvals live on the budget document, which is
 * already a jsonb column, so this does not need a migration.
 */
import type { CashAuditRow } from "./cash-input-audit.ts";
import { fyMonths } from "./budget.months.ts";
import type { BudgetDocument } from "./budget.types.ts";

export function budgetAuditRows(
  doc: BudgetDocument,
  format: (n: number) => string,
): CashAuditRow[] {
  const rows: CashAuditRow[] = [];
  rows.push({
    key: "fy",
    group: "setup",
    label: "Budget year",
    value: doc.fyStart,
    source: null,
    hashOf: doc.fyStart,
  });
  rows.push({
    key: "opening",
    group: "setup",
    label: "Opening cash",
    value: format(doc.openingCash ?? 0),
    source: doc.openingCashSource ?? null,
    hashOf: Math.round(doc.openingCash ?? 0),
  });
  rows.push({
    key: "gp",
    group: "setup",
    label: "Gross profit %",
    value: `${doc.gpPct}%`,
    source: null,
    hashOf: doc.gpPct,
  });
  rows.push({
    key: "debtor-days",
    group: "assumption",
    label: "Debtor days",
    value: String(doc.wc?.debtorDays ?? 0),
    source: doc.wcDaysSource ?? null,
    hashOf: doc.wc?.debtorDays ?? 0,
  });
  rows.push({
    key: "creditor-days",
    group: "assumption",
    label: "Creditor days",
    value: String(doc.wc?.creditorDays ?? 0),
    source: doc.wcDaysSource ?? null,
    hashOf: doc.wc?.creditorDays ?? 0,
  });
  const months = fyMonths(doc.fyStart);
  for (const line of doc.revenueLines ?? []) {
    let total = 0;
    for (const month of months) {
      const cell = line.months[month];
      total += (cell?.volume ?? 0) * (cell?.price ?? 0);
    }
    rows.push({
      key: `revenue:${line.id}`,
      group: "line",
      label: line.name?.trim() || "Revenue",
      value: format(total),
      source: null,
      hashOf: {
        name: line.name,
        months: months.map((month) => {
          const cell = line.months[month];
          return [month, cell?.volume ?? 0, cell?.price ?? 0];
        }),
      },
    });
  }
  for (const line of doc.overheads ?? []) {
    const total = months.reduce((sum, month) => sum + (line.months[month] || 0), 0);
    if (Math.abs(total) < 0.5) continue;
    rows.push({
      key: `overhead:${line.id}`,
      group: "line",
      label: line.name?.trim() || "Overhead",
      value: format(total),
      source: null,
      hashOf: {
        name: line.name,
        months: months.map((month) => [month, line.months[month] || 0]),
      },
    });
  }
  return rows;
}
