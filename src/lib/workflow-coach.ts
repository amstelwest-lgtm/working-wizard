/**
 * Accountant reading path — navigation only.
 *
 * Data → Health → Pillars → Profitability → Cash → Budget → Actions
 *   1. Data confirms the books (Xero, QuickBooks, or an upload) on Client Brain
 *   2. Health score diagnoses the problem
 *   3. Pillars show where it hurts
 *   4–6. Evidence: waterfall, 13-week cash, budget
 *   7. Assign the moves
 *
 * Continue prefers the next step that is not yet done, then the immediate
 * next page, so a deliverable is never a dead end. One Continue lives on
 * the sticky strip.
 */

export const COACH_STEPS = [
  { id: "data", label: "Data", tab: "summary" },
  { id: "health", label: "Health", tab: "ratios", focus: "health" },
  { id: "pillars", label: "Pillars", tab: "ratios", focus: "pillars" },
  { id: "profit", label: "Profitability", tab: "profit" },
  { id: "cash", label: "Cash", tab: "cash" },
  { id: "budget", label: "Budget", tab: "budget" },
  { id: "actions", label: "Actions", tab: "plan" },
] as const;

export type CoachStepId = (typeof COACH_STEPS)[number]["id"];
export type CoachStep = (typeof COACH_STEPS)[number];

/** Pages that show the coach but are not themselves a spine step. */
export type CoachSidePage = "ask" | "reports" | "advisory" | "collections" | "payables";
export type CoachPage = CoachStepId | CoachSidePage;

export type CoachDone = Partial<Record<CoachStepId, boolean>>;

export type CoachDestination = {
  tab: string;
  focus?: "health" | "pillars";
  /** Intent token the destination reads (`?coach=`). */
  coach?: string;
  /** Short reason from Milōn Bot (`?why=`). */
  why?: string;
  /** Last step: stay on Action Plan and point at the work list. */
  assign?: boolean;
};

const STEP_IDS = new Set<string>(COACH_STEPS.map((s) => s.id));

const DELIVERABLE_TABS = new Set([
  "summary",
  "ask",
  "ratios",
  "profit",
  "cash",
  "collections",
  "payables",
  "budget",
  "reports",
  "plan",
  "advisory",
]);

const NEXT_CUE: Record<CoachStepId, string> = {
  data: "confirm the books are in — sync or upload",
  health: "read the health score",
  pillars: "drill into the pillars",
  profit: "open the profitability waterfall",
  cash: "open the 13-week cash forecast",
  budget: "check the budget",
  actions: "assign the actions",
};

const DEFAULT_BECAUSE: Record<CoachPage, string> = {
  data: "the read starts by checking the books are current",
  health: "the score diagnoses the problem before you open the detail",
  pillars: "each pillar shows where the score actually hurts",
  profit: "the waterfall is the evidence for margin — how revenue becomes profit",
  cash: "the 13-week forecast is the evidence for liquidity",
  collections: "the chase list names who owes what, from the aged receivables report",
  payables: "the payables list names who to pay, delay, or renegotiate, from the aged payables report",
  budget: "the budget tests whether the plan fits the numbers",
  actions: "the read is done — these are the moves to assign",
  ask: "Milōn Bot drafts the next read from what is already on file",
  reports: "the board pack packages the diagnosis for the owner",
  advisory: "the note is how the owner hears what you just read",
};

type Intent = { page: CoachPage; because: string };

const INTENTS: Record<string, Intent> = {
  data: { page: "data", because: DEFAULT_BECAUSE.data },
  health: { page: "health", because: DEFAULT_BECAUSE.health },
  pillars: { page: "pillars", because: "a pillar is where the score actually hurts" },
  margin: {
    page: "profit",
    because: "margin is where this business hurts, and the waterfall shows the leak",
  },
  assets: {
    page: "profit",
    because:
      "asset efficiency is the weak pillar, and the waterfall shows whether those assets earn their keep",
  },
  liquidity: {
    page: "cash",
    because: "liquidity is the weak spot, and the 13-week forecast shows whether cash holds",
  },
  financing: {
    page: "budget",
    because: "financing is the weak pillar, and the budget shows what that structure can carry",
  },
  budget: { page: "budget", because: DEFAULT_BECAUSE.budget },
  collections: { page: "collections", because: DEFAULT_BECAUSE.collections },
  payables: { page: "payables", because: DEFAULT_BECAUSE.payables },
  actions: { page: "actions", because: "the diagnosis is ready to become assigned moves" },
};

export function isCoachSurface(tab: string): boolean {
  return DELIVERABLE_TABS.has(tab);
}

export function coachPageForTab(tab: string, focus?: string | null): CoachPage | null {
  switch (tab) {
    case "summary":
      return "data";
    case "ratios":
      return focus === "pillars" ? "pillars" : "health";
    case "profit":
      return "profit";
    case "cash":
      return "cash";
    case "collections":
      return "collections";
    case "payables":
      return "payables";
    case "budget":
      return "budget";
    case "plan":
      return "actions";
    case "ask":
    case "reports":
    case "advisory":
      return tab;
    default:
      return null;
  }
}

export function isCoachStep(page: string): page is CoachStepId {
  return STEP_IDS.has(page);
}

/** A pillar score under the healthy cutoff (65) is where it hurts. */
export function pillarIsWeak(score: number | null | undefined): boolean {
  return score != null && Number.isFinite(score) && score < 65;
}

export type PillarEvidenceId = "profit" | "assets" | "financing" | "cash";

const PILLAR_EVIDENCE: Record<PillarEvidenceId, { coach: string; label: string; tab: string }> = {
  profit: { coach: "margin", label: "See it on Profitability", tab: "profit" },
  assets: { coach: "assets", label: "See it on Profitability", tab: "profit" },
  cash: { coach: "liquidity", label: "See it on Cash", tab: "cash" },
  financing: { coach: "financing", label: "See it on Budget", tab: "budget" },
};

export function evidenceForPillar(id: string): (CoachDestination & { label: string }) | null {
  const row = PILLAR_EVIDENCE[id as PillarEvidenceId];
  if (!row) return null;
  return { tab: row.tab, coach: row.coach, label: row.label };
}

/** Owner briefing tabs → accountant deliverable + coach intent. */
export function evidenceForBriefingTab(
  tab: "cash" | "waterfall" | "budget",
): CoachDestination & { label: string } {
  if (tab === "cash") return { tab: "cash", coach: "liquidity", label: "See it on Cash" };
  if (tab === "waterfall")
    return { tab: "profit", coach: "margin", label: "See it on Profitability" };
  return { tab: "budget", coach: "budget", label: "See it on Budget" };
}

export function clipCoachWhy(text: string): string {
  const clean = text.replace(/[<>"]/g, "").replace(/\s+/g, " ").trim();
  if (clean.length <= 140) return clean;
  return `${clean.slice(0, 137).trimEnd()}…`;
}

export function nextCoachStep(current: CoachStepId | null, done: CoachDone): CoachStep | null {
  const start = current == null ? 0 : COACH_STEPS.findIndex((s) => s.id === current) + 1;
  for (let i = Math.max(0, start); i < COACH_STEPS.length; i++) {
    if (!done[COACH_STEPS[i].id]) return COACH_STEPS[i];
  }
  if (current != null) {
    const idx = COACH_STEPS.findIndex((s) => s.id === current);
    if (idx >= 0 && idx < COACH_STEPS.length - 1) return COACH_STEPS[idx + 1];
  }
  return null;
}

function becauseFor(page: CoachPage, intent: string | null, why: string | null): string {
  const known = intent ? INTENTS[intent] : undefined;
  const matches = Boolean(known && known.page === page);
  const base = matches && known ? known.because : DEFAULT_BECAUSE[page];
  const heard = matches && why ? clipCoachWhy(why) : "";
  if (heard) return `Milōn Bot asked “${heard}”, and ${base}`;
  return base;
}

export function destinationForStep(step: CoachStep): CoachDestination {
  return {
    tab: step.tab,
    ...("focus" in step ? { focus: step.focus } : {}),
  };
}

export type CoachView = {
  currentId: CoachStepId | null;
  because: string;
  nextCue: string;
  cta: string;
  destination: CoachDestination;
};

export function coachView(input: {
  page: CoachPage | null;
  intent?: string | null;
  why?: string | null;
  done?: CoachDone;
}): CoachView {
  const page = input.page;
  const currentId = page && isCoachStep(page) ? page : null;
  const next = nextCoachStep(currentId, input.done ?? {});
  const because = page ? becauseFor(page, input.intent ?? null, input.why ?? null) : "";
  if (!next) {
    return {
      currentId,
      because,
      nextCue: "assign each move to an owner",
      cta: "Assign a move",
      destination: { tab: "plan", assign: true },
    };
  }
  return {
    currentId,
    because,
    nextCue: NEXT_CUE[next.id],
    cta: `Continue → ${next.label}`,
    destination: destinationForStep(next),
  };
}

type HandoffKind =
  | "data"
  | "health"
  | "pillars"
  | "profit"
  | "cash"
  | "collections"
  | "payables"
  | "budget"
  | "actions";

const HANDOFF: Record<HandoffKind, CoachDestination & { label: string }> = {
  data: { tab: "summary", coach: "data", label: "Open Data" },
  health: { tab: "ratios", focus: "health", coach: "health", label: "Open Health" },
  pillars: { tab: "ratios", focus: "pillars", coach: "pillars", label: "Open Pillars" },
  profit: { tab: "profit", coach: "margin", label: "Open Profitability" },
  cash: { tab: "cash", coach: "liquidity", label: "Open Cash" },
  collections: { tab: "collections", coach: "collections", label: "Open Collections" },
  payables: { tab: "payables", coach: "payables", label: "Open Payables" },
  budget: { tab: "budget", coach: "budget", label: "Open Budget" },
  actions: { tab: "plan", coach: "actions", label: "Open Actions" },
};

/**
 * When a Milōn Bot question is about a deliverable, hand the accountant
 * that page plus a coach intent. Null when the question does not route.
 */
export function deliverableHandoff(
  question: string,
): (CoachDestination & { label: string; why: string }) | null {
  const q = question.toLowerCase().replace(/\s+/g, " ").trim();
  if (!q) return null;
  let kind: HandoffKind | null = null;
  if (/\b(action plan|assign(ed|ing)?|next steps?)\b/.test(q)) kind = "actions";
  else if (/\bbudget\b/.test(q)) kind = "budget";
  else if (/\b(payables?|aged creditors?|bills? to pay|suppliers? to pay)\b/.test(q))
    kind = "payables";
  else if (/\b(collections?|chase list|aged receivables?|aged debtors?)\b/.test(q))
    kind = "collections";
  else if (/\b(cash|liquidity|runway|forecast|13-week|13 week|debtor|working capital)\b/.test(q))
    kind = "cash";
  else if (/\b(margin|waterfall|profit|gross)\b/.test(q)) kind = "profit";
  else if (
    /\b(pillar|drag|weakest)\b/.test(q) ||
    /where (it|this) hurts/.test(q) ||
    /where should we focus/.test(q)
  )
    kind = "pillars";
  else if (
    /\b(xero|quickbooks|qbo)\b/.test(q) ||
    /\b(sync(?:ed|ing)?|upload(?:ed|ing)?)\b/.test(q) ||
    /data (?:is |up to date|current)/.test(q) ||
    /\bbooks (?:are |up to date|current)\b/.test(q)
  )
    kind = "data";
  else if (/\b(health|score|ratios?|diagnos)/.test(q)) kind = "health";
  if (!kind) return null;
  return { ...HANDOFF[kind], why: clipCoachWhy(question) };
}

/** Ledger link fields the Data step needs. Null when that ledger is not connected. */
export type DataSyncLink = {
  lastSyncedAt: string | null;
  syncStatus: string;
  periodLabel?: string | null;
} | null;

/**
 * A sync counts when it finished with a timestamp and the latest attempt
 * is not an error. Connected-but-never-synced does not count.
 */
export function syncSucceeded(link: DataSyncLink | undefined): boolean {
  if (!link?.lastSyncedAt) return false;
  if (!Number.isFinite(Date.parse(link.lastSyncedAt))) return false;
  return link.syncStatus !== "error";
}

/**
 * Data is done when Xero or QuickBooks has a successful sync, or a financial
 * snapshot is already on file (an upload writes one). Continue stays available
 * either way — this only drives the check on the strip.
 */
export function dataStepDone(input: {
  xero?: DataSyncLink;
  qbo?: DataSyncLink;
  snapshotCount?: number;
}): boolean {
  return syncSucceeded(input.xero) || syncSucceeded(input.qbo) || (input.snapshotCount ?? 0) > 0;
}

function formatSyncStamp(iso: string): string {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(d);
}

/** One line for the Client Brain data section: latest successful sync, else the snapshot period. */
export function dataFreshnessLine(input: {
  xero?: DataSyncLink;
  qbo?: DataSyncLink;
  snapshotPeriod?: string | null;
}): string {
  const rows: { label: string; at: string; period: string | null }[] = [];
  if (syncSucceeded(input.xero) && input.xero?.lastSyncedAt) {
    rows.push({
      label: "Xero",
      at: input.xero.lastSyncedAt,
      period: input.xero.periodLabel ?? null,
    });
  }
  if (syncSucceeded(input.qbo) && input.qbo?.lastSyncedAt) {
    rows.push({
      label: "QuickBooks",
      at: input.qbo.lastSyncedAt,
      period: input.qbo.periodLabel ?? null,
    });
  }
  rows.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  const best = rows[0];
  if (best) {
    const period = best.period ? ` · ${best.period}` : "";
    return `Last sync ${formatSyncStamp(best.at)} · ${best.label}${period}`;
  }
  const snapshot = input.snapshotPeriod?.trim();
  if (snapshot) return `Snapshot on file · ${snapshot}`;
  return "No sync yet. Connect Xero or QuickBooks, or upload statements.";
}
