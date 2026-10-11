/**
 * Shared reads and draft writes for the Financial Manager and the Advisor.
 * Each agent still gates its own allow-list before calling in.
 * Connection rows are read without tokens.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { executeAnalystTool, type AnalystExecCtx } from "../agent-analyst/execute.ts";
import type { AgentKey } from "../../../src/lib/agent-bus.ts";
import { booksQualityFigures, savedBudgetFigures, savedCashflowFigures } from "../../../src/lib/agent-books.ts";
import {
  AGENT_OUTBOUND_TYPES,
  draftMessageType,
  periodsFromFindingEvidence,
  prepareDraftRecord,
  resolveDraftRecipient,
  type AgentOutboundType,
} from "../../../src/lib/agent-draft.ts";
import { findingDuplicates, higherFindingSeverity, numericFigures } from "../../../src/lib/agent-analyst.ts";

export type AgentToolCtx = AnalystExecCtx & {
  agent: "financial_manager" | "advisor";
};

const UPLOAD_SOURCES = ["upload", "pdf_upload", "financial_statement"];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export async function readReusedAnalystTool(name: string, ctx: AgentToolCtx): Promise<unknown> {
  return executeAnalystTool(name, {}, ctx);
}

export async function readCash13Week(ctx: AgentToolCtx): Promise<unknown> {
  const { data, error } = await ctx.db
    .from("clients")
    .select("cashflow, cash_runway_weeks")
    .eq("id", ctx.clientId)
    .maybeSingle();
  if (error) return { error: error.message };
  const saved = savedCashflowFigures(data?.cashflow);
  const runway = data?.cash_runway_weeks;
  const figures = { ...saved.figures };
  if (typeof runway === "number" && Number.isFinite(runway)) figures.cash_runway_weeks = runway;
  if (saved.empty && figures.cash_runway_weeks == null) {
    return { empty: true, note: saved.note, figures: {} };
  }
  return {
    empty: false,
    books_basis: "saved_cashflow",
    note: saved.note,
    period_label: saved.periodLabel,
    figures,
  };
}

export async function readBudgetStatus(ctx: AgentToolCtx): Promise<unknown> {
  const { data, error } = await ctx.db
    .from("clients")
    .select("budget, budget_updated_at")
    .eq("id", ctx.clientId)
    .maybeSingle();
  if (error) return { error: error.message };
  const saved = savedBudgetFigures(data?.budget);
  if (saved.empty) return { empty: true, note: saved.note, figures: {} };
  return {
    empty: false,
    books_basis: "saved_budget",
    note: saved.note,
    period_label: saved.periodLabel,
    budget_updated_at: (data?.budget_updated_at as string | null) ?? null,
    figures: saved.figures,
  };
}

async function connectionRow(db: SupabaseClient, table: string, clientId: string) {
  const { data, error } = await db
    .from(table)
    .select("last_synced_at, sync_status")
    .eq("client_id", clientId)
    .maybeSingle();
  if (error) return { error: error.message, connected: false, last_synced_at: null, sync_status: null };
  return {
    error: null,
    connected: Boolean(data),
    last_synced_at: (data?.last_synced_at as string | null) ?? null,
    sync_status: (data?.sync_status as string | null) ?? null,
  };
}

export async function readBooksQuality(ctx: AgentToolCtx): Promise<unknown> {
  const [qbo, xero, sage, snapRes, uploadRes] = await Promise.all([
    connectionRow(ctx.db, "qbo_connections", ctx.clientId),
    connectionRow(ctx.db, "xero_connections", ctx.clientId),
    connectionRow(ctx.db, "sage_connections", ctx.clientId),
    ctx.db
      .from("client_financial_snapshots")
      .select("id, source, period_label, period_date, financials")
      .eq("client_id", ctx.clientId)
      .order("period_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
    ctx.db
      .from("client_financial_snapshots")
      .select("id", { count: "exact", head: true })
      .eq("client_id", ctx.clientId)
      .in("source", UPLOAD_SOURCES),
  ]);
  if (qbo.error) return { error: qbo.error };
  if (xero.error) return { error: xero.error };
  if (sage.error) return { error: sage.error };
  if (snapRes.error) return { error: snapRes.error.message };
  if (uploadRes.error) return { error: uploadRes.error.message };
  const snap = asRecord(snapRes.data);
  const totals = numericFigures(snap?.financials);
  const figures = booksQualityFigures({
    qboConnected: qbo.connected,
    xeroConnected: xero.connected,
    sageConnected: sage.connected,
    hasUpload: (uploadRes.count ?? 0) > 0,
    statementTotals: totals,
  });
  return {
    empty: false,
    books_basis: "ledger_or_upload",
    note: "Connection times and the latest statement on file. Not a bank feed. Tokens are not included.",
    qbo: { connected: qbo.connected, last_synced_at: qbo.last_synced_at, sync_status: qbo.sync_status },
    xero: { connected: xero.connected, last_synced_at: xero.last_synced_at, sync_status: xero.sync_status },
    sage: { connected: sage.connected, last_synced_at: sage.last_synced_at, sync_status: sage.sync_status },
    latest_source: (snap?.source as string | null) ?? null,
    snapshot_id: snap ? String(snap.id) : null,
    period_label: (snap?.period_label as string | null) ?? null,
    period_date: (snap?.period_date as string | null) ?? null,
    figures,
  };
}

export async function readInbox(ctx: AgentToolCtx): Promise<unknown> {
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

export async function readTeamFindings(ctx: AgentToolCtx): Promise<unknown> {
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

export async function readOwnMemory(ctx: AgentToolCtx): Promise<unknown> {
  const { data, error } = await ctx.db
    .from("agent_memory")
    .select("key, value, updated_at")
    .eq("agent", ctx.agent)
    .eq("client_id", ctx.clientId);
  if (error) return { error: error.message };
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  if (rows.length === 0) return { empty: true, memory: [] };
  return { empty: false, memory: rows };
}

async function outgoingHop(ctx: AgentToolCtx): Promise<{ hop: number } | { error: string; tool_blocked: true }> {
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

async function insertAgentMessage(
  ctx: AgentToolCtx,
  input: { toAgent: AgentKey; type: string; payload: Record<string, unknown> },
): Promise<{ ok: true } | { error: string; tool_blocked?: boolean }> {
  if (input.toAgent === ctx.agent) return { error: "an agent cannot message itself", tool_blocked: true };
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
  ctx: AgentToolCtx,
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
  const sent = await insertAgentMessage(ctx, {
    toAgent,
    type: type as AgentOutboundType,
    payload: { body },
  });
  if ("error" in sent) return sent;
  return { sent: true, to_agent: toAgent, type };
}

export async function recordAgentDraft(
  args: Record<string, unknown>,
  ctx: AgentToolCtx,
  peers: readonly AgentKey[],
  allowedKinds: readonly string[],
): Promise<unknown> {
  const recipient = resolveDraftRecipient({
    agent: ctx.agent,
    kind: typeof args.kind === "string" ? args.kind : "",
    toAgent: args.to_agent,
    peers,
  });
  const prepared = prepareDraftRecord({
    kind: typeof args.kind === "string" ? args.kind : "",
    allowedKinds,
    severity: typeof args.severity === "string" ? args.severity : "",
    title: typeof args.title === "string" ? args.title : "",
    detail: typeof args.detail === "string" ? args.detail : "",
    claimedFigures: args.figures,
    pool: ctx.pool,
    recordedKeys: ctx.recordedKeys,
  });
  if (!prepared.ok) return { error: prepared.error, ...(prepared.tool_blocked ? { tool_blocked: true } : {}) };

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentError } = await ctx.db
    .from("agent_findings")
    .select("id, kind, title, severity, evidence, last_seen, created_at, superseded_by, dismissed_reason")
    .eq("client_id", ctx.clientId)
    .eq("agent", ctx.agent)
    .gte("last_seen", since)
    .is("dismissed_reason", null)
    .order("last_seen", { ascending: false })
    .limit(50);
  if (recentError) return { error: recentError.message };
  const duplicate = findingDuplicates({
    nowMs: Date.now(),
    candidate: {
      kind: prepared.kind,
      figures: prepared.evidence.figures,
      periodLabel: prepared.evidence.period_label,
      snapshotId: prepared.evidence.snapshot_id,
    },
    recent: ((recent ?? []) as Array<Record<string, unknown>>).map((row) => {
      const evidence = asRecord(row.evidence);
      return {
        id: String(row.id),
        kind: typeof row.kind === "string" ? row.kind : "",
        figures: evidence?.figures,
        periodLabel: typeof evidence?.period_label === "string" ? evidence.period_label : null,
        snapshotId: typeof evidence?.snapshot_id === "string" ? evidence.snapshot_id : null,
        severity: typeof row.severity === "string" ? row.severity : "",
        seenAtMs: Date.parse(String(row.last_seen ?? row.created_at ?? "")),
        supersededBy: typeof row.superseded_by === "string" ? row.superseded_by : null,
      };
    }),
  });
  if (duplicate) {
    const seenAt = new Date().toISOString();
    const raised = higherFindingSeverity(duplicate.severity, prepared.severity);
    const { error: touchError } = await ctx.db
      .from("agent_findings")
      .update(raised ? { last_seen: seenAt, severity: raised } : { last_seen: seenAt })
      .eq("id", duplicate.id)
      .is("dismissed_reason", null)
      .is("superseded_by", null);
    if (touchError) return { error: touchError.message };
    for (const key of prepared.recordKeys) ctx.recordedKeys.add(key);
    return {
      recorded: true,
      deduped: true,
      finding_id: duplicate.id,
      to_agent: recipient.toAgent,
      evidence: prepared.evidence,
      ...(recipient.normalised ? { normalised_to_agent: true } : {}),
      ...(prepared.warning ? { warning: prepared.warning } : {}),
    };
  }

  const { data, error } = await ctx.db
    .from("agent_findings")
    .insert({
      agent: ctx.agent,
      client_id: ctx.clientId,
      run_id: ctx.runId,
      kind: prepared.kind,
      severity: prepared.severity,
      title: prepared.title,
      detail: prepared.detail,
      evidence: prepared.evidence,
      last_seen: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (error || !data?.id) return { error: error?.message || "The draft was not saved." };
  for (const key of prepared.recordKeys) ctx.recordedKeys.add(key);

  if (!recipient.toAgent) {
    return {
      recorded: true,
      finding_id: data.id,
      to_agent: null,
      evidence: prepared.evidence,
      ...(recipient.normalised ? { normalised_to_agent: true } : {}),
      ...(prepared.warning ? { warning: prepared.warning } : {}),
    };
  }

  const sent = await insertAgentMessage(ctx, {
    toAgent: recipient.toAgent,
    type: draftMessageType(prepared.kind),
    payload: {
      finding_id: data.id,
      kind: prepared.kind,
      title: prepared.title,
      severity: prepared.severity,
      draft: true,
    },
  });
  if ("error" in sent) return { error: sent.error, finding_id: data.id };

  return {
    recorded: true,
    finding_id: data.id,
    to_agent: recipient.toAgent,
    evidence: prepared.evidence,
    ...(recipient.normalised ? { normalised_to_agent: true } : {}),
    ...(prepared.warning ? { warning: prepared.warning } : {}),
  };
}
