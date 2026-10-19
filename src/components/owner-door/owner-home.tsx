import { useEffect, useState, type ReactNode } from "react";
import { ownerRunPhaseLabel, type OwnerRunPhase } from "@/hooks/owner-agent-ui";
import { agentAriaLabel, agentDisplayName, agentShortName } from "@/lib/milon-team";
import { AGENT_KEYS, type AgentKey } from "@/lib/milon-team-feed";
import type { OwnerCardStatus, OwnerHomeLines } from "@/lib/owner-answers";
import type { OwnerMotion, OwnerPresence } from "@/lib/owner-presence";
import type { OwnerNeedsView } from "@/lib/owner-needs";
import { AgentChipIcon } from "@/components/chrome-icons";
import { TaxSpecialistSlot } from "@/components/tax-specialist/tax-specialist-slot";
import { OwnerInviteNudge } from "@/components/owner-invite-nudge";
import { ChatIcon, HandoffBeam, OwnerAvatar, type AvatarVariant } from "./owner-avatar";
import "./owner-door.css";

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

function StatusIcon() {
  return (
    <svg className="owner-status-icon" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 4.5v4.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="8" cy="11.2" r="0.8" fill="currentColor" />
    </svg>
  );
}

export function OwnerNeedsStrip({
  needs,
  onMoves,
  onDeliverables,
  onActions,
  onDrafts,
  onBooks,
}: {
  needs: OwnerNeedsView;
  onMoves: () => void;
  onDeliverables: () => void;
  /** Client Home sends each cell to its rail item. Owner Home keeps the shared handlers. */
  onActions?: () => void;
  onDrafts?: () => void;
  onBooks?: () => void;
}) {
  const openActions = onActions ?? onMoves;
  const openDrafts = onDrafts ?? onMoves;
  const books = (
    <>
      <b>{needs.syncHeading}</b>
      {needs.syncLines.map((line) => (
        <span key={line}>{line}</span>
      ))}
    </>
  );
  return (
    <section className="owner-needs" aria-label="What needs you">
      <h2>What needs you</h2>
      <div className="owner-needs-grid">
        <button type="button" className="owner-needs-item" onClick={openActions}>
          <b>{needs.actionsHeading}</b>
          {needs.actionLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </button>
        <button type="button" className="owner-needs-item" onClick={openDrafts}>
          <b>{needs.draftsHeading}</b>
          {needs.draftLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </button>
        <button type="button" className="owner-needs-item" onClick={onDeliverables}>
          <b>{needs.deliverablesHeading}</b>
          {needs.deliverableLines.map((line) => (
            <span key={line}>{line}</span>
          ))}
        </button>
        {onBooks ? (
          <button type="button" className="owner-needs-item" onClick={onBooks}>
            {books}
          </button>
        ) : (
          <div className="owner-needs-item owner-needs-sync">{books}</div>
        )}
      </div>
    </section>
  );
}

export function OwnerHome({
  variant,
  presence,
  lines,
  status,
  onOpen,
  onAsk,
  runState,
  needs,
  onMoves,
  onDeliverables,
  onActions,
  onDrafts,
  onBooks,
  signoffLine,
  inviteClientId,
  marketCountry = null,
  audience,
  sampleClient = false,
  title = "Your finance team",
  lede = "Three agents watching the books — ask them anything, any time.",
  showInvite = true,
}: {
  variant: AvatarVariant;
  presence: OwnerPresence;
  lines: OwnerHomeLines;
  /** Accountant practice Home uses "Your whole finance team". */
  title?: string;
  /** Grey subtitle under the title. */
  lede?: string;
  /** Owner home invites an accountant. Practice Home does not. */
  showInvite?: boolean;
  status?: Partial<Record<AgentKey, OwnerCardStatus | null>>;
  /** Live agent_runs. Missing runners stay off this line. */
  runState?: Partial<Record<AgentKey, OwnerRunPhase | null>>;
  onOpen: (agent: AgentKey) => void;
  onAsk: (agent: AgentKey) => void;
  needs?: OwnerNeedsView;
  onMoves?: () => void;
  onDeliverables?: () => void;
  onActions?: () => void;
  onDrafts?: () => void;
  onBooks?: () => void;
  /** Advisory sign-off sentence on a client file. Owner Home leaves this off. */
  signoffLine?: string | null;
  inviteClientId?: string | null;
  /** Resolved market. The sample card loads only when this is ZA. */
  marketCountry?: string | null;
  audience?: "owner" | "accountant";
  /** clients.is_demo. Real clients do not get the sample tax card. */
  sampleClient?: boolean;
}) {
  const handoff = presence.handoff;
  const sampleAudience = audience ?? (showInvite ? "owner" : "accountant");
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
        <p className="owner-eyebrow">Home</p>
        <h1 className="owner-title">{title}</h1>
        <p className="owner-lede">{lede}</p>
      </div>
      <div className="owner-stage">
        <div className="owner-agents">
          {presence.agents.map((card) => {
            const brief = lines[card.agent] ?? [];
            const chip = status?.[card.agent] ?? null;
            const motion = card.motion === "idle" ? null : MOTION_LABEL[card.motion];
            return (
              <div
                key={card.agent}
                className="owner-agent"
                data-agent={card.agent}
                data-agent-card={card.agent}
              >
                <button
                  type="button"
                  className="owner-agent-open"
                  data-agent-open={card.agent}
                  onClick={() => onOpen(card.agent)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    onOpen(card.agent);
                  }}
                >
                  <span className="owner-portrait">
                    <span className="owner-portrait-chip" aria-hidden="true">
                      <AgentChipIcon agent={card.agent} />
                    </span>
                    <OwnerAvatar
                      agent={card.agent}
                      variant={variant}
                      size="lg"
                      share
                      motion={card.motion}
                      lookAt={card.lookAt}
                      fmClip={card.fmClip}
                      label={agentAriaLabel(card.agent, MOTION_LABEL[card.motion])}
                    />
                  </span>
                  <span className="owner-name">{agentDisplayName(card.agent)}</span>
                  {chip ? (
                    <span className={`owner-status is-${chip.tone}`}>
                      <StatusIcon />
                      {chip.word}
                    </span>
                  ) : null}
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
                  className="owner-ask"
                  data-ask={card.agent}
                  data-agent-open={card.agent}
                  onClick={() => onAsk(card.agent)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") return;
                    event.preventDefault();
                    onAsk(card.agent);
                  }}
                >
                  <ChatIcon />
                  Ask {agentShortName(card.agent)}
                </button>
              </div>
            );
          })}
          <TaxSpecialistSlot
            country={marketCountry}
            variant="card"
            audience={sampleAudience}
            sampleClient={sampleClient}
          />
        </div>
        <TaxSpecialistSlot country={marketCountry} variant="fm-handoff" audience={sampleAudience} />
        {handoff ? (
          <HandoffBeam
            sentence={handoff.sentence}
            fromIndex={AGENT_KEYS.indexOf(handoff.from)}
            toIndex={AGENT_KEYS.indexOf(handoff.to)}
          />
        ) : null}
      </div>
      {needs && onMoves && onDeliverables ? (
        <OwnerNeedsStrip
          needs={needs}
          onMoves={onMoves}
          onDeliverables={onDeliverables}
          onActions={onActions}
          onDrafts={onDrafts}
          onBooks={onBooks}
        />
      ) : null}
      {signoffLine ? (
        <p className="owner-signoff" data-signoff-line>
          {signoffLine}
        </p>
      ) : null}
      {showInvite ? <OwnerInviteNudge variant="app" clientId={inviteClientId} /> : null}
    </div>
  );
}
