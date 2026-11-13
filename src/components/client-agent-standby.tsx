/**
 * Agent cards before the client row arrives. Idle faces, no tax card,
 * and a line that says whether the read is still going or has given up.
 */
import { useEffect } from "react";
import { OwnerHome } from "@/components/owner-door/owner-home";
import { AGENT_CARD_CHECKING, agentCardPhase } from "@/lib/agent-card-phase";
import { CLIENT_HOME_CHECKING, CLIENT_HOME_LOAD_ERROR } from "@/lib/client-home-phase";
import { emptyAgentActivity } from "@/lib/milon-team-activity";
import { ownerPresence } from "@/lib/owner-presence";
import { markWarmCardLine } from "@/lib/card-timing";
import { readWarmBootCard } from "@/lib/warm-boot-cards";

export function ClientAgentStandby({
  timedOut,
  onRetry,
  clientId,
  userId,
  firmId,
  expiresAt,
  now,
}: {
  timedOut: boolean;
  onRetry?: () => void;
  clientId?: string | null;
  userId?: string | null;
  firmId?: string | null;
  expiresAt?: number | null;
  now?: number;
}) {
  const phase = agentCardPhase({ pending: true, timedOut });
  const cached = timedOut
    ? null
    : readWarmBootCard({
        userId,
        firmId,
        clientId,
        sessionUserId: userId,
        expiresAt,
        activeFirmId: firmId,
        now,
      });
  useEffect(() => {
    if (cached) markWarmCardLine();
  }, [cached]);
  const lede = timedOut ? CLIENT_HOME_LOAD_ERROR : CLIENT_HOME_CHECKING;
  return (
    <div
      className="accountant-portal premium-shell"
      data-client-agents={phase}
      data-client-boot={timedOut ? "load-error" : "pending"}
      data-warm-cash={cached ? "1" : "0"}
    >
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
          cardPhase={cached ? undefined : phase}
          presence={ownerPresence(emptyAgentActivity())}
          lines={{
            financial_manager: cached ? [cached] : [],
            analyst: cached ? [AGENT_CARD_CHECKING] : [],
            advisor: cached ? [AGENT_CARD_CHECKING] : [],
          }}
          onOpen={() => undefined}
          onAsk={() => undefined}
        />
      </div>
    </div>
  );
}
