import { agentAriaLabel, agentDisplayName, agentShortName } from "@/lib/milon-team";
import { AGENT_KEYS, type AgentKey } from "@/lib/milon-team-feed";
import { ownerTileLabel, type OwnerTile } from "@/lib/owner-answers";
import type { OwnerMotion, OwnerPresence } from "@/lib/owner-presence";
import { ChatIcon, HandoffBeam, OwnerAvatar, type AvatarVariant } from "./owner-avatar";

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
  tiles,
  onOpen,
  onAsk,
  onTile,
}: {
  variant: AvatarVariant;
  presence: OwnerPresence;
  tiles: OwnerTile[];
  onOpen: (agent: AgentKey) => void;
  onAsk: (agent: AgentKey) => void;
  onTile: (tile: OwnerTile) => void;
}) {
  const handoff = presence.handoff;
  return (
    <div className="owner-pane" data-owner-home="true">
      <div className="owner-head">
        <h1 className="owner-title">Your finance team</h1>
        <p className="owner-lede">Plain answers from the books. One thing for you.</p>
      </div>
      <div className="owner-stage">
        <div className="owner-agents">
          {presence.agents.map((card) => (
            <div key={card.agent} className="owner-agent" data-agent={card.agent}>
              <button type="button" className="owner-agent-open" onClick={() => onOpen(card.agent)}>
                <OwnerAvatar
                  agent={card.agent}
                  variant={variant}
                  size="lg"
                  motion={card.motion}
                  lookAt={card.lookAt}
                  label={agentAriaLabel(card.agent, MOTION_LABEL[card.motion])}
                />
                <span className="owner-name">{agentDisplayName(card.agent)}</span>
                <span className="owner-voice">{card.sentence}</span>
                <span className="owner-motion-label">{MOTION_LABEL[card.motion]}</span>
              </button>
              <button
                type="button"
                className="owner-ask"
                data-ask={card.agent}
                onClick={() => onAsk(card.agent)}
              >
                <ChatIcon />
                Ask {agentShortName(card.agent)}
              </button>
            </div>
          ))}
        </div>
        {handoff ? (
          <HandoffBeam
            sentence={handoff.sentence}
            fromIndex={AGENT_KEYS.indexOf(handoff.from)}
            toIndex={AGENT_KEYS.indexOf(handoff.to)}
          />
        ) : null}
      </div>
      <div className="owner-promises">
        {tiles.map((tile) => (
          <article
            key={tile.id}
            className="owner-tile"
            data-tile={tile.id}
            data-empty={tile.empty ? "true" : "false"}
          >
            <div>
              <h2>{tile.heading}</h2>
              <p>{tile.sentence}</p>
              <div className="owner-tile-source">{tile.source}</div>
            </div>
            <div className="owner-tile-actions">
              {tile.signed ? <span className="owner-badge">Signed off ✓</span> : null}
              <button type="button" className="owner-ask" onClick={() => onTile(tile)}>
                {tile.ask ? <ChatIcon /> : null}
                {ownerTileLabel(tile, agentShortName)}
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
