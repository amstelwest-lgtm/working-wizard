/**
 * FY month helpers + budget document factory.
 */

import type { ResolvedMarket } from "@/lib/market";
import { ZA_MARKET, formatMonthLabel as formatMonthLabelMarket } from "@/lib/market";
import type {
  BudgetDocument,
  BudgetMonthCell,
  BudgetQualification,
  BudgetRevenueLine,
  BudgetTemplateId,
} from "@/lib/budget.types";
import {
  BUDGET_TEMPLATES,
  OVERHEAD_BUCKETS,
  newId,
  resolveTemplateId,
  seedsForSecondary,
} from "@/lib/budget.templates";

/** Build 12 YYYY-MM keys starting at fyStart (inclusive). */
export function fyMonths(fyStart: string): string[] {
  const [y0, m0] = fyStart.split("-").map(Number);
  const out: string[] = [];
  for (let i = 0; i < 12; i++) {
    const d = new Date(Date.UTC(y0, m0 - 1 + i, 1));
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    out.push(`${y}-${String(m).padStart(2, "0")}`);
  }
  return out;
}

/** Current FY start YYYY-MM given fyStartMonth (1–12) and optional reference date. */
export function currentFyStart(fyStartMonth: number, ref = new Date()): string {
  const y = ref.getFullYear();
  const m = ref.getMonth() + 1;
  const startYear = m >= fyStartMonth ? y : y - 1;
  return `${startYear}-${String(fyStartMonth).padStart(2, "0")}`;
}

/** YYYY-MM for a date (local calendar). */
export function monthKey(ref = new Date()): string {
  return `${ref.getFullYear()}-${String(ref.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * First month of the 12-month budget window.
 *
 * The financial year still anchors reporting, but a budget only makes sense
 * from the first month there are actuals for — nobody should be asked to
 * budget retrospectively for months already closed with no figures. So the
 * window starts at the later of the current FY start and the first actuals
 * month (or this month when no actuals exist yet).
 */
export function budgetWindowStart(input: {
  fyStartMonth: number;
  /** YYYY-MM of the earliest month with real figures, if known. */
  firstActualsMonth?: string | null;
  ref?: Date;
}): string {
  const ref = input.ref ?? new Date();
  const fy = currentFyStart(input.fyStartMonth, ref);
  const now = monthKey(ref);
  const actuals =
    input.firstActualsMonth && /^\d{4}-\d{2}$/.test(input.firstActualsMonth)
      ? input.firstActualsMonth
      : null;
  const from = actuals && actuals <= now ? actuals : now;
  return from > fy ? from : fy;
}

/** "FY Jan–Dec · from Sep 2026" style caption for a budget document. */
export function budgetWindowLabel(
  doc: { fyStartMonth: number; fyStart: string },
  market: Pick<ResolvedMarket, "locale"> = ZA_MARKET,
): string {
  const fyEndMonth = ((doc.fyStartMonth + 10) % 12) + 1;
  const short = (m: number) =>
    new Date(Date.UTC(2000, m - 1, 1)).toLocaleString(market.locale, {
      month: "short",
      timeZone: "UTC",
    });
  const fyLabel = `FY ${short(doc.fyStartMonth)}–${short(fyEndMonth)}`;
  const [fyY, fyM] = doc.fyStart.split("-").map(Number);
  const atFyStart = fyM === doc.fyStartMonth && Number.isFinite(fyY);
  return atFyStart
    ? `${fyLabel} · from ${formatMonthLabelMarket(doc.fyStart, market)}`
    : `${fyLabel} · budget from ${formatMonthLabelMarket(doc.fyStart, market)}`;
}

export function emptyMonthMap(months: string[], cell: BudgetMonthCell = { volume: 0, price: 0 }) {
  return Object.fromEntries(months.map((mo) => [mo, { ...cell }]));
}

export function emptyAmountMap(months: string[], amount = 0) {
  return Object.fromEntries(months.map((mo) => [mo, amount]));
}

export function formatMonthLabel(
  ym: string,
  market: Pick<ResolvedMarket, "locale"> = ZA_MARKET,
): string {
  return formatMonthLabelMarket(ym, market);
}

export function createBudgetDocument(input: {
  templateId: BudgetTemplateId;
  qualification: BudgetQualification;
  fyStartMonth?: number;
  /** Explicit window start (YYYY-MM). Overrides firstActualsMonth. */
  fyStart?: string;
  /** Earliest month with real figures — the window never starts before it. */
  firstActualsMonth?: string | null;
  market?: ResolvedMarket;
}): BudgetDocument {
  const market = input.market ?? ZA_MARKET;
  const fyStartMonth = input.fyStartMonth ?? market.fyStartMonthDefault;
  const fyStart =
    input.fyStart ??
    budgetWindowStart({ fyStartMonth, firstActualsMonth: input.firstActualsMonth });
  const months = fyMonths(fyStart);
  const tpl = BUDGET_TEMPLATES[input.templateId];

  const seedRows = [...tpl.revenueSeeds];
  const secondary = input.qualification.secondaryVolumeUnits ?? [];
  for (const vu of secondary) {
    for (const s of seedsForSecondary(vu)) {
      if (seedRows.some((r) => r.driverKey === s.driverKey)) continue;
      seedRows.push(s);
    }
  }

  const revenueLines: BudgetRevenueLine[] = seedRows.map((seed) => ({
    id: newId("rev"),
    driverKey: seed.driverKey,
    name: seed.name,
    kind: tpl.driverKind,
    volumeLabel: seed.volumeLabel,
    priceLabel: seed.priceLabel,
    months: emptyMonthMap(months),
  }));

  // Secondary lines should use their own kit's driver kind / labels already;
  // re-stamp kind from secondary template when possible.
  for (let i = 0; i < revenueLines.length; i++) {
    const seed = seedRows[i];
    if (!seed.driverKey.startsWith("sec_")) continue;
    const vu = secondary.find((v) =>
      seedsForSecondary(v).some((s) => s.driverKey === seed.driverKey),
    );
    if (!vu) continue;
    const secTpl = BUDGET_TEMPLATES[resolveTemplateId({ payMotion: "mix", volumeUnit: vu })];
    revenueLines[i] = { ...revenueLines[i], kind: secTpl.driverKind };
  }

  const showInventory =
    tpl.showInventoryDays ||
    secondary.some(
      (vu) =>
        BUDGET_TEMPLATES[resolveTemplateId({ payMotion: "mix", volumeUnit: vu })].showInventoryDays,
    );

  return {
    version: 1,
    qualification: input.qualification,
    templateId: input.templateId,
    fyStartMonth,
    fyStart,
    vatMode: market.tax.regime === "vat" ? market.tax.vatMode : "exclusive",
    vatRate:
      market.tax.regime === "vat"
        ? market.tax.vatRate
        : market.tax.regime === "sales_tax"
          ? market.tax.combinedRate
          : 0,
    tax: market.tax,
    openingCash: 0,
    activeScenario: "base",
    scenarios: {
      base: {
        label: "Base",
        volumeFactor: 1,
        priceFactor: 1,
        overheadFactor: 1,
        debtorDaysDelta: 0,
      },
      upside: {
        label: "Upside",
        volumeFactor: 1.1,
        priceFactor: 1.05,
        overheadFactor: 1,
        debtorDaysDelta: -5,
      },
      downside: {
        label: "Downside",
        volumeFactor: 0.9,
        priceFactor: 0.97,
        overheadFactor: 1.05,
        debtorDaysDelta: 15,
      },
    },
    revenueLines,
    cogsMode: "gp_pct",
    gpPct: tpl.defaultGpPct,
    cogsPerUnit: Object.fromEntries(revenueLines.map((l) => [l.id, 0])),
    overheads: OVERHEAD_BUCKETS.map((b) => ({
      id: newId("oh"),
      bucket: b.bucket,
      name: b.name,
      months: emptyAmountMap(months),
    })),
    wc: {
      ...tpl.defaultWc,
      debtorDays: input.qualification.debtorDaysDefault || tpl.defaultWc.debtorDays,
    },
    capex: [],
    showInventoryDays: showInventory,
    notes: [],
    updatedAt: new Date().toISOString(),
  };
}
