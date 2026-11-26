/**
 * Pending Implementation Manager map, the plan generated with it, and the
 * start snapshot. JSON on an existing milon_brain_rules row. Not a confirmed
 * workflow rule and not a new table.
 */
import type { IntegrationPlanRow, IntegrationPlanStatus } from "./im-integration-plan.ts";
import type { SetupPartnerWorkflowMap } from "./setup-partner.ts";

export const IM_SETUP_HOLD_EVENT = "setup_partner_plan_hold";
export const IM_SETUP_HOLD_TASK = "practice_setup_plan";

export type ImPilotRef = { id: string; name: string };

export type ImRunningLine = {
  id: string;
  bot: string;
  status: string;
  summary: string;
  href: string;
  clientName: string;
  routine: string;
  /** Stable plan-row key. Enqueue and the running list both use this. */
  rowKey?: string;
  clientId?: string;
  runId?: string;
  draftId?: string;
};

export type ImSetupHold = {
  pendingMap: SetupPartnerWorkflowMap | null;
  rows: IntegrationPlanRow[];
  started: boolean;
  lines: ImRunningLine[];
  pilot: ImPilotRef | null;
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

export function planRowKey(playId: string): string {
  const id = playId.trim();
  return id ? `im-plan:${id}` : "";
}

/** Existing client route: `draft` scrolls the drafts shelf to that finding. */
export function draftDeepLink(clientId: string, draftId: string): string {
  const client = clientId.trim();
  const draft = draftId.trim();
  if (!client || !draft) return "";
  return `/clients/${encodeURIComponent(client)}?tab=reports&section=drafts&draft=${encodeURIComponent(draft)}`;
}

/** The client stamped on the stored plan rows. Not a second picker. */
export function pilotFromPlanRows(
  rows: readonly { actionHref?: string; clientName?: string }[],
): ImPilotRef | null {
  for (const row of rows) {
    const id = /\/clients\/([^/?#]+)/.exec(row.actionHref ?? "")?.[1]?.trim() ?? "";
    const name = (row.clientName ?? "").trim();
    if (id && name && name !== "this client") return { id: decodeURIComponent(id), name };
  }
  const named = rows.find((row) => {
    const name = (row.clientName ?? "").trim();
    return name && name !== "this client";
  });
  if (!named?.clientName) return null;
  return { id: "", name: named.clientName.trim() };
}

export function queuedRunningLines(input: {
  pilot: { id: string; name: string } | null;
  routines: readonly { routine: string; bot: string; rowKey?: string; draftId?: string; runId?: string }[];
}): ImRunningLine[] {
  const clientName = input.pilot?.name?.trim() ?? "";
  const clientId = input.pilot?.id?.trim() ?? "";
  const routines = input.routines.length > 0 ? input.routines : [{ routine: "monthly_pack", bot: "Milōn" }];
  return routines.slice(0, 8).map((row, index) => {
    const draftId = row.draftId?.trim() ?? "";
    const rowKey = row.rowKey?.trim() || planRowKey(row.routine) || `${row.routine}:${index}`;
    return {
      id: row.runId?.trim() || rowKey,
      bot: row.bot.trim() || "Milōn",
      status: draftId ? "Draft queued" : "Draft queued",
      summary: "Draft for your review. Nothing has been sent.",
      href: draftId ? draftDeepLink(clientId, draftId) : "",
      clientName,
      clientId,
      routine: routineLabel(row.routine),
      rowKey,
      runId: row.runId?.trim() ?? "",
      draftId,
    };
  });
}

/** One line per plan row, named for the stored pilot, linked only when a draft id exists. */
export function presentRunningLines(input: {
  rows: readonly IntegrationPlanRow[];
  lines: readonly ImRunningLine[];
  pilot?: ImPilotRef | null;
}): ImRunningLine[] {
  const pilot = input.pilot?.name ? input.pilot : pilotFromPlanRows(input.rows);
  const used = new Set<string>();
  const fromRows = input.rows.slice(0, 8).map((row) => {
    const rowKey = planRowKey(row.playId);
    const match =
      input.lines.find((line) => line.rowKey === rowKey) ??
      input.lines.find((line) => line.routine === row.routine && !used.has(line.id));
    if (match) used.add(match.id);
    const draftId = match?.draftId?.trim() ?? "";
    const clientId = pilot?.id || "";
    return {
      id: match?.runId || match?.id || rowKey,
      bot: row.bot || match?.bot || "Milōn",
      routine: row.routine || match?.routine || "",
      clientName: pilot?.name || row.clientName || "",
      clientId,
      rowKey,
      runId: match?.runId ?? "",
      draftId,
      status: match?.status || "Draft queued",
      summary: "Draft for your review. Nothing has been sent.",
      href: draftId ? draftDeepLink(clientId, draftId) : "",
    } satisfies ImRunningLine;
  });
  if (fromRows.length) return dedupeRunningLines(fromRows);
  return dedupeRunningLines(
    input.lines.map((line) => {
      const draftId = line.draftId?.trim() ?? "";
      const clientId = pilot?.id || line.clientId || "";
      return {
        ...line,
        clientName: pilot?.name || line.clientName,
        clientId,
        draftId,
        href: draftId ? draftDeepLink(clientId, draftId) : "",
      };
    }),
  );
}

export function dedupeRunningLines(lines: readonly ImRunningLine[]): ImRunningLine[] {
  const seen = new Set<string>();
  const out: ImRunningLine[] = [];
  for (const line of lines) {
    const key = line.rowKey?.trim() || line.routine || line.id;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

/** Test firm only. Clearing the hold does not need a new table. */
export function imResetAllowed(firmId: string): boolean {
  return firmId.trim().toLowerCase().startsWith("e8f7a440");
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
  const href = clip(row.href, 400);
  return {
    id,
    bot,
    status: clip(row.status, 40) || "Draft queued",
    summary: clip(row.summary, 240) || "Draft for your review. Nothing has been sent.",
    href: href.startsWith("/") ? href : "",
    clientName: clip(row.clientName, 80),
    routine: clip(row.routine, 120),
    rowKey: clip(row.rowKey, 120),
    clientId: clip(row.clientId, 80),
    runId: clip(row.runId, 80),
    draftId: clip(row.draftId, 80),
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
  const pilot = parsePilot(row.pilot) ?? pilotFromPlanRows(rows);
  if (!pendingMap && rows.length === 0 && !started && lines.length === 0 && !pilot) return null;
  return { pendingMap, rows, started, lines, pilot };
}

function parsePilot(value: unknown): ImPilotRef | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const name = clip(row.name, 80);
  const id = clip(row.id, 80);
  if (!name && !id) return null;
  return { id, name };
}

export function imSetupHoldRuleText(hold: ImSetupHold): string {
  return JSON.stringify({
    pendingMap: hold.pendingMap,
    rows: hold.rows.slice(0, 8),
    started: hold.started,
    lines: hold.lines.slice(0, 8),
    pilot: hold.pilot,
  });
}

export function emptyImSetupHold(): ImSetupHold {
  return { pendingMap: null, rows: [], started: false, lines: [], pilot: null };
}
