/**
 * Recent agent runs, findings, and hand-offs for one client.
 * The first paint is a SELECT. Realtime keeps runs and findings current
 * and drops the channel when the client changes or the desk unmounts.
 * An empty table, or a read the signed-in role cannot see, stays quiet:
 * the desk falls back to the existing feed. agent_settings is not readable
 * here; enabled=false simply leaves these tables empty.
 */
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { coerceMarketSelection } from "@/lib/market/parse";
import { resolveMarket, ZA_MARKET } from "@/lib/market/resolve";
import {
  agentActivityUnavailable,
  emptyAgentActivity,
  type AgentActivitySnapshot,
  type AgentFindingRow,
  type AgentMessageRow,
  type AgentRunRow,
} from "@/lib/milon-team-activity";
import type { AgentKey } from "@/lib/milon-team-feed";

const ROW_LIMIT = 20;
const CLIENT_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    queued_at: row.queued_at,
    started_at: textOrNull(row.started_at),
    finished_at: textOrNull(row.finished_at),
  };
}

function parseFinding(row: Record<string, unknown>): AgentFindingRow | null {
  if (row.superseded_by) return null;
  if (!isAgent(row.agent) || typeof row.id !== "string" || typeof row.title !== "string") return null;
  return {
    id: row.id,
    agent: row.agent,
    client_id: typeof row.client_id === "string" ? row.client_id : "",
    title: row.title,
    detail: textOrNull(row.detail),
    evidence: row.evidence ?? {},
    as_of: textOrNull(row.as_of),
    created_at: typeof row.created_at === "string" ? row.created_at : "",
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

export function useAgentActivity(clientId: string): AgentActivity {
  const [state, setState] = useState<AgentActivity>({ ...emptyAgentActivity(), loading: true, error: null });

  useEffect(() => {
    const id = clientId.trim();
    if (!id) {
      setState({ ...emptyAgentActivity(), loading: false, error: null });
      return;
    }

    let cancelled = false;

    async function load() {
      const [runsRes, findingsRes, messagesRes, clientRes] = await Promise.all([
        table("agent_runs")
          .select("id, agent, client_id, status, summary, queued_at, started_at, finished_at")
          .eq("client_id", id)
          .order("queued_at", { ascending: false })
          .limit(ROW_LIMIT),
        table("agent_findings")
          .select("id, agent, client_id, title, detail, evidence, as_of, created_at, superseded_by")
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
      void supabase.removeChannel(channel);
    };
  }, [clientId]);

  return state;
}
