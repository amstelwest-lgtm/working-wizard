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

export function interviewDateLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** The question on screen now. Earlier turns stay in PastInterviews. */
export function InterviewExchange({
  question,
  thinking,
}: {
  question: string;
  thinking: boolean;
  messages?: readonly FirmInterviewMessage[];
}) {
  return (
    <div className="setup-partner__exchange" data-interview-exchange="">
      {thinking ? (
        <p className="setup-partner__thinking" role="status" data-interview-thinking="">
          {IMPLEMENTATION_MANAGER_THINKING}
        </p>
      ) : question ? (
        <h2 className="setup-partner__question">{question}</h2>
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
  const pairs = interviewPairs(messages, question, thinking);
  if (pairs.length === 0) return null;
  const date = interviewDateLabel(recordedAt);
  return (
    <details className="setup-partner__log" data-past-interviews="">
      <summary>Past interviews</summary>
      <ol className="setup-partner__transcript">
        {pairs.map((pair, index) => (
          <li key={`${index}-${pair.question}`}>
            {pair.question ? (
              <p className="setup-partner__log-q">
                <strong>{pair.question}</strong>
              </p>
            ) : null}
            {pair.answer ? <p className="setup-partner__log-a">{pair.answer}</p> : null}
            {date ? (
              <p className="setup-partner__log-date">
                <time dateTime={recordedAt ?? undefined}>{date}</time>
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </details>
  );
}
