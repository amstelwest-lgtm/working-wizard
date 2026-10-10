/**
 * Analyst tools. The allow-list is checked before any read or write.
 * Findings copy figures from tool results, not from the model's own numbers.
 */
import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { executeAgentTool } from "../milon-bot/execute.ts";
import { citedFiguresCovered, groundFindingEvidence, type StoredFigures } from "../../../src/lib/agent-bus.ts";
import {
  executeAnalystGate,
  findingDuplicates,
  labelHealthScore,
  numericFigures,
  statementVariance,
  type AnalystToolName,
} from "../../../src/lib/agent-analyst.ts";

export type AnalystExecCtx = {
  clientId: string;
  runId: string;
  correlationId: string;
  firmId: string | null;
  db: SupabaseClient;
  pool: StoredFigures[];
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

async function latestSnapshots(db: SupabaseClient, clientId: string, limit: number) {
  const { data, error } = await db
    .from("client_financial_snapshots")
    .select("id, period_label, period_date, ratios, financials")
    .eq("client_id", clientId)
    .order("period_date", { ascending: false })
    .limit(limit);
  if (error) return { error: error.message, rows: [] as Array<Record<string, unknown>> };
  return { error: null, rows: (data ?? []) as Array<Record<string, unknown>> };
}

async function readTools(name: "get_health" | "get_financial_snapshot" | "get_statement_history", ctx: AnalystExecCtx) {
  return executeAgentTool(name, {}, {
    clientId: ctx.clientId,
    userId: "",
    token: "",
    audience: "accountant",
    userClient: ctx.db,
    adminClient: ctx.db,
  });
}

export async function executeAnalystTool(
  name: string,
  args: Record<string, unknown>,
  ctx: AnalystExecCtx,
): Promise<unknown> {
  const gate = executeAnalystGate(name);
  if (!gate.allowed) return gate;
  const tool: AnalystToolName = gate.name;

  if (tool === "get_statement_history") return readTools(tool, ctx);

  if (tool === "get_financial_snapshot") {
    const payload = await readTools(tool, ctx);
    const snaps = await latestSnapshots(ctx.db, ctx.clientId, 1);
    const snap = snaps.rows[0];
    const record = asRecord(payload) ?? {};
    return {
      ...record,
      snapshot_id: snap ? String(snap.id) : null,
      period_label: (snap?.period_label as string | null) ?? (record.period_label as string | null) ?? null,
    };
  }

  if (tool === "get_health") {
    const payload = await readTools(tool, ctx);
    const snaps = await latestSnapshots(ctx.db, ctx.clientId, 1);
    const snap = snaps.rows[0];
    const record = asRecord(payload) ?? {};
    const { data: stored, error: storedError } = await ctx.db
      .from("client_score_history")
      .select("period_date, score")
      .eq("client_id", ctx.clientId)
      .order("period_date", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (storedError) return { error: storedError.message };
    const storedRow = asRecord(stored);
    const labeled = labelHealthScore({
      liveOverall: finiteScore(record.overall),
      storedScore: finiteScore(storedRow?.score),
      storedAsOf: typeof storedRow?.period_date === "string" ? storedRow.period_date : null,
    });
    return {
      ...record,
      ...labeled,
      snapshot_id: snap ? String(snap.id) : null,
      period_label: (snap?.period_label as string | null) ?? (record.period_label as string | null) ?? null,
    };
  }

  if (tool === "get_ratios") {
    const snaps = await latestSnapshots(ctx.db, ctx.clientId, 1);
    if (snaps.error) return { error: snaps.error };
    const snap = snaps.rows[0];
    if (!snap) return { empty: true, stored_ratios: {}, statement_totals: {} };
    const financials = numericFigures(snap.financials);
    return {
      empty: false,
      snapshot_id: String(snap.id),
      period_label: (snap.period_label as string | null) ?? null,
      period_date: (snap.period_date as string | null) ?? null,
      stored_ratios: numericFigures(snap.ratios),
      statement_totals: financials,
      figures: financials,
    };
  }

  if (tool === "get_variance") {
    const snaps = await latestSnapshots(ctx.db, ctx.clientId, 2);
    if (snaps.error) return { error: snaps.error };
    if (snaps.rows.length < 2) return { empty: true, variance: {} };
    const current = snaps.rows[0];
    const prior = snaps.rows[1];
    const currentFigures = numericFigures(current.financials);
    const priorFigures = numericFigures(prior.financials);
    const variance = statementVariance(currentFigures, priorFigures);
    if (Object.keys(variance).length === 0) return { empty: true, variance: {} };
    return {
      empty: false,
      snapshot_id: String(current.id),
      period_label: (current.period_label as string | null) ?? null,
      prior_snapshot_id: String(prior.id),
      prior_period_label: (prior.period_label as string | null) ?? null,
      figures: currentFigures,
      variance,
    };
  }

  if (tool === "get_data_freshness") {
    const [clientRes, snapRes, xeroRes, qboRes, sageRes] = await Promise.all([
      ctx.db
        .from("clients")
        .select("financials_updated_at, created_at")
        .eq("id", ctx.clientId)
        .maybeSingle(),
      ctx.db
        .from("client_financial_snapshots")
        .select("period_label, period_date, created_at")
        .eq("client_id", ctx.clientId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      ctx.db.from("xero_connections").select("last_synced_at").eq("client_id", ctx.clientId).maybeSingle(),
      ctx.db.from("qbo_connections").select("last_synced_at").eq("client_id", ctx.clientId).maybeSingle(),
      ctx.db.from("sage_connections").select("last_synced_at").eq("client_id", ctx.clientId).maybeSingle(),
    ]);
    return {
      empty: false,
      books_basis: "ledger_or_upload",
      note: "These times are when the books on file were saved. They are not a bank feed.",
      financials_updated_at: (clientRes.data?.financials_updated_at as string | null) ?? null,
      latest_period_label: (snapRes.data?.period_label as string | null) ?? null,
      latest_period_date: (snapRes.data?.period_date as string | null) ?? null,
      xero_last_synced_at: (xeroRes.data?.last_synced_at as string | null) ?? null,
      qbo_last_synced_at: (qboRes.data?.last_synced_at as string | null) ?? null,
      sage_last_synced_at: (sageRes.data?.last_synced_at as string | null) ?? null,
    };
  }

  if (tool === "get_score_history") {
    const { data, error } = await ctx.db
      .from("client_score_history")
      .select("period_date, score, is_estimated")
      .eq("client_id", ctx.clientId)
      .order("period_date", { ascending: false })
      .limit(8);
    if (error) return { error: error.message };
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    if (rows.length === 0) return { empty: true, scores: [] };
    return { empty: false, scores: rows };
  }

  return recordFinding(args, ctx);
}

function finiteScore(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
}

async function recordFinding(args: Record<string, unknown>, ctx: AnalystExecCtx): Promise<unknown> {
  const severity = typeof args.severity === "string" ? args.severity.trim() : "";
  const title = typeof args.title === "string" ? args.title.trim() : "";
  const kind = typeof args.kind === "string" ? args.kind.trim().slice(0, 80) : "";
  const detail = typeof args.detail === "string" ? args.detail.trim().slice(0, 2000) : "";
  if (!kind || !title) return { error: "A finding needs a kind and a title." };
  if (severity !== "info" && severity !== "watch" && severity !== "act") {
    return { error: "Severity must be info, watch, or act." };
  }
  const grounded = groundFindingEvidence({
    pool: ctx.pool,
    claimedFigures: numericFigures(args.figures),
  });
  if (!grounded.ok) return { error: grounded.error, tool_blocked: true };
  const cited = citedFiguresCovered({
    title,
    detail,
    pool: ctx.pool,
    evidenceFigures: grounded.evidence.figures,
    evidencePeriod: grounded.evidence.period_label,
  });
  if (!cited.ok) return { error: cited.error, tool_blocked: true };

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: recent, error: recentError } = await ctx.db
    .from("agent_findings")
    .select("id, kind, title, evidence, last_seen, created_at, superseded_by")
    .eq("client_id", ctx.clientId)
    .eq("agent", "analyst")
    .gte("last_seen", since)
    .is("superseded_by", null)
    .order("last_seen", { ascending: false })
    .limit(50);
  if (recentError) return { error: recentError.message };
  const duplicate = findingDuplicates({
    nowMs: Date.now(),
    candidate: { kind, title, figures: grounded.evidence.figures },
    recent: ((recent ?? []) as Array<Record<string, unknown>>).map((row) => {
      const evidence = asRecord(row.evidence);
      return {
        id: String(row.id),
        kind: typeof row.kind === "string" ? row.kind : "",
        title: typeof row.title === "string" ? row.title : "",
        figures: numericFigures(evidence?.figures),
        seenAtMs: Date.parse(String(row.last_seen ?? row.created_at ?? "")),
      };
    }),
  });
  if (duplicate) {
    const seenAt = new Date().toISOString();
    const { error: touchError } = await ctx.db
      .from("agent_findings")
      .update({ last_seen: seenAt })
      .eq("id", duplicate.id);
    if (touchError) return { error: touchError.message };
    return { recorded: true, deduped: true, finding_id: duplicate.id, evidence: grounded.evidence };
  }

  const { data, error } = await ctx.db
    .from("agent_findings")
    .insert({
      agent: "analyst",
      client_id: ctx.clientId,
      run_id: ctx.runId,
      kind,
      severity,
      title: title.slice(0, 200),
      detail: detail || null,
      evidence: grounded.evidence,
      last_seen: new Date().toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (error || !data?.id) return { error: error?.message || "The finding was not saved." };

  const { error: messageError } = await ctx.db.from("agent_messages").insert({
    client_id: ctx.clientId,
    firm_id: ctx.firmId,
    from_agent: "analyst",
    to_agent: null,
    type: "finding",
    payload: {
      finding_id: data.id,
      kind,
      title: title.slice(0, 200),
      severity,
    },
    correlation_id: ctx.correlationId,
    run_id: ctx.runId,
    hop: 0,
    status: "pending",
  });
  if (messageError) return { error: messageError.message, finding_id: data.id };

  return {
    recorded: true,
    finding_id: data.id,
    evidence: grounded.evidence,
  };
}
