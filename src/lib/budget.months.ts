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
 * First month of the 12-month budget window: the firm financial year.
 *
 * A window that started at "this month" labelled itself "FY Mar–Feb" while
 * the columns ran Oct–Sep. The caption and the columns are the same FY.
 * `firstActualsMonth` is accepted so callers keep compiling; it does not
 * slice the year.
 */
export function budgetWindowStart(input: {
  fyStartMonth: number;
  /** Kept for callers. The window is the firm FY, not the first actuals month. */
  firstActualsMonth?: string | null;
  ref?: Date;
}): string {
  return currentFyStart(input.fyStartMonth, input.ref ?? new Date());
}

/** FY start (YYYY-MM) of the firm year that contains `ym`. */
export function firmFyContaining(fyStartMonth: number, ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  const startYear = m >= fyStartMonth ? y : y - 1;
  return `${startYear}-${String(fyStartMonth).padStart(2, "0")}`;
}

function uniformCell(
  keys: string[],
  map: Record<string, BudgetMonthCell>,
): BudgetMonthCell | null {
  if (!keys.length) return null;
  const first = map[keys[0]] ?? { volume: 0, price: 0 };
  const same = keys.every((key) => {
    const cell = map[key] ?? { volume: 0, price: 0 };
    return cell.volume === first.volume && cell.price === first.price;
  });
  return same ? { volume: first.volume, price: first.price } : null;
}

function uniformAmount(keys: string[], map: Record<string, number>): number | null {
  if (!keys.length) return null;
  const first = map[keys[0]] ?? 0;
  return keys.every((key) => (map[key] ?? 0) === first) ? first : null;
}

/**
 * A saved budget whose first column is not the firm FY start (Oct→Sep under
 * a March year) is moved onto that FY. A uniform monthly seed is copied
 * across the new year so the full-year total stays a year.
 */
export function alignBudgetToFirmFy(doc: BudgetDocument): BudgetDocument {
  if (!/^\d{4}-\d{2}$/.test(doc.fyStart) || !(doc.fyStartMonth >= 1 && doc.fyStartMonth <= 12)) {
    return doc;
  }
  const startMonth = Number(doc.fyStart.slice(5, 7));
  if (startMonth === doc.fyStartMonth) return doc;
  const target = firmFyContaining(doc.fyStartMonth, doc.fyStart);
  if (target === doc.fyStart) return doc;
  const oldMonths = fyMonths(doc.fyStart);
  const nextMonths = fyMonths(target);
  return {
    ...doc,
    fyStart: target,
    revenueLines: doc.revenueLines.map((line) => {
      const fill = uniformCell(oldMonths, line.months);
      return {
        ...line,
        months: Object.fromEntries(
          nextMonths.map((month) => [
            month,
            line.months[month]
              ? { ...line.months[month] }
              : fill
                ? { ...fill }
                : { volume: 0, price: 0 },
          ]),
        ),
      };
    }),
    overheads: doc.overheads.map((oh) => {
      const fill = uniformAmount(oldMonths, oh.months);
      return {
        ...oh,
        months: Object.fromEntries(
          nextMonths.map((month) => [
            month,
            oh.months[month] != null ? oh.months[month] : fill != null ? fill : 0,
          ]),
        ),
      };
    }),
  };
}

/** "FY Jan–Dec · from Sep 2026" style caption for a budget document. */
/** Plain window for the budget page, e.g. "Billable-hours budget · Mar 2026 – Feb 2027". */
export function plainBudgetWindowHeading(
  templateLabel: string,
  doc: { fyStart: string },
  market: Pick<ResolvedMarket, "locale"> = ZA_MARKET,
): string {
  const kind = templateLabel.split("/")[0].trim().replace(/(\S)\s+(?=\S)/g, "$1-");
  const months = fyMonths(doc.fyStart);
  const fmt = (ym: string) => {
    const [y, m] = ym.split("-").map(Number);
    if (!y || !m) return ym;
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(market.locale, {
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  };
  const start = months[0] ? fmt(months[0]) : "";
  const end = months.length ? fmt(months[months.length - 1]) : "";
  return `${kind} budget · ${start} – ${end}`;
}

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

/** The month both Budget views open on: this calendar month when it sits in the plan. */
export function currentBudgetMonth(months: string[], now = new Date()): string {
  const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (months.includes(cur)) return cur;
  return months[0] ?? cur;
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
  /** Explicit window start (YYYY-MM). Overrides the firm-FY default. */
  fyStart?: string;
  /** Accepted for callers. The default window is the firm FY containing `ref`. */
  firstActualsMonth?: string | null;
  /** Reference date for the firm FY. Defaults to today. */
  ref?: Date;
  market?: ResolvedMarket;
}): BudgetDocument {
  const market = input.market ?? ZA_MARKET;
  const fyStartMonth = input.fyStartMonth ?? market.fyStartMonthDefault;
  const fyStart =
    input.fyStart ??
    budgetWindowStart({
      fyStartMonth,
      firstActualsMonth: input.firstActualsMonth,
      ref: input.ref,
    });
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
    statementDepreciation: 0,
    showInventoryDays: showInventory,
    notes: [],
    updatedAt: new Date().toISOString(),
  };
}
