/**
 * Model-change mapping: carry drivers by key, review unmapped, warn on low overlap.
 */

import type {
  BudgetDocument,
  BudgetRevenueLine,
  BudgetTemplateId,
  UnmappedDriver,
} from "@/lib/budget.types";
import { BUDGET_TEMPLATES, newId } from "@/lib/budget.templates";
import { emptyMonthMap, fyMonths } from "@/lib/budget.months";
import type { BudgetQualification } from "@/lib/budget.types";
import { createBudgetDocument } from "@/lib/budget.months";

export type ModelChangeResult = {
  next: BudgetDocument;
  mappedCount: number;
  unmapped: UnmappedDriver[];
  newEmptyKeys: string[];
  overlapPct: number;
  lowOverlap: boolean;
};

/** Overlap = matched / old keys (shrinking models don't look artificially healthy). */
export function computeDriverOverlap(
  oldKeys: string[],
  newKeys: string[],
): { matched: number; overlapPct: number } {
  const newSet = new Set(newKeys);
  const matched = oldKeys.filter((k) => newSet.has(k)).length;
  const denom = Math.max(oldKeys.length, 1);
  return { matched, overlapPct: (matched / denom) * 100 };
}

export function applyTemplateChange(
  prev: BudgetDocument,
  templateId: BudgetTemplateId,
  qualification: BudgetQualification,
): ModelChangeResult {
  const fresh = createBudgetDocument({
    templateId,
    qualification,
    fyStartMonth: prev.fyStartMonth,
    fyStart: prev.fyStart,
  });
  const months = fyMonths(prev.fyStart);
  const tpl = BUDGET_TEMPLATES[templateId];

  const oldByKey = new Map(prev.revenueLines.map((l) => [l.driverKey, l]));
  const usedOld = new Set<string>();

  const mappedLines: BudgetRevenueLine[] = fresh.revenueLines.map((seed) => {
    const old = oldByKey.get(seed.driverKey);
    if (!old) {
      return seed;
    }
    usedOld.add(seed.driverKey);
    return {
      ...seed,
      id: old.id,
      name: old.name || seed.name,
      months: months.reduce<Record<string, { volume: number; price: number }>>((acc, mo) => {
        acc[mo] = old.months[mo] ?? { volume: 0, price: 0 };
        return acc;
      }, {}),
    };
  });

  const unmapped: UnmappedDriver[] = prev.revenueLines
    .filter((l) => !usedOld.has(l.driverKey))
    .map((l) => ({
      id: l.id,
      driverKey: l.driverKey,
      name: l.name,
      kind: l.kind,
      months: l.months,
    }));

  const newEmptyKeys = fresh.revenueLines
    .filter((l) => !oldByKey.has(l.driverKey))
    .map((l) => l.driverKey);

  const { matched, overlapPct } = computeDriverOverlap(
    prev.revenueLines.map((l) => l.driverKey),
    fresh.revenueLines.map((l) => l.driverKey),
  );

  const next: BudgetDocument = {
    ...fresh,
    revenueLines: mappedLines,
    // Preserve user economics where sensible
    gpPct: prev.gpPct || fresh.gpPct,
    cogsMode: prev.cogsMode,
    vatMode: prev.vatMode,
    vatRate: prev.vatRate ?? fresh.vatRate,
    tax: prev.tax ?? fresh.tax,
    openingCash: prev.openingCash ?? 0,
    activeScenario: prev.activeScenario,
    scenarios: prev.scenarios,
    overheads: prev.overheads.map((oh) => ({
      ...oh,
      months: months.reduce<Record<string, number>>((acc, mo) => {
        acc[mo] = oh.months[mo] ?? 0;
        return acc;
      }, {}),
    })),
    wc: {
      ...fresh.wc,
      debtorDays: prev.wc.debtorDays || fresh.wc.debtorDays,
      creditorDays: prev.wc.creditorDays || fresh.wc.creditorDays,
      inventoryDays: tpl.showInventoryDays ? prev.wc.inventoryDays || fresh.wc.inventoryDays : 0,
    },
    capex: prev.capex.map((c) => ({
      ...c,
      usefulLifeMonths: c.usefulLifeMonths ?? 36,
      residual: c.residual ?? 0,
    })),
    notes: prev.notes ?? [],
    cogsPerUnit: Object.fromEntries(mappedLines.map((l) => [l.id, prev.cogsPerUnit[l.id] ?? 0])),
    updatedAt: new Date().toISOString(),
  };

  return {
    next,
    mappedCount: matched,
    unmapped,
    newEmptyKeys,
    overlapPct,
    lowOverlap: overlapPct < 30,
  };
}

/** Manually reassign an unmapped driver onto a target line (by driverKey). */
export function reassignUnmappedDriver(
  doc: BudgetDocument,
  unmapped: UnmappedDriver,
  targetDriverKey: string,
): BudgetDocument {
  const months = fyMonths(doc.fyStart);
  return {
    ...doc,
    revenueLines: doc.revenueLines.map((line) => {
      if (line.driverKey !== targetDriverKey) return line;
      return {
        ...line,
        months: months.reduce<Record<string, { volume: number; price: number }>>((acc, mo) => {
          const from = unmapped.months[mo];
          const cur = line.months[mo] ?? { volume: 0, price: 0 };
          acc[mo] = from
            ? { volume: from.volume || cur.volume, price: from.price || cur.price }
            : cur;
          return acc;
        }, {}),
      };
    }),
    updatedAt: new Date().toISOString(),
  };
}

/** Add unmapped as an extra revenue line under the new template. */
export function keepUnmappedAsExtraLine(
  doc: BudgetDocument,
  unmapped: UnmappedDriver,
): BudgetDocument {
  const tpl = BUDGET_TEMPLATES[doc.templateId];
  const months = fyMonths(doc.fyStart);
  const seed = tpl.revenueSeeds[0];
  const line: BudgetRevenueLine = {
    id: newId("rev"),
    driverKey: unmapped.driverKey,
    name: unmapped.name,
    kind: tpl.driverKind,
    volumeLabel: seed?.volumeLabel ?? "Volume",
    priceLabel: seed?.priceLabel ?? "Price",
    months: emptyMonthMap(months),
  };
  for (const mo of months) {
    line.months[mo] = unmapped.months[mo] ?? { volume: 0, price: 0 };
  }
  return {
    ...doc,
    revenueLines: [...doc.revenueLines, line],
    cogsPerUnit: { ...doc.cogsPerUnit, [line.id]: 0 },
    updatedAt: new Date().toISOString(),
  };
}
