/**
 * Deliverable drafts on Client Summary — checklist, mark ready, discard, send.
 * Claude creation lives in brain-deliverable-draft; this panel never auto-sends.
 */

import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useAccountantProfile } from "@/contexts/accountant-profile";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  hashFigures,
  latestSnapshotId,
  recordDelivery,
  warnIfDeliveryFailed,
} from "@/lib/advisory-deliveries";
import {
  draftStatusLabel,
  parseAssumptionChecklist,
  type AssumptionItem,
  type DeliverableDraft,
} from "@/lib/client-brain";
import {
  assumptionsAsJson,
  bodyWithAssumptionFooter,
  canDiscard,
  canEditAssumptions,
  canMarkReady,
  canSend,
  draftKindLabel,
  kindToDelivery,
  parseDraftSubjectBody,
  toggleAssumptionChecked,
  updateAssumptionText,
} from "@/lib/client-brain-deliverable";

type DraftDialog =
  | { mode: "ready" | "discard" | "send"; draft: DeliverableDraft }
  | null;

export function ClientBrainDrafts({
  clientId,
  drafts,
  onReload,
  onOpenAdvisory,
}: {
  clientId: string;
  drafts: DeliverableDraft[];
  onReload: () => Promise<void> | void;
  onOpenAdvisory?: () => void;
}) {
  const { user } = useAuth();
  const { firmId } = useAccountantProfile();
  const [dialog, setDialog] = useState<DraftDialog>(null);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState<{ draftId: string; itemId: string; text: string } | null>(
    null,
  );
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const persistChecklist = async (draft: DeliverableDraft, items: AssumptionItem[]) => {
    const { error } = await supabase
      .from("deliverable_drafts")
      .update({ assumption_checklist: assumptionsAsJson(items) })
      .eq("id", draft.id)
      .eq("client_id", clientId);
    if (error) {
      toast.error(error.message);
      return false;
    }
    return true;
  };

  const onToggle = async (draft: DeliverableDraft, itemId: string) => {
    if (!canEditAssumptions(draft.status)) return;
    const items = toggleAssumptionChecked(parseAssumptionChecklist(draft.assumption_checklist), itemId);
    if (!(await persistChecklist(draft, items))) return;
    await onReload();
  };

  const commitEdit = async () => {
    if (!editing) return;
    const draft = drafts.find((d) => d.id === editing.draftId);
    if (!draft || !canEditAssumptions(draft.status)) {
      setEditing(null);
      return;
    }
    const items = updateAssumptionText(
      parseAssumptionChecklist(draft.assumption_checklist),
      editing.itemId,
      editing.text,
    );
    setEditing(null);
    if (!(await persistChecklist(draft, items))) return;
    await onReload();
  };

  const applyDialog = async () => {
    if (!dialog) return;
    setSaving(true);
    try {
      if (dialog.mode === "ready") {
        const { error } = await supabase
          .from("deliverable_drafts")
          .update({ status: "ready" })
          .eq("id", dialog.draft.id)
          .eq("client_id", clientId)
          .eq("status", "draft");
        if (error) throw error;
        toast.success("Draft marked ready — not sent");
      } else if (dialog.mode === "discard") {
        const { error } = await supabase
          .from("deliverable_drafts")
          .update({ status: "discarded" })
          .eq("id", dialog.draft.id)
          .eq("client_id", clientId);
        if (error) throw error;
        toast.success("Draft discarded");
      } else {
        if (!user) throw new Error("Not signed in");
        if (dialog.draft.advisory_delivery_id) {
          toast.message("Already logged to sent history.");
          setDialog(null);
          return;
        }
        const parsed = parseDraftSubjectBody(dialog.draft.body);
        const items = parseAssumptionChecklist(dialog.draft.assumption_checklist);
        const snapId = await latestSnapshotId(clientId);
        const body = bodyWithAssumptionFooter(parsed.body || dialog.draft.body || "", items);
        const logged = await recordDelivery({
          clientId,
          firmId,
          channel: "copy",
          kind: kindToDelivery(dialog.draft.kind),
          subject: parsed.subject,
          body,
          snapshotId: snapId,
          figuresHash: hashFigures({
            draftId: dialog.draft.id,
            kind: dialog.draft.kind,
            assumptions: items,
          }),
          createdBy: user.id,
        });
        warnIfDeliveryFailed(logged.error);
        if (logged.error || !logged.id) {
          throw new Error(logged.error || "Could not log advisory delivery");
        }
        const { error } = await supabase
          .from("deliverable_drafts")
          .update({ status: "sent", advisory_delivery_id: logged.id })
          .eq("id", dialog.draft.id)
          .eq("client_id", clientId)
          .eq("status", "ready");
        if (error) throw error;
        const copyText = parsed.subject ? `Subject: ${parsed.subject}\n\n${body}` : body;
        try {
          await navigator.clipboard.writeText(copyText);
          toast.success("Logged to sent history and copied");
        } catch {
          toast.success("Logged to sent history");
        }
      }
      setDialog(null);
      await onReload();
    } catch (e) {
      toast.error((e as Error).message || "Could not update draft");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card pad">
      <span className="eyebrow">Deliverable drafts</span>
      {drafts.length === 0 ? (
        <p className="sub" style={{ margin: 0 }}>
          No deliverable drafts yet. Use Draft advisory from brain — it stays a draft until you sign off.
          {onOpenAdvisory ? (
            <>
              {" "}
              <button type="button" className="btn ghost mini" style={{ marginLeft: 8 }} onClick={onOpenAdvisory}>
                Open Advisory
              </button>
            </>
          ) : null}
        </p>
      ) : (
        <ul className="brain-list gap-lg">
          {drafts.map((draft) => {
            const items = parseAssumptionChecklist(draft.assumption_checklist);
            const parsed = parseDraftSubjectBody(draft.body);
            const body = parsed.body || draft.body || "";
            const long = body.length > 420 && !expanded[draft.id];
            const editable = canEditAssumptions(draft.status);
            return (
              <li key={draft.id} className="card-inner">
                <div className="brain-item-head">
                  <strong>{draftKindLabel(draft.kind)}</strong>
                  <span className="status-tag gold">{draftStatusLabel(draft.status)}</span>
                </div>
                {parsed.subject && (
                  <div style={{ fontSize: 13.5, marginTop: 6, fontWeight: 600 }}>{parsed.subject}</div>
                )}
                {body && (
                  <p className="sub" style={{ margin: "8px 0 0", whiteSpace: "pre-wrap" }}>
                    {long ? `${body.slice(0, 420)}…` : body}
                  </p>
                )}
                {body.length > 420 && (
                  <button
                    type="button"
                    className="btn ghost mini"
                    style={{ marginTop: 8 }}
                    onClick={() => setExpanded((prev) => ({ ...prev, [draft.id]: !prev[draft.id] }))}
                  >
                    {expanded[draft.id] ? "Show less" : "Show full draft"}
                  </button>
                )}
                {items.length === 0 ? (
                  <p className="sub" style={{ margin: "10px 0 0", fontSize: 12.5 }}>
                    No assumption checklist on this draft.
                  </p>
                ) : (
                  <ul style={{ listStyle: "none", margin: "12px 0 0", padding: 0, display: "grid", gap: 8 }}>
                    {items.map((item) => {
                      const isEditing = editing?.draftId === draft.id && editing.itemId === item.id;
                      return (
                        <li key={item.id} style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                          <Checkbox
                            id={`${draft.id}-${item.id}`}
                            checked={item.checked}
                            disabled={!editable}
                            onCheckedChange={() => void onToggle(draft, item.id)}
                          />
                          {isEditing ? (
                            <Input
                              value={editing.text}
                              onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                              onBlur={() => void commitEdit()}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  void commitEdit();
                                }
                                if (e.key === "Escape") setEditing(null);
                              }}
                              className="bg-[#0a0e1a] border-slate-700 h-8 text-[13.5px]"
                              autoFocus
                            />
                          ) : (
                            <>
                              <label
                                htmlFor={`${draft.id}-${item.id}`}
                                style={{ fontSize: 13.5, cursor: editable ? "pointer" : "default", flex: 1 }}
                              >
                                {item.text}
                              </label>
                              {editable && (
                                <button
                                  type="button"
                                  className="btn ghost mini"
                                  style={{ fontSize: 11 }}
                                  onClick={() =>
                                    setEditing({ draftId: draft.id, itemId: item.id, text: item.text })
                                  }
                                >
                                  Edit
                                </button>
                              )}
                            </>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
                {draft.status === "sent" && draft.advisory_delivery_id && (
                  <p className="sub" style={{ margin: "10px 0 0", fontSize: 12.5 }}>
                    Logged to sent history.
                  </p>
                )}
                {(canMarkReady(draft.status) || canSend(draft.status) || canDiscard(draft.status)) && (
                  <div className="brain-actions">
                    {canMarkReady(draft.status) && (
                      <button
                        type="button"
                        className="btn gold mini"
                        onClick={() => setDialog({ mode: "ready", draft })}
                      >
                        Mark ready
                      </button>
                    )}
                    {canSend(draft.status) && (
                      <button
                        type="button"
                        className="btn gold mini"
                        onClick={() => setDialog({ mode: "send", draft })}
                      >
                        Sign off and log
                      </button>
                    )}
                    {canDiscard(draft.status) && (
                      <button
                        type="button"
                        className="btn ghost mini"
                        onClick={() => setDialog({ mode: "discard", draft })}
                      >
                        Discard
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={dialog != null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="border-[#d4a550]/25 bg-[#0d1117] text-slate-100">
          <DialogHeader>
            <DialogTitle>
              {dialog?.mode === "ready"
                ? "Mark draft ready"
                : dialog?.mode === "discard"
                  ? "Discard draft"
                  : "Sign off and log"}
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {dialog?.mode === "ready"
                ? "Assumptions stay on the record. This does not send to the client."
                : dialog?.mode === "discard"
                  ? "The draft is kept as discarded — not deleted."
                  : "Promotes to advisory sent history and copies the pack. Share opened is not postal proof."}
            </DialogDescription>
          </DialogHeader>
          {dialog?.mode === "send" && (
            <ul className="text-sm text-slate-300" style={{ margin: 0, paddingLeft: 18 }}>
              {parseAssumptionChecklist(dialog.draft.assumption_checklist).map((item) => (
                <li key={item.id}>
                  {item.checked ? "☑" : "☐"} {item.text}
                </li>
              ))}
              {parseAssumptionChecklist(dialog.draft.assumption_checklist).length === 0 && (
                <li>No assumptions listed — none were invented.</li>
              )}
            </ul>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setDialog(null)} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void applyDialog()} disabled={saving}>
              {saving
                ? "Saving…"
                : dialog?.mode === "ready"
                  ? "Mark ready"
                  : dialog?.mode === "discard"
                    ? "Discard"
                    : "Sign off and log"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
