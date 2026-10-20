import { useEffect, useState } from "react";
import { handoffIsSlow } from "@/lib/action-handoff";

/**
 * Queued and running hand-offs show Working.
 * After three minutes the same row offers Retry instead of the queue line.
 */
export function HandoffRunStatus({
  run,
  caption,
  missed = false,
  error = null,
  draftId = null,
  onOpenDraft,
  onRetry,
}: {
  run?: { status: string; at?: string | null } | null;
  caption?: string | null;
  /** No run appeared for this hand-off. Offer Retry instead of Working. */
  missed?: boolean;
  /** The hand-off did not start. Working and the optimistic note stay off. */
  error?: string | null;
  /** Finding id. The finished line and Open draft render only when this is set. */
  draftId?: string | null;
  onOpenDraft?: (draftId: string) => void;
  onRetry?: () => void;
}) {
  const active = !error && !missed && (run?.status === "queued" || run?.status === "running");
  const stopped = Boolean(
    caption?.includes("couldn't finish this one") || caption?.includes("couldn't draft this"),
  );
  const openId = draftId?.trim() ?? "";
  const finished = Boolean(caption?.includes("finished") && openId);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [active, run?.at]);
  const slow = active && handoffIsSlow(run?.status, run?.at, now);
  if (!slow && !caption && !active && !stopped && !missed && !error) return null;
  return (
    <>
      {error ? (
        <p className="mt-1 text-[12px] font-semibold text-[#0B5FFF]" data-handoff-error>
          {error} ·{" "}
          <button
            type="button"
            className="font-semibold text-[#0B5FFF] underline"
            data-handoff-retry
            onClick={(event) => {
              event.stopPropagation();
              onRetry?.();
            }}
          >
            Retry
          </button>
        </p>
      ) : null}
      {missed && !error ? (
        <p className="mt-1 text-[12px] font-semibold text-[#0B5FFF]" data-handoff-slow>
          Taking longer than usual ·{" "}
          <button
            type="button"
            className="font-semibold text-[#0B5FFF] underline"
            data-handoff-retry
            onClick={(event) => {
              event.stopPropagation();
              onRetry?.();
            }}
          >
            Retry
          </button>
        </p>
      ) : null}
      {stopped && !active && !missed ? (
        <p className="mt-1 text-[12px] font-semibold text-[#0B5FFF]" data-handoff-stopped>
          {caption} ·{" "}
          <button
            type="button"
            className="font-semibold text-[#0B5FFF] underline"
            data-handoff-retry
            onClick={(event) => {
              event.stopPropagation();
              onRetry?.();
            }}
          >
            Retry
          </button>
        </p>
      ) : null}
      {active && !slow ? (
        <p className="mt-1 text-[12px] font-semibold text-[#0B5FFF]" data-handoff-working>
          Working
        </p>
      ) : null}
      {slow && !missed ? (
        <p className="mt-1 text-[12px] font-semibold text-[#0B5FFF]" data-handoff-slow>
          Taking longer than usual ·{" "}
          <button
            type="button"
            className="font-semibold text-[#0B5FFF] underline"
            data-handoff-retry
            onClick={(event) => {
              event.stopPropagation();
              onRetry?.();
            }}
          >
            Retry
          </button>
        </p>
      ) : caption && !stopped && !missed && !(caption.includes("finished") && !openId) ? (
        <p className="fm-brief-progress mt-1 text-[11px] font-semibold text-[#0B5FFF]" data-agent-pickup>
          {caption}
          {finished && onOpenDraft ? (
            <>
              {" · "}
              <button
                type="button"
                className="font-semibold text-[#0B5FFF] underline"
                data-open-draft={openId}
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenDraft(openId);
                }}
              >
                Open draft
              </button>
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );
}
