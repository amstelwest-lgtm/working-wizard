/**
 * Agent cards before the client row arrives. Idle faces, no tax card,
 * and a line that says whether the read is still going or has given up.
 */
import { OwnerHome } from "@/components/owner-door/owner-home";
import { agentCardPhase } from "@/lib/agent-card-phase";
import { CLIENT_HOME_CHECKING, CLIENT_HOME_LOAD_ERROR } from "@/lib/client-home-phase";
import { emptyAgentActivity } from "@/lib/milon-team-activity";
import { ownerPresence } from "@/lib/owner-presence";

export function ClientAgentStandby({
  timedOut,
  onRetry,
}: {
  timedOut: boolean;
  onRetry?: () => void;
}) {
  const phase = agentCardPhase({ pending: true, timedOut });
  const lede = timedOut ? CLIENT_HOME_LOAD_ERROR : CLIENT_HOME_CHECKING;
  return (
    <div className="accountant-portal premium-shell" data-client-agents={phase}>
      <div className="shell">
        <p className="owner-lede" role="status">
          {lede}
        </p>
        {timedOut && onRetry ? (
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        <OwnerHome
          title="Your whole finance team"
          variant="character"
          showInvite={false}
          audience="accountant"
          marketCountry={null}
          sampleClient={false}
          cardPhase={phase}
          presence={ownerPresence(emptyAgentActivity())}
          lines={{
            financial_manager: [],
            analyst: [],
            advisor: [],
          }}
          onOpen={() => undefined}
          onAsk={() => undefined}
        />
      </div>
    </div>
  );
}
