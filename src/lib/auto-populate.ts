/**
 * Auto-populate deliverables from an upload.
 *
 * First upload (owner or accountant): every deliverable — profitability, cash
 * forecast, budget — is drafted from the statements with no extra clicks.
 * Later uploads: checkboxes decide which deliverables the new pack refreshes;
 * the choice is remembered per client in clients.auto_update_prefs.
 *
 * Anything written here bumps the deliverable's freshness stamp so an existing
 * accountant sign-off flips to "Needs re-review" (see computeIsStale).
 *
 * Pure module — no I/O. Persistence lives in auto-populate-run.ts.
 */

import type { BudgetDocument } from "@/lib/budget.types";
import { createBudgetDocument, currentFyStart } from "@/lib/budget.months";
import { normalizeBudgetDocument } from "@/lib/budget.compute";
import { budgetToCashForecastPayload, seedBudgetFromFinancials } from "@/lib/budget.bridges";
import { buildCashflowPublishPayload, type ExistingCashflow } from "@/lib/cash-from-banks.publish";
import type {
  CashForecastPublishPayload,
  CashFromBanksDraftResult,
} from "@/lib/cash-from-banks.types";
import type { ReviewScope } from "@/lib/review-signoffs.functions";
import { profileToBudgetQualification, type ClientOperatingProfile } from "@/lib/client-profile";
import type { ResolvedMarket } from "@/lib/market";

export const AUTO_POPULATE_TARGETS = ["profitability", "cash_forecast", "budget"] as const;
export type AutoPopulateTarget = (typeof AUTO_POPULATE_TARGETS)[number];

export type AutoPopulatePlan = Record<AutoPopulateTarget, boolean>;

export type AutoPopulatePrefs = AutoPopulatePlan & {
  /** Persist the checkbox state for the next upload. */
  remember: boolean;
  updatedAt?: string;
};

export const AUTO_POPULATE_LABEL: Record<AutoPopulateTarget, string> = {
  profitability: "Profitability",
  cash_forecast: "Cash forecast",
  budget: "Budget",
};

export const AUTO_POPULATE_HINT: Record<AutoPopulateTarget, string> = {
  profitability: "Period figures, waterfall and margins",
  cash_forecast: "13-week forecast from the same statements",
  budget: "FY assumptions re-seeded from the new figures",
};

/** Which review sign-offs a target invalidates when it is rewritten. */
export const AUTO_POPULATE_SCOPES: Record<AutoPopulateTarget, ReviewScope[]> = {
  profitability: ["financials", "profitability"],
  cash_forecast: ["cash_forecast"],
  budget: ["budget"],
};

export function defaultAutoPopulatePrefs(): AutoPopulatePrefs {
  return { profitability: true, cash_forecast: true, budget: true, remember: true };
}

export function allOnPlan(): AutoPopulatePlan {
  return { profitability: true, cash_forecast: true, budget: true };
}

/** Coerce the clients.auto_update_prefs blob (any shape) into typed prefs. */
export function parseAutoPopulatePrefs(raw: unknown): AutoPopulatePrefs {
  const d = defaultAutoPopulatePrefs();
  if (!raw || typeof raw !== "object") return d;
  const o = raw as Record<string, unknown>;
  const bool = (k: keyof AutoPopulatePrefs, fallback: boolean) =>
    typeof o[k] === "boolean" ? (o[k] as boolean) : fallback;
  return {
    profitability: bool("profitability", d.profitability),
    cash_forecast: bool("cash_forecast", d.cash_forecast),
    budget: bool("budget", d.budget),
    remember: bool("remember", d.remember),
    updatedAt: typeof o.updatedAt === "string" ? o.updatedAt : undefined,
  };
}

export type ClientFreshness = {
  financials_updated_at?: string | null;
  last_forecast_at?: string | null;
  budget_updated_at?: string | null;
};

/**
 * First upload = no deliverable has ever been stamped. Durable (DB columns),
 * shared by owner and accountant, and independent of the localStorage tour flag.
 */
export function isFirstUpload(meta: ClientFreshness | null | undefined): boolean {
  if (!meta) return true;
  return !meta.financials_updated_at && !meta.last_forecast_at && !meta.budget_updated_at;
}

/** First upload fills everything; afterwards the checkboxes decide. */
export function resolveAutoPopulatePlan(opts: {
  firstUpload: boolean;
  prefs: AutoPopulatePlan;
}): AutoPopulatePlan {
  if (opts.firstUpload) return allOnPlan();
  return {
    profitability: Boolean(opts.prefs.profitability),
    cash_forecast: Boolean(opts.prefs.cash_forecast),
    budget: Boolean(opts.prefs.budget),
  };
}

export function planTargets(plan: AutoPopulatePlan): AutoPopulateTarget[] {
  return AUTO_POPULATE_TARGETS.filter((t) => plan[t]);
}

/** Review scopes that must be re-signed after this plan ran. */
export function scopesResetByPlan(plan: AutoPopulatePlan): ReviewScope[] {
  const out = new Set<ReviewScope>();
  for (const t of planTargets(plan)) for (const s of AUTO_POPULATE_SCOPES[t]) out.add(s);
  return [...out];
}

/** Prefs to persist after an upload. `remember` off → keep what was stored. */
export function nextStoredPrefs(
  stored: AutoPopulatePrefs,
  chosen: AutoPopulatePrefs,
  now = new Date().toISOString(),
): AutoPopulatePrefs {
  if (!chosen.remember) return { ...stored, remember: false, updatedAt: now };
  return { ...chosen, remember: true, updatedAt: now };
}

// ── Writes ────────────────────────────────────────────────────────────────────

export type AutoPopulateContext = {
  /** Period figures keyed by the app's Inputs keys (strings). Already saved to financials. */
  fields: Record<string, string | number | null | undefined>;
  /** Bank pack cash draft (same statements). Absent for financial-statement uploads. */
  cashDraft?: CashFromBanksDraftResult | null;
  existingBudget?: unknown;
  existingCashflow?: ExistingCashflow | null;
  operatingProfile?: ClientOperatingProfile | null;
  fyStartMonth?: number | null;
  /** Earliest month covered by the upload (YYYY-MM). */
  firstActualsMonth?: string | null;
  market: ResolvedMarket;
  now?: string;
};

export type AutoPopulateWrites = {
  /** Partial clients row update (JSON columns + freshness stamps). */
  update: Record<string, unknown>;
  applied: AutoPopulateTarget[];
  skipped: Array<{ target: AutoPopulateTarget; reason: string }>;
  changes: string[];
  scopesReset: ReviewScope[];
};

/** Existing document, else one built from the profile, else the hybrid kit. */
export function resolveBudgetDocForAutoPopulate(ctx: {
  existingBudget?: unknown;
  operatingProfile?: ClientOperatingProfile | null;
  fyStartMonth?: number | null;
  firstActualsMonth?: string | null;
  market: ResolvedMarket;
}): BudgetDocument {
  const raw = ctx.existingBudget as BudgetDocument | null | undefined;
  if (raw && typeof raw === "object" && raw.version === 1) return normalizeBudgetDocument(raw);
  const fyStartMonth = ctx.fyStartMonth ?? ctx.market.fyStartMonthDefault;
  if (ctx.operatingProfile) {
    return createBudgetDocument({
      templateId: ctx.operatingProfile.templateId,
      qualification: profileToBudgetQualification(ctx.operatingProfile),
      fyStartMonth,
      firstActualsMonth: ctx.firstActualsMonth ?? null,
      market: ctx.market,
    });
  }
  return createBudgetDocument({
    templateId: "hybrid_primary",
    qualification: {
      payMotion: "mix",
      volumeUnit: "units_sku",
      driverKind: "units_price",
      costShape: "balanced",
      debtorDaysDefault: 30,
      capexMode: "none",
      confirmedAt: new Date(0).toISOString(),
    },
    fyStartMonth,
    fyStart: ctx.firstActualsMonth ? undefined : currentFyStart(fyStartMonth),
    firstActualsMonth: ctx.firstActualsMonth ?? null,
    market: ctx.market,
  });
}

function hasFigures(fields: AutoPopulateContext["fields"]): boolean {
  const n = (v: unknown) => parseFloat(String(v ?? "").replace(/[^0-9.-]/g, "")) || 0;
  return n(fields.revenue) > 0 || n(fields.fixedCosts) > 0 || n(fields.cogs) > 0;
}

/**
 * Cash forecast from a bank pack: accept every proposed line, replace what is
 * there (the new statements supersede), adopt bank balances.
 */
export function cashForecastFromBankDraft(
  draft: CashFromBanksDraftResult,
  existing: ExistingCashflow | null | undefined,
): CashForecastPublishPayload {
  return buildCashflowPublishPayload({
    lines: draft.lines.map((l) => (l.status === "proposed" ? { ...l, status: "confirmed" } : l)),
    startDate: draft.startDate,
    openingBalance: draft.openingBalance,
    policy: "replace",
    existing: existing ?? null,
    adoptBankBalances: true,
  });
}

/**
 * Build the clients row update for a plan. Profitability figures are already
 * on clients.financials by the time this runs; the target only stamps freshness
 * (and therefore resets the financials + profitability sign-offs).
 */
export function buildAutoPopulateWrites(
  plan: AutoPopulatePlan,
  ctx: AutoPopulateContext,
): AutoPopulateWrites {
  const now = ctx.now ?? new Date().toISOString();
  const update: Record<string, unknown> = {};
  const applied: AutoPopulateTarget[] = [];
  const skipped: AutoPopulateWrites["skipped"] = [];
  const changes: string[] = [];

  if (plan.profitability) {
    update.financials_updated_at = now;
    applied.push("profitability");
    changes.push("Profitability figures refreshed from the upload");
  }

  let seededDoc: BudgetDocument | null = null;
  if (plan.budget || (plan.cash_forecast && !ctx.cashDraft)) {
    if (hasFigures(ctx.fields)) {
      const doc = resolveBudgetDocForAutoPopulate(ctx);
      const seeded = seedBudgetFromFinancials(doc, ctx.fields);
      seededDoc = { ...seeded.doc, updatedAt: now };
      if (plan.budget) {
        update.budget = seededDoc;
        update.budget_updated_at = now;
        applied.push("budget");
        changes.push(...seeded.changes);
      }
    } else if (plan.budget) {
      skipped.push({ target: "budget", reason: "No revenue or cost figures to seed from" });
    }
  }

  if (plan.cash_forecast) {
    let payload: CashForecastPublishPayload | null = null;
    if (ctx.cashDraft && ctx.cashDraft.lines.some((l) => l.status !== "excluded" && l.amount > 0)) {
      payload = cashForecastFromBankDraft(ctx.cashDraft, ctx.existingCashflow);
      changes.push(
        `Cash forecast published from ${ctx.cashDraft.lines.filter((l) => l.status !== "excluded").length} bank movement lines`,
      );
    } else if (seededDoc) {
      payload = budgetToCashForecastPayload(seededDoc);
      const openingCash = parseFloat(String(ctx.fields.cash ?? "")) || 0;
      if (openingCash > 0) payload = { ...payload, openingBalance: String(openingCash) };
      changes.push("Cash forecast drafted from the budget's first three months");
    }
    if (payload) {
      update.cashflow = payload;
      update.cashflow_bank_draft = ctx.cashDraft ?? payload;
      update.last_forecast_at = now;
      applied.push("cash_forecast");
    } else {
      skipped.push({ target: "cash_forecast", reason: "Nothing to forecast from yet" });
    }
  }

  const appliedPlan: AutoPopulatePlan = {
    profitability: applied.includes("profitability"),
    cash_forecast: applied.includes("cash_forecast"),
    budget: applied.includes("budget"),
  };

  return { update, applied, skipped, changes, scopesReset: scopesResetByPlan(appliedPlan) };
}

/** One-line toast copy for what just happened. */
export function summariseAutoPopulate(w: AutoPopulateWrites, firstUpload: boolean): string {
  if (!w.applied.length) return "Figures saved. Nothing else was updated.";
  const names = AUTO_POPULATE_TARGETS.filter((t) => w.applied.includes(t)).map((t) =>
    AUTO_POPULATE_LABEL[t].toLowerCase(),
  );
  const list =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return firstUpload
    ? `Milōn drafted your ${list} from this upload. Your accountant reviews and signs off before anything is final.`
    : `Updated ${list} from this upload — accountant sign-off is needed again.`;
}
