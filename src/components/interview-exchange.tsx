import { useMarketFormat } from "@/contexts/market";
import { AgentReplyShell } from "@/components/agent-reply/agent-reply-shell";
import { structureAgentReply, type AgentReply } from "@/lib/agent-reply";
import { groupInterviewSessions, type FirmInterviewDraft } from "@/lib/firm-interview-draft";
import type { FirmInterviewMessage } from "@/lib/setup-partner";

/** A plain interview question stays a heading. A formatted reply uses the shared card. */
function formattedImReply(text: string): AgentReply | null {
  const reply = structureAgentReply(text);
  if (reply.figures.length || reply.suggestions.length || reply.kpis.length || reply.detail.trim()) return reply;
  return null;
}

export const IMPLEMENTATION_MANAGER_THINKING = "Implementation Manager is thinking…";

export type InterviewPair = { question: string; answer: string | null };

/**
 * Prior turns only. The live question stays out of the log unless the model
 * is still writing the next one, in which case that question has been answered.
 */
export function interviewPairs(
  messages: readonly FirmInterviewMessage[],
  currentQuestion: string,
  thinking: boolean,
): InterviewPair[] {
  const prior = messages.filter((message, index) => {
    if (thinking) return true;
    return !(message.content === currentQuestion && index === messages.length - 1);
  });
  const pairs: InterviewPair[] = [];
  for (const message of prior) {
    if (message.role === "assistant") {
      pairs.push({ question: message.content, answer: null });
      continue;
    }
    const open = pairs.at(-1);
    if (open && open.answer == null) open.answer = message.content;
    else pairs.push({ question: "", answer: message.content });
  }
  return pairs.filter((pair) => pair.question || pair.answer);
}

/** The question on screen now. Earlier turns stay in PastInterviews. */
export function InterviewExchange({
  question,
  thinking,
  questionIndex,
  questionTotal,
}: {
  question: string;
  thinking: boolean;
  messages?: readonly FirmInterviewMessage[];
  /** Shown only when the interview knows which question this is. */
  questionIndex?: number;
  questionTotal?: number;
}) {
  const count =
    thinking || !questionIndex || questionIndex <= 0
      ? null
      : questionTotal && questionTotal > 0
        ? `Question ${questionIndex} of ~${questionTotal}`
        : `Question ${questionIndex}`;
  const shaped = question && !thinking ? formattedImReply(question) : null;
  return (
    <div className="setup-partner__exchange" data-interview-exchange="">
      {count ? <p className="im-qcount">{count}</p> : null}
      {thinking ? (
        <p className="setup-partner__thinking" role="status" data-interview-thinking="">
          <span className="im-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          {IMPLEMENTATION_MANAGER_THINKING}
        </p>
      ) : shaped ? (
        <AgentReplyShell reply={shaped} />
      ) : question ? (
        <div className="im-ask">
          <h2 className="setup-partner__question">{question}</h2>
        </div>
      ) : null}
    </div>
  );
}

/** Collapsed Q/A log. One interview per session. Render only when an answer exists. */
export function PastInterviews({
  messages = [],
  question,
  thinking,
  recordedAt,
  sessionId,
  sessions,
}: {
  messages?: readonly FirmInterviewMessage[];
  question: string;
  thinking: boolean;
  recordedAt?: string | null;
  sessionId?: string | null;
  sessions?: readonly FirmInterviewDraft[];
}) {
  const { date: formatWhen } = useMarketFormat();
  const grouped = groupInterviewSessions(
    sessions && sessions.length > 0
      ? sessions
      : [
          {
            messages: [...messages],
            question,
            modelTurns: 0,
            sessionId: sessionId ?? null,
            savedAt: recordedAt ?? null,
          },
        ],
  );
  if (grouped.length === 0) return null;
  const label = grouped.length === 1 ? "1 interview" : `${grouped.length} interviews`;
  return (
    <details className="setup-partner__log im-card" data-past-interviews="">
      <summary>{label}</summary>
      <div className="im-log-groups">
        {grouped.map((session) => {
          const pairs = interviewPairs(
            session.messages,
            session.sessionId && session.sessionId === sessionId ? question : "",
            session.sessionId && session.sessionId === sessionId ? thinking : false,
          ).filter((pair) => pair.answer);
          if (pairs.length === 0) return null;
          const when = session.savedAt ? new Date(session.savedAt) : null;
          const date = when && !Number.isNaN(when.getTime()) ? formatWhen(when) : null;
          return (
            <section key={session.sessionId || session.savedAt || pairs[0]?.question}>
              {date ? (
                <h3 className="setup-partner__log-date">
                  <time dateTime={session.savedAt ?? undefined}>{date}</time>
                </h3>
              ) : null}
              <ol className="setup-partner__transcript">
                {pairs.map((pair, index) => {
                  const shaped = pair.question ? formattedImReply(pair.question) : null;
                  return (
                  <li key={`${session.sessionId}-${index}-${pair.question}`} className="im-thread">
                    {shaped ? (
                      <AgentReplyShell reply={shaped} />
                    ) : pair.question ? (
                      <p className="setup-partner__log-q im-bubble im-bubble--ask">
                        <strong>{pair.question}</strong>
                      </p>
                    ) : null}
                    {pair.answer ? <p className="setup-partner__log-a im-bubble">{pair.answer}</p> : null}
                  </li>
                  );
                })}
              </ol>
            </section>
          );
        })}
      </div>
    </details>
  );
}
