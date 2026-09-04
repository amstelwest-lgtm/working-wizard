/**
 * Debt facility schedule — stored under clients.financials.debt_schedule.
 * Powers the Leverage PDF; never invent facilities when empty.
 */

import {
  emptyWeeklyInputs,
  parseWeeklyInputs,
  type WeeklyInputs,
} from "./weekly-inputs";
import { emptyProductMix, parseProductMix, type ProductMix } from "./product-mix";

export type DebtFacilityType =
  | "term"
  | "revolving"
  | "asset_finance"
  | "director"
  | "other";

export type DebtFacility = {
  id: string;
  label: string;
  amount: number;
  annual_rate_pct: number | null;
  maturity_year: number | null;
  facility_type?: DebtFacilityType;
};

export type DebtSchedule = {
  lines: DebtFacility[];
  drawings_ytd?: number | null;
  prior_equity?: number | null;
};

export function emptyDebtSchedule(): DebtSchedule {
  return { lines: [], drawings_ytd: null, prior_equity: null };
}

export function newDebtFacility(): DebtFacility {
  return {
    id: crypto.randomUUID(),
    label: "",
    amount: 0,
    annual_rate_pct: null,
    maturity_year: null,
    facility_type: "term",
  };
}

export function parseDebtSchedule(raw: unknown): DebtSchedule {
  if (!raw) return emptyDebtSchedule();
  let obj: unknown = raw;
  if (typeof raw === "string") {
    try {
      obj = JSON.parse(raw);
    } catch {
      return emptyDebtSchedule();
    }
  }
  if (!obj || typeof obj !== "object") return emptyDebtSchedule();
  const o = obj as Record<string, unknown>;
  const linesRaw = Array.isArray(o.lines) ? o.lines : [];
  const lines: DebtFacility[] = linesRaw
    .map((line): DebtFacility | null => {
      if (!line || typeof line !== "object") return null;
      const l = line as Record<string, unknown>;
      const amount = typeof l.amount === "number" ? l.amount : parseFloat(String(l.amount ?? "")) || 0;
      const rate =
        l.annual_rate_pct == null || l.annual_rate_pct === ""
          ? null
          : typeof l.annual_rate_pct === "number"
            ? l.annual_rate_pct
            : parseFloat(String(l.annual_rate_pct));
      const maturity =
        l.maturity_year == null || l.maturity_year === ""
          ? null
          : typeof l.maturity_year === "number"
            ? l.maturity_year
            : parseInt(String(l.maturity_year), 10);
      return {
        id: typeof l.id === "string" && l.id ? l.id : crypto.randomUUID(),
        label: typeof l.label === "string" ? l.label : "",
        amount,
        annual_rate_pct: rate != null && Number.isFinite(rate) ? rate : null,
        maturity_year: maturity != null && Number.isFinite(maturity) ? maturity : null,
        facility_type: (l.facility_type as DebtFacilityType) || "other",
      };
    })
    .filter((x): x is DebtFacility => x != null);

  const drawings =
    o.drawings_ytd == null || o.drawings_ytd === ""
      ? null
      : typeof o.drawings_ytd === "number"
        ? o.drawings_ytd
        : parseFloat(String(o.drawings_ytd));
  const priorEq =
    o.prior_equity == null || o.prior_equity === ""
      ? null
      : typeof o.prior_equity === "number"
        ? o.prior_equity
        : parseFloat(String(o.prior_equity));

  return {
    lines,
    drawings_ytd: drawings != null && Number.isFinite(drawings) ? drawings : null,
    prior_equity: priorEq != null && Number.isFinite(priorEq) ? priorEq : null,
  };
}

/** Pull debt_schedule out of a financials blob without stringifying it. */
export function splitFinancialsBlob(
  fin: Record<string, unknown> | null | undefined,
): {
  scalars: Record<string, string>;
  debtSchedule: DebtSchedule;
  weeklyInputs: WeeklyInputs;
  productMix: ProductMix;
} {
  const scalars: Record<string, string> = {};
  let debtSchedule = emptyDebtSchedule();
  let weeklyInputs = emptyWeeklyInputs();
  let productMix = emptyProductMix();
  if (!fin) return { scalars, debtSchedule, weeklyInputs, productMix };
  for (const [k, v] of Object.entries(fin)) {
    if (k === "debt_schedule") {
      debtSchedule = parseDebtSchedule(v);
      continue;
    }
    if (k === "weeklyInputs") {
      weeklyInputs = parseWeeklyInputs(v);
      continue;
    }
    if (k === "productMix") {
      productMix = parseProductMix(v);
      continue;
    }
    if (v != null && typeof v === "object") continue;
    scalars[k] = v != null ? String(v) : "";
  }
  return { scalars, debtSchedule, weeklyInputs, productMix };
}

/** Merge scalar grid + debt schedule + weekly inputs + product mix for clients.financials write. */
export function mergeFinancialsBlob(
  scalars: Record<string, string>,
  debtSchedule: DebtSchedule,
  weeklyInputs: WeeklyInputs = emptyWeeklyInputs(),
  productMix: ProductMix = emptyProductMix(),
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...scalars };
  if (debtSchedule.lines.length > 0 || debtSchedule.drawings_ytd != null || debtSchedule.prior_equity != null) {
    out.debt_schedule = {
      lines: debtSchedule.lines.filter((l) => l.label.trim() || l.amount > 0),
      drawings_ytd: debtSchedule.drawings_ytd ?? null,
      prior_equity: debtSchedule.prior_equity ?? null,
    };
  } else {
    delete out.debt_schedule;
  }
  // Always persist nested blobs so an accountant autosave cannot wipe owner-entered weeks or mix.
  out.weeklyInputs = weeklyInputs;
  out.productMix = productMix;
  return out;
}

export function totalDebtFromSchedule(schedule: DebtSchedule): number {
  return schedule.lines.reduce((s, l) => s + (Number.isFinite(l.amount) ? l.amount : 0), 0);
}
