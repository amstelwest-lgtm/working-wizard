/**
 * Two lightweight agent presences. CSS and SVG only.
 * Each motion is a different drawing, so a frozen frame still reads.
 * `prefers-reduced-motion` stops the loops and leaves that drawing.
 */
import type { OwnerBotKey } from "./owner-team";

export type AvatarVariant = "orb" | "character";
export type AvatarMotion = "idle" | "working" | "found" | "speaking" | "listening";
export type AvatarSize = "lg" | "md" | "sm";

export const AVATAR_MOTIONS: readonly AvatarMotion[] = [
  "idle",
  "working",
  "found",
  "speaking",
  "listening",
];

export const AVATAR_MOTION_LABEL: Record<AvatarMotion, string> = {
  idle: "Idle",
  working: "Working…",
  found: "Found something",
  speaking: "Speaking",
  listening: "Listening",
};

export const HANDOFF_SENTENCE =
  "Analyst → Advisor: September made less, so two moves are being drafted.";

export function OwnerAvatar({
  bot,
  variant,
  motion,
  size = "sm",
  lookAt = null,
  label,
}: {
  bot: OwnerBotKey;
  variant: AvatarVariant;
  motion: AvatarMotion;
  size?: AvatarSize;
  /** Character eyes glance toward this agent during a hand-off. */
  lookAt?: OwnerBotKey | null;
  label?: string;
}) {
  return (
    <span
      className={`owner-presence-avatar is-${bot} is-${variant} is-${motion} is-${size}`}
      data-avatar={variant}
      data-bot={bot}
      data-motion={motion}
      data-look={lookAt ?? undefined}
      data-size={size}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 80 80" className="owner-presence-svg">
        <circle className="stage" cx="40" cy="40" r="30" />
        {variant === "orb" ? <OrbSigil bot={bot} /> : <Face bot={bot} />}
        <circle className="work-arc" cx="40" cy="40" r="33" />
        <circle className="found-ring" cx="40" cy="40" r="35" />
        <circle className="found-dot" cx="62" cy="16" r="4.5" />
        <WaveBars className="speak-bars" radius={36} />
        <WaveBars className="listen-bars" radius={18} />
        <g className="mic" transform="translate(40 58)">
          <rect x="-3" y="-10" width="6" height="9" rx="3" />
          <path d="M-6 -3 a6 6 0 0 0 12 0 M0 3 v4 M-3 7 h6" />
        </g>
      </svg>
    </span>
  );
}

export function HandoffBeam({ sentence }: { sentence: string }) {
  return (
    <div className="owner-beam" data-handoff="true">
      <span className="owner-beam-track" aria-hidden="true">
        <i />
      </span>
      <p>{sentence}</p>
    </div>
  );
}

function WaveBars({ className, radius }: { className: string; radius: number }) {
  const heights = [7, 12, 16, 9, 18, 11, 15, 8, 17, 10, 13, 8];
  return (
    <g className={className}>
      {heights.map((height, index) => {
        const angle = (index / heights.length) * 360 - 90;
        return (
          <line
            key={index}
            x1="40"
            y1={40 - radius}
            x2="40"
            y2={40 - radius + height}
            transform={`rotate(${angle} 40 40)`}
          />
        );
      })}
    </g>
  );
}

function OrbSigil({ bot }: { bot: OwnerBotKey }) {
  if (bot === "financial_manager") {
    return (
      <g className="sigil">
        <circle className="sigil-ring" cx="40" cy="40" r="16" />
        <g className="ticks">
          {Array.from({ length: 8 }, (_, index) => (
            <line
              key={index}
              x1="40"
              y1="20"
              x2="40"
              y2="24"
              transform={`rotate(${index * 45} 40 40)`}
            />
          ))}
        </g>
        <circle className="core" cx="40" cy="40" r="3" />
      </g>
    );
  }
  if (bot === "analyst") {
    return (
      <g className="sigil">
        <circle className="sigil-ring" cx="40" cy="40" r="16" />
        <g className="scan">
          <line x1="26" y1="34" x2="54" y2="34" />
          <line x1="26" y1="40" x2="54" y2="40" />
          <line x1="26" y1="46" x2="54" y2="46" />
        </g>
      </g>
    );
  }
  return (
    <g className="sigil">
      <circle className="sigil-ring" cx="40" cy="40" r="16" />
      <path className="beam-mark" d="M28 40h16M36 32l8 8-8 8" />
    </g>
  );
}

function Face({ bot }: { bot: OwnerBotKey }) {
  return (
    <g className="face">
      {bot === "financial_manager" ? (
        <>
          <rect className="shell" x="22" y="18" width="36" height="42" rx="12" />
          <rect className="visor" x="26" y="30" width="28" height="14" rx="4" />
        </>
      ) : null}
      {bot === "analyst" ? (
        <>
          <circle className="shell" cx="40" cy="40" r="20" />
          <circle className="monocle" cx="50" cy="38" r="8" />
          <line className="monocle-scan" x1="42" y1="38" x2="58" y2="38" />
        </>
      ) : null}
      {bot === "advisor" ? (
        <>
          <path className="shell" d="M40 16l20 10v16L40 64 20 42V26z" />
          <path className="chev" d="M32 28l8 6 8-6" />
        </>
      ) : null}
      <g className="eyes">
        <rect className="eye" x="31" y="34" width="6" height="6" rx="1.4" />
        <rect className="eye" x="43" y="34" width="6" height="6" rx="1.4" />
      </g>
    </g>
  );
}
