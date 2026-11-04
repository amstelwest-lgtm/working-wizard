/**
 * Stored health prose. Regenerate paints the title the server saved.
 * A saved title that is not the card's live sentence is toasted, not swapped in.
 */
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import {
  FIGURES_CHANGED_REGENERATE,
  FIGURES_CHANGED_RELOAD,
  splitRegenerateNarrative,
} from "@/lib/health-snapshot";
import { reconcileHealthFindingNarrative } from "@/lib/agent-finding-reconcile.functions";

export function HealthNarrativeLine({
  text,
  liveSentence,
  scoreSnapshotHash,
  findingId,
  onReconciled,
  className = "",
}: {
  text: string;
  liveSentence?: string | null;
  /** Hash of the snapshot this card rendered. */
  scoreSnapshotHash?: string | null;
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
      if (!scoreSnapshotHash) {
        toast.error(FIGURES_CHANGED_RELOAD);
        return;
      }
      setBusy(true);
      try {
        const result = await reconcile({
          data: { findingId, liveSentence, scoreSnapshotHash },
        });
        setShown(result.title);
        if (result.title !== liveSentence) {
          toast.error(FIGURES_CHANGED_RELOAD);
          return;
        }
        onReconciled?.();
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Could not save regenerated narrative";
        toast.error(message);
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
