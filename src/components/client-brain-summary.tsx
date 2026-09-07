/**
 * Client Brain Summary tab — read-mostly system-of-record panel.
 * Structure only: no Claude propose / AI generation.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { useMarket, useMarketFormat } from "@/contexts/market";
import { parseOperatingProfile, profileNeedsCompletion } from "@/lib/client-profile";
import { profileDisplayRows, profileIndustryLabel } from "@/lib/profile-signals";
import { coerceMarketSelection, usState } from "@/lib/market";
import {
  artifactKindLabel,
  buildNextStepEditDiff,
  draftStatusLabel,
  factSourceLabel,
  isMissingBrainRelation,
  nextStepStatusLabel,
  parseAssumptionChecklist,
  parseBrainSummary,
  serializeAssumptionChecklist,
  type ClientArtifact,
  type ContextFact,
  type DeliverableDraft,
  type NextStepStatus,
  type ProposedNextStep,
} from "@/lib/client-brain";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

export type BrainSummaryTab = "budget" | "ratios" | "advisory";

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
  const { market } = useMarket();
  const { dateTime } = useMarketFormat();

  const parsedProfile = useMemo(
    () => parseOperatingProfile(operatingProfile),
    [operatingProfile],
  );
  const profileRows = useMemo(
    () => (parsedProfile ? profileDisplayRows(parsedProfile, market).slice(0, 8) : []),
    [parsedProfile, market],
  );

  const [loading, setLoading] = useState(true);
  const [brainSummary, setBrainSummary] = useState<unknown>(null);
  const [brainSummaryUpdatedAt, setBrainSummaryUpdatedAt] = useState<string | null>(null);
  const [budget, setBudget] = useState<unknown>(null);
  const [budgetUpdatedAt, setBudgetUpdatedAt] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotLite[]>([]);
  const [artifacts, setArtifacts] = useState<ClientArtifact[]>([]);
  const [facts, setFacts] = useState<ContextFact[]>([]);
  const [steps, setSteps] = useState<ProposedNextStep[]>([]);
  const [drafts, setDrafts] = useState<DeliverableDraft[]>([]);
  const [dialog, setDialog] = useState<StepDialog>(null);
  const [note, setNote] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editRationale, setEditRationale] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [clientRes, snapRes, artRes, factRes, stepRes, draftRes] = await Promise.all([
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
    setLoading(false);
  }, [clientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const summary = parseBrainSummary(brainSummary);
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

  const toggleAssumption = async (draft: DeliverableDraft, itemId: string) => {
    const items = parseAssumptionChecklist(draft.assumption_checklist).map((item) =>
      item.id === itemId ? { ...item, checked: !item.checked } : item,
    );
    const { error } = await supabase
      .from("deliverable_drafts")
      .update({ assumption_checklist: serializeAssumptionChecklist(items) })
      .eq("id", draft.id)
      .eq("client_id", clientId);
    if (error) {
      toast.error(error.message);
      return;
    }
    setDrafts((prev) =>
      prev.map((d) =>
        d.id === draft.id ? { ...d, assumption_checklist: serializeAssumptionChecklist(items) } : d,
      ),
    );
  };

  return (
    <div>
      <div className="card hero-card pad" style={{ marginBottom: 20 }}>
        <span className="eyebrow">Client brain</span>
        <h2 className="h-sec" style={{ marginBottom: 6 }}>
          Summary · {clientName}
        </h2>
        <p className="sub">
          System of record for this client. Structure only — no AI propose in this slice.
        </p>
      </div>

      {loading ? (
        <div className="card pad" style={{ color: "var(--ink-dim)" }}>
          Loading summary…
        </div>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {/* 1. Profile strip */}
          <section className="card pad">
            <span className="eyebrow">Profile</span>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 10,
                marginBottom: 14,
                alignItems: "baseline",
              }}
            >
              <strong style={{ fontSize: 16 }}>
                {profileIndustryLabel(parsedProfile, businessType || "Profile not set")}
              </strong>
              <span style={{ color: "var(--ink-dim)", fontSize: 13 }}>
                {marketStripLabel(marketRaw)}
              </span>
              {profileNeedsCompletion(parsedProfile) && (
                <span style={{ color: "var(--warn)", fontSize: 12 }}>Core profile only</span>
              )}
            </div>
            {profileRows.length > 0 ? (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                  gap: 10,
                }}
              >
                {profileRows.map((row) => (
                  <div key={row.label}>
                    <div
                      style={{
                        fontSize: 10,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        color: "var(--ink-faint)",
                      }}
                    >
                      {row.label}
                    </div>
                    <div style={{ fontSize: 13.5 }}>{row.value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="sub" style={{ margin: 0 }}>
                No operating profile yet. Run the 10-question funnel from Health &amp; Ratios.
              </p>
            )}
            {summary ? (
              <div
                style={{
                  marginTop: 16,
                  paddingTop: 14,
                  borderTop: "1px solid var(--line-soft)",
                }}
              >
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
                  <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 8 }}>
                    Updated {formatWhen(brainSummaryUpdatedAt, dateTime)}
                  </div>
                )}
              </div>
            ) : (
              <p className="sub" style={{ marginTop: 14 }}>
                No saved brain summary yet. Generation is out of scope for this slice.
              </p>
            )}
          </section>

          {/* 2. Artifacts rail */}
          <section className="card pad">
            <span className="eyebrow">Artifacts</span>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                gap: 12,
              }}
            >
              <div style={{ border: "1px solid var(--line-soft)", borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--gold)" }}>
                  Latest snapshot
                </div>
                {latestSnapshot ? (
                  <>
                    <div style={{ fontWeight: 600, marginTop: 6 }}>{latestSnapshot.period_label}</div>
                    <div className="sub" style={{ fontSize: 12.5 }}>
                      {latestSnapshot.source} · {formatWhen(latestSnapshot.created_at, dateTime)}
                    </div>
                  </>
                ) : (
                  <p className="sub" style={{ margin: "8px 0 0" }}>
                    No financial snapshot yet.
                  </p>
                )}
                <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
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

              <div style={{ border: "1px solid var(--line-soft)", borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--gold)" }}>
                  Budget
                </div>
                {budgetDoc ? (
                  <>
                    <div style={{ fontWeight: 600, marginTop: 6 }}>
                      {budgetFy ? `FY ${budgetFy}` : "Budget on file"}
                    </div>
                    <div className="sub" style={{ fontSize: 12.5 }}>
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
                  <div style={{ marginTop: 10 }}>
                    <button type="button" className="btn ghost mini" onClick={() => onOpenTab("budget")}>
                      Open Budget
                    </button>
                  </div>
                )}
              </div>

              <div style={{ border: "1px solid var(--line-soft)", borderRadius: 14, padding: 14 }}>
                <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--gold)" }}>
                  Recent uploads
                </div>
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

            <div style={{ marginTop: 16 }}>
              <div style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--ink-faint)" }}>
                Artifact ledger
              </div>
              {artifacts.length === 0 ? (
                <p className="sub" style={{ margin: "8px 0 0" }}>
                  No rows in client_artifacts yet.
                </p>
              ) : (
                <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 8 }}>
                  {artifacts.map((a) => (
                    <li
                      key={a.id}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        gap: 12,
                        fontSize: 13.5,
                        borderBottom: "1px solid var(--line-soft)",
                        paddingBottom: 8,
                      }}
                    >
                      <span>
                        {artifactKindLabel(a.kind)}
                        {a.period_label ? ` · ${a.period_label}` : ""}
                      </span>
                      <span style={{ color: "var(--ink-faint)", fontSize: 12 }}>
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
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
                {facts.map((f) => (
                  <li key={f.id} style={{ borderBottom: "1px solid var(--line-soft)", paddingBottom: 10 }}>
                    <div>{f.fact_text}</div>
                    <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 4 }}>
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
                Queue is empty. Approve / edit / reject will land here once proposals exist.
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 14 }}>
                {steps.map((step) => (
                  <li
                    key={step.id}
                    style={{
                      border: "1px solid var(--line-soft)",
                      borderRadius: 14,
                      padding: 14,
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <strong>{step.title}</strong>
                      <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--gold)" }}>
                        {nextStepStatusLabel(step.status)}
                      </span>
                    </div>
                    {step.rationale && (
                      <p className="sub" style={{ margin: "6px 0 0" }}>
                        {step.rationale}
                      </p>
                    )}
                    {step.signed_off_by_name && step.signed_off_at && (
                      <div style={{ fontSize: 12, color: "var(--ink-dim)", marginTop: 8 }}>
                        {nextStepStatusLabel(step.status)} by {step.signed_off_by_name}
                        {step.firm_name ? ` · ${step.firm_name}` : ""} · {formatWhen(step.signed_off_at, dateTime)}
                        {step.note ? ` — “${step.note}”` : ""}
                      </div>
                    )}
                    {step.status === "proposed" && (
                      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
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

          {/* 5. Deliverable drafts */}
          <section className="card pad">
            <span className="eyebrow">Deliverable drafts</span>
            {drafts.length === 0 ? (
              <p className="sub" style={{ margin: 0 }}>
                No deliverable drafts yet.
                {onOpenTab ? (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="btn ghost mini"
                      style={{ marginLeft: 8 }}
                      onClick={() => onOpenTab("advisory")}
                    >
                      Open Advisory
                    </button>
                  </>
                ) : null}
              </p>
            ) : (
              <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 14 }}>
                {drafts.map((draft) => {
                  const items = parseAssumptionChecklist(draft.assumption_checklist);
                  return (
                    <li
                      key={draft.id}
                      style={{ border: "1px solid var(--line-soft)", borderRadius: 14, padding: 14 }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                        <strong>{draft.kind?.replace(/_/g, " ") || "Draft"}</strong>
                        <span style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--gold)" }}>
                          {draftStatusLabel(draft.status)}
                        </span>
                      </div>
                      {draft.body && (
                        <p className="sub" style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>
                          {draft.body.length > 420 ? `${draft.body.slice(0, 420)}…` : draft.body}
                        </p>
                      )}
                      {items.length === 0 ? (
                        <p className="sub" style={{ margin: "10px 0 0", fontSize: 12.5 }}>
                          No assumption checklist on this draft.
                        </p>
                      ) : (
                        <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 8 }}>
                          {items.map((item) => (
                            <li key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                              <Checkbox
                                id={`${draft.id}-${item.id}`}
                                checked={item.checked}
                                onCheckedChange={() => void toggleAssumption(draft, item.id)}
                              />
                              <label
                                htmlFor={`${draft.id}-${item.id}`}
                                style={{ fontSize: 13.5, cursor: "pointer" }}
                              >
                                {item.text}
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  );
                })}
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
