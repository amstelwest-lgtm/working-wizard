import { useEffect, useState } from "react";
import { HomeBotCard } from "@/components/owner-door/home-bot-card";
import { readFirmInterviewDraft } from "@/lib/firm-interview-draft";

const LABEL = "Implementation Manager";
const CAPTION = "Map how the firm closes, reviews, signs off, and reports.";

export function ImplementationManagerChip() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <rect
        x="2.5"
        y="2.5"
        width="11"
        height="11"
        rx="2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path
        d="M5 8.2 7 10.2 11.2 5.8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * Firm Home entry. The same bot card as Financial Manager, Analyst, and Advisor.
 * Opens the practice interview, not a client.
 */
function interviewFace(firmId: string | null): { status: string; metric: string } {
  const draft = firmId ? readFirmInterviewDraft(firmId) : null;
  if (!draft || draft.phase === "done") return { status: "Not started", metric: "Takes ~10 min" };
  if (draft.phase === "map") {
    const steps = draft.map?.todaysFlow.length ?? 0;
    return { status: "Map ready", metric: steps > 0 ? `${steps} steps mapped` : "Takes ~10 min" };
  }
  if (draft.messages.length > 0) return { status: "In progress", metric: "Takes ~10 min" };
  return { status: "Not started", metric: "Takes ~10 min" };
}

export function PracticeSetupCard({
  exampleClientId: _exampleClientId,
  embedded = false,
  firmId = null,
}: {
  exampleClientId?: string | null;
  /** Render the tile only, for the home agent grid. */
  embedded?: boolean;
  firmId?: string | null;
}) {
  const [face, setFace] = useState(() => interviewFace(firmId));
  useEffect(() => {
    const refresh = () => setFace(interviewFace(firmId));
    refresh();
    window.addEventListener("milon-firm-interview", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener("milon-firm-interview", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [firmId]);
  const card = (
    <HomeBotCard
      agent="setup_partner"
      name={LABEL}
      label={LABEL}
      to="/practice/setup"
      askLabel="Set up practice"
      chip={<ImplementationManagerChip />}
      status={<span className="owner-status is-attention">{face.status}</span>}
      lines={
        <span className="owner-lines" data-status-update="">
          <span className="owner-voice">
            {CAPTION} <strong className="owner-money">{face.metric}</strong>
          </span>
        </span>
      }
    />
  );
  if (embedded) return card;
  return (
    <div className="owner-door" data-practice-setup="" data-im-card="solo">
      <div className="owner-pane" data-owner-home="true">
        <div className="owner-agents">{card}</div>
      </div>
    </div>
  );
}
