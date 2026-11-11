import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import "@/components/owner-door/owner-door.css";
import { ChatIcon, OwnerAvatar, type AvatarVariant } from "@/components/owner-door/owner-avatar";
import type { AvatarFace, FmAvatarClip } from "@/lib/fm-avatar-state";
import type { AgentKey } from "@/lib/milon-team-feed";
import type { OwnerMotion } from "@/lib/owner-presence";

/**
 * The home-page bot card (Financial Manager, Analyst, Advisor).
 * Implementation Manager uses this same tile.
 */
export function HomeBotCard({
  agent,
  name,
  label,
  lines,
  status,
  chip,
  askLabel,
  onOpen,
  onAsk,
  to,
  variant = "character",
  motion = "idle",
  lookAt = null,
  fmClip = null,
  share = false,
}: {
  agent: AvatarFace;
  name: string;
  label: string;
  lines: ReactNode;
  status?: ReactNode;
  chip?: ReactNode;
  askLabel?: string;
  onOpen?: () => void;
  onAsk?: () => void;
  to?: "/practice/setup";
  variant?: AvatarVariant;
  motion?: OwnerMotion;
  lookAt?: AgentKey | null;
  fmClip?: FmAvatarClip | null;
  share?: boolean;
}) {
  const face = (
    <>
      <span className="owner-portrait">
        {chip ? (
          <span className="owner-portrait-chip" aria-hidden="true">
            {chip}
          </span>
        ) : null}
        <OwnerAvatar
          agent={agent}
          variant={variant}
          size="lg"
          share={share}
          motion={motion}
          lookAt={lookAt}
          fmClip={fmClip}
          label={label}
        />
      </span>
      <span className="owner-name">{name}</span>
      {status}
      {lines}
    </>
  );
  const ask = askLabel ? (
    <>
      <ChatIcon />
      {askLabel}
    </>
  ) : null;
  return (
    <div className="owner-agent" data-agent={agent} data-agent-card={agent}>
      {to ? (
        <Link to={to} className="owner-agent-open" data-agent-open={agent}>
          {face}
        </Link>
      ) : (
        <button
          type="button"
          className="owner-agent-open"
          data-agent-open={agent}
          onClick={onOpen}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            if (!onOpen) return;
            event.preventDefault();
            onOpen();
          }}
        >
          {face}
        </button>
      )}
      {ask ? (
        to && !onAsk ? (
          <Link to={to} className="owner-ask" data-ask={agent} data-agent-open={agent}>
            {ask}
          </Link>
        ) : (
          <button
            type="button"
            className="owner-ask"
            data-ask={agent}
            data-agent-open={agent}
            onClick={onAsk}
          >
            {ask}
          </button>
        )
      ) : null}
    </div>
  );
}
