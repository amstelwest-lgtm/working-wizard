/**
 * Client Brain Summary tab — system-of-record panel.
 * Propose from brain drafts next steps; Draft advisory from brain writes a sign-off pack.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { useMarketFormat } from "@/contexts/market";
import { parseOperatingProfile, profileNeedsCompletion } from "@/lib/client-profile";
import { profileIndustryLabel } from "@/lib/profile-signals";
import { coerceMarketSelection, usState } from "@/lib/market";
import { useFinancialInputs } from "@/contexts/financial-inputs";
import { invokeBrainPropose } from "@/lib/brain-propose-client";
import { invokeBrainDeliverableDraft } from "@/lib/brain-deliverable-client";
import { ClientBrainDrafts } from "@/components/client-brain-drafts";
import { MilonBotPanel } from "@/components/milon-bot-panel";
import { PanelSkeleton } from "@/components/primitives";
import {
  asBrainSummaryObject,
  markCompetitorSignedOff,
  markGapItemSignedOff,
} from "@/lib/client-brain-propose";
import { useBrainDrip } from "@/hooks/use-brain-drip";
import {
  BUSINESS_MAP_FIELDS,
  artifactKindLabel,
  buildNextStepEditDiff,
  factSourceLabel,
  isMissingBrainRelation,
  mergeBusinessMapFromFacts,
  nextStepStatusLabel,
  parseBrainSummary,
  parseBusinessMap,
  parseCompetitors,
  parseGapReport,
  type ClientArtifact,
  type ClientBrainQuestion,
  type ContextFact,
  type DeliverableDraft,
  type NextStepStatus,
  type ProposedNextStep,
} from "@/lib/client-brain";
import {
  mergeOutstandingQuestions,
  operatingProfileQuestionStates,
  productLineQuestionStates,
} from "@/lib/client-brain-questions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

export type BrainSummaryTab = "budget" | "ratios" | "advisory" | "profit";

type SnapshotLite = {
  id: string;
  period_label: string;
  period_date: string;
  source: string;
  created_at: string;
};

type StepDialog =
  | { mode: "approve" | "reject"; step: ProposedNextStep }
  | { mode: "edit"; step: ProposedNextStep }
  | null;

function marketStripLabel(raw: unknown): string {
  const sel = coerceMarketSelection(raw);
  if (sel.country === "US" && sel.regionCode) {
    const state = usState(sel.regionCode);
    return `United States · ${state?.name ?? sel.regionCode}`;
  }
  return "South Africa";
}

function formatWhen(iso: string | null | undefined, fmt: (d: Date | string) => string): string {
  if (!iso) return "—";
  return fmt(iso);
}

function StatusDot({ answered }: { answered: boolean }) {
  return (
    <span className={`status-tag ${answered ? "ok" : "faint"}`}>
      {answered ? "Answered" : "Empty"}
    </span>
  );
}

export function ClientBrainSummary({
  clientId,
  clientName,
  operatingProfile,
  market: marketRaw,
  businessType,
  onOpenUpload,
  onOpenTab,
}: {
  clientId: string;
  clientName: string;
  operatingProfile?: unknown;
  market?: unknown;
  businessType?: string | null;
  onOpenUpload?: () => void;
  onOpenTab?: (tab: BrainSummaryTab) => void;
}) {
  const { user } = useAuth();
  const { profile } = useAccountantProfile();
  const { dateTime } = useMarketFormat();
  const { productMix, weeklyInputs } = useFinancialInputs();

  const parsedProfile = useMemo(
    () => parseOperatingProfile(operatingProfile),
    [operatingProfile],
  );
  const profileQuestions = useMemo(
    () => operatingProfileQuestionStates(parsedProfile),
    [parsedProfile],
  );
  const productQuestions = useMemo(
    () => productLineQuestionStates(productMix, weeklyInputs),
    [productMix, weeklyInputs],
  );

  const [loading, setLoading] = useState(true);
  const [queueReady, setQueueReady] = useState(false);
  const [brainSummary, setBrainSummary] = useState<unknown>(null);
  const [brainSummaryUpdatedAt, setBrainSummaryUpdatedAt] = useState<string | null>(null);
  const [budget, setBudget] = useState<unknown>(null);
  const [budgetUpdatedAt, setBudgetUpdatedAt] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotLite[]>([]);
  const [artifacts, setArtifacts] = useState<ClientArtifact[]>([]);
  const [facts, setFacts] = useState<ContextFact[]>([]);
  const [steps, setSteps] = useState<ProposedNextStep[]>([]);
  const [drafts, setDrafts] = useState<DeliverableDraft[]>([]);
  const [storedQuestions, setStoredQuestions] = useState<ClientBrainQuestion[]>([]);
  const [dialog, setDialog] = useState<StepDialog>(null);
  const [note, setNote] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editRationale, setEditRationale] = useState("");
  const [saving, setSaving] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [drafting, setDrafting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [clientRes, snapRes, artRes, factRes, stepRes, draftRes, qRes] = await Promise.all([
      supabase
        .from("clients")
        .select("brain_summary, brain_summary_updated_at, budget, budget_updated_at")
        .eq("id", clientId)
        .maybeSingle(),
      supabase
        .from("client_financial_snapshots")
        .select("id, period_label, period_date, source, created_at")
        .eq("client_id", clientId)
        .order("period_date", { ascending: false })
        .limit(8),
      supabase
        .from("client_artifacts")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("context_facts")
        .select("*")
        .eq("client_id", clientId)
        .is("superseded_by", null)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("proposed_next_steps")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("deliverable_drafts")
        .select("*")
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false })
        .limit(20),
      supabase
        .from("client_brain_questions")
        .select("*")
        .eq("client_id", clientId)
        .order("created_at", { ascending: false })
        .limit(80),
    ]);

    if (clientRes.error && !isMissingBrainRelation(clientRes.error)) {
      const fallback = await supabase
        .from("clients")
        .select("budget, budget_updated_at")
        .eq("id", clientId)
        .maybeSingle();
      if (!fallback.error) {
        setBudget(fallback.data?.budget ?? null);
        setBudgetUpdatedAt(fallback.data?.budget_updated_at ?? null);
      }
    } else {
      setBrainSummary(clientRes.data?.brain_summary ?? null);
      setBrainSummaryUpdatedAt(clientRes.data?.brain_summary_updated_at ?? null);
      setBudget(clientRes.data?.budget ?? null);
      setBudgetUpdatedAt(clientRes.data?.budget_updated_at ?? null);
    }

    if (!snapRes.error) setSnapshots((snapRes.data ?? []) as SnapshotLite[]);
    setArtifacts(isMissingBrainRelation(artRes.error) ? [] : ((artRes.data ?? []) as ClientArtifact[]));
    setFacts(isMissingBrainRelation(factRes.error) ? [] : ((factRes.data ?? []) as ContextFact[]));
    setSteps(isMissingBrainRelation(stepRes.error) ? [] : ((stepRes.data ?? []) as ProposedNextStep[]));
    setDrafts(isMissingBrainRelation(draftRes.error) ? [] : ((draftRes.data ?? []) as DeliverableDraft[]));
    setStoredQuestions(
      isMissingBrainRelation(qRes.error) ? [] : ((qRes.data ?? []) as ClientBrainQuestion[]),
    );
    setLoading(false);
    setQueueReady(true);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = parseBrainSummary(brainSummary);
  const gapReport = parseGapReport(brainSummary);
  const competitors = parseCompetitors(brainSummary);
  const businessMap = (() => {
    const merged = mergeBusinessMapFromFacts(parseBusinessMap(brainSummary), facts);
    if (!merged.seasonality && parsedProfile && parsedProfile.depth !== "core") {
      const season = profileQuestions.find((q) => q.key === "operating_profile.seasonality");
      if (season?.answered && season.answer) merged.seasonality = season.answer;
    }
    return merged;
  })();
  const outstanding = mergeOutstandingQuestions(
    [...profileQuestions, ...productQuestions],
    storedQuestions,
  );
  const drip = useBrainDrip({
    clientId,
    derived: [...profileQuestions, ...productQuestions],
    stored: storedQuestions,
    enabled: queueReady,
    onStamped: () => {
      void load();
    },
  });
  const latestSnapshot = snapshots[0] ?? null;
  const uploadSnaps = snapshots.filter((s) => s.source === "upload").slice(0, 3);
  const budgetDoc = budget && typeof budget === "object" ? (budget as Record<string, unknown>) : null;
  const budgetFy = typeof budgetDoc?.fyStart === "string" ? budgetDoc.fyStart : null;
  const budgetLines = Array.isArray(budgetDoc?.revenueLines) ? budgetDoc.revenueLines.length : 0;

  const signerName =
    profile.accountantName.trim() ||
    (user?.user_metadata as { full_name?: string; name?: string } | null)?.full_name ||
    (user?.user_metadata as { full_name?: string; name?: string } | null)?.name ||
    user?.email ||
    "Accountant";

  const closeDialog = () => {
    setDialog(null);
    setNote("");
    setEditTitle("");
    setEditRationale("");
  };

  const openStepDialog = (mode: "approve" | "reject" | "edit", step: ProposedNextStep) => {
    setDialog({ mode, step });
    setNote(step.note ?? "");
    setEditTitle(step.title);
    setEditRationale(step.rationale ?? "");
  };

  const applyStepStatus = async () => {
    if (!dialog) return;
    setSaving(true);
    try {
      const now = new Date().toISOString();
      const stamp = {
        signed_off_by_id: user?.id ?? null,
        signed_off_by_name: signerName,
        signed_off_by_title: null as string | null,
        firm_name: profile.firmName.trim() || null,
        signed_off_at: now,
        note: note.trim() || null,
      };

      if (dialog.mode === "edit") {
        const title = editTitle.trim();
        if (!title) {
          toast.error("Title is required");
          setSaving(false);
          return;
        }
        const rationale = editRationale.trim() || null;
        const edit_diff = buildNextStepEditDiff(dialog.step, { title, rationale });
        const { error } = await supabase
          .from("proposed_next_steps")
          .update({
            title,
            rationale,
            status: "edited" satisfies NextStepStatus,
            edit_diff,
            ...stamp,
          })
          .eq("id", dialog.step.id)
          .eq("client_id", clientId);
        if (error) throw error;
        toast.success("Next step updated");
      } else {
        const status: NextStepStatus = dialog.mode === "approve" ? "approved" : "rejected";
        const { error } = await supabase
          .from("proposed_next_steps")
          .update({ status, ...stamp })
          .eq("id", dialog.step.id)
          .eq("client_id", clientId);
        if (error) throw error;
        toast.success(status === "approved" ? "Next step approved" : "Next step rejected");
      }
      closeDialog();
      await load();
    } catch (e) {
      toast.error((e as Error).message || "Could not update next step");
    } finally {
      setSaving(false);
    }
  };

  const proposeFromBrain = async () => {
    setProposing(true);
    try {
      const result = await invokeBrainPropose(
        clientId,
        outstanding.map((q) => ({ key: q.key, prompt: q.prompt, audience: q.audience })),
      );
      const bits: string[] = [];
      if (result.stepsInserted) bits.push(`${result.stepsInserted} next step${result.stepsInserted === 1 ? "" : "s"}`);
      if (result.gapDrafts) bits.push(`${result.gapDrafts} GAP draft${result.gapDrafts === 1 ? "" : "s"}`);
      if (result.competitorDrafts) bits.push(`${result.competitorDrafts} competitor stub${result.competitorDrafts === 1 ? "" : "s"}`);
      if (result.drip) bits.push("one outstanding question");
      if (result.skippedReason === "ai_not_configured") {
        toast.message("AI is not configured. Queued one outstanding question if any.");
      } else if (bits.length) {
        toast.success(`Proposed ${bits.join(", ")}.`);
      } else {
        toast.message("Nothing new to propose — open steps already cover this, or context is empty.");
      }
      await load();
    } catch (e) {
      toast.error((e as Error).message || "Could not propose from brain");
    } finally {
      setProposing(false);
    }
  };

  const saveBrainSummaryBlob = async (blob: Record<string, unknown>) => {
    const { data, error } = await supabase
      .from("clients")
      .update({
        brain_summary: blob as Json,
        brain_summary_updated_at: new Date().toISOString(),
      })
      .eq("id", clientId)
      .select("id")
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("Could not save brain summary — access denied or client missing");
    await load();
  };

  const signOffGap = async (key: string) => {
    const items = markGapItemSignedOff(gapReport?.items ?? [], key);
    const blob = asBrainSummaryObject(brainSummary);
    blob.gap_report = { items, updated_at: new Date().toISOString() };
    try {
      await saveBrainSummaryBlob(blob);
      toast.success("GAP item signed off");
    } catch (e) {
      toast.error((e as Error).message || "Could not sign off GAP item");
    }
  };

  const signOffCompetitor = async (name: string) => {
    const items = markCompetitorSignedOff(competitors, name);
    const blob = asBrainSummaryObject(brainSummary);
    blob.competitors = items;
    try {
      await saveBrainSummaryBlob(blob);
      toast.success("Competitor signed off");
    } catch (e) {
      toast.error((e as Error).message || "Could not sign off competitor");
    }
  };

  const draftAdvisoryFromBrain = async () => {
    setDrafting(true);
    try {
      const result = await invokeBrainDeliverableDraft(clientId);
      if (result.skippedReason === "ai_not_configured") {
        toast.message("AI is not configured. No draft was created.");
      } else if (result.draftInserted) {
        toast.success("Advisory draft saved — not sent.");
      } else if (result.skippedReason === "similar_open") {
        toast.message("An open draft already covers this — no duplicate created.");
      } else if (result.skippedReason === "empty_context" || result.skippedReason === "empty_draft") {
                        toast.message("Nothing to draft from what's on file — assumptions stay empty.");
      } else {
        toast.message("No new draft created.");
      }
      await load();
    } catch (e) {
      toast.error((e as Error).message || "Could not draft advisory from brain");
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div>
      <div className="card hero-card pad brain-hero">
        <span className="eyebrow">Client brain</span>
        <h2 className="h-sec" style={{ marginBottom: 6 }}>
          Summary · {clientName}
        </h2>
        <p className="sub">
          System of record. Propose from brain drafts next steps for Approve / Edit / Reject.
          Draft advisory from brain writes a pack with an assumptions list — never auto-sent.
        </p>
        <div className="brain-actions">
          <button
            type="button"
            className="btn gold mini"
            onClick={() => void proposeFromBrain()}
            disabled={proposing || drafting || loading}
          >
            {proposing ? "Proposing…" : "Propose from brain"}
          </button>
          <button
            type="button"
            className="btn ghost mini"
            onClick={() => void draftAdvisoryFromBrain()}
            disabled={proposing || drafting || loading}
          >
            {drafting ? "Drafting…" : "Draft advisory from brain"}
          </button>
        </div>
      </div>

      <MilonBotPanel clientId={clientId} audience="accountant" surface="portal" />

      {loading ? (
        <PanelSkeleton rows={6} className="card pad bg-[var(--card)]" />
      ) : (
        <div className="brain-stack">
          {/* 1. Profile strip */}
          <section className="card pad">
            <span className="eyebrow">Profile</span>
            <div className="brain-profile">
              <strong className="brain-profile-name">
                {profileIndustryLabel(parsedProfile, businessType || "Profile not set")}
              </strong>
              <span className="brain-profile-meta">{marketStripLabel(marketRaw)}</span>
              {profileNeedsCompletion(parsedProfile) && (
                <span className="brain-profile-warn">Core profile only</span>
              )}
            </div>
            <span className="section-kicker">
              10 initial questions
              {parsedProfile?.depth === "core"
                ? " · core 4 of 10"
                : parsedProfile
                  ? " · full"
                  : ""}
            </span>
            <ul className="brain-list">
              {profileQuestions.map((q) => (
                <li key={q.key} className="brain-row">
                  <div>
                    <div className="brain-row-title">{q.prompt}</div>
                    <div className="brain-row-meta">{q.answered && q.answer ? q.answer : "Empty"}</div>
                  </div>
                  <StatusDot answered={q.answered} />
                </li>
              ))}
            </ul>
            {summary ? (
              <div className="brain-divider">
                <span className="eyebrow">Brain summary</span>
                {summary.headline && (
                  <div style={{ fontWeight: 700, marginBottom: 6 }}>{summary.headline}</div>
                )}
                {summary.body && <p className="sub">{summary.body}</p>}
                {summary.bullets && summary.bullets.length > 0 && (
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18, color: "var(--ink-dim)" }}>
                    {summary.bullets.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
                {brainSummaryUpdatedAt && (
                  <div className="brain-meta">
                    Updated {formatWhen(brainSummaryUpdatedAt, dateTime)}
                  </div>
                )}
              </div>
            ) : (
              <p className="sub" style={{ marginTop: 14 }}>
                No saved brain summary yet. Propose from brain can draft one from what is on file.
              </p>
            )}
          </section>

          {/* Product line questions */}
          <section className="card pad">
            <span className="eyebrow">Product line questions</span>
            <ul className="brain-list">
              {productQuestions.map((q) => (
                <li key={q.key} className="brain-row">
                  <div>
                    <div className="brain-row-title">{q.prompt}</div>
                    <div className="brain-row-meta">{q.answered && q.answer ? q.answer : "Empty"}</div>
                  </div>
                  <StatusDot answered={q.answered} />
                </li>
              ))}
            </ul>
            {onOpenTab && (
              <div className="brain-actions">
                <button type="button" className="btn ghost mini" onClick={() => onOpenTab("profit")}>
                  Open Profit
                </button>
              </div>
            )}
          </section>

          {/* Mini GAP report */}
          <section className="card pad">
            <span className="eyebrow">Mini GAP report</span>
            {gapReport?.items.length ? (
              <ul className="brain-list gap-md">
                {gapReport.items.map((item) => (
                  <li key={item.key} className="brain-row-block">
                    <div className="brain-item-head">
                      <strong>{item.title}</strong>
                      <span className="status-tag gold">
                        {item.status === "signed_off" ? "Signed off" : "Draft"}
                        {item.severity ? ` · ${item.severity}` : ""}
                      </span>
                    </div>
                    {item.detail && (
                      <p className="sub" style={{ margin: "4px 0 0" }}>
                        {item.detail}
                      </p>
                    )}
                    {item.status !== "signed_off" && (
                      <button
                        type="button"
                        className="btn ghost mini"
                        style={{ marginTop: 8 }}
                        onClick={() => void signOffGap(item.key)}
                      >
                        Sign off
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sub" style={{ margin: 0 }}>
                No GAP items yet. Propose from brain may add drafts — never auto-truth.
              </p>
            )}
            {gapReport?.updated_at && (
              <div className="brain-meta">Updated {formatWhen(gapReport.updated_at, dateTime)}</div>
            )}
          </section>

          {/* Competitors */}
          <section className="card pad">
            <span className="eyebrow">Competitors</span>
            {competitors.length > 0 ? (
              <ul className="brain-list gap-md">
                {competitors.map((c) => (
                  <li key={c.name} className="brain-row-block">
                    <div className="brain-item-head">
                      <strong>{c.name}</strong>
                      <span className="status-tag gold">
                        {c.status === "signed_off" ? "Signed off" : "Draft"}
                      </span>
                    </div>
                    {c.threat && (
                      <span className="brain-row-meta">Threat: {c.threat}</span>
                    )}
                    {c.notes && (
                      <p className="sub" style={{ margin: "4px 0 0" }}>
                        {c.notes}
                      </p>
                    )}
                    {c.status !== "signed_off" && (
                      <button
                        type="button"
                        className="btn ghost mini"
                        style={{ marginTop: 8 }}
                        onClick={() => void signOffCompetitor(c.name)}
                      >
                        Sign off
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="sub" style={{ margin: 0 }}>
                No competitors recorded. Propose from brain may add draft stubs only.
              </p>
            )}
          </section>

          {/* Business-map extras */}
          <section className="card pad">
            <span className="eyebrow">Business map</span>
            <ul className="brain-list">
              {BUSINESS_MAP_FIELDS.map((field) => {
                const value = businessMap[field.key];
                return (
                  <li key={field.key} className="brain-row">
                    <div>
                      <div className="brain-row-title">{field.label}</div>
                      <div className="brain-row-meta">{value || "Empty"}</div>
                    </div>
                    <StatusDot answered={!!value} />
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Artifacts rail */}
          <section className="card pad">
            <span className="eyebrow">Artifacts</span>
            <div className="card-inner-grid">
              <div className="card-inner">
                <div className="mini-kicker">Latest snapshot</div>
                {latestSnapshot ? (
                  <>
                    <div style={{ fontWeight: 600, marginTop: 6 }}>{latestSnapshot.period_label}</div>
                    <div className="brain-row-meta">
                      {latestSnapshot.source} · {formatWhen(latestSnapshot.created_at, dateTime)}
                    </div>
                  </>
                ) : (
                  <p className="sub" style={{ margin: "8px 0 0" }}>
                    No financial snapshot yet.
                  </p>
                )}
                <div className="brain-actions" style={{ marginTop: 10 }}>
                  {onOpenUpload && (
                    <button type="button" className="btn ghost mini" onClick={onOpenUpload}>
                      Upload / extract
                    </button>
                  )}
                  {onOpenTab && (
                    <button type="button" className="btn ghost mini" onClick={() => onOpenTab("ratios")}>
                      Health
                    </button>
                  )}
                </div>
              </div>

              <div className="card-inner">
                <div className="mini-kicker">Budget</div>
                {budgetDoc ? (
                  <>
                    <div style={{ fontWeight: 600, marginTop: 6 }}>
                      {budgetFy ? `FY ${budgetFy}` : "Budget on file"}
                    </div>
                    <div className="brain-row-meta">
                      {budgetLines} revenue line{budgetLines === 1 ? "" : "s"}
                      {budgetUpdatedAt ? ` · ${formatWhen(budgetUpdatedAt, dateTime)}` : ""}
                    </div>
                  </>
                ) : (
                  <p className="sub" style={{ margin: "8px 0 0" }}>
                    No budget saved.
                  </p>
                )}
                {onOpenTab && (
                  <div className="brain-actions" style={{ marginTop: 10 }}>
                    <button type="button" className="btn ghost mini" onClick={() => onOpenTab("budget")}>
                      Open Budget
                    </button>
                  </div>
                )}
              </div>

              <div className="card-inner">
                <div className="mini-kicker">Recent uploads</div>
                {uploadSnaps.length > 0 ? (
                  <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 13.5 }}>
                    {uploadSnaps.map((s) => (
                      <li key={s.id}>
                        {s.period_label} · {formatWhen(s.created_at, dateTime)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="sub" style={{ margin: "8px 0 0" }}>
                    No upload-sourced snapshots yet.
                  </p>
                )}
              </div>
            </div>

            <div className="brain-divider">
              <span className="section-kicker">Artifact ledger</span>
              {artifacts.length === 0 ? (
                <p className="sub" style={{ margin: "8px 0 0" }}>
                  No rows in client_artifacts yet.
                </p>
              ) : (
                <ul className="brain-list" style={{ marginTop: 10 }}>
                  {artifacts.map((a) => (
                    <li
                      key={a.id}
                      className="brain-row-block"
                      style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13.5 }}
                    >
                      <span>
                        {artifactKindLabel(a.kind)}
                        {a.period_label ? ` · ${a.period_label}` : ""}
                      </span>
                      <span className="brain-meta" style={{ marginTop: 0 }}>
                        {formatWhen(a.created_at, dateTime)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* 3. Context facts */}
          <section className="card pad">
            <span className="eyebrow">Context facts</span>
            {facts.length === 0 ? (
              <p className="sub" style={{ margin: 0 }}>
                No context facts captured yet.
              </p>
            ) : (
              <ul className="brain-list gap-md">
                {facts.map((f) => (
                  <li key={f.id} className="brain-row-block">
                    <div className="brain-row-title">{f.fact_text}</div>
                    <div className="brain-meta">
                      {factSourceLabel(f.source)}
                      {f.category ? ` · ${f.category}` : ""}
                      {f.confidence != null ? ` · ${Math.round(Number(f.confidence) * 100)}%` : ""}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 4. Proposed next steps */}
          <section className="card pad">
            <span className="eyebrow">Proposed next steps</span>
            {steps.length === 0 ? (
              <p className="sub" style={{ margin: 0 }}>
                Queue is empty. Use Propose from brain, then Approve / Edit / Reject.
              </p>
            ) : (
              <ul className="brain-list gap-lg">
                {steps.map((step) => (
                  <li key={step.id} className="card-inner">
                    <div className="brain-item-head">
                      <strong>{step.title}</strong>
                      <span className="status-tag gold">{nextStepStatusLabel(step.status)}</span>
                    </div>
                    {step.rationale && (
                      <p className="sub" style={{ margin: "6px 0 0" }}>
                        {step.rationale}
                      </p>
                    )}
                    {step.signed_off_by_name && step.signed_off_at && (
                      <div className="brain-row-meta" style={{ marginTop: 8 }}>
                        {nextStepStatusLabel(step.status)} by {step.signed_off_by_name}
                        {step.firm_name ? ` · ${step.firm_name}` : ""} · {formatWhen(step.signed_off_at, dateTime)}
                        {step.note ? ` — “${step.note}”` : ""}
                      </div>
                    )}
                    {step.status === "proposed" && (
                      <div className="brain-actions">
                        <button type="button" className="btn gold mini" onClick={() => openStepDialog("approve", step)}>
                          Approve
                        </button>
                        <button type="button" className="btn ghost mini" onClick={() => openStepDialog("edit", step)}>
                          Edit
                        </button>
                        <button type="button" className="btn ghost mini" onClick={() => openStepDialog("reject", step)}>
                          Reject
                        </button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <ClientBrainDrafts
            clientId={clientId}
            drafts={drafts}
            onReload={load}
            onOpenAdvisory={onOpenTab ? () => onOpenTab("advisory") : undefined}
          />

          {/* Outstanding questions — shared owner + accountant queue */}
          <section className="card pad">
            <span className="eyebrow">Outstanding questions</span>
            <p className="sub" style={{ margin: "0 0 12px" }}>
              Shared with the owner. One question is dripped at a time — no spam.
            </p>
            {drip && (
              <div className="brain-highlight">
                <div className="mini-kicker">Asking now</div>
                <div className="prompt">{drip.prompt}</div>
                <div className="brain-row-meta">{drip.key}</div>
              </div>
            )}
            {outstanding.length === 0 ? (
              <p className="sub" style={{ margin: 0 }}>
                No outstanding questions.
              </p>
            ) : (
              <ul className="brain-list">
                {outstanding.map((q) => (
                  <li key={q.key} className="brain-row">
                    <div>
                      <div className="brain-row-title">{q.prompt}</div>
                      <div className="brain-row-meta">
                        {q.key}
                        {q.audience !== "both" ? ` · ${q.audience}` : ""}
                      </div>
                    </div>
                    <span className={`status-tag ${drip?.key === q.key ? "gold" : "faint"}`}>
                      {drip?.key === q.key ? "Asking" : "Empty"}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <Dialog open={dialog != null} onOpenChange={(open) => !open && closeDialog()}>
        <DialogContent className="border-[#d4a550]/25 bg-[#0d1117] text-slate-100">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === "approve"
                ? "Approve next step"
                : dialog?.mode === "reject"
                  ? "Reject next step"
                  : "Edit next step"}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              Status change only — no signature ceremony in this slice.
              {dialog?.step ? ` “${dialog.step.title}”` : ""}
            </DialogDescription>
          </DialogHeader>
          {dialog?.mode === "edit" && (
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="brain-step-title">Title</Label>
                <Input
                  id="brain-step-title"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="bg-[#0a0e1a] border-slate-700"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="brain-step-rationale">Rationale</Label>
                <Textarea
                  id="brain-step-rationale"
                  value={editRationale}
                  onChange={(e) => setEditRationale(e.target.value)}
                  className="bg-[#0a0e1a] border-slate-700"
                  rows={3}
                />
              </div>
            </div>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="brain-step-note">Note (optional)</Label>
            <Textarea
              id="brain-step-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="bg-[#0a0e1a] border-slate-700"
              rows={3}
              placeholder="Why this decision…"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeDialog} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void applyStepStatus()} disabled={saving}>
              {saving
                ? "Saving…"
                : dialog?.mode === "approve"
                  ? "Approve"
                  : dialog?.mode === "reject"
                    ? "Reject"
                    : "Save edit"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
