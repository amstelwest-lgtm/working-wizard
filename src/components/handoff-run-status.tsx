import { useEffect, useState, type MouseEvent } from "react";
import { HandoffRunTimeline } from "@/components/handoff-run-timeline";
import { handoffIsSlow } from "@/lib/action-handoff";
import { pausedHandoffLine, readHandoffPaused } from "@/lib/handoff-timeline";
import { agentShortName } from "@/lib/milon-team";
import type { AgentKey } from "@/lib/milon-team-feed";

const AGENT_KEYS: readonly string[] = ["financial_manager", "analyst", "advisor"];

function shortName(agent: string | null | undefined): string | null {
  return agent && AGENT_KEYS.includes(agent) ? agentShortName(agent as AgentKey) : null;
}

/** Reassign opens the Hand to menu in the same row when the caller has none. */
function openNearestHandTo(event: MouseEvent<HTMLButtonElement>) {
  let node: HTMLElement | null = event.currentTarget.parentElement;
  for (let i = 0; node && i < 6; i += 1) {
    const trigger = node.querySelector<HTMLButtonElement>("[data-hand-to-trigger]");
    if (trigger) {
      trigger.click();
      trigger.focus();
      return;
    }
    node = node.parentElement;
  }
}

/**
 * Queued and running hand-offs show Working.
 * After three minutes the same row offers Retry instead of the queue line.
 * A run id adds "What <agent> did" with the steps and output.
 * A paused runner reads "Not started: <agent> is paused" with Reassign.
 */
export function HandoffRunStatus({
  run,
  caption,
  missed = false,
  error = null,
  draftId = null,
  onOpenDraft,
  onRetry,
  actionItemId = null,
  onReassign,
}: {
  run?: { id?: string; agent?: string; status: string; at?: string | null } | null;
  caption?: string | null;
  /** No run appeared for this hand-off. Offer Retry instead of Working. */
  missed?: boolean;
  /** The hand-off did not start. Working and the optimistic note stay off. */
  error?: string | null;
  /** Finding id. The finished line and Open draft render only when this is set. */
  draftId?: string | null;
  onOpenDraft?: (draftId: string) => void;
  onRetry?: () => void;
  /** Reads the paused marker this device wrote when the runner was off. */
  actionItemId?: string | null;
  onReassign?: () => void;
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
  const [pausedAgent, setPausedAgent] = useState<string | null>(null);
  useEffect(() => {
    const marker = readHandoffPaused(actionItemId);
    const newerRun = marker && run?.at && run.at > marker.at;
    setPausedAgent(marker && !newerRun ? marker.agent : null);
  }, [actionItemId, run?.at, missed]);
  const pausedName = !active && !error ? shortName(pausedAgent) : null;
  const runId = run?.id?.trim() ?? "";
  const runAgent = shortName(run?.agent);
  const timeline =
    runId && runAgent && !pausedName ? (
      <HandoffRunTimeline runId={runId} agentName={runAgent} onOpenDraft={onOpenDraft} />
    ) : null;
  if (pausedName) {
    return (
      <p className="handoff-paused" data-handoff-paused>
        {pausedHandoffLine(pausedName)} ·{" "}
        <button
          type="button"
          data-handoff-reassign
          onClick={(event) => {
            event.stopPropagation();
            if (onReassign) onReassign();
            else openNearestHandTo(event);
          }}
        >
          Reassign
        </button>
      </p>
    );
  }
  if (!slow && !caption && !active && !stopped && !missed && !error) return timeline;
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
      {timeline}
    </>
  );
}
