import { useEffect, useState, type ReactNode } from "react";
import { ownerRunPhaseLabel, type OwnerRunPhase } from "@/hooks/owner-agent-ui";
import { agentAriaLabel, agentDisplayName, agentShortName } from "@/lib/milon-team";
import { AGENT_KEYS, type AgentKey } from "@/lib/milon-team-feed";
import type { OwnerHomeLines } from "@/lib/owner-answers";
import type { OwnerMotion, OwnerPresence } from "@/lib/owner-presence";
import { ChatIcon, HandoffBeam, OwnerAvatar, type AvatarVariant } from "./owner-avatar";

const MONEY_TOKEN =
  /(\$(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?|R[\u00a0 ](?:\d{1,3}(?:[,\u00a0 ]\d{3})+|\d+)(?:\.\d+)?)/g;

function voiceNodes(line: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let last = 0;
  for (const match of line.matchAll(MONEY_TOKEN)) {
    const index = match.index ?? 0;
    if (index > last) nodes.push(line.slice(last, index));
    nodes.push(
      <strong key={`${index}-${match[0]}`} className="owner-money">
        {match[0]}
      </strong>,
    );
    last = index + match[0].length;
  }
  if (last < line.length) nodes.push(line.slice(last));
  return nodes.length > 0 ? nodes : [line];
}

export type OwnerBotLayout = "row" | "stack";

/** Desktop only. Phone always stacks. `?bots=stack` is the wide-row trial. */
export function ownerBotLayout(search: string): OwnerBotLayout {
  const value = new URLSearchParams(search).get("bots");
  return value === "stack" ? "stack" : "row";
}

const MOTION_LABEL: Record<OwnerMotion, string> = {
  idle: "Idle",
  working: "Working…",
  found: "Found something",
  speaking: "Speaking",
  listening: "Listening",
};

export function OwnerHome({
  variant,
  presence,
  lines,
  onOpen,
  onAsk,
  runState,
}: {
  variant: AvatarVariant;
  presence: OwnerPresence;
  lines: OwnerHomeLines;
  /** Live agent_runs. Missing runners stay off this line. */
  runState?: Partial<Record<AgentKey, OwnerRunPhase | null>>;
  onOpen: (agent: AgentKey) => void;
  onAsk: (agent: AgentKey) => void;
}) {
  const handoff = presence.handoff;
  const [bots, setBots] = useState<OwnerBotLayout>(() =>
    ownerBotLayout(typeof window === "undefined" ? "" : window.location.search),
  );
  useEffect(() => {
    const read = () => setBots(ownerBotLayout(window.location.search));
    window.addEventListener("popstate", read);
    return () => window.removeEventListener("popstate", read);
  }, []);
  return (
    <div className="owner-pane" data-owner-home="true" data-bots={bots}>
      <div className="owner-head">
        <h1 className="owner-title">Your finance team</h1>
      </div>
      <div className="owner-stage">
        <div className="owner-agents">
          {presence.agents.map((card) => {
            const brief = lines[card.agent] ?? [];
            const motion = card.motion === "idle" ? null : MOTION_LABEL[card.motion];
            return (
              <div key={card.agent} className="owner-agent" data-agent={card.agent}>
                <button type="button" className="owner-agent-open" onClick={() => onOpen(card.agent)}>
                  <OwnerAvatar
                    agent={card.agent}
                    variant={variant}
                    size="lg"
                    share
                    motion={card.motion}
                    lookAt={card.lookAt}
                    label={agentAriaLabel(card.agent, MOTION_LABEL[card.motion])}
                  />
                  <span className="owner-name">{agentDisplayName(card.agent)}</span>
                  <span className="owner-lines">
                    {brief.map((line, index) => (
                      <span key={`${card.agent}-${index}`} className="owner-voice">
                        {voiceNodes(line)}
                      </span>
                    ))}
                  </span>
                  {runState?.[card.agent] ? (
                    <span className="owner-run-state" data-run-state={runState[card.agent]}>
                      {ownerRunPhaseLabel(runState[card.agent]!)}
                    </span>
                  ) : null}
                  {motion ? <span className="owner-motion-label">{motion}</span> : null}
                </button>
                <button
                  type="button"
                  className="btn gold owner-ask"
                  data-ask={card.agent}
                  onClick={() => onAsk(card.agent)}
                >
                  <ChatIcon />
                  Ask {agentShortName(card.agent)}
                </button>
              </div>
            );
          })}
        </div>
        {handoff ? (
          <HandoffBeam
            sentence={handoff.sentence}
            fromIndex={AGENT_KEYS.indexOf(handoff.from)}
            toIndex={AGENT_KEYS.indexOf(handoff.to)}
          />
        ) : null}
      </div>
    </div>
  );
}
