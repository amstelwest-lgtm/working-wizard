/**
 * Agent presence. Loops are CSS on transform and opacity.
 * A job start and a return to rest are short WAAPI clips on the outer box.
 */
import { useEffect, useRef } from "react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";
import { displayFmClip, type AvatarFace, type FmAvatarClip } from "@/lib/fm-avatar-state";
import type { AgentKey } from "@/lib/milon-team-feed";
import type { OwnerMotion } from "@/lib/owner-presence";
import { FmVideoAvatar } from "./fm-video-avatar";
import { avatarRhythm } from "./owner-rhythm";

export type AvatarVariant = "orb" | "character";
export type AvatarSize = "lg" | "md" | "sm" | "stage";

const JUMP: Keyframe[] = [
  { transform: "translate3d(0, 0, 0) scale(1, 1)" },
  { transform: "translate3d(0, 2px, 0) scale(1.08, 0.9)", offset: 0.32 },
  { transform: "translate3d(0, -7px, 0) scale(0.98, 1.06)", offset: 0.68 },
  { transform: "translate3d(0, 0, 0) scale(1, 1)" },
];

const SETTLE: Keyframe[] = [
  { transform: "translate3d(0, -5px, 0) scale(1.04)" },
  { transform: "translate3d(0, 0, 0) scale(1)" },
];

export function OwnerAvatar({
  agent,
  variant,
  motion,
  size = "lg",
  lookAt = null,
  label,
  share = false,
  fmClip = null,
}: {
  agent: AvatarFace;
  variant: AvatarVariant;
  motion: OwnerMotion;
  size?: AvatarSize;
  lookAt?: AgentKey | null;
  label?: string;
  /** Activity clip for a character video. Orb faces ignore it. */
  fmClip?: FmAvatarClip | null;
  /** Same view-transition name on the home avatar and the open stage. */
  share?: boolean;
}) {
  const node = useRef<HTMLSpanElement>(null);
  const prev = useRef(motion);
  const reduced = usePrefersReducedMotion();
  const rhythm = avatarRhythm(agent);
  const videoFace = variant === "character";
  const clip = videoFace ? displayFmClip(fmClip, motion) : null;

  useEffect(() => {
    const el = node.current;
    if (!el) return;
    const before = prev.current;
    if (reduced || videoFace || before === motion) {
      prev.current = motion;
      return;
    }
    const jumping = motion === "working" && (before === "idle" || before === "listening");
    const settling = motion === "idle" && before !== "idle";
    const frames = jumping ? JUMP : settling ? SETTLE : null;
    const duration = jumping ? 320 : 600;
    if (!frames) {
      prev.current = motion;
      return;
    }
    const anim = el.animate(frames, {
      duration,
      easing: jumping ? "cubic-bezier(0.34, 1.56, 0.64, 1)" : "cubic-bezier(0.22, 0.61, 0.36, 1)",
      fill: "none",
    });
    const commit = window.setTimeout(() => {
      prev.current = motion;
    }, 0);
    return () => {
      anim.cancel();
      window.clearTimeout(commit);
    };
  }, [motion, reduced, videoFace]);

  return (
    <span
      ref={node}
      className={`owner-presence is-${agent} is-${variant} is-${motion} is-${size}${videoFace ? " is-fm-clip" : ""}`}
      data-avatar={variant}
      data-agent={agent}
      data-motion={motion}
      data-look={lookAt ?? undefined}
      data-size={size}
      data-bot-shared={share ? "true" : undefined}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      style={{
        viewTransitionName: share ? `owner-bot-${agent}` : undefined,
        ["--breathe" as string]: rhythm.breathe,
        ["--breathe-delay" as string]: rhythm.breatheDelay,
        ["--drift" as string]: rhythm.drift,
        ["--drift-delay" as string]: rhythm.driftDelay,
        ["--drift-x" as string]: rhythm.driftX,
        ["--drift-y" as string]: rhythm.driftY,
        ["--micro" as string]: rhythm.micro,
        ["--micro-delay" as string]: rhythm.microDelay,
        ["--blink" as string]: rhythm.blink,
        ["--blink-delay" as string]: rhythm.blinkDelay,
        ["--glance" as string]: rhythm.glance,
        ["--glance-delay" as string]: rhythm.glanceDelay,
        ["--orbit" as string]: rhythm.orbit,
        ["--shimmer" as string]: rhythm.shimmer,
      }}
    >
      <span className="owner-drift">
        <span className="owner-breathe">
          <span className="owner-micro">
            <span className="owner-presence-avatar">
              <span className="owner-glow" aria-hidden="true" />
              {clip ? <FmVideoAvatar agent={agent} clip={clip} /> : null}
              {clip ? null : (
                <svg viewBox="0 0 80 80" className="owner-presence-svg">
                  <circle className="stage" cx="40" cy="40" r="30" />
                  <circle className="shimmer" cx="40" cy="40" r="30" />
                  {variant === "orb" && agent !== "tax_specialist" ? <OrbSigil agent={agent} /> : null}
                  <g className="work-spin">
                    <circle className="work-arc" cx="40" cy="40" r="33" />
                  </g>
                  <circle className="found-ring" cx="40" cy="40" r="35" />
                  <circle className="found-dot" cx="62" cy="16" r="4.5" />
                  <WaveBars className="speak-bars" radius={36} />
                  <WaveBars className="listen-bars" radius={33} />
                  <g className="mic" transform="translate(40 58)">
                    <rect x="-3" y="-10" width="6" height="9" rx="3" />
                    <path d="M-6 -3 a6 6 0 0 0 12 0 M0 3 v4 M-3 7 h6" />
                  </g>
                </svg>
              )}
              {variant === "orb" ? (
                <span className="owner-orbit" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
              ) : null}
            </span>
          </span>
        </span>
      </span>
    </span>
  );
}

export function HandoffBeam({
  sentence,
  fromIndex,
  toIndex,
}: {
  sentence: string;
  fromIndex: number;
  toIndex: number;
}) {
  const a = Math.min(fromIndex, toIndex);
  const b = Math.max(fromIndex, toIndex);
  return (
    <div
      className="owner-beam"
      data-handoff="true"
      style={{
        ["--beam-a" as string]: String(a),
        ["--beam-b" as string]: String(b),
      }}
    >
      <span className="owner-beam-track" aria-hidden="true">
        <i />
      </span>
      <p>{sentence}</p>
    </div>
  );
}

export function ChatIcon() {
  return (
    <svg className="owner-chat-icon" viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6 16.5 4 19.5V6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v8a1.5 1.5 0 0 1-1.5 1.5H6Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function WaveBars({ className, radius }: { className: string; radius: number }) {
  const heights = [7, 12, 16, 9, 18, 11, 15, 8, 17, 10, 13, 8];
  return (
    <g className={className}>
      {heights.map((height, index) => {
        const angle = (index / heights.length) * 360 - 90;
        return (
          <g key={index} transform={`rotate(${angle} 40 40)`}>
            <line x1="40" y1={40 - radius} x2="40" y2={40 - radius + height} />
          </g>
        );
      })}
    </g>
  );
}

function OrbSigil({ agent }: { agent: AgentKey }) {
  if (agent === "financial_manager") {
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
  if (agent === "analyst") {
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
      <path d="M30 36 a10 8 0 0 1 20 0" />
      <rect className="badge" x="27" y="33" width="5" height="8" rx="1.6" />
      <path className="mark" d="M29 41 v5 h5" />
    </g>
  );
}
