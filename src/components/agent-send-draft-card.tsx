/**
 * Accountant card for one unsent Send an agent draft.
 * Approve calls mintClientAgentSend. Dismiss is not a send.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { approveAgentSendDraft, dismissAgentSendDraft } from "@/lib/agent-send-draft.functions";
import type { AgentFindingRow } from "@/lib/milon-team-activity";

function evidence(row: AgentFindingRow): Record<string, unknown> {
  if (!row.evidence || typeof row.evidence !== "object" || Array.isArray(row.evidence)) return {};
  return row.evidence as Record<string, unknown>;
}

function lines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

export function AgentSendDraftCard({
  row,
  onRefresh,
}: {
  row: AgentFindingRow;
  onRefresh?: () => void;
}) {
  const approve = useServerFn(approveAgentSendDraft);
  const dismiss = useServerFn(dismissAgentSendDraft);
  const stored = evidence(row);
  const checklist = lines(stored.checklist);
  const clientName = typeof stored.client_name === "string" ? stored.client_name : "";
  const message = typeof stored.message === "string" ? stored.message : row.detail ?? "";
  const sent = stored.sent === true || stored.minted === true;
  const [email, setEmail] = useState(typeof stored.recipient_email === "string" ? stored.recipient_email : "");
  const [firstName, setFirstName] = useState(
    typeof stored.recipient_first_name === "string" ? stored.recipient_first_name : "",
  );
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onApprove() {
    setNote(null);
    setBusy(true);
    try {
      const result = await approve({
        data: {
          findingId: row.id,
          recipientEmail: email,
          recipientFirstName: firstName,
        },
      });
      if (!result.ok) {
        setNote(
          result.reason === "needs_named_accountant"
            ? "Approval needs a named accountant. Nothing was sent."
            : result.reason === "address"
              ? "Enter the email address to send to. Nothing was sent."
              : result.reason === "dismissed"
                ? "Dismissed. Nothing was sent."
                : "Nothing was sent.",
        );
        return;
      }
      setNote(result.already ? "This draft was already approved." : "Approved. The document list was sent.");
      onRefresh?.();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  async function onDismiss() {
    setNote(null);
    setBusy(true);
    try {
      const result = await dismiss({ data: { findingId: row.id } });
      if (!result.ok) {
        setNote(result.reason === "already_sent" ? "This draft was already sent." : "Nothing was sent.");
        return;
      }
      setNote("Dismissed. Nothing was sent.");
      onRefresh?.();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Nothing was sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article data-agent-send-draft={row.id} style={{ display: "grid", gap: 8, color: "#102A43" }}>
      <h3 style={{ margin: 0 }}>{row.title}</h3>
      {clientName ? <p style={{ margin: 0 }}>Client: {clientName}</p> : null}
      {message ? <p style={{ margin: 0 }}>{message}</p> : null}
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {checklist.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <p style={{ margin: 0 }}>Nothing is sent until a named accountant approves.</p>
      {sent ? (
        <p style={{ margin: 0 }}>Approved. The document list was sent.</p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void onApprove();
          }}
          style={{ display: "grid", gap: 8 }}
        >
          <label>
            First name
            <input
              value={firstName}
              onChange={(event) => setFirstName(event.target.value)}
              style={{ display: "block", marginTop: 4, color: "#102A43" }}
            />
          </label>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              style={{ display: "block", marginTop: 4, color: "#102A43" }}
            />
          </label>
          <button type="submit" disabled={busy} style={{ justifySelf: "start", color: "#102A43" }}>
            {busy ? "Approving…" : "Approve and send"}
          </button>
          <button type="button" disabled={busy} onClick={() => void onDismiss()} style={{ justifySelf: "start", color: "#102A43" }}>
            Dismiss
          </button>
        </form>
      )}
      {note ? <p style={{ margin: 0 }}>{note}</p> : null}
    </article>
  );
}
