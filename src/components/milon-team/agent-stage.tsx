/**
 * Open agent view. Same pieces as the owner stage: the video face,
 * the name, the role, the latest finding, and a way to switch agents.
 * The feed and the Ask composer stay as children.
 */
import type { ReactNode } from "react";
import { agentDisplayName, agentJobLine, agentShortName } from "@/lib/milon-team";
import { AGENT_KEYS, type AgentKey } from "@/lib/milon-team-feed";
import { OwnerAvatar } from "@/components/owner-door/owner-avatar";
import { TaxSpecialistSlot } from "@/components/tax-specialist/tax-specialist-slot";
import "./agent-stage.css";

export function AgentStage({
  agent,
  finding,
  onSelect,
  marketCountry = null,
  audience = "accountant",
  children,
}: {
  agent: AgentKey;
  finding: string | null;
  onSelect: (agent: AgentKey) => void;
  marketCountry?: string | null;
  audience?: "owner" | "accountant";
  children?: ReactNode;
}) {
  return (
    <section className="agent-stage" data-agent-stage={agent}>
      <div className="agent-stage-hero">
        <OwnerAvatar
          agent={agent}
          variant="character"
          size="stage"
          motion="idle"
          label={agentDisplayName(agent)}
        />
        <h1 className="agent-stage-name">{agentDisplayName(agent)}</h1>
        <p className="agent-stage-role">{agentJobLine(agent)}</p>
        <p className="agent-stage-finding" data-agent-finding={agent}>
          {finding?.trim() ? finding : "No finding on file yet."}
        </p>
      </div>
      <div className="agent-stage-switch" role="tablist" aria-label="Agents">
        {AGENT_KEYS.map((key) => {
          const selected = key === agent;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={selected}
              data-agent-open={key}
              className={selected ? "is-on" : undefined}
              onClick={() => onSelect(key)}
              onKeyDown={(event) => {
                if (event.key !== "Enter" && event.key !== " ") return;
                event.preventDefault();
                onSelect(key);
              }}
            >
              {agentShortName(key)}
            </button>
          );
        })}
        <TaxSpecialistSlot country={marketCountry} variant="stage" audience={audience} />
      </div>
      {children}
    </section>
  );
}
