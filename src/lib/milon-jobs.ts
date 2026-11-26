/**
 * Jobs are what the firm sees. Agents, routines and drafts are how a job gets done.
 *
 * The three jobs Milōn does today, plus Books, which waits on the Sage write path.
 * Every routine kind and every agent is tagged to one job so the practice Home,
 * the rails and future queues can read jobs without a new runner or table.
 */
import type { AgentKey } from "@/lib/milon-team-feed";
import type { RoutineActionKind } from "@/lib/client-routines";
import type { StageAgentKey } from "@/lib/tax-specialist/agents";

export const JOB_KEYS = ["collect", "tax", "advise", "books"] as const;
export type JobKey = (typeof JOB_KEYS)[number];

/** Jobs shown on the board today. Books joins once the Sage write path is live. */
export const LIVE_JOB_KEYS: readonly JobKey[] = ["collect", "tax", "advise"];

export type JobMeta = {
  key: JobKey;
  label: string;
  /** One plain sentence. What the firm gets, not what the agent is. */
  outcome: string;
  agents: readonly StageAgentKey[];
  routines: readonly RoutineActionKind[];
  /** The one button on the card. */
  action: string;
};

export const JOB_META: Record<JobKey, JobMeta> = {
  collect: {
    key: "collect",
    label: "Collect",
    outcome: "Documents in from the client without you chasing.",
    agents: ["financial_manager"],
    routines: ["document_chase", "client_update_draft"],
    action: "Send an agent",
  },
  tax: {
    key: "tax",
    label: "Tax",
    outcome: "SARS form drafts and workings ready for you to check and file.",
    agents: ["tax_specialist"],
    routines: ["tax_deadline_watch"],
    action: "Review tax drafts",
  },
  advise: {
    key: "advise",
    label: "Advise",
    outcome: "Health, cash, budget and a Management Report the client acts on.",
    agents: ["analyst", "advisor", "financial_manager"],
    routines: [
      "monthly_pack",
      "cash_debtor_early_warning",
      "budget_actual_drift",
      "report_pack",
      "report_cash",
      "report_waterfall",
      "report_budget",
    ],
    action: "Review and send",
  },
  books: {
    key: "books",
    label: "Books",
    outcome: "Bank lines drafted into Sage with the source document attached.",
    agents: ["financial_manager"],
    routines: [],
    action: "Coming with Sage write access",
  },
};

export function jobForRoutine(routine: RoutineActionKind): JobKey {
  for (const key of JOB_KEYS) {
    if (JOB_META[key].routines.includes(routine)) return key;
  }
  return "advise";
}

export function jobsForAgent(agent: StageAgentKey | AgentKey): readonly JobKey[] {
  return JOB_KEYS.filter((key) => JOB_META[key].agents.includes(agent as StageAgentKey));
}

// ── Board counts ──────────────────────────────────────────────────────────────

export type JobsBoardClient = {
  id: string;
  name: string;
  /** Null when the count has not been read yet. */
  openQueries: number | null;
  chaseActions: readonly { title: string; overdue: boolean }[];
  openActions: number;
  overdueActions: number;
  /** True when this client is on a market the Tax Specialist serves. */
  taxEnabled: boolean;
  /** True when a tax deadline is inside the watch window for this client. */
  taxDeadlineNear: boolean;
  /** Reports the drafter can produce from figures on file. */
  reportsReady: number;
  /** True once figures are on file from a ledger sync or an upload. */
  hasFigures: boolean;
};

export type JobsBoardCount = {
  job: JobKey;
  /** Headline number on the card. */
  count: number;
  /** One line under the number. */
  line: string;
  /** Client to open when the card button is pressed. Null when nothing is waiting. */
  clientId: string | null;
};

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Pure. Takes what the practice board already loads and turns it into three
 * cards. Nothing here reads the database.
 */
export function jobsBoardCounts(
  clients: readonly JobsBoardClient[],
): Record<JobKey, JobsBoardCount> {
  const collectClients = clients.filter(
    (c) => (c.openQueries ?? 0) > 0 || c.chaseActions.length > 0,
  );
  const collectSorted = [...collectClients].sort(
    (a, b) =>
      b.chaseActions.filter((x) => x.overdue).length -
        a.chaseActions.filter((x) => x.overdue).length ||
      (b.openQueries ?? 0) - (a.openQueries ?? 0),
  );
  const collectItems = collectClients.reduce(
    (s, c) => s + (c.openQueries ?? 0) + c.chaseActions.length,
    0,
  );

  const taxClients = clients.filter((c) => c.taxEnabled);
  const taxNear = taxClients.filter((c) => c.taxDeadlineNear);
  const taxNoFigures = taxNear.filter((c) => !c.hasFigures);

  const adviseClients = clients.filter((c) => c.hasFigures);
  const adviseReady = adviseClients.filter((c) => c.reportsReady > 0);
  const adviseFollowUp = clients.filter((c) => c.overdueActions > 0);
  const adviseSorted = [...adviseReady].sort((a, b) => b.reportsReady - a.reportsReady);

  return {
    collect: {
      job: "collect",
      count: collectClients.length,
      line:
        collectClients.length === 0
          ? "Nothing outstanding from clients."
          : `${plural(collectItems, "item")} outstanding across ${plural(collectClients.length, "client")}.`,
      clientId: collectSorted[0]?.id ?? null,
    },
    tax: {
      job: "tax",
      count: taxNear.length,
      line:
        taxClients.length === 0
          ? "No South African clients on file yet."
          : taxNear.length === 0
            ? `${plural(taxClients.length, "client")} on watch. No return due soon.`
            : taxNoFigures.length > 0
              ? `${plural(taxNear.length, "return")} due soon. ${taxNoFigures.length} still need figures.`
              : `${plural(taxNear.length, "return")} due soon. Drafts can start.`,
      clientId: (taxNear[0] ?? taxClients[0])?.id ?? null,
    },
    advise: {
      job: "advise",
      count: adviseReady.length,
      line:
        adviseClients.length === 0
          ? "Connect or upload one client to start."
          : adviseReady.length === 0
            ? `${plural(adviseClients.length, "client")} with figures. Packs build at month end.`
            : adviseFollowUp.length > 0
              ? `${plural(adviseReady.length, "client")} with a pack ready. ${adviseFollowUp.length} with overdue action points.`
              : `${plural(adviseReady.length, "client")} with a pack ready to send.`,
      clientId: adviseSorted[0]?.id ?? adviseClients[0]?.id ?? null,
    },
    books: {
      job: "books",
      count: 0,
      line: "Sage write access is on its way. Read-only sync runs today.",
      clientId: null,
    },
  };
}

// ── First run ─────────────────────────────────────────────────────────────────

export type FirstRunStep = "interview" | "connect" | "first_draft" | "done";

export const FIRST_RUN_STEPS: readonly {
  id: Exclude<FirstRunStep, "done">;
  title: string;
  detail: string;
}[] = [
  {
    id: "interview",
    title: "Tell the Implementation Manager how you work",
    detail:
      "Ten minutes. It maps your month to the three jobs and notes what Milōn does not do yet.",
  },
  {
    id: "connect",
    title: "Connect or upload one client",
    detail: "Sage, Xero, QuickBooks, or a trial balance PDF. One client is enough.",
  },
  {
    id: "first_draft",
    title: "See the first draft",
    detail:
      "A document request, a tax draft or a health pack for that client. You approve before anything goes out.",
  },
];

/**
 * Pure. Which step the firm is on. "done" hides the strip.
 * The strip stays until a draft has been approved, so a firm that skips the
 * interview sees it on every visit.
 */
export function firstRunStep(input: {
  interviewDone: boolean;
  clientsWithFigures: number;
  /** Activation or routine runs that have finished. */
  finishedRuns: number;
  /** Any draft a named person has approved. */
  approvedDrafts: number;
}): FirstRunStep {
  if (input.approvedDrafts > 0) return "done";
  if (!input.interviewDone) return "interview";
  if (input.clientsWithFigures === 0) return "connect";
  return "first_draft";
}

export function firstRunProgress(step: FirstRunStep): { index: number; of: number } {
  const of = FIRST_RUN_STEPS.length;
  if (step === "done") return { index: of, of };
  return { index: FIRST_RUN_STEPS.findIndex((s) => s.id === step), of };
}
