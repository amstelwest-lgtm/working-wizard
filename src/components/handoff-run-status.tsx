import { useEffect, useState } from "react";
import { handoffIsSlow } from "@/lib/action-handoff";

/**
 * Queued and running hand-offs show Working.
 * After three minutes the same row offers Retry instead of the queue line.
 */
export function HandoffRunStatus({
  run,
  caption,
  onRetry,
}: {
  run?: { status: string; at?: string | null } | null;
  caption?: string | null;
  onRetry?: () => void;
}) {
  const active = run?.status === "queued" || run?.status === "running";
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 15000);
    return () => window.clearInterval(timer);
  }, [active, run?.at]);
  const slow = active && handoffIsSlow(run?.status, run?.at, now);
  if (!slow && !caption && !active) return null;
  return (
    <>
      {active && !slow ? (
        <p className="mt-1 text-[12px] font-semibold text-[#0B5FFF]" data-handoff-working>
          Working
        </p>
      ) : null}
      {slow ? (
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
      ) : caption ? (
        <p className="fm-brief-progress mt-1 text-[11px] font-semibold text-[#0B5FFF]" data-agent-pickup>
          {caption}
        </p>
      ) : null}
    </>
  );
}
