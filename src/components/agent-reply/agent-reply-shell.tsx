/**
 * The one reply card for every bot: Financial Manager, Analyst, Advisor,
 * Tax Specialist, the firm thread, the owner thread, and a formatted
 * Implementation Manager reply. The how-trail stays closed until opened.
 */
import { useState, type ReactNode } from "react";
import { advisorReplyBlocks } from "@/lib/advisor-reply-format";
import {
  structureAgentReply,
  type AgentReply,
  type AgentReplyAgent,
  type AgentReplyDecision,
  type AgentReplyHowDetail,
  type AgentReplySources,
} from "@/lib/agent-reply";
import { parseRuns } from "@/lib/owner-reply-format";

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

function InlineText({ text }: { text: string }) {
  return parseRuns(text).map((run, index) =>
    run.bold ? <strong key={index}>{run.text}</strong> : <span key={index}>{run.text}</span>,
  );
}

function ReplyMarkdown({ text }: { text: string }) {
  const blocks = advisorReplyBlocks(text);
  return (
    <div className="agent-reply-md" data-agent-markdown="true">
      {blocks.map((block, index) => {
        if (block.kind === "ul" || block.kind === "ol") {
          const List = block.kind === "ol" ? "ol" : "ul";
          return (
            <List key={index} className="agent-reply-md-list">
              {block.items.map((item) => (
                <li key={item}>
                  <InlineText text={item} />
                </li>
              ))}
            </List>
          );
        }
        return (
          <p key={index}>
            <InlineText text={block.text} />
          </p>
        );
      })}
    </div>
  );
}

/** Parse one bot reply and paint the shared card. */
export function BotReply({
  text,
  agent = null,
  sources,
  onSuggest,
  onLoadDetail,
}: {
  text: string;
  agent?: AgentReplyAgent | null;
  sources?: AgentReplySources;
  onSuggest?: (suggestion: string) => void;
  onLoadDetail?: (detailId: string) => Promise<AgentReplyHowDetail | null>;
}) {
  const reply = structureAgentReply(text, { ...sources, agent: agent ?? sources?.agent ?? null });
  return <AgentReplyShell reply={reply} onSuggest={onSuggest} onLoadDetail={onLoadDetail} />;
}

export function AgentReplyShell({
  reply,
  busy = false,
  onDecide,
  onLoadDetail,
  onSuggest,
}: {
  reply: AgentReply;
  busy?: boolean;
  onDecide?: (action: AgentReplyDecisionAction, decision: AgentReplyDecision) => void;
  onLoadDetail?: (detailId: string) => Promise<AgentReplyHowDetail | null>;
  onSuggest?: (suggestion: string) => void;
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
  const detail = reply.detail?.trim() ?? "";
  const collapseDetail = detail.length > 320 || detail.split("\n").length > 4;
  let detailNode: ReactNode = null;
  if (detail && collapseDetail) {
    detailNode = (
      <details className="agent-reply-more" data-agent-more="true">
        <summary>More detail</summary>
        <ReplyMarkdown text={detail} />
      </details>
    );
  } else if (detail) {
    detailNode = (
      <div data-agent-detail="true">
        <ReplyMarkdown text={detail} />
      </div>
    );
  }

  return (
    <div className="agent-reply" data-agent-reply="true" data-agent={reply.agent ?? ""}>
      {reply.headline ? (
        <p className="agent-reply-headline" data-agent-headline="true">
          <InlineText text={reply.headline} />
        </p>
      ) : null}
      {reply.kpis.length ? (
        <ul className="agent-reply-kpis" data-agent-kpis="true">
          {reply.kpis.map((kpi) => (
            <li
              key={`${kpi.label}:${kpi.value}`}
              className="agent-reply-kpi"
              data-agent-kpi={kpi.label}
              aria-label={`${kpi.label} ${kpi.value}`}
            >
              <span className="agent-reply-kpi-label">{kpi.label}</span>{" "}
              <span className="agent-reply-kpi-value">{kpi.value}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {reply.bullets.length ? (
        <ul className="agent-reply-bullets" data-agent-bullets="true">
          {reply.bullets.map((bullet, index) => (
            <li key={`${index}:${bullet}`}>
              <InlineText text={bullet} />
            </li>
          ))}
        </ul>
      ) : null}
      {detailNode}
      {reply.suggestions?.length ? (
        <div className="agent-reply-suggestions" data-agent-suggestions="true">
          {reply.suggestions.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              className="ask-ai-chip"
              data-agent-suggestion={suggestion}
              onClick={() => onSuggest?.(suggestion)}
            >
              {suggestion}
            </button>
          ))}
        </div>
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
