import { useEffect, useState } from "react";
import { HomeBotCard } from "@/components/owner-door/home-bot-card";
import { useOptionalAccountantProfile } from "@/contexts/accountant-profile";
import { fetchFirmInterviewDraft, fetchFirmSetupPlan } from "@/lib/setup-partner-client";

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

export type PracticeSetupCardStatus = "Not started" | "In progress" | "Done";

/** Draft wins over a saved plan. A plan with no draft is Done. */
export function practiceSetupCardStatus(input: {
  draft: boolean;
  plan: boolean;
}): PracticeSetupCardStatus {
  if (input.draft) return "In progress";
  if (input.plan) return "Done";
  return "Not started";
}

/**
 * Firm Home entry. The same bot card as Financial Manager, Analyst, and Advisor.
 * Opens the practice interview, not a client.
 */
export function PracticeSetupCard({
  exampleClientId: _exampleClientId,
  embedded = false,
}: {
  exampleClientId?: string | null;
  /** Render the tile only, for the home agent grid. */
  embedded?: boolean;
}) {
  const profile = useOptionalAccountantProfile();
  const practiceFirmId = profile?.firmId ?? null;
  const [status, setStatus] = useState<PracticeSetupCardStatus | null>(null);
  useEffect(() => {
    if (!practiceFirmId) {
      setStatus("Not started");
      return;
    }
    let cancel = false;
    void Promise.all([fetchFirmSetupPlan(practiceFirmId), fetchFirmInterviewDraft(practiceFirmId)])
      .then(([plan, draft]) => {
        if (cancel) return;
        setStatus(
          practiceSetupCardStatus({
            draft: Boolean(draft?.question),
            plan: Boolean(plan && plan.steps.length > 0),
          }),
        );
      })
      .catch(() => {
        if (!cancel) setStatus("Not started");
      });
    return () => {
      cancel = true;
    };
  }, [practiceFirmId]);
  const chip = status ?? "Not started";
  const card = (
    <HomeBotCard
      agent="setup_partner"
      name={LABEL}
      label={LABEL}
      to="/practice/setup"
      askLabel="Set up practice"
      chip={<ImplementationManagerChip />}
      status={<span className="owner-status is-attention">{chip}</span>}
      lines={
        <span className="owner-lines" data-status-update="">
          <span className="owner-voice">{CAPTION}</span>
          <span className="owner-voice">Takes ~10 min</span>
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
