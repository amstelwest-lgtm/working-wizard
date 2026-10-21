/**
 * Stored health prose. When the live snapshot disagrees, the stale claim
 * stays off the screen until Regenerate paints the snapshot sentence.
 */
import { useEffect, useState } from "react";
import { FIGURES_CHANGED_REGENERATE, splitRegenerateNarrative } from "@/lib/health-snapshot";

export function HealthNarrativeLine({
  text,
  liveSentence,
  className = "",
}: {
  text: string;
  liveSentence?: string | null;
  className?: string;
}) {
  const [shown, setShown] = useState(text);
  useEffect(() => {
    setShown(text);
  }, [text]);
  const parts = splitRegenerateNarrative(shown);
  return (
    <>
      <p className={className} data-health-narrative={parts.action ? "stale" : "current"}>
        {parts.action ? parts.lead || FIGURES_CHANGED_REGENERATE : shown}
      </p>
      {parts.action && liveSentence ? (
        <button
          type="button"
          className="milon-desk-btn outline"
          data-health-regenerate
          onClick={() => setShown(liveSentence)}
        >
          {FIGURES_CHANGED_REGENERATE}
        </button>
      ) : null}
    </>
  );
}
