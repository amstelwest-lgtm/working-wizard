import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion";

/**
 * One shimmer per cue id for the life of the page. A later visit to the same
 * level does not pulse again. prefers-reduced-motion skips the animation.
 */
const pulsedCueIds = new Set<string>();

function useDigPulse(id: string): boolean {
  const reduce = usePrefersReducedMotion();
  const [pulse, setPulse] = useState(false);

  useEffect(() => {
    if (reduce || pulsedCueIds.has(id)) return;
    pulsedCueIds.add(id);
    setPulse(true);
    const timer = window.setTimeout(() => setPulse(false), 1100);
    return () => window.clearTimeout(timer);
  }, [id, reduce]);

  return pulse;
}

/** Identical hint on every drillable health level, owner and accountant. Neutral on desktop. */
export const HEALTH_DRILL_CUE = "See more";

function CueCopy() {
  return <span className="dig-cue__copy">{HEALTH_DRILL_CUE}</span>;
}

/**
 * Premium cue for a health-score control that opens a real next level.
 * The same words on a mouse and on a touch screen.
 * Pass onClick when the cue is its own control. Inside an existing button,
 * omit onClick so the chip stays presentational.
 */
export function DigCue({
  id,
  compact = false,
  onClick,
  label = HEALTH_DRILL_CUE,
}: {
  id: string;
  compact?: boolean;
  onClick?: () => void;
  label?: string;
}) {
  const pulse = useDigPulse(id);
  const className = `dig-cue${compact ? " dig-cue--compact" : ""}${pulse ? " dig-cue--pulse" : ""}`;
  const inner: ReactNode = (
    <>
      <ChevronRight className="dig-cue__icon" strokeWidth={2.25} aria-hidden />
      <CueCopy />
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        className={`${className} dig-cue--control`}
        onClick={onClick}
        aria-label={label}
      >
        <span className="dig-cue__face" aria-hidden>
          {inner}
        </span>
      </button>
    );
  }
  return (
    <span className={className} aria-hidden="true">
      {inner}
    </span>
  );
}

/** Quiet note for a health-score leaf. No dig-deeper cue. */
export function DigLeaf({ source = "From the figures on file." }: { source?: string }) {
  return (
    <p className="dig-leaf">
      <span className="dig-leaf__title">This is the bottom line</span>
      {source ? <span className="dig-leaf__source">{source}</span> : null}
    </p>
  );
}
