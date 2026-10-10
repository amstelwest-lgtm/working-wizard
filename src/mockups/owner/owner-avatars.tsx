/**
 * Two lightweight agent presences. CSS and SVG only.
 * `prefers-reduced-motion` freezes the loops in owner-avatars.css.
 */
import type { OwnerBotKey } from "./owner-team";

export type AvatarVariant = "orb" | "character";
export type AvatarMotion = "idle" | "working" | "found" | "speaking" | "listening";

export const AVATAR_MOTIONS: readonly AvatarMotion[] = [
  "idle",
  "working",
  "found",
  "speaking",
  "listening",
];

export const AVATAR_MOTION_LABEL: Record<AvatarMotion, string> = {
  idle: "Idle",
  working: "Working",
  found: "Found something",
  speaking: "Speaking",
  listening: "Listening",
};

export function OwnerAvatar({
  bot,
  variant,
  motion,
  lookAt = null,
  label,
}: {
  bot: OwnerBotKey;
  variant: AvatarVariant;
  motion: AvatarMotion;
  /** Character eyes glance toward this agent during a hand-off. */
  lookAt?: OwnerBotKey | null;
  label?: string;
}) {
  return (
    <span
      className={`owner-avatar is-${bot} is-${variant} is-${motion}`}
      data-avatar={variant}
      data-bot={bot}
      data-motion={motion}
      data-look={lookAt ?? undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      {variant === "orb" ? <Orb bot={bot} /> : <Face bot={bot} />}
      <i className="owner-avatar-dot" />
    </span>
  );
}

function Orb({ bot }: { bot: OwnerBotKey }) {
  if (bot === "financial_manager") {
    return (
      <svg viewBox="0 0 64 64" className="owner-orb-svg">
        <circle className="owner-orb-ring" cx="32" cy="32" r="20" />
        <g className="owner-orb-ticks">
          {Array.from({ length: 12 }, (_, index) => (
            <line
              key={index}
              x1="32"
              y1="6"
              x2="32"
              y2="11"
              transform={`rotate(${index * 30} 32 32)`}
            />
          ))}
        </g>
        <circle className="owner-orb-core" cx="32" cy="32" r="3.5" />
        <circle className="owner-orb-wave" cx="32" cy="32" r="26" />
      </svg>
    );
  }
  if (bot === "analyst") {
    return (
      <svg viewBox="0 0 64 64" className="owner-orb-svg">
        <circle className="owner-orb-ring" cx="32" cy="32" r="20" />
        <g className="owner-orb-scan">
          <line x1="16" y1="24" x2="48" y2="24" />
          <line x1="16" y1="32" x2="48" y2="32" />
          <line x1="16" y1="40" x2="48" y2="40" />
        </g>
        <circle className="owner-orb-wave" cx="32" cy="32" r="26" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" className="owner-orb-svg">
      <circle className="owner-orb-ring" cx="32" cy="32" r="20" />
      <path className="owner-orb-beam" d="M18 32h20M30 20l12 12-12 12" />
      <circle className="owner-orb-wave" cx="32" cy="32" r="26" />
    </svg>
  );
}

function Face({ bot }: { bot: OwnerBotKey }) {
  return (
    <svg viewBox="0 0 64 64" className="owner-face-svg">
      {bot === "financial_manager" ? (
        <rect className="owner-face-shell" x="14" y="12" width="36" height="40" rx="14" />
      ) : null}
      {bot === "analyst" ? <circle className="owner-face-shell" cx="32" cy="32" r="20" /> : null}
      {bot === "advisor" ? (
        <path className="owner-face-shell" d="M18 16h22l10 16-10 16H18l8-16z" />
      ) : null}
      {bot === "analyst" ? (
        <line className="owner-face-scan" x1="16" y1="32" x2="48" y2="32" />
      ) : null}
      {bot === "financial_manager" ? (
        <g className="owner-face-ticks">
          <line x1="32" y1="8" x2="32" y2="12" />
          <line x1="22" y1="10" x2="24" y2="14" />
          <line x1="42" y1="10" x2="40" y2="14" />
        </g>
      ) : null}
      <g className="eyes">
        <rect className="eye" x="24" y="28" width="5" height="6" rx="1.5" />
        <rect className="eye" x="35" y="28" width="5" height="6" rx="1.5" />
      </g>
    </svg>
  );
}
