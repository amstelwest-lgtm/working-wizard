import { useCallback, useEffect, useState } from "react";
import { Check, CircleDashed, Loader2, MinusCircle, XCircle } from "lucide-react";
import { loadHandoffRunDetail } from "@/lib/owner-handoff-client";
import {
  handoffRunActive,
  handoffTimeline,
  type HandoffRunDetail,
  type TimelineStep,
} from "@/lib/handoff-timeline";
import "./handoff-run-timeline.css";
import { useMarketFormat } from "@/contexts/market";

const POLL_MS = 8000;

function StepIcon({ state }: { state: TimelineStep["state"] }) {
  if (state === "done") return <Check className="h-3.5 w-3.5" aria-hidden />;
  if (state === "active") return <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />;
  if (state === "failed") return <XCircle className="h-3.5 w-3.5" aria-hidden />;
  if (state === "skipped") return <MinusCircle className="h-3.5 w-3.5" aria-hidden />;
  return <CircleDashed className="h-3.5 w-3.5" aria-hidden />;
}

export function HandoffTimelineList({ steps }: { steps: TimelineStep[] }) {
  const { dateTime } = useMarketFormat();
  const stepTime = (at: string | null | undefined): string | null => {
    if (!at || Number.isNaN(new Date(at).getTime())) return null;
    return dateTime(at, { hour: "2-digit", minute: "2-digit" });
  };
  return (
    <ol className="handoff-timeline__steps" data-handoff-steps>
      {steps.map((step) => (
        <li key={step.key} className="handoff-timeline__step" data-step-state={step.state}>
          <span className="handoff-timeline__icon">
            <StepIcon state={step.state} />
          </span>
          <span className="handoff-timeline__copy">
            <span className="handoff-timeline__label">{step.label}</span>
            {step.detail ? <span className="handoff-timeline__detail">{step.detail}</span> : null}
          </span>
          {stepTime(step.at) ? (
            <time className="handoff-timeline__time">{stepTime(step.at)}</time>
          ) : null}
        </li>
      ))}
    </ol>
  );
}

/**
 * "What <agent> did": the run's steps and output under a hand-off row.
 * Open by default so the row shows the work. Refreshes while the run is queued or running.
 */
export function HandoffRunTimeline({
  runId,
  agentName,
  onOpenDraft,
  defaultOpen = true,
}: {
  runId: string;
  agentName: string;
  onOpenDraft?: (draftId: string) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [detail, setDetail] = useState<HandoffRunDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await loadHandoffRunDetail(runId);
      setDetail(next);
      setFailed(next == null);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  const active = handoffRunActive(detail?.status);
  useEffect(() => {
    if (!open || !active) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, active, load]);

  const steps = detail ? handoffTimeline({ agentName, run: detail }) : [];

  return (
    <details
      className="handoff-timeline"
      data-handoff-timeline={runId}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onClick={(event) => event.stopPropagation()}
    >
      <summary className="handoff-timeline__summary">What {agentName} did</summary>
      {!open ? null : loading && !detail ? (
        <p className="handoff-timeline__muted" aria-busy="true">
          Loading the steps…
        </p>
      ) : failed && !detail ? (
        <p className="handoff-timeline__muted">The steps could not be loaded.</p>
      ) : (
        <>
          <HandoffTimelineList steps={steps} />
          {detail && detail.findings.length > 0 ? (
            <div className="handoff-timeline__output" data-handoff-output>
              <p className="handoff-timeline__kicker">Output</p>
              <ul>
                {detail.findings.map((finding) => (
                  <li key={finding.id}>
                    <span className="handoff-timeline__finding-title">{finding.title}</span>
                    {finding.detail ? (
                      <span className="handoff-timeline__detail">
                        {finding.detail.slice(0, 280)}
                      </span>
                    ) : null}
                    {onOpenDraft ? (
                      <button
                        type="button"
                        className="handoff-timeline__open"
                        data-open-draft={finding.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpenDraft(finding.id);
                        }}
                      >
                        Open draft
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : detail && !active ? (
            <p className="handoff-timeline__muted">No draft or finding was written.</p>
          ) : null}
        </>
      )}
    </details>
  );
}
