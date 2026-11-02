/**
 * Inbox, team findings, and peer messages.
 * Kept out of agent-desk so ask-ai can call them without loading the analyst executor.
 * Tax Specialist is not an agent_key and is not a peer.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { type AgentKey } from "../../../src/lib/agent-bus.ts";
import {
  AGENT_OUTBOUND_TYPES,
  periodsFromFindingEvidence,
  type AgentOutboundType,
} from "../../../src/lib/agent-draft.ts";

export type AgentMessageCtx = {
  clientId: string;
  /** Background runs pass the agent_runs id. A chat send has no run row, so this is null. */
  runId: string | null;
  correlationId: string;
  firmId: string | null;
  db: SupabaseClient;
  agent: "financial_manager" | "advisor" | "analyst";
};

export async function readInbox(ctx: AgentMessageCtx): Promise<unknown> {
  const { data, error } = await ctx.db
    .from("agent_messages")
    .select("id, from_agent, type, payload, hop, created_at")
    .eq("client_id", ctx.clientId)
    .eq("to_agent", ctx.agent)
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) return { error: error.message };
  const messages = (data ?? []) as Array<Record<string, unknown>>;
  if (messages.length === 0) return { empty: true, messages: [] };
  return {
    empty: false,
    messages: messages.map((row) => ({
      id: row.id,
      from_agent: row.from_agent,
      type: row.type,
      payload: row.payload,
      hop: row.hop,
      created_at: row.created_at,
    })),
  };
}

export async function readTeamFindings(ctx: AgentMessageCtx): Promise<unknown> {
  const { data, error } = await ctx.db
    .from("agent_findings")
    .select("id, agent, kind, severity, title, evidence, created_at")
    .eq("client_id", ctx.clientId)
    .is("superseded_by", null)
    .is("dismissed_reason", null)
    .order("created_at", { ascending: false })
    .limit(8);
  if (error) return { error: error.message };
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { empty: true, findings: [], periods: [] };
  const periods = rows.flatMap((row) => periodsFromFindingEvidence(row.evidence));
  return {
    empty: false,
    findings: rows.map((row) => ({
      id: row.id,
      agent: row.agent,
      kind: row.kind,
      severity: row.severity,
      title: row.title,
      created_at: row.created_at,
    })),
    periods,
  };
}

async function outgoingHop(
  ctx: AgentMessageCtx,
): Promise<{ hop: number } | { error: string; tool_blocked: true }> {
  const { count, error: countError } = await ctx.db
    .from("agent_messages")
    .select("id", { count: "exact", head: true })
    .eq("correlation_id", ctx.correlationId);
  if (countError) return { error: countError.message, tool_blocked: true };
  if ((count ?? 0) >= 12) {
    return { error: "agent correlation is capped at 12 messages", tool_blocked: true };
  }
  const { data, error } = await ctx.db
    .from("agent_messages")
    .select("hop")
    .eq("correlation_id", ctx.correlationId)
    .order("hop", { ascending: false })
    .limit(1);
  if (error) return { error: error.message, tool_blocked: true };
  const current = data?.[0]?.hop;
  if (typeof current === "number" && current >= 4) {
    return { error: "agent message hop limit is 4", tool_blocked: true };
  }
  return { hop: typeof current === "number" ? current + 1 : 0 };
}

/** Insert one agent_messages row. Callers choose the payload. Chat sends pass runId null. */
export async function deliverAgentMessage(
  ctx: AgentMessageCtx,
  input: { toAgent: AgentKey; type: string; payload: Record<string, unknown> },
): Promise<{ ok: true } | { error: string; tool_blocked?: boolean }> {
  if (input.toAgent === ctx.agent)
    return { error: "an agent cannot message itself", tool_blocked: true };
  const hop = await outgoingHop(ctx);
  if ("error" in hop) return hop;
  const { error } = await ctx.db.from("agent_messages").insert({
    client_id: ctx.clientId,
    firm_id: ctx.firmId,
    from_agent: ctx.agent,
    to_agent: input.toAgent,
    type: input.type,
    payload: input.payload,
    correlation_id: ctx.correlationId,
    run_id: ctx.runId,
    hop: hop.hop,
    status: "pending",
  });
  if (error) return { error: error.message };
  return { ok: true };
}

function peerName(value: unknown, peers: readonly AgentKey[]): AgentKey | null {
  if (typeof value !== "string") return null;
  return (peers as readonly string[]).includes(value) ? (value as AgentKey) : null;
}

export async function sendAgentMessage(
  args: Record<string, unknown>,
  ctx: AgentMessageCtx,
  peers: readonly AgentKey[],
): Promise<unknown> {
  const toAgent = peerName(args.to_agent, peers);
  const type = typeof args.type === "string" ? args.type.trim() : "";
  const body = typeof args.body === "string" ? args.body.trim().slice(0, 2000) : "";
  if (!toAgent) return { error: `to_agent must be one of: ${peers.join(", ")}.` };
  if (!(AGENT_OUTBOUND_TYPES as readonly string[]).includes(type)) {
    return { error: `type must be one of: ${AGENT_OUTBOUND_TYPES.join(", ")}.` };
  }
  if (!body) return { error: "A message needs a body." };
  const sent = await deliverAgentMessage(ctx, {
    toAgent,
    type: type as AgentOutboundType,
    payload: { body },
  });
  if ("error" in sent) return sent;
  return { sent: true, to_agent: toAgent, type };
}
