/**
 * Browser call for agent-draft-decision v1 (#455).
 * POST { finding_id, decision, edits? } with the user JWT.
 * A 200 is success, including already:true with the same record_id.
 * The Supabase client is imported only when a decision is sent, so a
 * render of the card does not require the env vars.
 */

export const DRAFT_ALREADY_DECIDED = "Already decided";
export const DRAFT_INVITE_ACCOUNTANT = "Invite your accountant first";
export const DRAFT_WITH_ACCOUNTANT = "Already with your accountant";
export const DRAFT_SIGNED_OFF = "Already signed off";
export const DRAFT_NOT_SAVED = "That didn't save. Try again.";

const CONFLICTS = new Set(["already_approved", "already_dismissed", "approve_incomplete", "superseded"]);

export type DraftDecisionOutcome =
  | {
      ok: true;
      already: boolean;
      status: "approved" | "dismissed";
      recordTable: string | null;
      recordId: string | null;
      approvedBy: string | null;
      approvedAt: string | null;
      dismissedReason: string | null;
    }
  | { ok: false; hideButtons: true }
  | { ok: false; hideButtons: false; message: string; refresh: boolean; invite: boolean };

export type ApprovedLiveLink = {
  label: string;
  screen: "moves" | "accountant";
};

let buttonsHidden = false;
const hideListeners = new Set<() => void>();

export function draftDecisionButtonsHidden(): boolean {
  return buttonsHidden;
}

export function hideDraftDecisionButtons(): void {
  buttonsHidden = true;
  for (const listener of hideListeners) listener();
}

export function subscribeDraftDecisionButtons(listener: () => void): () => void {
  hideListeners.add(listener);
  return () => {
    hideListeners.delete(listener);
  };
}

/** Tests only. */
export function resetDraftDecisionButtonsForTests(): void {
  buttonsHidden = false;
  hideListeners.clear();
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function recordOf(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) return {};
  return body as Record<string, unknown>;
}

/** Maps the live HTTP result onto the owner card. */
export function interpretDraftDecisionResponse(status: number, body: unknown): DraftDecisionOutcome {
  if (status === 401 || status === 403) return { ok: false, hideButtons: true };
  const record = recordOf(body);
  const error = typeof record.error === "string" ? record.error : "";

  if (status === 200 && record.ok === true) {
    return {
      ok: true,
      already: record.already === true,
      status: record.status === "dismissed" ? "dismissed" : "approved",
      recordTable: text(record.record_table),
      recordId: text(record.record_id),
      approvedBy: text(record.approved_by),
      approvedAt: text(record.approved_at),
      dismissedReason: text(record.dismissed_reason),
    };
  }

  if (status === 409 && CONFLICTS.has(error)) {
    return { ok: false, hideButtons: false, message: DRAFT_ALREADY_DECIDED, refresh: true, invite: false };
  }
  if (status === 409 && error === "client_has_no_firm") {
    return { ok: false, hideButtons: false, message: DRAFT_INVITE_ACCOUNTANT, refresh: false, invite: true };
  }
  if (status === 409 && error === "accountant_request_already_open") {
    return { ok: false, hideButtons: false, message: DRAFT_WITH_ACCOUNTANT, refresh: false, invite: false };
  }
  if (status === 400 && error === "signed_off_refused") {
    return { ok: false, hideButtons: false, message: DRAFT_SIGNED_OFF, refresh: false, invite: false };
  }
  if (status === 404 && (error === "finding_not_found" || error === "client_not_found")) {
    return { ok: false, hideButtons: false, message: DRAFT_ALREADY_DECIDED, refresh: true, invite: false };
  }
  if (status === 404) return { ok: false, hideButtons: true };
  return { ok: false, hideButtons: false, message: DRAFT_NOT_SAVED, refresh: false, invite: false };
}

/** Where an approved live row opens. */
export function approvedLiveLink(table: string | null | undefined): ApprovedLiveLink | null {
  if (table === "action_items" || table === "proposed_next_steps") {
    return { label: "Open Next moves", screen: "moves" };
  }
  if (table === "data_requests") return { label: "Open requests", screen: "accountant" };
  return null;
}

/** The table an owner approval creates, used for the optimistic link. */
export function liveTableForOwnerKind(kind: string | null | undefined): string | null {
  if (kind === "action_point_draft") return "action_items";
  if (kind === "next_move_draft") return "proposed_next_steps";
  if (kind === "data_request_draft") return "data_requests";
  return null;
}

export async function submitAgentDraftDecision(input: {
  findingId: string;
  decision: "approve" | "dismiss";
  edits?: { title?: string; detail?: string };
}): Promise<DraftDecisionOutcome> {
  const { supabase } = await import("@/integrations/supabase/client");
  const { data: sess } = await supabase.auth.getSession();
  const token = sess.session?.access_token;
  const base = import.meta.env.VITE_SUPABASE_URL;
  if (!token || !base) return { ok: false, hideButtons: true };
  let response: Response;
  try {
    response = await fetch(`${base}/functions/v1/agent-draft-decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        finding_id: input.findingId,
        decision: input.decision,
        ...(input.decision === "approve" && input.edits ? { edits: input.edits } : {}),
      }),
    });
  } catch {
    return { ok: false, hideButtons: false, message: DRAFT_NOT_SAVED, refresh: false, invite: false };
  }
  const body = await response.json().catch(() => null);
  const outcome = interpretDraftDecisionResponse(response.status, body);
  if (!outcome.ok && outcome.hideButtons) hideDraftDecisionButtons();
  return outcome;
}
