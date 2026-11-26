/**
 * Pending Implementation Manager map, the plan generated with it, and the
 * start snapshot. JSON on an existing milon_brain_rules row. Not a confirmed
 * workflow rule and not a new table.
 */
import type { IntegrationPlanRow, IntegrationPlanStatus } from "./im-integration-plan.ts";
import type { SetupPartnerWorkflowMap } from "./setup-partner.ts";

export const IM_SETUP_HOLD_EVENT = "setup_partner_plan_hold";
export const IM_SETUP_HOLD_TASK = "practice_setup_plan";

export type ImRunningLine = {
  id: string;
  bot: string;
  status: string;
  summary: string;
  href: string;
  clientName: string;
  routine: string;
};

export type ImSetupHold = {
  pendingMap: SetupPartnerWorkflowMap | null;
  rows: IntegrationPlanRow[];
  started: boolean;
  lines: ImRunningLine[];
};

const PLAN_STATUS = new Set<IntegrationPlanStatus>(["Waiting", "Draft queued", "Running"]);

const ROUTINE_LABEL: Record<string, string> = {
  document_chase: "Document chase",
  monthly_pack: "Monthly pack",
  cash_debtor_early_warning: "Cash and debtor early warning",
  budget_actual_drift: "Budget versus actual",
  tax_deadline_watch: "Tax deadline watch",
};

/** Sample and demo clients are not pilots. "New York Yankees" is one of them. */
export function isImSampleClient(input: { name?: string | null; isDemo?: boolean | null }): boolean {
  if (input.isDemo === true) return true;
  const folded = (input.name ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!folded) return false;
  if (folded.includes("yankees")) return true;
  return /\b(sample|demo)\b/.test(folded);
}

export function routineLabel(routine: string): string {
  return ROUTINE_LABEL[routine] ?? "Routine";
}

export function draftHref(clientId: string): string {
  return `/clients/${clientId}?tab=plan&section=open`;
}

export function queuedRunningLines(input: {
  pilot: { id: string; name: string } | null;
  routines: readonly { routine: string; bot: string }[];
}): ImRunningLine[] {
  const href = input.pilot ? draftHref(input.pilot.id) : "/clients";
  const clientName = input.pilot?.name?.trim() ?? "";
  const routines = input.routines.length > 0 ? input.routines : [{ routine: "monthly_pack", bot: "Milōn" }];
  return routines.slice(0, 6).map((row, index) => ({
    id: `${row.routine}:${index}`,
    bot: row.bot.trim() || "Milōn",
    status: "Draft queued",
    summary: "Draft for your review. Nothing has been sent.",
    href,
    clientName,
    routine: routineLabel(row.routine),
  }));
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function parseMap(value: unknown): SetupPartnerWorkflowMap | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const strings = (list: unknown, max: number) =>
    Array.isArray(list) ? list.map((item) => clip(item, 500)).filter(Boolean).slice(0, max) : [];
  const coverage = Array.isArray(row.milonCoverage)
    ? row.milonCoverage
        .flatMap((item) => {
          if (!item || typeof item !== "object") return [];
          const rec = item as Record<string, unknown>;
          const agent = clip(rec.agent, 80);
          const owns = clip(rec.owns, 400);
          return agent && owns ? [{ agent, owns }] : [];
        })
        .slice(0, 12)
    : [];
  const todaysFlow = strings(row.todaysFlow, 24);
  if (!todaysFlow.length && !coverage.length) return null;
  return {
    todaysFlow: todaysFlow.length ? todaysFlow : ["Practice month-end close, review, and sign-off."],
    milonCoverage: coverage,
    gaps: strings(row.gaps, 12),
    checklist: strings(row.checklist, 12),
  };
}

function parseRow(value: unknown): IntegrationPlanRow | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const playId = clip(row.playId, 80);
  const problem = clip(row.problem, 400);
  const milon = clip(row.milon, 400);
  const routine = clip(row.routine, 200);
  const clientSees = clip(row.clientSees, 400);
  const bot = clip(row.bot, 80);
  if (!playId || !problem || !milon || !routine || !clientSees || !bot) return null;
  const status = clip(row.status, 40);
  return {
    playId,
    problem,
    milon,
    routine,
    clientSees,
    approve: clip(row.approve, 400),
    bot,
    section: row.section === "already_covered" ? "already_covered" : "lead",
    status: PLAN_STATUS.has(status as IntegrationPlanStatus) ? (status as IntegrationPlanStatus) : "Waiting",
    actionLabel: clip(row.actionLabel, 200),
    actionHref: clip(row.actionHref, 300),
    actionPrompt: clip(row.actionPrompt, 400),
    actionApprove: clip(row.actionApprove, 400),
    clientName: clip(row.clientName, 80),
  };
}

function parseLine(value: unknown): ImRunningLine | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const id = clip(row.id, 80);
  const bot = clip(row.bot, 80);
  if (!id || !bot) return null;
  const href = clip(row.href, 300);
  return {
    id,
    bot,
    status: clip(row.status, 40) || "Draft queued",
    summary: clip(row.summary, 240) || "Draft for your review. Nothing has been sent.",
    href: href.startsWith("/") ? href : "/clients",
    clientName: clip(row.clientName, 80),
    routine: clip(row.routine, 80),
  };
}

export function parseImSetupHold(raw: string | null | undefined): ImSetupHold | null {
  if (!raw || !raw.trim().startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const row = parsed as Record<string, unknown>;
  const rows = Array.isArray(row.rows)
    ? row.rows.map(parseRow).filter((item): item is IntegrationPlanRow => item != null).slice(0, 8)
    : [];
  const lines = Array.isArray(row.lines)
    ? row.lines.map(parseLine).filter((item): item is ImRunningLine => item != null).slice(0, 8)
    : [];
  const pendingMap = parseMap(row.pendingMap);
  const started = row.started === true;
  if (!pendingMap && rows.length === 0 && !started && lines.length === 0) return null;
  return { pendingMap, rows, started, lines };
}

export function imSetupHoldRuleText(hold: ImSetupHold): string {
  return JSON.stringify({
    pendingMap: hold.pendingMap,
    rows: hold.rows.slice(0, 8),
    started: hold.started,
    lines: hold.lines.slice(0, 8),
  });
}

export function emptyImSetupHold(): ImSetupHold {
  return { pendingMap: null, rows: [], started: false, lines: [] };
}
