/**
 * Stored health prose. When the live snapshot disagrees, the stale claim
 * stays off the screen until Regenerate paints the snapshot sentence.
 */
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { FIGURES_CHANGED_REGENERATE, splitRegenerateNarrative } from "@/lib/health-snapshot";
import { reconcileHealthFindingNarrative } from "@/lib/agent-finding-reconcile.functions";

export function HealthNarrativeLine({
  text,
  liveSentence,
  findingId,
  onReconciled,
  className = "",
}: {
  text: string;
  liveSentence?: string | null;
  /** When set, Regenerate persists reconciled copy and bumps last_seen. */
  findingId?: string;
  onReconciled?: () => void;
  className?: string;
}) {
  const reconcile = useServerFn(reconcileHealthFindingNarrative);
  const [shown, setShown] = useState(text);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setShown(text);
  }, [text]);
  const parts = splitRegenerateNarrative(shown);

  async function regenerate() {
    if (!liveSentence) return;
    if (findingId) {
      setBusy(true);
      try {
        const result = await reconcile({ data: { findingId } });
        setShown(result.title || liveSentence);
        onReconciled?.();
      } catch {
        setShown(liveSentence);
      } finally {
        setBusy(false);
      }
      return;
    }
    setShown(liveSentence);
  }

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
          disabled={busy}
          onClick={() => void regenerate()}
        >
          {FIGURES_CHANGED_REGENERATE}
        </button>
      ) : null}
    </>
  );
}
