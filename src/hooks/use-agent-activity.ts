/**
 * Recent agent runs, findings, and hand-offs for one client.
 * The first paint is a SELECT. Realtime keeps runs and findings current
 * and drops the channel when the client changes or the desk unmounts.
 * An empty table, or a read the signed-in role cannot see, stays quiet:
 * the desk falls back to the existing feed. agent_settings is not readable
 * here; enabled=false simply leaves these tables empty.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { pollAfterTick } from "@/lib/agent-activity-poll";
import { dispatchActionPlanRefresh } from "@/lib/owner-handoff-client";
import { coerceMarketSelection } from "@/lib/market/parse";
import { resolveMarket, ZA_MARKET } from "@/lib/market/resolve";
import { SHELL_GATE_TIMEOUT_MS } from "@/lib/shell-gate";
import {
  agentActivityUnavailable,
  emptyAgentActivity,
  isVisibleAgentFinding,
  type AgentActivitySnapshot,
  type AgentFindingRow,
  type AgentMessageRow,
  type AgentRunRow,
} from "@/lib/milon-team-activity";
import type { AgentKey } from "@/lib/milon-team-feed";

const ROW_LIMIT = 20;
/** While any run for this client is queued or running, Home reloads, then stops. */
const ACTIVE_POLL_MS = 5000;
const CLIENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function runIsOpen(status: string): boolean {
  return status === "queued" || status === "running";
}

const FINDING_COLUMNS =
  "id, agent, client_id, run_id, kind, severity, title, detail, evidence, as_of, created_at, superseded_by, dismissed_reason, status, approved_by, approved_at, approved_table, approved_row_id";

async function fetchClientRuns(clientId: string): Promise<AgentRunRow[]> {
  const runsRes = await table("agent_runs")
    .select("id, agent, client_id, status, summary, trigger, queued_at, started_at, finished_at, action_item_id")
    .eq("client_id", clientId)
    .order("queued_at", { ascending: false })
    .limit(ROW_LIMIT);
  if (agentActivityUnavailable(runsRes.error)) return [];
  if (runsRes.error) throw new Error(runsRes.error.message ?? "Could not load runs");
  return rowsOf(runsRes.data).map(parseRun).filter((row): row is AgentRunRow => Boolean(row));
}

async function fetchClientFindings(clientId: string): Promise<AgentFindingRow[]> {
  const findingsRes = await table("agent_findings")
    .select(FINDING_COLUMNS)
    .eq("client_id", clientId)
    .order("created_at", { ascending: false })
    .limit(ROW_LIMIT);
  if (agentActivityUnavailable(findingsRes.error)) return [];
  if (findingsRes.error) throw new Error(findingsRes.error.message ?? "Could not load findings");
  return rowsOf(findingsRes.data).map(parseFinding).filter((row): row is AgentFindingRow => Boolean(row));
}

type QueryError = { message?: string; code?: string } | null;

type ListQuery = {
  select(columns: string): ListQuery;
  eq(column: string, value: string): ListQuery;
  order(column: string, options: { ascending: boolean }): ListQuery;
  limit(count: number): Promise<{ data: unknown; error: QueryError }>;
};

export type AgentActivity = AgentActivitySnapshot & {
  loading: boolean;
  error: string | null;
  refresh: () => void;
};

function table(name: string): ListQuery {
  return (supabase as unknown as { from(relation: string): ListQuery }).from(name);
}

function rowsOf(data: unknown): Record<string, unknown>[] {
  if (!Array.isArray(data)) return [];
  return data.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
}

function isAgent(value: unknown): value is AgentKey {
  return value === "financial_manager" || value === "analyst" || value === "advisor";
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function parseRun(row: Record<string, unknown>): AgentRunRow | null {
  if (!isAgent(row.agent) || typeof row.id !== "string" || typeof row.queued_at !== "string") return null;
  return {
    id: row.id,
    agent: row.agent,
    client_id: typeof row.client_id === "string" ? row.client_id : "",
    status: typeof row.status === "string" ? row.status : "",
    summary: typeof row.summary === "string" ? row.summary : "",
    trigger: textOrNull(row.trigger),
    queued_at: row.queued_at,
    started_at: textOrNull(row.started_at),
    finished_at: textOrNull(row.finished_at),
    action_item_id: textOrNull(row.action_item_id),
  };
}

function parseFinding(row: Record<string, unknown>): AgentFindingRow | null {
  if (row.superseded_by) return null;
  if (typeof row.dismissed_reason === "string" && row.dismissed_reason.trim()) return null;
  const finding = {
    superseded_by: row.superseded_by,
    status: textOrNull(row.status),
    dismissed_reason: textOrNull(row.dismissed_reason),
  };
  if (!isVisibleAgentFinding(finding)) return null;
  if (!isAgent(row.agent) || typeof row.id !== "string" || typeof row.title !== "string") return null;
  return {
    id: row.id,
    agent: row.agent,
    client_id: typeof row.client_id === "string" ? row.client_id : "",
    run_id: textOrNull(row.run_id),
    kind: textOrNull(row.kind),
    severity: textOrNull(row.severity),
    title: row.title,
    detail: textOrNull(row.detail),
    evidence: row.evidence ?? {},
    as_of: textOrNull(row.as_of),
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    status: finding.status,
    approved_by: textOrNull(row.approved_by),
    approved_at: textOrNull(row.approved_at),
    approved_table: textOrNull(row.approved_table),
    approved_row_id: textOrNull(row.approved_row_id),
  };
}

function parseMessage(row: Record<string, unknown>): AgentMessageRow | null {
  if (!isAgent(row.from_agent) || typeof row.id !== "string") return null;
  return {
    id: row.id,
    client_id: typeof row.client_id === "string" ? row.client_id : "",
    from_agent: row.from_agent,
    to_agent: isAgent(row.to_agent) ? row.to_agent : null,
    type: typeof row.type === "string" ? row.type : "",
    payload: row.payload ?? {},
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

export function useAgentActivity(
  clientId: string,
  awaiting: readonly { openedAt?: string | null }[] = [],
): AgentActivity {
  const [reload, setReload] = useState(0);
  const refresh = useCallback(() => setReload((n) => n + 1), []);
  const [state, setState] = useState<AgentActivitySnapshot & { loading: boolean; error: string | null }>({
    ...emptyAgentActivity(),
    loading: true,
    error: null,
  });
  const awaitingRef = useRef(awaiting);
  awaitingRef.current = awaiting;
  const awaitingKey = awaiting.map((row) => row.openedAt ?? "").join("\n");
  const runsRef = useRef(state.runs);
  runsRef.current = state.runs;
  const armRef = useRef<() => void>(() => {});

  useEffect(() => {
    const id = clientId.trim();
    if (!id) {
      setState({ ...emptyAgentActivity(), loading: false, error: null });
      return;
    }

    let cancelled = false;
    const deadline = window.setTimeout(() => {
      if (cancelled) return;
      setState((current) =>
        current.loading
          ? {
              ...current,
              loading: false,
              error: "Couldn't load the team. Refresh to try again.",
            }
          : current,
      );
    }, SHELL_GATE_TIMEOUT_MS);

    async function load() {
      const [runsRes, findingsRes, messagesRes, clientRes] = await Promise.all([
        table("agent_runs")
          .select("id, agent, client_id, status, summary, trigger, queued_at, started_at, finished_at, action_item_id")
          .eq("client_id", id)
          .order("queued_at", { ascending: false })
          .limit(ROW_LIMIT),
        table("agent_findings")
          .select(FINDING_COLUMNS)
          .eq("client_id", id)
          .order("created_at", { ascending: false })
          .limit(ROW_LIMIT),
        table("agent_messages")
          .select("id, client_id, from_agent, to_agent, type, payload, created_at")
          .eq("client_id", id)
          .order("created_at", { ascending: false })
          .limit(ROW_LIMIT),
        supabase.from("clients").select("market").eq("id", id).maybeSingle(),
      ]);
      if (cancelled) return;

      const failures = [runsRes.error, findingsRes.error, messagesRes.error].filter(
        (error): error is NonNullable<QueryError> => Boolean(error),
      );
      const hard = failures.find((error) => !agentActivityUnavailable(error));
      let market = ZA_MARKET;
      try {
        market = resolveMarket(coerceMarketSelection(clientRes.data?.market));
      } catch {
        market = ZA_MARKET;
      }

      setState({
        runs: agentActivityUnavailable(runsRes.error) ? [] : rowsOf(runsRes.data).map(parseRun).filter((row): row is AgentRunRow => Boolean(row)),
        findings: agentActivityUnavailable(findingsRes.error)
          ? []
          : rowsOf(findingsRes.data).map(parseFinding).filter((row): row is AgentFindingRow => Boolean(row)),
        messages: agentActivityUnavailable(messagesRes.error)
          ? []
          : rowsOf(messagesRes.data).map(parseMessage).filter((row): row is AgentMessageRow => Boolean(row)),
        market,
        loading: false,
        error: hard?.message ?? null,
      });
    }

    void load().catch((err: unknown) => {
      if (cancelled) return;
      setState({
        ...emptyAgentActivity(),
        loading: false,
        error: err instanceof Error ? err.message : "Could not load agent activity",
      });
    });

    if (!CLIENT_UUID.test(id)) {
      return () => {
        cancelled = true;
        window.clearTimeout(deadline);
      };
    }

    const channel = supabase.channel(`agent-activity:${id}`);
    const listen = channel.on.bind(channel) as (
      event: "postgres_changes",
      filter: { event: "*"; schema: "public"; table: string; filter: string },
      callback: () => void,
    ) => typeof channel;
    const refresh = () => {
      if (!cancelled) void load();
    };
    listen(
      "postgres_changes",
      { event: "*", schema: "public", table: "agent_runs", filter: `client_id=eq.${id}` },
      refresh,
    );
    listen(
      "postgres_changes",
      { event: "*", schema: "public", table: "agent_findings", filter: `client_id=eq.${id}` },
      refresh,
    );
    void channel.subscribe();

    return () => {
      cancelled = true;
      window.clearTimeout(deadline);
      void supabase.removeChannel(channel);
    };
  }, [clientId, reload]);

  // One timer for this client. A render that looks idle must not clear it:
  // the tick fetches again and continues while any fresh run is still open.
  useEffect(() => {
    const id = clientId.trim();
    if (!CLIENT_UUID.test(id)) return;

    let cancelled = false;
    let timer: number | undefined;
    let generation = 0;

    const arm = () => {
      if (cancelled || timer !== undefined) return;
      timer = window.setTimeout(() => {
        timer = undefined;
        void tick();
      }, ACTIVE_POLL_MS);
    };

    const tick = async () => {
      const gen = ++generation;
      let fresh: AgentRunRow[] | null = null;
      let findings: AgentFindingRow[] | null = null;
      try {
        // Runs and findings land together. A finish caption must not render
        // from the run summary while the draft row is still the previous snapshot.
        [fresh, findings] = await Promise.all([fetchClientRuns(id), fetchClientFindings(id)]);
      } catch {
        if (
          !cancelled &&
          gen === generation &&
          (runsRef.current.some((run) => runIsOpen(run.status)) || pollAfterTick([], awaitingRef.current) === "continue")
        ) {
          arm();
        }
        return;
      }
      if (cancelled || gen !== generation || !fresh || !findings) return;
      setState((current) => ({
        ...current,
        runs: fresh ?? current.runs,
        findings: findings ?? current.findings,
        loading: false,
      }));
      dispatchActionPlanRefresh();
      if (pollAfterTick(fresh, awaitingRef.current) === "continue") arm();
    };

    armRef.current = arm;
    if (runsRef.current.some((run) => runIsOpen(run.status)) || pollAfterTick([], awaitingRef.current) === "continue") arm();

    return () => {
      cancelled = true;
      generation += 1;
      if (timer !== undefined) window.clearTimeout(timer);
      armRef.current = () => {};
    };
  }, [clientId]);

  useEffect(() => {
    if (state.runs.some((run) => runIsOpen(run.status)) || pollAfterTick([], awaitingRef.current) === "continue") {
      armRef.current();
    }
  }, [awaitingKey, state.runs]);

  return { ...state, refresh };
}
