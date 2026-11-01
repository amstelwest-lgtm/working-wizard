/**
 * Answer-first card for an agent reply.
 * The how-trail stays closed until the person opens it, and that open
 * reads a trail already stored with the reply.
 */
import { useState } from "react";
import type { AgentReply, AgentReplyDecision, AgentReplyHowDetail } from "@/lib/agent-reply";

export type AgentReplyDecisionAction = "confirm" | "reject" | "approve" | "dismiss";

export function AgentReplyDecisionStrip({
  decision,
  disabled = false,
  onDecide,
  buttonClassName,
}: {
  decision: AgentReplyDecision;
  disabled?: boolean;
  onDecide: (action: AgentReplyDecisionAction) => void;
  buttonClassName?: (action: AgentReplyDecisionAction) => string | undefined;
}) {
  const pair: ReadonlyArray<readonly [AgentReplyDecisionAction, string]> =
    decision.kind === "confirm_reject"
      ? [
          ["confirm", "Confirm"],
          ["reject", "Reject"],
        ]
      : [
          ["approve", "Approve"],
          ["dismiss", "Dismiss"],
        ];
  const label = decision.kind === "confirm_reject" ? "Confirm or reject" : "Approve or dismiss";
  return (
    <div className="agent-reply-decision" data-agent-decision={decision.kind} role="group" aria-label={label}>
      {decision.prompt ? <p className="agent-reply-decision-prompt">{decision.prompt}</p> : null}
      <div className="agent-reply-decision-actions">
        {pair.map(([action, text]) => (
          <button
            key={action}
            type="button"
            className={
              buttonClassName?.(action) ??
              `agent-reply-decision-btn ${action === "confirm" || action === "approve" ? "is-primary" : "is-secondary"}`
            }
            data-decision={action}
            disabled={disabled}
            onClick={() => onDecide(action)}
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AgentReplyShell({
  reply,
  busy = false,
  onDecide,
  onLoadDetail,
}: {
  reply: AgentReply;
  busy?: boolean;
  onDecide?: (action: AgentReplyDecisionAction, decision: AgentReplyDecision) => void;
  onLoadDetail?: (detailId: string) => Promise<AgentReplyHowDetail | null>;
}) {
  const [phase, setPhase] = useState<"closed" | "loading" | "open" | "missing">("closed");
  const [lines, setLines] = useState<string[]>([]);
  const how = reply.how;
  const expandable = Boolean(how?.detailId && onLoadDetail);

  async function toggleHow() {
    if (!how?.detailId || !onLoadDetail || phase === "loading") return;
    if (phase === "open" || phase === "missing") {
      setPhase("closed");
      return;
    }
    setPhase("loading");
    try {
      const detail = await onLoadDetail(how.detailId);
      const next = detail?.lines?.filter((line) => line.trim()) ?? [];
      setLines(next);
      setPhase(next.length ? "open" : "missing");
    } catch {
      setLines([]);
      setPhase("missing");
    }
  }

  const decisionPrompt =
    reply.decision && reply.decision.prompt && reply.decision.prompt !== reply.headline
      ? reply.decision.prompt
      : "";

  return (
    <div className="agent-reply" data-agent-reply="true" data-agent={reply.agent ?? ""}>
      {reply.headline ? (
        <p className="agent-reply-headline" data-agent-headline="true">
          {reply.headline}
        </p>
      ) : null}
      {reply.kpis.length ? (
        <ul className="agent-reply-kpis" data-agent-kpis="true">
          {reply.kpis.map((kpi) => (
            <li key={`${kpi.label}:${kpi.value}`} className="agent-reply-kpi" data-agent-kpi={kpi.label}>
              <span className="agent-reply-kpi-label">{kpi.label}</span>
              <span className="agent-reply-kpi-value">{kpi.value}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {reply.bullets.length ? (
        <ul className="agent-reply-bullets" data-agent-bullets="true">
          {reply.bullets.map((bullet, index) => (
            <li key={`${index}:${bullet}`}>{bullet}</li>
          ))}
        </ul>
      ) : null}
      {reply.figures.length ? (
        <ul className="agent-reply-figures" data-agent-figures="true">
          {reply.figures.map((chip) => (
            <li key={`${chip.source}:${chip.label}:${chip.value}`} className="agent-reply-figure" data-figure-source={chip.source}>
              {chip.value ? (
                <>
                  <span className="agent-reply-figure-label">{chip.label}</span>{" "}
                  <span className="agent-reply-figure-value">{chip.value}</span>
                </>
              ) : (
                <span className="agent-reply-figure-label">{chip.label}</span>
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {reply.decision && onDecide ? (
        <AgentReplyDecisionStrip
          decision={{ ...reply.decision, prompt: decisionPrompt }}
          disabled={busy}
          onDecide={(action) => onDecide(action, reply.decision as AgentReplyDecision)}
        />
      ) : null}
      {how ? (
        <section className="agent-reply-how" data-agent-how="true" data-agent-how-open={phase === "open" ? "true" : "false"}>
          {expandable ? (
            <button
              type="button"
              className="agent-reply-how-toggle"
              data-agent-how-toggle="true"
              aria-expanded={phase === "open"}
              onClick={() => void toggleHow()}
            >
              <span className="agent-reply-how-kicker">How I got this</span>
              <span className="agent-reply-how-summary" data-agent-how-summary="true">
                {how.summary}
              </span>
            </button>
          ) : (
            <div className="agent-reply-how-static">
              <span className="agent-reply-how-kicker">How I got this</span>
              <p className="agent-reply-how-summary" data-agent-how-summary="true">
                {how.summary}
              </p>
            </div>
          )}
          {phase === "loading" ? <p className="agent-reply-how-loading">Loading the detail…</p> : null}
          {phase === "missing" ? (
            <p className="agent-reply-how-missing" data-agent-how-missing="true">
              No further detail was stored with this reply.
            </p>
          ) : null}
          {phase === "open" && lines.length ? (
            <ul className="agent-reply-how-detail" data-agent-how-detail="true">
              {lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
