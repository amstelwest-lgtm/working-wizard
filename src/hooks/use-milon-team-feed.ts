/**
 * Client-side feed for the three agents (bookkeeper, analyst, advisor).
 * Reads with the signed-in Supabase client (RLS). Approve calls the existing
 * draft path and does not send anything. Dismiss writes the existing
 * `proposed_next_steps.status` (`rejected`) or `deliverable_drafts.status` (`discarded`).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getAdvisorySignoffState } from "@/lib/advisory-signoff";
import { invokeBrainDeliverableDraft } from "@/lib/brain-deliverable-client";
import { isMissingBrainRelation } from "@/lib/client-brain";
import { parseRecommendationRow } from "@/lib/recommendations";
import { coerceMarketSelection } from "@/lib/market/parse";
import { resolveMarket, ZA_MARKET } from "@/lib/market/resolve";
import { isPrecardCapFailure, PRECARD_CAP_CODE, PRECARD_CAP_MESSAGE } from "@/lib/precard-cap";
import {
  buildMilonTeamFeed,
  diagnosisFromWorkspace,
  emptyMilonTeamFeed,
  mapApproveResult,
  precardStateFromFirm,
  TEAM_DRAFT_AUTO_SEND,
  withPrecardCap,
  type ApproveResult,
  type MilonTeamFeed,
  type TeamFeedDraft,
  type TeamFeedProposal,
} from "@/lib/milon-team-feed";

export type MilonTeamFeedApi = MilonTeamFeed & {
  approveJob(id: string): Promise<ApproveResult>;
  dismissJob(id: string, reason?: string): Promise<{ ok: boolean; message?: string }>;
  refresh(): void;
};

type QueryError = { code?: string; message?: string } | null;

function soft(error: QueryError): string | null {
  if (!error) return null;
  if (isMissingBrainRelation(error)) return null;
  return error.message || "Could not load the team feed";
}

function draftHref(clientId: string): string {
  return `/clients/${clientId}?tab=deliverables&section=drafter`;
}

export function useMilonTeamFeed(clientId: string): MilonTeamFeedApi {
  const [feed, setFeed] = useState<MilonTeamFeed>(() => ({ ...emptyMilonTeamFeed(), loading: true }));
  const [tick, setTick] = useState(0);
  const loadedFor = useRef("");

  const refresh = useCallback(() => {
    setTick((n) => n + 1);
  }, []);

  useEffect(() => {
    const id = clientId.trim();
    if (!id) {
      loadedFor.current = "";
      setFeed(emptyMilonTeamFeed());
      return;
    }
    let cancelled = false;
    const switching = loadedFor.current !== id;
    loadedFor.current = id;
    setFeed((prev) =>
      switching ? { ...emptyMilonTeamFeed(), loading: true } : { ...prev, loading: true, error: null },
    );

    void (async () => {
      const [clientRes, snapRes, stepRes, draftRes, requestRes, noteRes, artifactRes, diagnosisRes] =
        await Promise.all([
          supabase
            .from("clients")
            .select(
              "firm_id, financials, cashflow, brain_summary, brain_summary_updated_at, last_forecast_at, market, financial_year_start_month",
            )
            .eq("id", id)
            .maybeSingle(),
          supabase
            .from("client_financial_snapshots")
            .select("id, created_at, period_date, period_label, source, financials")
            .eq("client_id", id)
            .order("created_at", { ascending: false })
            .limit(24),
          supabase
            .from("proposed_next_steps")
            .select("*")
            .eq("client_id", id)
            .order("created_at", { ascending: false })
            .limit(40),
          supabase
            .from("deliverable_drafts")
            .select("id, kind, body, status, created_at, updated_at")
            .eq("client_id", id)
            .order("created_at", { ascending: false })
            .limit(20),
          supabase
            .from("data_requests")
            .select("id, title, requested_at, created_at")
            .eq("client_id", id)
            .order("requested_at", { ascending: false })
            .limit(40),
          supabase
            .from("client_notes")
            .select("id, body, ratio_key, created_at")
            .eq("client_id", id)
            .not("ratio_key", "is", null)
            .order("created_at", { ascending: false })
            .limit(40),
          supabase
            .from("client_artifacts")
            .select("id, kind, period_label, created_at")
            .eq("client_id", id)
            .eq("kind", "upload")
            .order("created_at", { ascending: false })
            .limit(40),
          supabase
            .from("advisory_events")
            .select("id, event, created_at")
            .eq("client_id", id)
            .eq("event", "diagnosis.reviewed")
            .order("created_at", { ascending: false })
            .limit(20),
        ]);

      const errors = [
        soft(clientRes.error),
        soft(snapRes.error),
        soft(stepRes.error),
        soft(draftRes.error),
        soft(requestRes.error),
        soft(noteRes.error),
        soft(artifactRes.error),
        soft(diagnosisRes.error),
      ].filter((msg): msg is string => Boolean(msg));

      const client = clientRes.data;
      let market = ZA_MARKET;
      try {
        market = resolveMarket(coerceMarketSelection(client?.market));
      } catch {
        market = ZA_MARKET;
      }

      let precard = precardStateFromFirm(null);
      if (client?.firm_id) {
        const firmRes = await supabase
          .from("firms")
          .select(
            "precard_cap_applies, precard_pack_generations, precard_email_drafts, precard_bot_messages",
          )
          .eq("id", client.firm_id)
          .maybeSingle();
        const firmError = soft(firmRes.error);
        if (firmError) errors.push(firmError);
        else precard = precardStateFromFirm(firmRes.data);
      }

      let signoff = null;
      let signoffError: string | null = null;
      try {
        signoff = await getAdvisorySignoffState(id, supabase);
      } catch (err) {
        signoffError = err instanceof Error ? err.message : "Could not read sign-off";
      }

      const snapshots = snapRes.data ?? [];
      const current = snapshots[0] ?? null;
      const proposals: TeamFeedProposal[] = ((stepRes.data ?? []) as Record<string, unknown>[]).map(
        (row) => {
          const parsed = parseRecommendationRow(row);
          return {
            id: parsed.id,
            title: parsed.title,
            summary: (parsed.rationale || parsed.problem || "").trim(),
            type: parsed.expected_impact_metric,
            priority: parsed.priority,
            status: parsed.status,
            createdAt: parsed.created_at,
            decidedAt: parsed.decided_at,
            updatedAt: parsed.updated_at,
            signedOffAt: parsed.signed_off_at,
            note: parsed.note,
          };
        },
      );
      const drafts: TeamFeedDraft[] = (draftRes.data ?? []).map((row) => ({
        id: row.id,
        kind: row.kind,
        body: row.body,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));
      const openProposals = proposals.filter((step) => step.status === "proposed" || step.status === "edited");
      const diagnosis = diagnosisFromWorkspace({
        financials: client?.financials ?? current?.financials ?? null,
        cashflow: client?.cashflow ?? null,
        financialsUpdatedAt: null,
        lastForecastAt: client?.last_forecast_at ?? null,
        fyStartMonth: client?.financial_year_start_month ?? null,
        market,
        timeZone: market.timezone,
        brainSummary: client?.brain_summary ?? null,
        brainSummaryUpdatedAt: client?.brain_summary_updated_at ?? null,
        snapshotAsOf: current?.period_date || current?.created_at || null,
        proposals: openProposals.map((step) => ({
          id: step.id,
          title: step.title,
          summary: step.summary,
          type: step.type,
          priority: step.priority,
          createdAt: step.createdAt,
        })),
      });

      const next = buildMilonTeamFeed({
        clientId: id,
        diagnosis,
        proposals,
        drafts,
        precard,
        signoff,
        signoffMarket: market,
        activityRecords: {
          snapshots: snapshots.map((row) => ({
            id: row.id,
            source: row.source,
            periodLabel: row.period_label,
            at: row.created_at,
          })),
          uploads: (artifactRes.data ?? []).map((row) => ({
            id: row.id,
            label: row.period_label,
            at: row.created_at,
          })),
          diagnosisEvents: (diagnosisRes.data ?? []).map((row) => ({
            id: String(row.id),
            at: row.created_at,
          })),
          dataRequests: (requestRes.data ?? []).map((row) => ({
            id: row.id,
            title: row.title,
            at: row.requested_at || row.created_at,
          })),
          queries: (noteRes.data ?? [])
            .filter((row) => row.ratio_key)
            .map((row) => ({
              id: row.id,
              text: row.body,
              at: row.created_at,
            })),
        },
        error: signoffError || errors[0] || null,
      });

      if (!cancelled) setFeed(next);
    })().catch((err: unknown) => {
      if (cancelled) return;
      setFeed({
        ...emptyMilonTeamFeed(),
        error: err instanceof Error ? err.message : "Could not load the team feed",
      });
    });

    return () => {
      cancelled = true;
    };
  }, [clientId, tick]);

  const approveJob = useCallback(
    async (jobId: string): Promise<ApproveResult> => {
      const id = clientId.trim();
      const job = feed.jobs.find((row) => row.id === jobId);
      if (!id || !job) {
        return mapApproveResult({ failed: true, message: "Job not found" });
      }
      if (job.blockedReason === "precard_cap" || feed.precard.capped) {
        setFeed((prev) => withPrecardCap(prev));
        return mapApproveResult({ code: PRECARD_CAP_CODE, message: PRECARD_CAP_MESSAGE });
      }
      if (!job.canApprove) {
        const message =
          job.blockedReason === "no_data"
            ? "Nothing on file to draft from"
            : "This job cannot be drafted";
        return mapApproveResult({ failed: true, message });
      }
      if (TEAM_DRAFT_AUTO_SEND) {
        return mapApproveResult({ failed: true, message: "Drafts are not sent" });
      }
      try {
        const result = await invokeBrainDeliverableDraft(id);
        let draftId: string | null = null;
        if (result.draftInserted) {
          const latest = await supabase
            .from("deliverable_drafts")
            .select("id")
            .eq("client_id", id)
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          draftId = latest.data?.id ?? null;
        }
        const href = draftHref(id);
        refresh();
        return mapApproveResult({ draftId, href });
      } catch (err) {
        if (isPrecardCapFailure(err)) {
          setFeed((prev) => withPrecardCap(prev));
          return mapApproveResult({
            code: PRECARD_CAP_CODE,
            message: err instanceof Error ? err.message : PRECARD_CAP_MESSAGE,
          });
        }
        return mapApproveResult({
          failed: true,
          message: err instanceof Error ? err.message : "Could not save the draft",
        });
      }
    },
    [clientId, feed.jobs, feed.precard.capped, refresh],
  );

  const dismissJob = useCallback(
    async (jobId: string, reason?: string): Promise<{ ok: boolean; message?: string }> => {
      const id = clientId.trim();
      if (!id || !jobId.trim()) return { ok: false, message: "Job not found" };
      const patch: { status: "rejected"; decided_at: string; note?: string } = {
        status: "rejected",
        decided_at: new Date().toISOString(),
      };
      if (reason?.trim()) patch.note = reason.trim();
      const proposal = await supabase
        .from("proposed_next_steps")
        .update(patch)
        .eq("id", jobId)
        .eq("client_id", id)
        .select("id")
        .maybeSingle();
      if (proposal.error && /decided_at/i.test(proposal.error.message)) {
        const fallback: { status: "rejected"; note?: string } = { status: "rejected" };
        if (reason?.trim()) fallback.note = reason.trim();
        const again = await supabase
          .from("proposed_next_steps")
          .update(fallback)
          .eq("id", jobId)
          .eq("client_id", id)
          .select("id")
          .maybeSingle();
        if (again.error && !isMissingBrainRelation(again.error)) {
          return { ok: false, message: again.error.message };
        }
        if (again.data?.id) {
          refresh();
          return { ok: true };
        }
      } else if (proposal.error && !isMissingBrainRelation(proposal.error)) {
        return { ok: false, message: proposal.error.message };
      } else if (proposal.data?.id) {
        refresh();
        return { ok: true };
      }

      const draft = await supabase
        .from("deliverable_drafts")
        .update({ status: "discarded" })
        .eq("id", jobId)
        .eq("client_id", id)
        .select("id")
        .maybeSingle();
      if (draft.error && !isMissingBrainRelation(draft.error)) {
        return { ok: false, message: draft.error.message };
      }
      if (!draft.data?.id) return { ok: false, message: "Job not found" };
      refresh();
      return { ok: true };
    },
    [clientId, refresh],
  );

  return { ...feed, approveJob, dismissJob, refresh };
}
