import { HomeBotCard } from "@/components/owner-door/home-bot-card";

const LABEL = "Implementation Manager";

/**
 * Firm Home entry. The same bot card as Financial Manager, Analyst, and Advisor.
 * Opens the practice interview, not a client.
 */
export function PracticeSetupCard({
  exampleClientId: _exampleClientId,
}: {
  exampleClientId: string | null;
}) {
  return (
    <div className="owner-door" data-practice-setup="">
      <div className="owner-pane" data-owner-home="true">
        <div className="owner-agents">
          <HomeBotCard
            agent="setup_partner"
            name={LABEL}
            label={LABEL}
            to="/practice/setup"
            askLabel="Set up your practice"
            lines={
              <span className="owner-lines">
                <span className="owner-voice">
                  Map how the firm closes, reviews, signs off, and reports. No desktop access.
                </span>
              </span>
            }
          />
        </div>
      </div>
    </div>
  );
}
