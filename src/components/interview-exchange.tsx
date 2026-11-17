import { useMarketFormat } from "@/contexts/market";
import type { FirmInterviewMessage } from "@/lib/setup-partner";

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
    questionIndex && questionIndex > 0
      ? questionTotal && questionTotal > 0
        ? `Question ${questionIndex} of ~${questionTotal}`
        : `Question ${questionIndex}`
      : null;
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
      ) : question ? (
        <div className="im-ask">
          <h2 className="setup-partner__question">{question}</h2>
        </div>
      ) : null}
    </div>
  );
}

/** Collapsed Q/A log. Render only when a prior answer exists. */
export function PastInterviews({
  messages,
  question,
  thinking,
  recordedAt,
}: {
  messages: readonly FirmInterviewMessage[];
  question: string;
  thinking: boolean;
  recordedAt?: string | null;
}) {
  const { date: formatWhen } = useMarketFormat();
  const pairs = interviewPairs(messages, question, thinking);
  if (pairs.length === 0) return null;
  const when = recordedAt ? new Date(recordedAt) : null;
  const date = when && !Number.isNaN(when.getTime()) ? formatWhen(when) : null;
  return (
    <details className="setup-partner__log im-card" data-past-interviews="">
      <summary>Past interviews ({pairs.length})</summary>
      <div className="im-log-groups">
        <section>
          {date ? (
            <h3 className="setup-partner__log-date">
              <time dateTime={recordedAt ?? undefined}>{date}</time>
            </h3>
          ) : null}
          <ol className="setup-partner__transcript">
            {pairs.map((pair, index) => (
              <li key={`${index}-${pair.question}`} className="im-thread">
                {pair.question ? (
                  <p className="setup-partner__log-q im-bubble im-bubble--ask">
                    <strong>{pair.question}</strong>
                  </p>
                ) : null}
                {pair.answer ? <p className="setup-partner__log-a im-bubble">{pair.answer}</p> : null}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </details>
  );
}
