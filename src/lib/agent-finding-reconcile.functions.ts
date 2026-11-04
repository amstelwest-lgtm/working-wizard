/**
 * Persist reconciled health narrative on the finding row when Regenerate is used.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  guardReconciledFindingWrite,
  loadHealthScoreSnapshot,
  persistReconciledFindingCopy,
  snapshotEvidenceFields,
} from "@/lib/health-snapshot";
import { overviewRatios } from "@/lib/health-score";

type LooseSb = {
  from: (t: string) => {
    select: (cols: string) => {
      eq: (col: string, val: string) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null; error: { message: string } | null }>;
      };
    };
  };
  rpc: (fn: string, args: Record<string, string>) => Promise<{ data: unknown; error: { message: string } | null }>;
};

export const reconcileHealthFindingNarrative = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z
      .object({
        findingId: z.string().uuid(),
        liveSentence: z.string().min(1),
        scoreSnapshotHash: z.string().min(1),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const userId = context.userId;
    if (!userId) throw new Error("Not authenticated");
    const sb = context.supabase as unknown as LooseSb;

    const { data: row, error: rowError } = await sb
      .from("agent_findings")
      .select("id, client_id, title, detail, evidence, superseded_by, dismissed_reason")
      .eq("id", data.findingId)
      .maybeSingle();
    if (rowError) throw new Error(rowError.message);
    if (!row?.id || !row.client_id) throw new Error("Finding not found");
    if (row.superseded_by || row.dismissed_reason) throw new Error("That finding is no longer active");

    const { data: access, error: accessError } = await sb.rpc("has_client_access", {
      _user_id: userId,
      _client_id: String(row.client_id),
    });
    if (accessError) throw new Error(accessError.message);
    if (!access) throw new Error("You do not have access to this client");

    const live = await loadHealthScoreSnapshot(sb, String(row.client_id));
    if (!live) throw new Error("Live health snapshot is not available");

    const { data: clientRow } = await sb
      .from("clients")
      .select("financials, market")
      .eq("id", String(row.client_id))
      .maybeSingle();
    const financials =
      clientRow?.financials && typeof clientRow.financials === "object" && !Array.isArray(clientRow.financials)
        ? (clientRow.financials as Record<string, unknown>)
        : null;
    const canonicalRatios = financials ? overviewRatios(financials) : null;

    const evidence =
      row.evidence && typeof row.evidence === "object" && !Array.isArray(row.evidence)
        ? (row.evidence as Record<string, unknown>)
        : {};
    const mergedEvidence = {
      ...evidence,
      ...snapshotEvidenceFields(live),
    };

    const persisted = persistReconciledFindingCopy({
      title: String(row.title ?? ""),
      detail: typeof row.detail === "string" ? row.detail : null,
      evidence: mergedEvidence,
      live,
      canonicalRatios,
    });

    const guard = guardReconciledFindingWrite({
      server: live,
      clientHash: data.scoreSnapshotHash,
      liveSentence: data.liveSentence,
      title: persisted.title,
    });
    if (!guard.write) throw new Error(guard.error);
    if (!persisted.changed) throw new Error("Nothing to regenerate");

    const seenAt = new Date().toISOString();
    const { data: updated, error: updateError } = await supabaseAdmin
      .from("agent_findings")
      .update({
        title: guard.title,
        detail: persisted.detail,
        last_seen: seenAt,
        evidence: mergedEvidence as never,
      })
      .eq("id", data.findingId)
      .select("id")
      .single();

    if (updateError) throw new Error(updateError.message);
    if (!updated?.id) throw new Error("Finding update did not persist");

    return {
      ok: true as const,
      findingId: data.findingId,
      title: guard.title,
      lastSeen: seenAt,
    };
  });
