/**
 * Cash forecast adjustments the Financial Manager may propose.
 * The keys match the Cash page engine (opening balance and the what-if
 * inputs). A proposal is pending until a person confirms. Apply refuses
 * to change clients.cashflow without that confirm.
 */

export const CASH_FORECAST_ADJUSTMENT_KEYS = [
  "openingBalance",
  "revAdj",
  "expAdj",
  "collectDelay",
  "headcountDelta",
  "avgSalary",
  "fixedCostDelta",
  "revGrowthPct",
  "capexAmount",
  "capexWeek",
  "netWeek",
  "netDelta",
] as const;

export type CashForecastAdjustmentKey = (typeof CASH_FORECAST_ADJUSTMENT_KEYS)[number];

export const FIGURE_PROPOSAL_TOOL = "propose_figure_adjustment";

export const FIGURE_SURFACES = ["cash", "budget", "waterfall"] as const;
export type FigureSurface = (typeof FIGURE_SURFACES)[number];

export const BUDGET_FIGURE_KEYS = [
  "openingCash",
  "gpPct",
  "debtorDays",
  "creditorDays",
  "inventoryDays",
] as const;
export type BudgetFigureKey = (typeof BUDGET_FIGURE_KEYS)[number];

/** Period P&L fields the profitability waterfall reads from clients.financials. */
export const WATERFALL_FIGURE_KEYS = [
  "revenue",
  "cogs",
  "grossProfit",
  "fixedCosts",
  "ebit",
  "interest",
  "tax",
  "netIncome",
] as const;
export type WaterfallFigureKey = (typeof WATERFALL_FIGURE_KEYS)[number];

export type BudgetFigurePatch = Partial<Record<BudgetFigureKey, number>>;
export type WaterfallFigurePatch = Partial<Record<WaterfallFigureKey, number>>;

export const CASH_FORECAST_PROPOSAL_STATUSES = [
  "pending",
  "approved",
  "rejected",
  "applied",
] as const;

export type CashForecastProposalStatus = (typeof CASH_FORECAST_PROPOSAL_STATUSES)[number];

/** Neutral what-if, the same defaults the Cash page starts on. */
export const NEUTRAL_CASH_FORECAST_ENGINE = {
  revAdj: 100,
  expAdj: 100,
  collectDelay: 0,
  headcountDelta: 0,
  avgSalary: "0",
  fixedCostDelta: "0",
  revGrowthPct: 0,
  capexAmount: "0",
  capexWeek: 1,
  netWeek: 1,
  netDelta: 0,
} as const;

export type CashForecastEngine = {
  revAdj: number;
  expAdj: number;
  collectDelay: number;
  headcountDelta: number;
  avgSalary: string;
  fixedCostDelta: string;
  revGrowthPct: number;
  capexAmount: string;
  capexWeek: number;
  netWeek: number;
  netDelta: number;
};

export type CashForecastPatch = Partial<{
  openingBalance: string;
  revAdj: number;
  expAdj: number;
  collectDelay: number;
  headcountDelta: number;
  avgSalary: string;
  fixedCostDelta: string;
  revGrowthPct: number;
  capexAmount: string;
  capexWeek: number;
  netWeek: number;
  netDelta: number;
}>;

export type CashForecastProposal = {
  /** Set once the row is stored. Absent on a proposal that has not been inserted. */
  id?: string;
  clientId: string;
  firmId: string | null;
  proposedBy: "financial_manager";
  runId: string | null;
  patch: CashForecastPatch;
  beforeValues: Partial<Record<CashForecastAdjustmentKey, string | number | null>>;
  note: string;
  status: CashForecastProposalStatus;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  appliedAt: string | null;
};

export type ConfirmedForecastAdjustments = {
  proposalId: string;
  appliedAt: string;
  appliedBy: string | null;
  patch: CashForecastPatch;
};

const KEY_SET = new Set<string>(CASH_FORECAST_ADJUSTMENT_KEYS);
const NOTE_MAX = 600;

const LABELS: Record<CashForecastAdjustmentKey, string> = {
  openingBalance: "Opening balance",
  revAdj: "Revenue",
  expAdj: "Expenses",
  collectDelay: "Collection delay",
  headcountDelta: "Headcount change",
  avgSalary: "Average monthly salary",
  fixedCostDelta: "Fixed cost change",
  revGrowthPct: "Revenue growth / week",
  capexAmount: "One-off capex",
  capexWeek: "Capex week",
  netWeek: "Net week",
  netDelta: "Week net change",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function finite(raw: unknown): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string" && raw.trim() !== "") {
    const n = Number(raw.replace(/,/g, "").trim());
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function moneyString(raw: unknown): string | null {
  const n = finite(raw);
  if (n == null) return null;
  return String(Math.round(n * 100) / 100);
}

function numberIn(raw: unknown, min: number, max: number): number | null {
  const n = finite(raw);
  if (n == null || n < min || n > max) return null;
  return n;
}

function integerIn(raw: unknown, min: number, max: number): number | null {
  const n = numberIn(raw, min, max);
  if (n == null || !Number.isInteger(n)) return null;
  return n;
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/** One structured patch. Unknown keys and out-of-range inputs are refused. */
export function parseCashForecastPatch(
  raw: unknown,
): { ok: true; patch: CashForecastPatch } | { ok: false; error: string } {
  const record = asRecord(raw);
  if (!record) return fail("patch must be an object of cash forecast inputs.");
  const keys = Object.keys(record);
  if (keys.length === 0) return fail("patch needs at least one cash forecast input.");
  const unknown = keys.filter((key) => !KEY_SET.has(key));
  if (unknown.length) {
    return fail(
      `That cash forecast key is not an adjustment (${unknown[0]}). Use ${CASH_FORECAST_ADJUSTMENT_KEYS.join(", ")}.`,
    );
  }
  const patch: CashForecastPatch = {};
  if ("openingBalance" in record) {
    const opening = moneyString(record.openingBalance);
    if (opening == null) return fail("openingBalance must be a number.");
    patch.openingBalance = opening;
  }
  if ("revAdj" in record) {
    const n = numberIn(record.revAdj, 50, 150);
    if (n == null) return fail("revAdj must be between 50 and 150.");
    patch.revAdj = n;
  }
  if ("expAdj" in record) {
    const n = numberIn(record.expAdj, 50, 150);
    if (n == null) return fail("expAdj must be between 50 and 150.");
    patch.expAdj = n;
  }
  if ("collectDelay" in record) {
    const n = integerIn(record.collectDelay, 0, 6);
    if (n == null) return fail("collectDelay must be a whole number of weeks from 0 to 6.");
    patch.collectDelay = n;
  }
  if ("headcountDelta" in record) {
    const n = integerIn(record.headcountDelta, -100, 100);
    if (n == null) return fail("headcountDelta must be a whole number from -100 to 100.");
    patch.headcountDelta = n;
  }
  if ("avgSalary" in record) {
    const n = finite(record.avgSalary);
    if (n == null || n < 0) return fail("avgSalary must be a number that is zero or more.");
    patch.avgSalary = String(Math.round(n * 100) / 100);
  }
  if ("fixedCostDelta" in record) {
    const amount = moneyString(record.fixedCostDelta);
    if (amount == null) return fail("fixedCostDelta must be a number.");
    patch.fixedCostDelta = amount;
  }
  if ("revGrowthPct" in record) {
    const n = numberIn(record.revGrowthPct, -10, 10);
    if (n == null) return fail("revGrowthPct must be between -10 and 10.");
    patch.revGrowthPct = n;
  }
  if ("capexAmount" in record) {
    const n = finite(record.capexAmount);
    if (n == null || n < 0) return fail("capexAmount must be a number that is zero or more.");
    patch.capexAmount = String(Math.round(n * 100) / 100);
  }
  if ("capexWeek" in record) {
    const n = integerIn(record.capexWeek, 1, 13);
    if (n == null) return fail("capexWeek must be a whole week from 1 to 13.");
    patch.capexWeek = n;
  }
  if ("netWeek" in record) {
    const n = integerIn(record.netWeek, 1, 13);
    if (n == null) return fail("netWeek must be a whole week from 1 to 13.");
    patch.netWeek = n;
  }
  if ("netDelta" in record) {
    const n = finite(record.netDelta);
    if (n == null || Math.abs(n) > 1e12) return fail("netDelta must be a number.");
    patch.netDelta = Math.round(n * 100) / 100;
  }
  return { ok: true, patch };
}

export function parseCashForecastProposalArgs(
  args: unknown,
): { ok: true; patch: CashForecastPatch; note: string } | { ok: false; error: string } {
  const record = asRecord(args);
  if (!record) return fail("A cash forecast proposal needs a reason and a patch.");
  const note = typeof record.reason === "string" ? record.reason.trim() : "";
  if (!note) return fail("A cash forecast proposal needs a reason a person can read.");
  if (note.length > NOTE_MAX) return fail(`reason must be at most ${NOTE_MAX} characters.`);
  const parsed = parseCashForecastPatch(record.patch);
  if (!parsed.ok) return parsed;
  return { ok: true, patch: parsed.patch, note };
}

function neutralBefore(key: CashForecastAdjustmentKey): string | number {
  if (key === "openingBalance") return "";
  if (key === "revAdj" || key === "expAdj") return 100;
  if (key === "collectDelay" || key === "headcountDelta" || key === "revGrowthPct") return 0;
  if (key === "capexWeek" || key === "netWeek") return 1;
  if (key === "netDelta") return 0;
  return "0";
}

/** Values already on the saved cashflow for the keys this patch changes. */
export function cashForecastBeforeValues(
  cashflow: unknown,
  patch: CashForecastPatch,
): Partial<Record<CashForecastAdjustmentKey, string | number | null>> {
  const cf = asRecord(cashflow);
  const out: Partial<Record<CashForecastAdjustmentKey, string | number | null>> = {};
  for (const key of Object.keys(patch) as CashForecastAdjustmentKey[]) {
    const raw = cf?.[key];
    if (raw == null || raw === "") out[key] = neutralBefore(key);
    else if (typeof raw === "number" && Number.isFinite(raw)) out[key] = raw;
    else if (typeof raw === "string") out[key] = raw;
    else out[key] = neutralBefore(key);
  }
  return out;
}

export function buildCashForecastProposal(input: {
  clientId: string;
  firmId?: string | null;
  runId?: string | null;
  patch: CashForecastPatch;
  beforeValues: CashForecastProposal["beforeValues"];
  note: string;
  at: string;
}): CashForecastProposal {
  return {
    clientId: input.clientId,
    firmId: input.firmId ?? null,
    proposedBy: "financial_manager",
    runId: input.runId ?? null,
    patch: input.patch,
    beforeValues: input.beforeValues,
    note: input.note,
    status: "pending",
    createdAt: input.at,
    decidedBy: null,
    decidedAt: null,
    appliedAt: null,
  };
}

export type ApplyCashForecastResult =
  | {
      applied: false;
      blocked: true;
      reason: string;
      cashflow: Record<string, unknown>;
      proposal: CashForecastProposal;
    }
  | {
      applied: true;
      blocked: false;
      cashflow: Record<string, unknown>;
      proposal: CashForecastProposal;
    };

function cashflowRecord(cashflow: unknown): { record: Record<string, unknown>; same: boolean } {
  const record = asRecord(cashflow);
  if (!record) return { record: {}, same: false };
  return { record, same: true };
}

/**
 * Write the patch onto a cashflow object only when confirm is true and the
 * proposal is still waiting. Does not mutate the cashflow it was given.
 * A blocked call returns that same object when it was already a record.
 */
export function applyCashForecastProposal(
  proposal: CashForecastProposal,
  cashflow: unknown,
  input: { confirm: boolean; decidedBy?: string | null; at?: string },
): ApplyCashForecastResult {
  const { record, same } = cashflowRecord(cashflow);
  const unchanged = same ? record : {};
  if (input.confirm !== true) {
    return {
      applied: false,
      blocked: true,
      reason: "confirm_required",
      cashflow: unchanged,
      proposal,
    };
  }
  if (proposal.status === "applied") {
    return {
      applied: false,
      blocked: true,
      reason: "already_applied",
      cashflow: unchanged,
      proposal,
    };
  }
  if (proposal.status !== "pending" && proposal.status !== "approved") {
    return {
      applied: false,
      blocked: true,
      reason: "not_pending",
      cashflow: unchanged,
      proposal,
    };
  }
  if (!proposal.id) {
    return {
      applied: false,
      blocked: true,
      reason: "proposal_missing",
      cashflow: unchanged,
      proposal,
    };
  }
  const at = input.at ?? new Date().toISOString();
  const decidedBy = input.decidedBy ?? null;
  const proposalId = proposal.id ?? "";
  const next: Record<string, unknown> = { ...record, ...proposal.patch };
  const confirmed: ConfirmedForecastAdjustments = {
    proposalId,
    appliedAt: at,
    appliedBy: decidedBy,
    patch: proposal.patch,
  };
  next.confirmedForecastAdjustments = confirmed;
  return {
    applied: true,
    blocked: false,
    cashflow: next,
    proposal: {
      ...proposal,
      status: "applied",
      decidedBy,
      decidedAt: at,
      appliedAt: at,
    },
  };
}

export function rejectCashForecastProposal(
  proposal: CashForecastProposal,
  input: { decidedBy?: string | null; at?: string } = {},
): { ok: true; proposal: CashForecastProposal } | { ok: false; reason: string; proposal: CashForecastProposal } {
  if (proposal.status !== "pending" && proposal.status !== "approved") {
    return { ok: false, reason: "not_pending", proposal };
  }
  const at = input.at ?? new Date().toISOString();
  return {
    ok: true,
    proposal: {
      ...proposal,
      status: "rejected",
      decidedBy: input.decidedBy ?? null,
      decidedAt: at,
      appliedAt: null,
    },
  };
}

export function readConfirmedForecastAdjustments(cashflow: unknown): ConfirmedForecastAdjustments | null {
  const cf = asRecord(cashflow);
  const raw = asRecord(cf?.confirmedForecastAdjustments);
  if (!raw) return null;
  const parsed = parseCashForecastPatch(raw.patch);
  if (!parsed.ok) return null;
  const proposalId = typeof raw.proposalId === "string" ? raw.proposalId : "";
  const appliedAt = typeof raw.appliedAt === "string" ? raw.appliedAt : "";
  if (!proposalId || !appliedAt) return null;
  return {
    proposalId,
    appliedAt,
    appliedBy: typeof raw.appliedBy === "string" ? raw.appliedBy : null,
    patch: parsed.patch,
  };
}

/**
 * Autosave strips what-if knobs so an unsaved slider cannot become the base.
 * A confirmed proposal is the base, so those keys are written back.
 * Opening balance stays whatever the Cash page already put on the payload.
 */
export function withConfirmedForecastAdjustments<T extends Record<string, unknown>>(
  payload: T,
  source: unknown,
): T {
  const confirmed = readConfirmedForecastAdjustments(source);
  if (!confirmed) return payload;
  const knobs: CashForecastPatch = { ...confirmed.patch };
  delete knobs.openingBalance;
  return {
    ...payload,
    ...knobs,
    confirmedForecastAdjustments: confirmed,
  };
}

export function engineFromConfirmed(confirmed: ConfirmedForecastAdjustments | null): CashForecastEngine {
  const engine: CashForecastEngine = { ...NEUTRAL_CASH_FORECAST_ENGINE };
  if (!confirmed) return engine;
  const patch = confirmed.patch;
  if (patch.revAdj != null) engine.revAdj = patch.revAdj;
  if (patch.expAdj != null) engine.expAdj = patch.expAdj;
  if (patch.collectDelay != null) engine.collectDelay = patch.collectDelay;
  if (patch.headcountDelta != null) engine.headcountDelta = patch.headcountDelta;
  if (patch.avgSalary != null) engine.avgSalary = patch.avgSalary;
  if (patch.fixedCostDelta != null) engine.fixedCostDelta = patch.fixedCostDelta;
  if (patch.revGrowthPct != null) engine.revGrowthPct = patch.revGrowthPct;
  if (patch.capexAmount != null) engine.capexAmount = patch.capexAmount;
  if (patch.capexWeek != null) engine.capexWeek = patch.capexWeek;
  if (patch.netWeek != null) engine.netWeek = patch.netWeek;
  if (patch.netDelta != null) engine.netDelta = patch.netDelta;
  return engine;
}

function showValue(key: CashForecastAdjustmentKey, value: string | number | null | undefined): string {
  if (value == null || value === "") return key === "openingBalance" ? "not set" : String(neutralBefore(key));
  if (key === "revAdj" || key === "expAdj" || key === "revGrowthPct") return `${value}%`;
  if (key === "collectDelay") return `${value}w`;
  return String(value);
}

export function cashForecastDeltaLines(input: {
  patch: CashForecastPatch;
  beforeValues: CashForecastProposal["beforeValues"];
}): Array<{ key: CashForecastAdjustmentKey; text: string }> {
  return (Object.keys(input.patch) as CashForecastAdjustmentKey[]).map((key) => ({
    key,
    text: `${LABELS[key]} ${showValue(key, input.beforeValues[key])} → ${showValue(key, input.patch[key] ?? null)}`,
  }));
}

export function figureDecisionError(message: string): string {
  if (/confirm_required/i.test(message)) return "Confirm the change before it is saved.";
  if (/not_allowed/i.test(message)) return "You cannot change these figures.";
  if (/not_pending/i.test(message)) return "That proposal is no longer waiting.";
  if (/already_applied/i.test(message)) return "That change is already saved.";
  if (/proposal_missing/i.test(message)) return "That proposal is not on file.";
  if (/budget_missing/i.test(message)) return "There is no budget on file to update.";
  return message;
}

export const cashForecastDecisionError = figureDecisionError;

const BUDGET_KEY_SET = new Set<string>(BUDGET_FIGURE_KEYS);
const WATERFALL_KEY_SET = new Set<string>(WATERFALL_FIGURE_KEYS);
const NON_NEGATIVE_WATERFALL = new Set<WaterfallFigureKey>(["revenue", "cogs", "fixedCosts"]);

export function parseBudgetFigurePatch(
  raw: unknown,
): { ok: true; patch: BudgetFigurePatch } | { ok: false; error: string } {
  const record = asRecord(raw);
  if (!record) return fail("patch must be an object of budget inputs.");
  const keys = Object.keys(record);
  if (!keys.length) return fail("patch needs at least one budget input.");
  const unknown = keys.find((key) => !BUDGET_KEY_SET.has(key));
  if (unknown) {
    return fail(
      `That budget key is not an adjustment (${unknown}). Use ${BUDGET_FIGURE_KEYS.join(", ")}.`,
    );
  }
  const patch: BudgetFigurePatch = {};
  if ("openingCash" in record) {
    const n = finite(record.openingCash);
    if (n == null) return fail("openingCash must be a number.");
    patch.openingCash = Math.round(n * 100) / 100;
  }
  if ("gpPct" in record) {
    const n = numberIn(record.gpPct, 0, 100);
    if (n == null) return fail("gpPct must be between 0 and 100.");
    patch.gpPct = Math.round(n * 100) / 100;
  }
  for (const key of ["debtorDays", "creditorDays", "inventoryDays"] as const) {
    if (!(key in record)) continue;
    const n = integerIn(record[key], 0, 365);
    if (n == null) return fail(`${key} must be a whole number of days from 0 to 365.`);
    patch[key] = n;
  }
  return { ok: true, patch };
}

export function parseWaterfallFigurePatch(
  raw: unknown,
): { ok: true; patch: WaterfallFigurePatch } | { ok: false; error: string } {
  const record = asRecord(raw);
  if (!record) return fail("patch must be an object of profitability inputs.");
  const keys = Object.keys(record);
  if (!keys.length) return fail("patch needs at least one profitability input.");
  const unknown = keys.find((key) => !WATERFALL_KEY_SET.has(key));
  if (unknown) {
    return fail(
      `That profitability key is not an adjustment (${unknown}). Use ${WATERFALL_FIGURE_KEYS.join(", ")}.`,
    );
  }
  const patch: WaterfallFigurePatch = {};
  for (const key of WATERFALL_FIGURE_KEYS) {
    if (!(key in record)) continue;
    const n = finite(record[key]);
    if (n == null) return fail(`${key} must be a number.`);
    if (NON_NEGATIVE_WATERFALL.has(key) && n < 0) return fail(`${key} must be zero or more.`);
    if (Math.abs(n) > 1e12) return fail(`${key} is out of range.`);
    patch[key] = Math.round(n * 100) / 100;
  }
  return { ok: true, patch };
}

export type FigureProposal = {
  id?: string;
  clientId: string;
  firmId: string | null;
  proposedBy: "financial_manager";
  runId: string | null;
  surface: FigureSurface;
  patch: CashForecastPatch | BudgetFigurePatch | WaterfallFigurePatch;
  beforeValues: Record<string, string | number | null>;
  note: string;
  status: CashForecastProposalStatus;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  appliedAt: string | null;
};

export function parseFigureProposalArgs(
  args: unknown,
):
  | { ok: true; surface: FigureSurface; patch: FigureProposal["patch"]; note: string }
  | { ok: false; error: string } {
  const record = asRecord(args);
  if (!record) return fail("A figure proposal needs a surface, a reason, and a patch.");
  const surface = record.surface;
  if (surface !== "cash" && surface !== "budget" && surface !== "waterfall") {
    return fail("surface must be cash, budget, or waterfall.");
  }
  const note = typeof record.reason === "string" ? record.reason.trim() : "";
  if (!note) return fail("A figure proposal needs a reason a person can read.");
  if (note.length > NOTE_MAX) return fail(`reason must be at most ${NOTE_MAX} characters.`);
  if (surface === "cash") {
    const parsed = parseCashForecastPatch(record.patch);
    if (!parsed.ok) return parsed;
    return { ok: true, surface, patch: parsed.patch, note };
  }
  if (surface === "budget") {
    const parsed = parseBudgetFigurePatch(record.patch);
    if (!parsed.ok) return parsed;
    return { ok: true, surface, patch: parsed.patch, note };
  }
  const parsed = parseWaterfallFigurePatch(record.patch);
  if (!parsed.ok) return parsed;
  return { ok: true, surface, patch: parsed.patch, note };
}

function storedScalar(raw: unknown, fallback: string | number): string | number | null {
  if (raw == null || raw === "") return fallback;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") return raw;
  return fallback;
}

/** Current values for the keys in this patch. Budget days are read from budget.wc. */
export function figureBeforeValues(
  surface: FigureSurface,
  stored: unknown,
  patch: FigureProposal["patch"],
): Record<string, string | number | null> {
  const record = asRecord(stored);
  const out: Record<string, string | number | null> = {};
  if (surface === "cash") return cashForecastBeforeValues(stored, patch as CashForecastPatch);
  if (surface === "budget") {
    const wc = asRecord(record?.wc);
    for (const key of Object.keys(patch) as BudgetFigureKey[]) {
      if (key === "debtorDays" || key === "creditorDays" || key === "inventoryDays") {
        out[key] = storedScalar(wc?.[key], 0);
      } else {
        out[key] = storedScalar(record?.[key], 0);
      }
    }
    return out;
  }
  for (const key of Object.keys(patch)) {
    out[key] = storedScalar(record?.[key], 0);
  }
  return out;
}

export function buildFigureProposal(input: {
  clientId: string;
  firmId?: string | null;
  runId?: string | null;
  surface: FigureSurface;
  patch: FigureProposal["patch"];
  beforeValues: Record<string, string | number | null>;
  note: string;
  at: string;
}): FigureProposal {
  return {
    clientId: input.clientId,
    firmId: input.firmId ?? null,
    proposedBy: "financial_manager",
    runId: input.runId ?? null,
    surface: input.surface,
    patch: input.patch,
    beforeValues: input.beforeValues,
    note: input.note,
    status: "pending",
    createdAt: input.at,
    decidedBy: null,
    decidedAt: null,
    appliedAt: null,
  };
}

export type FigureBooks = {
  cashflow?: unknown;
  budget?: unknown;
  financials?: unknown;
};

export type ApplyFigureResult = {
  applied: boolean;
  blocked: boolean;
  reason?: string;
  proposal: FigureProposal;
  cashflow: unknown;
  budget: unknown;
  financials: unknown;
};

function gateProposal(
  proposal: FigureProposal,
  books: FigureBooks,
  input: { confirm: boolean },
): ApplyFigureResult | null {
  const unchanged = {
    applied: false as const,
    blocked: true as const,
    proposal,
    cashflow: books.cashflow,
    budget: books.budget,
    financials: books.financials,
  };
  if (input.confirm !== true) return { ...unchanged, reason: "confirm_required" };
  if (proposal.status === "applied") return { ...unchanged, reason: "already_applied" };
  if (proposal.status !== "pending" && proposal.status !== "approved") {
    return { ...unchanged, reason: "not_pending" };
  }
  if (!proposal.id) return { ...unchanged, reason: "proposal_missing" };
  return null;
}

function decided(proposal: FigureProposal, at: string, decidedBy: string | null): FigureProposal {
  return { ...proposal, status: "applied", decidedBy, decidedAt: at, appliedAt: at };
}

function applyBudgetPatch(budget: Record<string, unknown>, patch: BudgetFigurePatch): Record<string, unknown> {
  const next: Record<string, unknown> = { ...budget };
  if (patch.openingCash != null) next.openingCash = patch.openingCash;
  if (patch.gpPct != null) next.gpPct = patch.gpPct;
  const days = ["debtorDays", "creditorDays", "inventoryDays"] as const;
  if (days.some((key) => patch[key] != null)) {
    const wc = asRecord(next.wc) ?? {};
    next.wc = {
      ...wc,
      ...(patch.debtorDays != null ? { debtorDays: patch.debtorDays } : {}),
      ...(patch.creditorDays != null ? { creditorDays: patch.creditorDays } : {}),
      ...(patch.inventoryDays != null ? { inventoryDays: patch.inventoryDays } : {}),
    };
  }
  return next;
}

function applyWaterfallPatch(
  financials: Record<string, unknown>,
  patch: WaterfallFigurePatch,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...financials };
  for (const key of WATERFALL_FIGURE_KEYS) {
    if (patch[key] == null) continue;
    const existing = financials[key];
    next[key] = typeof existing === "string" ? String(patch[key]) : patch[key];
  }
  return next;
}

/**
 * One apply path for cash, budget, and the profitability waterfall.
 * Confirm is required. A blocked call does not copy or change the stored books.
 */
export function applyFigureProposal(
  proposal: FigureProposal,
  books: FigureBooks,
  input: { confirm: boolean; decidedBy?: string | null; at?: string },
): ApplyFigureResult {
  const blocked = gateProposal(proposal, books, input);
  if (blocked) return blocked;
  const at = input.at ?? new Date().toISOString();
  const decidedBy = input.decidedBy ?? null;
  if (proposal.surface === "cash") {
    const cash = applyCashForecastProposal(
      { ...proposal, patch: proposal.patch as CashForecastPatch, beforeValues: {} },
      books.cashflow,
      { confirm: true, decidedBy, at },
    );
    return {
      applied: cash.applied,
      blocked: cash.blocked,
      reason: cash.applied ? undefined : cash.reason,
      proposal: cash.applied ? decided(proposal, at, decidedBy) : proposal,
      cashflow: cash.cashflow,
      budget: books.budget,
      financials: books.financials,
    };
  }
  if (proposal.surface === "budget") {
    const doc = asRecord(books.budget);
    if (!doc || doc.version !== 1) {
      return {
        applied: false,
        blocked: true,
        reason: "budget_missing",
        proposal,
        cashflow: books.cashflow,
        budget: books.budget,
        financials: books.financials,
      };
    }
    return {
      applied: true,
      blocked: false,
      proposal: decided(proposal, at, decidedBy),
      cashflow: books.cashflow,
      budget: applyBudgetPatch(doc, proposal.patch as BudgetFigurePatch),
      financials: books.financials,
    };
  }
  const fields = asRecord(books.financials) ?? {};
  return {
    applied: true,
    blocked: false,
    proposal: decided(proposal, at, decidedBy),
    cashflow: books.cashflow,
    budget: books.budget,
    financials: applyWaterfallPatch(fields, proposal.patch as WaterfallFigurePatch),
  };
}

export function rejectFigureProposal(
  proposal: FigureProposal,
  input: { decidedBy?: string | null; at?: string } = {},
): { ok: true; proposal: FigureProposal } | { ok: false; reason: string; proposal: FigureProposal } {
  if (proposal.status !== "pending" && proposal.status !== "approved") {
    return { ok: false, reason: "not_pending", proposal };
  }
  const at = input.at ?? new Date().toISOString();
  return {
    ok: true,
    proposal: {
      ...proposal,
      status: "rejected",
      decidedBy: input.decidedBy ?? null,
      decidedAt: at,
      appliedAt: null,
    },
  };
}

const FIGURE_LABELS: Record<string, string> = {
  ...LABELS,
  openingCash: "Opening cash",
  gpPct: "Gross profit %",
  debtorDays: "Debtor days",
  creditorDays: "Creditor days",
  inventoryDays: "Inventory days",
  revenue: "Revenue",
  cogs: "Cost of sales",
  grossProfit: "Gross profit",
  fixedCosts: "Operating expenses",
  ebit: "Operating profit",
  interest: "Interest",
  tax: "Tax",
  netIncome: "Net profit",
};

export function figureDeltaLines(proposal: {
  surface: FigureSurface;
  patch: FigureProposal["patch"];
  beforeValues: Record<string, string | number | null>;
}): Array<{ key: string; text: string }> {
  const patch = proposal.patch as Record<string, string | number | undefined>;
  const keys = Object.keys(patch).filter((key) => !(key === "netWeek" && patch.netDelta != null));
  return keys.map((key) => {
    const after = patch[key];
    const before = proposal.beforeValues[key];
    if (key === "netDelta") {
      const week = patch.netWeek ?? proposal.beforeValues.netWeek ?? 1;
      const delta = typeof after === "number" ? after : Number(after);
      const shown = Number.isFinite(delta) ? `${delta > 0 ? "+" : ""}${delta}` : String(after ?? "");
      return { key, text: `Week ${week} net ${shown}` };
    }
    const label = FIGURE_LABELS[key] ?? key;
    const show = (value: string | number | null | undefined) => {
      if (value == null || value === "") return "not set";
      if (key === "gpPct") return `${value}%`;
      if (key.endsWith("Days")) return `${value} days`;
      if (key === "revAdj" || key === "expAdj" || key === "revGrowthPct") return `${value}%`;
      if (key === "collectDelay") return `${value}w`;
      return String(value);
    };
    return { key, text: `${label} ${show(before)} → ${show(after)}` };
  });
}

/** Add a week-net change onto an already computed weekly net. Week 1 is index 0. */
export function applyWeekNetDelta(net: readonly number[], week: number, delta: number): number[] {
  const next = net.slice();
  if (!Number.isFinite(delta) || delta === 0) return next;
  const index = Math.round(week) - 1;
  if (!Number.isInteger(index) || index < 0 || index >= next.length) return next;
  next[index] += delta;
  return next;
}

const CARD_TITLE: Record<FigureSurface, string> = {
  cash: "Cash forecast change waiting for you",
  budget: "Budget change waiting for you",
  waterfall: "Waterfall change waiting for you",
};

/** Copy for the chat card. Owners can read it. Only a writer gets the two decisions. */
export function figureProposalCardCopy(input: {
  surface: FigureSurface;
  patch: FigureProposal["patch"];
  beforeValues: Record<string, string | number | null>;
  canDecide: boolean;
}): { title: string; lines: string[]; actions: readonly ["Confirm and apply", "Reject"] | readonly [] } {
  return {
    title: CARD_TITLE[input.surface],
    lines: figureDeltaLines(input).map((line) => line.text),
    actions: input.canDecide ? ["Confirm and apply", "Reject"] : [],
  };
}

function askText(question: string): string {
  return question.replace(/\s+/g, " ").trim();
}

function isFigureQuestion(question: string): boolean {
  const q = askText(question).toLowerCase();
  if (!q) return true;
  if (/\?\s*$/.test(q)) return true;
  if (/^(what|which|who|why|how|when|where|whose|should|can|could|would|do|does|did|is|are|am|will)\b/.test(q)) {
    return true;
  }
  return false;
}

/**
 * A direct ask to change one figure. Questions and "propose next steps" stay
 * on the numbers chat. Week net ("W1 net by R100") is a cash patch.
 */
export function parseFigureProposalAsk(
  question: string,
): { surface: FigureSurface; patch: FigureProposal["patch"]; reason: string } | null {
  const q = askText(question);
  if (!q || isFigureQuestion(q)) return null;
  if (/\bpropose next steps\b/i.test(q)) return null;
  if (!/\b(propose|change|adjust|increase|decrease|reduce|lower|raise)\b/i.test(q)) return null;
  const lower = q.toLowerCase();
  let surface: FigureSurface | null = null;
  if (/\bwaterfall\b|\bprofitability\b/.test(lower)) surface = "waterfall";
  else if (/\bbudget\b/.test(lower)) surface = "budget";
  else if (/\bcash forecast\b|\bcashflow\b|\b13-week\b|\bw\d{1,2}\s+net\b/.test(lower)) surface = "cash";
  if (surface !== "cash") return null;
  const week = lower.match(/\bw(\d{1,2})\s+net\b/);
  const amount = lower.match(/\bby\s+(?:r|zar|\$|usd)?\s*(-?\d[\d\s]*(?:\.\d+)?)/);
  if (!week || !amount) return null;
  const netWeek = Number(week[1]);
  let netDelta = Number(amount[1].replace(/\s/g, ""));
  if (!Number.isInteger(netWeek) || !Number.isFinite(netDelta)) return null;
  if (/\b(reduce|lower|decrease|cut)\b/.test(lower) && netDelta > 0) netDelta = -netDelta;
  const reason = q.slice(0, 600);
  const parsed = parseFigureProposalArgs({ surface: "cash", reason, patch: { netWeek, netDelta } });
  if (!parsed.ok) return null;
  return { surface: "cash", patch: parsed.patch, reason: parsed.note };
}

export type FigureProposalTurn =
  | {
      kind: "propose";
      tool: typeof FIGURE_PROPOSAL_TOOL;
      args: { surface: FigureSurface; reason: string; patch: FigureProposal["patch"] };
    }
  | { kind: "refuse"; answer: string };

/**
 * The accountant chat on the Financial Manager can propose. The same sentence
 * to the Analyst or the Advisor is a refusal. Other questions stay on ask-ai.
 */
export function figureProposalTurn(agent: string | null, question: string): FigureProposalTurn | null {
  const parsed = parseFigureProposalAsk(question);
  if (!parsed) return null;
  if (agent === "financial_manager") {
    return {
      kind: "propose",
      tool: FIGURE_PROPOSAL_TOOL,
      args: { surface: parsed.surface, reason: parsed.reason, patch: parsed.patch },
    };
  }
  if (agent === "analyst") {
    return { kind: "refuse", answer: "The Analyst cannot propose a figure change. Nothing was saved." };
  }
  if (agent === "advisor") {
    return { kind: "refuse", answer: "The Advisor cannot propose a figure change. Nothing was saved." };
  }
  return null;
}

export function proposeFigureToolSchema() {
  return {
    name: FIGURE_PROPOSAL_TOOL,
    description:
      "Call this when the user asks to add or change a cash, budget, or waterfall figure. Calling it is the proposal. Do not refuse, and do not stall to say a proposal or approval must come first. Saves a pending proposal only. Does not change the saved figures. After it succeeds, tell the person to Confirm on the Cash forecast page for a cash change. Add CapEx, one-off CapEx, or CapEx in week N with surface cash and patch capexAmount plus capexWeek. Add an outflow in week N that is not named CapEx with surface cash, netWeek, and a negative netDelta. If they named CapEx, use the CapEx keys.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      required: ["surface", "reason", "patch"],
      properties: {
        surface: {
          type: "string",
          enum: ["cash", "budget", "waterfall"],
          description:
            "cash writes clients.cashflow after confirm. budget writes clients.budget. waterfall writes the period P&L on clients.financials.",
        },
        reason: {
          type: "string",
          minLength: 1,
          maxLength: NOTE_MAX,
          description: "Why this change is proposed. A person reads this before confirming.",
        },
        patch: {
          type: "object",
          description:
            "cash: openingBalance, revAdj, expAdj, collectDelay, headcountDelta, avgSalary, fixedCostDelta, revGrowthPct, capexAmount, capexWeek, netWeek (1-13), netDelta (amount added to that week's net). CapEx or one-off CapEx in week N is capexAmount plus capexWeek. An outflow in week N that is not CapEx is netWeek plus a negative netDelta. Week 1 net by 100 is netWeek 1 and netDelta 100. budget: openingCash, gpPct, debtorDays, creditorDays, inventoryDays. waterfall: revenue, cogs, grossProfit, fixedCosts, ebit, interest, tax, netIncome.",
        },
      },
    },
  };
}
