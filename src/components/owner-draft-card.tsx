/**
 * One agent draft on the owner door.
 * The owner can approve or dismiss an owner-side draft. Accountant drafts
 * stay read-only. Approve edits the title and detail, then confirms.
 * The card updates immediately and restores itself if the call fails.
 */
import { useEffect, useState, type ReactNode } from "react";
import { agentShortName } from "@/lib/milon-team";
import {
  approvedLiveLink,
  draftDecisionButtonsHidden,
  DRAFT_NOT_SAVED,
  liveTableForOwnerKind,
  submitAgentDraftDecision,
  subscribeDraftDecisionButtons,
  type ApprovedLiveLink,
} from "@/lib/agent-draft-decision-client";
import type { AgentFindingRow } from "@/lib/milon-team-activity";
import {
  DRAFT_NEEDS_OWNER,
  draftFindingKindLabel,
  draftFindingLabel,
} from "@/hooks/owner-agent-ui";

export type ApprovedDraftTarget = ApprovedLiveLink & {
  table: string;
  recordId: string | null;
};

type Optimistic =
  | { phase: "approved"; table: string | null; recordId: string | null }
  | { phase: "dismissed" };

export function OwnerDraftCard({
  row,
  layout,
  sentence,
  meta,
  onOpen,
  onInvite,
  onRefresh,
}: {
  row: AgentFindingRow;
  layout: "moves" | "desk";
  sentence?: string;
  meta?: ReactNode;
  onOpen?: (target: ApprovedDraftTarget) => void;
  onInvite?: () => void;
  onRefresh?: () => void;
}) {
  const label = draftFindingLabel(row);
  const kindLabel = draftFindingKindLabel(row);
  const ownerOk = label === DRAFT_NEEDS_OWNER;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(row.title);
  const [detail, setDetail] = useState(row.detail ?? "");
  const [optimistic, setOptimistic] = useState<Optimistic | null>(null);
  const [blocked, setBlocked] = useState(draftDecisionButtonsHidden);
  const [message, setMessage] = useState<string | null>(null);
  const [invite, setInvite] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeDraftDecisionButtons(() => setBlocked(true)), []);

  if (optimistic?.phase === "dismissed") return null;

  const approved = row.status === "approved" || optimistic?.phase === "approved";
  const table =
    (optimistic?.phase === "approved" ? optimistic.table : null) ??
    row.approved_table ??
    (approved ? liveTableForOwnerKind(row.kind) : null);
  const recordId =
    (optimistic?.phase === "approved" ? optimistic.recordId : null) ?? row.approved_row_id ?? null;
  const link = approved ? approvedLiveLink(table) : null;
  const showActions = ownerOk && !blocked && !approved;
  const shownTitle = approved && optimistic?.phase === "approved" ? title : row.title;

  function fail(result: { hideButtons: boolean; message?: string; refresh?: boolean; invite?: boolean }, restoreEdit: boolean) {
    setOptimistic(null);
    if (result.hideButtons) {
      setBlocked(true);
      setEditing(false);
      setMessage(null);
      setInvite(false);
      return;
    }
    if (restoreEdit) setEditing(true);
    setMessage(result.message ?? DRAFT_NOT_SAVED);
    setInvite(result.invite === true);
    if (result.refresh) onRefresh?.();
  }

  async function confirm() {
    if (busy) return;
    const nextTitle = title.trim();
    const nextDetail = detail.trim();
    if (!nextTitle) {
      setMessage("Add a title.");
      setInvite(false);
      return;
    }
    setBusy(true);
    setMessage(null);
    setInvite(false);
    setOptimistic({ phase: "approved", table: liveTableForOwnerKind(row.kind), recordId: null });
    setEditing(false);
    const result = await submitAgentDraftDecision({
      findingId: row.id,
      decision: "approve",
      edits: { title: nextTitle, detail: nextDetail },
    });
    setBusy(false);
    if (!result.ok) {
      fail(result, true);
      return;
    }
    if (result.status === "dismissed") {
      setOptimistic({ phase: "dismissed" });
      return;
    }
    setOptimistic({
      phase: "approved",
      table: result.recordTable ?? liveTableForOwnerKind(row.kind),
      recordId: result.recordId,
    });
  }

  async function dismiss() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setInvite(false);
    setOptimistic({ phase: "dismissed" });
    const result = await submitAgentDraftDecision({ findingId: row.id, decision: "dismiss" });
    setBusy(false);
    if (!result.ok) fail(result, false);
  }

  function openLive() {
    if (!link || !table) return;
    onOpen?.({ ...link, table, recordId });
  }

  const status = approved ? (
    <p className={layout === "desk" ? "milon-desk-hint" : "mt-1 text-sm text-slate-600 dark:text-slate-300"} data-draft-status="approved">
      {kindLabel ? `${kindLabel} · ` : ""}
      Approved
      {link ? (
        <>
          {" "}
          <button type="button" className="owner-draft-link" data-approved-table={table ?? ""} data-record-id={recordId ?? ""} onClick={openLive}>
            {link.label}
          </button>
        </>
      ) : null}
    </p>
  ) : label ? (
    <p
      className={layout === "desk" ? "milon-desk-hint" : "mt-1 text-sm text-slate-600 dark:text-slate-300"}
      data-draft-label={label}
      data-draft-status={ownerOk ? "owner" : "accountant"}
    >
      {kindLabel ? `${kindLabel} · ` : ""}
      {label}
    </p>
  ) : null;

  const editor = editing ? (
    <div className={layout === "desk" ? "milon-desk-draft-edit" : "owner-draft-edit"} data-draft-edit="open">
      <label>
        Title
        <input value={title} onChange={(event) => setTitle(event.target.value)} />
      </label>
      <label>
        Detail
        <textarea rows={3} value={detail} onChange={(event) => setDetail(event.target.value)} />
      </label>
    </div>
  ) : null;

  const actions = showActions ? (
    <div className={layout === "desk" ? "milon-desk-actions milon-desk-draft-actions" : "owner-draft-actions"} data-draft-actions="owner">
      {editing ? (
        <>
          <button type="button" className={layout === "desk" ? "milon-desk-btn primary" : "btn gold owner-draft-approve"} onClick={() => void confirm()}>
            Confirm
          </button>
          <button
            type="button"
            className={layout === "desk" ? "milon-desk-btn outline" : "owner-draft-dismiss"}
            onClick={() => {
              setEditing(false);
              setTitle(row.title);
              setDetail(row.detail ?? "");
              setMessage(null);
            }}
          >
            Back
          </button>
        </>
      ) : (
        <>
          <button type="button" className={layout === "desk" ? "milon-desk-btn primary" : "btn gold owner-draft-approve"} onClick={() => setEditing(true)}>
            Approve
          </button>
          <button type="button" className={layout === "desk" ? "milon-desk-btn ghost" : "owner-draft-dismiss"} onClick={() => void dismiss()}>
            Dismiss
          </button>
        </>
      )}
    </div>
  ) : null;

  const notice = message ? (
    <p className={layout === "desk" ? "milon-desk-hint" : "mt-2 text-sm text-slate-600 dark:text-slate-300"} role="alert" data-draft-message={message}>
      {message}
    </p>
  ) : null;

  const inviteButton = invite ? (
    <button type="button" className="btn gold owner-ask owner-ask-inline" onClick={() => onInvite?.()}>
      Invite your accountant
    </button>
  ) : null;

  if (layout === "desk") {
    return (
      <li className="milon-desk-row" data-finding={row.id} data-finding-agent={row.agent} data-finding-draft={label ? "true" : undefined} data-draft={row.id}>
        <div className="milon-desk-job-copy">
          <span className="milon-desk-tag">{agentShortName(row.agent)}</span>
          <p className="milon-desk-figure">{sentence || shownTitle}</p>
          {editor}
          {status}
          {meta}
          {actions}
          {notice}
          {inviteButton}
        </div>
      </li>
    );
  }

  return (
    <li className="rounded-lg border border-amber-900/10 bg-white/60 px-3 py-3 dark:border-slate-800 dark:bg-slate-900/50" data-draft={row.id}>
      {editing ? null : <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{shownTitle}</p>}
      {editor}
      {status}
      {actions}
      {notice}
      {inviteButton}
    </li>
  );
}
