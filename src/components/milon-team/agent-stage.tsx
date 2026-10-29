/**
 * Open agent view, top to bottom: the agent blocks, the hero (face, name,
 * role, latest finding) beside the chat, then the sections as children.
 */
import { useId, type ReactNode } from "react";
import { agentDisplayName, agentJobLine, agentShortName } from "@/lib/milon-team";
import { AGENT_KEYS, type AgentKey } from "@/lib/milon-team-feed";
import { askAgentTitle } from "@/lib/agent-section-copy";
import { OwnerAvatar } from "@/components/owner-door/owner-avatar";
import { TaxSpecialistSlot } from "@/components/tax-specialist/tax-specialist-slot";
import "./agent-stage.css";

export function AgentStage({
  agent,
  finding,
  onSelect,
  marketCountry = null,
  audience = "accountant",
  chat,
  children,
}: {
  agent: AgentKey;
  finding: string | null;
  onSelect: (agent: AgentKey) => void;
  marketCountry?: string | null;
  audience?: "owner" | "accountant";
  /** The Ask widget host. It renders right after the hero. */
  chat?: ReactNode;
  children?: ReactNode;
}) {
  const chatTitleId = useId();
  return (
    <section className="agent-stage" data-agent-stage={agent}>
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
      <div className={chat ? "agent-stage-top has-chat" : "agent-stage-top"}>
        <div className="agent-stage-hero">
          <OwnerAvatar
            agent={agent}
            variant="character"
            size="stage"
            motion="idle"
            label={agentDisplayName(agent)}
          />
          <div className="agent-stage-copy">
            <h1 className="agent-stage-name">{agentDisplayName(agent)}</h1>
            <p className="agent-stage-role">{agentJobLine(agent)}</p>
            <p className="agent-stage-finding" data-agent-finding={agent}>
              {finding?.trim() ? finding : "No finding on file yet."}
            </p>
          </div>
        </div>
        {chat ? (
          <section
            className="agent-stage-chat"
            aria-labelledby={chatTitleId}
            data-agent-chat={agent}
          >
            <h2 className="agent-stage-chat-title" id={chatTitleId}>
              {askAgentTitle(agentShortName(agent))}
            </h2>
            {chat}
          </section>
        ) : null}
      </div>
      {children}
    </section>
  );
}
