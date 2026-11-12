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

export function InterviewExchange({
  question,
  thinking,
  messages,
}: {
  question: string;
  thinking: boolean;
  messages: readonly FirmInterviewMessage[];
}) {
  const pairs = interviewPairs(messages, question, thinking);
  return (
    <div className="setup-partner__exchange" data-interview-exchange="">
      {pairs.length > 0 ? (
        <details className="setup-partner__log">
          <summary>
            Earlier answers ({pairs.length})
          </summary>
          <ol className="setup-partner__transcript">
            {pairs.map((pair, index) => (
              <li key={`${index}-${pair.question}`}>
                {pair.question ? <p className="setup-partner__log-q">{pair.question}</p> : null}
                {pair.answer ? <p className="setup-partner__log-a">{pair.answer}</p> : null}
              </li>
            ))}
          </ol>
        </details>
      ) : null}
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
