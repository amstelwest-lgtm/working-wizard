import { createFileRoute } from "@tanstack/react-router";
import { Toaster } from "sonner";
import { PracticeRail } from "@/components/practice-rail";
import { PRACTICE_SETUP_TOASTER_ID, PracticeSetupPanel } from "@/components/practice-setup-panel";
import { ImActivationStep } from "@/components/im-activation-step";
import { AgentBotRulesPanel } from "@/components/agent-bot-rules-panel";
import { useAccountantProfile } from "@/contexts/accountant-profile";

export const Route = createFileRoute("/_authenticated/practice_/setup")({
  component: PracticeSetupPage,
  head: () => ({
    meta: [{ title: "Implementation Manager — Milōn" }],
  }),
});

function PracticeSetupPage() {
  const { firmId } = useAccountantProfile();
  return (
    <div className="accountant-portal premium-shell practice-home">
      <main className="shell">
        <div className="client-workspace">
          <PracticeRail />
          <div className="deliverable-main">
            <PracticeSetupPanel />
            {firmId ? (
              <section className="practice-im-rules" data-practice-im-rules="true">
                <h2 className="deliverable-section-title">Private rules</h2>
                <p className="milon-desk-hint">
                  Preferences from Implementation Manager onboarding. Bots use these when drafting; nothing here posts to a ledger.
                </p>
                <AgentBotRulesPanel firmId={firmId} tab="implementation_manager" />
              </section>
            ) : null}
            <ImActivationStep />
            <Toaster
              id={PRACTICE_SETUP_TOASTER_ID}
              position="top-right"
              richColors
              offset={16}
              style={{ zIndex: 200 }}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
