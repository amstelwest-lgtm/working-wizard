/**
 * Stored health prose. When the live snapshot disagrees, the stale claim
 * stays off the screen until Regenerate paints the snapshot sentence.
 */
import { useEffect, useState } from "react";
import { FIGURES_CHANGED_REGENERATE } from "@/lib/health-snapshot";

function isRegenerateMarker(text: string): boolean {
  const trimmed = text.trim().replace(/[.!?]$/, "");
  return trimmed === FIGURES_CHANGED_REGENERATE;
}

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
  const stale = isRegenerateMarker(shown);
  return (
    <>
      <p className={className} data-health-narrative={stale ? "stale" : "current"}>
        {shown}
      </p>
      {stale && liveSentence ? (
        <button type="button" className="milon-desk-btn outline" data-health-regenerate onClick={() => setShown(liveSentence)}>
          Regenerate
        </button>
      ) : null}
    </>
  );
}
