/**
 * Client Brain Summary tab — the background file on this client.
 * Context here is what you and Milōn Bot use. Agreed work lives on Action Plan.
 */

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { useMarketFormat } from "@/contexts/market";
import { parseOperatingProfile, profileNeedsCompletion } from "@/lib/client-profile";
import { profileIndustryLabel } from "@/lib/profile-signals";
import { coerceMarketSelection, usState } from "@/lib/market";
import { useFinancialInputs } from "@/contexts/financial-inputs";
import { invokeBrainPropose } from "@/lib/brain-propose-client";
import { invokeBrainDeliverableDraft } from "@/lib/brain-deliverable-client";
import { ClientBrainDrafts } from "@/components/client-brain-drafts";
import { SharedDocumentsList } from "@/components/shared-documents-list";
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
  factSourceLabel,
  isMissingBrainRelation,
  mergeBusinessMapFromFacts,
  parseBrainSummary,
  parseBusinessMap,
  parseCompetitors,
  parseGapReport,
  type ClientArtifact,
  type ClientBrainQuestion,
  type ContextFact,
  type DeliverableDraft,
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

export type BrainSummaryTab = "budget" | "ratios" | "advisory" | "profit" | "plan";

const FACT_CATEGORIES = [
  { id: "customers", label: "Customers / concentration" },
  { id: "pricing", label: "Pricing" },
  { id: "team", label: "Team / owner time" },
  { id: "systems", label: "Systems (Xero, bank, payroll)" },
  { id: "regulatory", label: "Tax / regulatory" },
  { id: "seasonality", label: "Seasonality" },
  { id: "cash", label: "Cash / banking" },
  { id: "other", label: "Other" },
] as const;

function SectionLead({ children }: { children: ReactNode }) {
  return <p className="brain-purpose">{children}</p>;
}

type SnapshotLite = {
  id: string;
  period_label: string;
  period_date: string;
  source: string;
  created_at: string;
};

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

type FillDialog =
  | { kind: "stored"; key: string; prompt: string; audience: "owner" | "accountant" | "both" }
  | { kind: "map"; key: string; label: string }
  | null;

function AnswerButton({ onClick, label = "Answer" }: { onClick: () => void; label?: string }) {
  return (
    <button type="button" className="btn gold mini" onClick={onClick}>
      {label}
    </button>
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
  onAnswerProfile,
}: {
  clientId: string;
  clientName: string;
  operatingProfile?: unknown;
  market?: unknown;
  businessType?: string | null;
  onOpenUpload?: () => void;
  onOpenTab?: (tab: BrainSummaryTab) => void;
  onAnswerProfile?: () => void;
}) {
  const { user } = useAuth();
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
  const [drafts, setDrafts] = useState<DeliverableDraft[]>([]);
  const [storedQuestions, setStoredQuestions] = useState<ClientBrainQuestion[]>([]);
  const [proposing, setProposing] = useState(false);
  const [drafting, setDrafting] = useState(false);
  const [fillDialog, setFillDialog] = useState<FillDialog>(null);
  const [fillText, setFillText] = useState("");
  const [fillSaving, setFillSaving] = useState(false);
  const [factText, setFactText] = useState("");
  const [factCategory, setFactCategory] = useState<(typeof FACT_CATEGORIES)[number]["id"]>("other");
  const [factSaving, setFactSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [clientRes, snapRes, artRes, factRes, draftRes, qRes] = await Promise.all([
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
  // Files the owner chose to share. RLS already hides private ones; this
  // list only ever contains what the caller may open.
  const sharedDocs = artifacts.filter((a) => a.kind === "upload" && a.storage_path);
  const ledgerArtifacts = artifacts.filter((a) => !(a.kind === "upload" && a.storage_path));
  const budgetDoc = budget && typeof budget === "object" ? (budget as Record<string, unknown>) : null;
  const budgetFy = typeof budgetDoc?.fyStart === "string" ? budgetDoc.fyStart : null;
  const budgetLines = Array.isArray(budgetDoc?.revenueLines) ? budgetDoc.revenueLines.length : 0;

  const proposeFromBrain = async () => {
    setProposing(true);
    try {
      const result = await invokeBrainPropose(
        clientId,
        outstanding.map((q) => ({ key: q.key, prompt: q.prompt, audience: q.audience })),
      );
      const bits: string[] = [];
      if (result.stepsInserted) {
        bits.push(
          `${result.stepsInserted} suggested move${result.stepsInserted === 1 ? "" : "s"} (put agreed work on Action Plan)`,
        );
      }
      if (result.gapDrafts) bits.push(`${result.gapDrafts} GAP draft${result.gapDrafts === 1 ? "" : "s"}`);
      if (result.competitorDrafts) bits.push(`${result.competitorDrafts} competitor stub${result.competitorDrafts === 1 ? "" : "s"}`);
      if (result.drip) bits.push("one outstanding question");
      if (result.skippedReason === "ai_not_configured") {
        toast.message("AI is not configured. Queued one outstanding question if any.");
      } else if (bits.length) {
        toast.success(`Proposed ${bits.join(", ")}.`);
      } else {
        toast.message("Nothing new to add — this file is already current, or context is still thin.");
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

  const saveFact = async () => {
    const text = factText.trim();
    if (!text) {
      toast.error("Write the fact first — one short sentence is enough.");
      return;
    }
    setFactSaving(true);
    try {
      const { error } = await supabase.from("context_facts").insert({
        client_id: clientId,
        fact_text: text,
        category: factCategory,
        source: "manual",
        created_by: user?.id ?? null,
      });
      if (error) throw error;
      setFactText("");
      toast.success("Fact saved to this client’s brain.");
      await load();
    } catch (e) {
      toast.error((e as Error).message || "Could not save the fact");
    } finally {
      setFactSaving(false);
    }
  };

  const closeFill = () => {
    setFillDialog(null);
    setFillText("");
  };

  const openFill = (next: FillDialog) => {
    setFillDialog(next);
    setFillText("");
  };

  const routeQuestionAnswer = (q: { key: string; prompt: string; audience: "owner" | "accountant" | "both"; source: string }) => {
    if (q.source === "operating_profile" || q.key.startsWith("operating_profile.")) {
      if (onAnswerProfile) {
        onAnswerProfile();
        return;
      }
    }
    if (q.source === "product_mix" || q.source === "weekly_inputs" || q.key.startsWith("product_mix.")) {
      onOpenTab?.("profit");
      return;
    }
    openFill({
      kind: "stored",
      key: q.key,
      prompt: q.prompt,
      audience: q.audience,
    });
  };

  const saveFill = async () => {
    if (!fillDialog) return;
    const text = fillText.trim();
    if (!text) {
      toast.error("Add an answer first");
      return;
    }
    setFillSaving(true);
    try {
      if (fillDialog.kind === "map") {
        const blob = asBrainSummaryObject(brainSummary);
        const current = parseBusinessMap(brainSummary);
        blob.business_map = { ...current, [fillDialog.key]: text };
        await saveBrainSummaryBlob(blob);
        toast.success("Business map updated");
      } else {
        const now = new Date().toISOString();
        const { error } = await supabase.from("client_brain_questions").upsert(
          {
            client_id: clientId,
            question_key: fillDialog.key,
            prompt_text: fillDialog.prompt,
            audience: fillDialog.audience,
            status: "answered",
            answer_text: text,
            answered_at: now,
            answered_by: user?.id ?? null,
          },
          { onConflict: "client_id,question_key" },
        );
        if (error) throw error;
        toast.success("Answer saved");
        await load();
      }
      closeFill();
    } catch (e) {
      toast.error((e as Error).message || "Could not save answer");
    } finally {
      setFillSaving(false);
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
      <div id="wizard-brain-hero" className="card hero-card pad brain-hero">
        <span className="eyebrow">Client brain</span>
        <h2 className="h-sec" style={{ marginBottom: 6 }}>
          The background on {clientName}
        </h2>
        <p className="sub">
          This is the collection of context around this client — how they make money, what is on
          file, and the short facts numbers miss. You and Milōn Bot use it so advice is about{" "}
          <em>this</em> business, not a generic SME.
        </p>
        <p className="sub" style={{ marginTop: 8 }}>
          Empty blocks below are waiting for a fact, an upload, or a draft. They fill as you work
          this file. They are not broken. Agreed work the owner will chase lives on the Action Plan
          tab — not here.
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
            className="btn gold mini"
            onClick={() => void draftAdvisoryFromBrain()}
            disabled={proposing || drafting || loading}
          >
            {drafting ? "Drafting…" : "Draft advisory from brain"}
          </button>
          {onOpenTab && (
            <button type="button" className="btn ghost mini" onClick={() => onOpenTab("plan")}>
              Open Action Plan
            </button>
          )}
        </div>
        <p className="brain-purpose" style={{ marginTop: 10 }}>
          Propose fills GAP drafts, competitor stubs, and suggested moves from what is already on
          this file. Draft advisory writes a pack that lands under Deliverable drafts — nothing is
          sent until you sign it off.
        </p>
      </div>

      {loading ? (
        <PanelSkeleton rows={6} className="card pad bg-[var(--card)]" />
      ) : (
        <div className="brain-stack">
          {/* 1. Profile strip */}
          <section className="card pad">
            <span className="eyebrow">Profile</span>
            <SectionLead>
              How this business makes money. Answer the empties here or in the business profile —
              Milōn Bot reads this first.
            </SectionLead>
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
                  <div className="brain-row-actions">
                    {!q.answered && onAnswerProfile && (
                      <AnswerButton onClick={() => onAnswerProfile()} />
                    )}
                    <StatusDot answered={q.answered} />
                  </div>
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
                No written summary yet. Propose from brain can draft one from what is already on
                this file — it will not invent a story.
              </p>
            )}
          </section>

          {/* Product line questions */}
          <section className="card pad">
            <span className="eyebrow">Product line questions</span>
            <SectionLead>
              What they sell, in their words. Empty until the product mix on Profit is filled — open
              Profit to capture it. This block does not stay empty forever.
            </SectionLead>
            <ul className="brain-list">
              {productQuestions.map((q) => (
                <li key={q.key} className="brain-row">
                  <div>
                    <div className="brain-row-title">{q.prompt}</div>
                    <div className="brain-row-meta">{q.answered && q.answer ? q.answer : "Empty"}</div>
                  </div>
                  <div className="brain-row-actions">
                    {!q.answered && onOpenTab && (
                      <AnswerButton onClick={() => onOpenTab("profit")} />
                    )}
                    <StatusDot answered={q.answered} />
                  </div>
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
            <SectionLead>
              Gaps between these figures and a healthy business in this sector. Empty until you run
              Propose from brain. Drafts are not truth until you sign them off.
            </SectionLead>
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
                No GAP items yet. Run Propose from brain when the file has enough context — drafts
                only, never treated as signed-off truth.
              </p>
            )}
            {gapReport?.updated_at && (
              <div className="brain-meta">Updated {formatWhen(gapReport.updated_at, dateTime)}</div>
            )}
          </section>

          {/* Competitors */}
          <section className="card pad">
            <span className="eyebrow">Competitors</span>
            <SectionLead>
              Who they compete with. Empty until you or Propose from brain add a stub. Sign off when
              you believe the name.
            </SectionLead>
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
                No competitors on file yet. That is normal on a new client — Propose from brain may
                add draft stubs only.
              </p>
            )}
          </section>

          {/* Business-map extras */}
          <section className="card pad">
            <span className="eyebrow">Business map</span>
            <SectionLead>
              How they sell, price, staff, and run systems. Answer any empty row here — it becomes
              part of this brain immediately.
            </SectionLead>
            <ul className="brain-list">
              {BUSINESS_MAP_FIELDS.map((field) => {
                const value = businessMap[field.key];
                return (
                  <li key={field.key} className="brain-row">
                    <div>
                      <div className="brain-row-title">{field.label}</div>
                      <div className="brain-row-meta">{value || "Empty"}</div>
                    </div>
                    <div className="brain-row-actions">
                      {!value && (
                        <AnswerButton
                          onClick={() =>
                            field.key === "seasonality" && onAnswerProfile
                              ? onAnswerProfile()
                              : openFill({ kind: "map", key: field.key, label: field.label })
                          }
                        />
                      )}
                      <StatusDot answered={!!value} />
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>

          {/* Artifacts rail */}
          <section className="card pad">
            <span className="eyebrow">On file</span>
            <SectionLead>
              Snapshots, the budget, and documents already saved for this client. Empty until
              figures are uploaded or a budget is saved — use Upload if nothing is here.
            </SectionLead>
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
              <span className="section-kicker">Shared documents</span>
              <SharedDocumentsList docs={sharedDocs} />
            </div>

            <div className="brain-divider">
              <span className="section-kicker">Artifact ledger</span>
              {ledgerArtifacts.length === 0 ? (
                <p className="sub" style={{ margin: "8px 0 0" }}>
                  No rows in client_artifacts yet.
                </p>
              ) : (
                <ul className="brain-list" style={{ marginTop: 10 }}>
                  {ledgerArtifacts.map((a) => (
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

          {/* Context facts — short truths the numbers miss */}
          <section className="card pad">
            <span className="eyebrow">Context facts</span>
            <SectionLead>
              Short truths the numbers miss — the kind of thing you would tell a colleague before a
              meeting. Examples: one customer is 40% of revenue; the owner works six days; they want
              to sell in three years; busy November–January; they run Xero plus a bookkeeper. Milōn
              Bot reads these. Add one here; they also land from uploads, the profile, and the bot.
            </SectionLead>
            {facts.length === 0 ? (
              <p className="sub" style={{ margin: "0 0 12px" }}>
                None on this file yet. That is expected on a new client — add the first one below.
              </p>
            ) : (
              <ul className="brain-list gap-md" style={{ marginBottom: 14 }}>
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
            <div className="brain-fact-form">
              <Label htmlFor="brain-fact-text" className="mini-kicker">
                Add a fact
              </Label>
              <Textarea
                id="brain-fact-text"
                value={factText}
                onChange={(e) => setFactText(e.target.value)}
                rows={3}
                placeholder="e.g. Largest customer is 40% of revenue and pays on 60 days."
                className="brain-input"
              />
              <div className="brain-fact-row">
                <select
                  aria-label="Fact category"
                  value={factCategory}
                  onChange={(e) =>
                    setFactCategory(e.target.value as (typeof FACT_CATEGORIES)[number]["id"])
                  }
                  className="brain-input"
                >
                  {FACT_CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn gold mini"
                  onClick={() => void saveFact()}
                  disabled={factSaving}
                >
                  {factSaving ? "Saving…" : "Save to brain"}
                </button>
              </div>
            </div>
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
            <SectionLead>
              Shared with the owner. One question is dripped at a time — no spam. Answer any of them
              here so you and the owner are filling the same brain.
            </SectionLead>
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
                    <div className="brain-row-actions">
                      <AnswerButton onClick={() => routeQuestionAnswer(q)} />
                      <span className={`status-tag ${drip?.key === q.key ? "gold" : "faint"}`}>
                        {drip?.key === q.key ? "Asking" : "Empty"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      <Dialog open={fillDialog != null} onOpenChange={(open) => !open && closeFill()}>
        <DialogContent className="border-[#d4a550]/25 bg-[#0d1117] text-slate-100">
          <DialogHeader>
            <DialogTitle>
              {fillDialog?.kind === "map" ? fillDialog.label : "Answer this question"}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {fillDialog?.kind === "stored"
                ? fillDialog.prompt
                : "Short note that becomes part of the client brain — not sent to the owner."}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor="brain-fill-answer">Answer</Label>
            <Textarea
              id="brain-fill-answer"
              value={fillText}
              onChange={(e) => setFillText(e.target.value)}
              className="bg-[#0a0e1a] border-slate-700"
              rows={4}
              placeholder="Type the answer…"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={closeFill} disabled={fillSaving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void saveFill()} disabled={fillSaving}>
              {fillSaving ? "Saving…" : "Save answer"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
