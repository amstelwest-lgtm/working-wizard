/**
 * Open/overdue counts for every surface. The rows come back without a
 * pickup caption. This loads the same hand-off the plan uses and attaches
 * "Done by …" before actionCounts runs.
 */
import { deriveActionHealth, type ActionItemHealth } from "./action-item-health.ts";
import {
  actionCounts,
  actionDisplayClass,
  actionOverdueInput,
  type ActionCountInput,
  type ActionPlanCounts,
} from "./action-plan-counts.ts";

export type ActionCountDb = {
  // The app client and the server client both expose this. Tests pass a fake.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
};

type Raw = Record<string, unknown>;

function rowsOf(data: unknown): Raw[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Raw => Boolean(row) && typeof row === "object");
}

async function read(query: unknown): Promise<Raw[]> {
  const result = (await query) as { data?: unknown; error?: { message?: string } | null };
  if (result?.error) return [];
  return rowsOf(result?.data);
}

function text(row: Raw, key: string): string {
  const value = row[key];
  return typeof value === "string" ? value : "";
}

const BOT_NAME: Record<string, string> = {
  financial_manager: "Financial Manager",
  analyst: "Analyst",
  advisor: "Advisor",
};

/** Same finished line as handoffProgressCaption, without the plan page's clock. */
function pickupCaption(assignee: string, agent: string, status: string, draftId: string): string | null {
  const name = BOT_NAME[agent];
  if (!name) return null;
  const who = assignee.trim();
  if (who !== name && who !== agent) return null;
  if (status !== "succeeded" && status !== "partial") return null;
  if (!draftId) return null;
  return `Done by ${name}. See result.`;
}

function findingIdForRun(runId: string, findings: readonly Raw[]): string {
  const matches = findings.filter((row) => {
    if (text(row, "run_id") !== runId || !text(row, "id")) return false;
    if (row.superseded_by) return false;
    if (text(row, "status") === "dismissed") return false;
    if (text(row, "dismissed_reason").trim()) return false;
    return true;
  });
  const open = matches.find((row) => text(row, "status") !== "approved");
  return text(open ?? matches[0] ?? {}, "id");
}

/** Raw action rows plus the hand-off caption. Nothing here is written back. */
export async function loadActionCountInputs(
  db: ActionCountDb,
  clientIds: readonly string[],
): Promise<Map<string, ActionCountInput[]>> {
  const out = new Map<string, ActionCountInput[]>();
  const ids = clientIds.map((id) => id.trim()).filter(Boolean);
  if (!ids.length) return out;
  const [actions, plans] = await Promise.all([
    read(
      db
        .from("action_items")
        .select("id, client_id, status, due_date, created_at, title, owner_name")
        .in("client_id", ids)
        .neq("status", "done"),
    ),
    read(
      db
        .from("action_plans")
        .select("client_id, target_date")
        .in("client_id", ids)
        .eq("is_active", true),
    ),
  ]);
  const target = new Map<string, string>();
  for (const plan of plans) {
    const clientId = text(plan, "client_id");
    const date = text(plan, "target_date");
    if (clientId && date && !target.has(clientId)) target.set(clientId, date);
  }
  const actionIds = actions.map((row) => text(row, "id")).filter(Boolean);
  const runs = actionIds.length
    ? await read(
        db
          .from("agent_runs")
          .select("id, action_item_id, agent, status, queued_at")
          .in("action_item_id", actionIds)
          .order("queued_at", { ascending: false }),
      )
    : [];
  const runIds = runs.map((row) => text(row, "id")).filter(Boolean);
  const findings = runIds.length
    ? await read(
        db
          .from("agent_findings")
          .select("id, run_id, status, superseded_by, dismissed_reason")
          .in("run_id", runIds),
      )
    : [];
  const findingRefs = findings.flatMap((row) => {
    const id = text(row, "id");
    if (!id) return [];
    return [
      {
        id,
        run_id: text(row, "run_id") || null,
        status: text(row, "status") || null,
        superseded_by: row.superseded_by,
        dismissed_reason: text(row, "dismissed_reason") || null,
      },
    ];
  });
  const runsByAction = new Map<string, Raw[]>();
  for (const run of runs) {
    const id = text(run, "action_item_id");
    if (!id) continue;
    const list = runsByAction.get(id) ?? [];
    list.push(run);
    runsByAction.set(id, list);
  }
  for (const action of actions) {
    const clientId = text(action, "client_id");
    if (!clientId) continue;
    const id = text(action, "id");
    const mine = (runsByAction.get(id) ?? []).slice().sort((a, b) => text(b, "queued_at").localeCompare(text(a, "queued_at")));
    const newest = mine[0];
    const agent = text(newest ?? {}, "agent");
    const runId = text(newest ?? {}, "id");
    const draftId = runId ? findingIdForRun(runId, findingRefs) : "";
    const list = out.get(clientId) ?? [];
    list.push({
      status: text(action, "status") || null,
      dueDate: text(action, "due_date") || null,
      createdAt: text(action, "created_at") || null,
      planTarget: target.get(clientId) ?? null,
      title: text(action, "title") || null,
      pickupLabel: newest ? pickupCaption(text(action, "owner_name"), agent, text(newest, "status"), draftId) : null,
      draftId: draftId || null,
    });
    out.set(clientId, list);
  }
  return out;
}

export function judgedActionCounts(rows: readonly ActionCountInput[], today: string): ActionPlanCounts {
  return actionCounts(
    rows.map((row) => actionOverdueInput(row, today)),
    today,
  );
}

export type HealthBuckets = Record<ActionItemHealth, number>;

export function healthBuckets(rows: readonly ActionCountInput[], today: string): HealthBuckets {
  const counts: HealthBuckets = {
    on_track: 0,
    at_risk: 0,
    off_track: 0,
    overdue: 0,
    not_started: 0,
    complete: 0,
    awaiting_sign_off: 0,
  };
  const now = new Date(`${today}T12:00:00Z`);
  for (const row of rows) {
    const health = deriveActionHealth(
      {
        status: row.status ?? "not_started",
        due_date: row.dueDate ?? null,
        progress_pct: row.progressPct ?? 0,
        created_at: row.createdAt ?? "",
        plan_target: row.planTarget,
        pickupLabel: row.pickupLabel,
        draftId: row.draftId,
        title: row.title,
      },
      now,
    );
    counts[health] += 1;
  }
  return counts;
}

export async function loadPracticeBoardActionMaps(
  db: ActionCountDb,
  clientIds: readonly string[],
  today: string,
) {
  const grouped = await loadActionCountInputs(db, clientIds);
  const openActionsMap: Record<string, number> = {};
  const overdueActionsMap: Record<string, number> = {};
  const doneActionsMap: Record<string, number> = {};
  const chaseActionsMap: Record<string, { title: string; overdue: boolean }[]> = {};
  for (const [clientId, rows] of grouped) {
    const judged = rows.map((row) => actionOverdueInput(row, today));
    const counts = actionCounts(judged, today);
    if (counts.open) openActionsMap[clientId] = counts.open;
    if (counts.overdue) overdueActionsMap[clientId] = counts.overdue;
    if (counts.done) doneActionsMap[clientId] = counts.done;
    for (const row of judged) {
      const title = row.title?.trim() ?? "";
      if (!title) continue;
      const klass = actionDisplayClass(row, today);
      if (klass !== "open" && klass !== "overdue") continue;
      chaseActionsMap[clientId] = chaseActionsMap[clientId] ?? [];
      chaseActionsMap[clientId].push({ title, overdue: klass === "overdue" });
    }
  }
  return { openActionsMap, overdueActionsMap, doneActionsMap, chaseActionsMap };
}

export async function loadPortfolioActionMaps(
  db: ActionCountDb,
  clientIds: readonly string[],
  today: string,
) {
  const grouped = await loadActionCountInputs(db, clientIds);
  const openAct = new Map<string, number>();
  const overdueAct = new Map<string, number>();
  const doneAct = new Map<string, number>();
  const blockedAct = new Map<string, number>();
  for (const [clientId, rows] of grouped) {
    const counts = judgedActionCounts(rows, today);
    if (counts.open) openAct.set(clientId, counts.open);
    if (counts.overdue) overdueAct.set(clientId, counts.overdue);
    if (counts.done) doneAct.set(clientId, counts.done);
    const blocked = rows.filter((row) => row.status === "blocked").length;
    if (blocked) blockedAct.set(clientId, blocked);
  }
  return { openAct, overdueAct, doneAct, blockedAct };
}

export async function loadHomeActionCounts(db: ActionCountDb, clientId: string, today: string) {
  const rows = (await loadActionCountInputs(db, [clientId])).get(clientId) ?? [];
  const counts = judgedActionCounts(rows, today);
  const titles = rows.flatMap((row) => {
    const klass = actionDisplayClass(actionOverdueInput(row, today), today);
    const title = row.title?.trim() ?? "";
    return klass === "open" || klass === "overdue" ? [title] : [];
  });
  return { counts, titles: titles.filter(Boolean) };
}

export async function loadActionHealthCounts(db: ActionCountDb, clientId: string, today: string) {
  const rows = (await loadActionCountInputs(db, [clientId])).get(clientId) ?? [];
  return { counts: judgedActionCounts(rows, today), buckets: healthBuckets(rows, today) };
}
