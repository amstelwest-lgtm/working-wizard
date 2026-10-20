/**
 * Agent cards before the client row arrives. Idle faces, no tax card,
 * and a line that says whether the read is still going or has given up.
 */
import { OwnerHome } from "@/components/owner-door/owner-home";
import {
  CLIENT_HOME_CHECKING,
  CLIENT_HOME_LOAD_ERROR,
  CLIENT_HOME_NOTHING,
} from "@/lib/client-home-phase";
import { emptyAgentActivity } from "@/lib/milon-team-activity";
import { ownerPresence } from "@/lib/owner-presence";

export function ClientAgentStandby({ timedOut }: { timedOut: boolean }) {
  const line = timedOut ? CLIENT_HOME_LOAD_ERROR : CLIENT_HOME_CHECKING;
  return (
    <div
      className="accountant-portal premium-shell"
      data-client-agents={timedOut ? "error" : "loading"}
    >
      <div className="shell">
        <p className="owner-lede" role="status">
          {line}
        </p>
        <OwnerHome
          title="Your whole finance team"
          variant="character"
          showInvite={false}
          audience="accountant"
          marketCountry={null}
          sampleClient={false}
          presence={ownerPresence(emptyAgentActivity())}
          lines={{
            financial_manager: [line],
            analyst: [CLIENT_HOME_NOTHING],
            advisor: [CLIENT_HOME_NOTHING],
          }}
          onOpen={() => undefined}
          onAsk={() => undefined}
        />
      </div>
    </div>
  );
}
