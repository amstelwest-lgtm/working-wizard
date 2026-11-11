/**
 * In-progress practice interview, stored on the existing milon_brain_rules
 * row the setup-partner confirm path already writes. rule_text is unbounded
 * text. This row is not a prompt rule, so it is not clipped to 500 characters
 * and it uses its own task and source so it cannot be read back as a plan.
 */

export const SETUP_PARTNER_INTERVIEW_EVENT = "setup_partner_interview";
export const SETUP_PARTNER_INTERVIEW_TASK = "practice_setup_interview";

const MESSAGE_CAP = 24;
const MESSAGE_CHARS = 2000;
const RULE_CHARS = 16000;

export type FirmInterviewDraftMessage = {
  role: "user" | "assistant";
  content: string;
};

export type FirmInterviewDraft = {
  messages: FirmInterviewDraftMessage[];
  question: string;
  modelTurns: number;
};

function clipContent(value: string): string {
  const text = value.trim();
  if (text.length <= MESSAGE_CHARS) return text;
  return text.slice(0, MESSAGE_CHARS);
}

export function interviewDraftWithQuestion(
  messages: readonly FirmInterviewDraftMessage[],
  question: string,
  modelTurns: number,
): FirmInterviewDraft {
  const questionText = clipContent(question);
  const kept: FirmInterviewDraftMessage[] = [];
  for (const message of messages) {
    if (message.role !== "user" && message.role !== "assistant") continue;
    const content = clipContent(message.content);
    if (!content) continue;
    kept.push({ role: message.role, content });
  }
  const last = kept[kept.length - 1];
  const withQuestion =
    questionText && !(last?.role === "assistant" && last.content === questionText)
      ? [...kept, { role: "assistant" as const, content: questionText }]
      : kept;
  return {
    messages: withQuestion.slice(-MESSAGE_CAP),
    question: questionText,
    modelTurns: Number.isFinite(modelTurns) && modelTurns > 0 ? Math.floor(modelTurns) : 0,
  };
}

export function interviewDraftRuleText(draft: FirmInterviewDraft): string {
  const messages = draft.messages.slice(-MESSAGE_CAP);
  let turns = draft.modelTurns;
  let text = JSON.stringify({ messages, question: draft.question, modelTurns: turns });
  while (text.length > RULE_CHARS && messages.length > 1) {
    messages.shift();
    text = JSON.stringify({ messages, question: draft.question, modelTurns: turns });
  }
  return text;
}

export function interviewDraftFromRuleText(raw: string | null | undefined): FirmInterviewDraft | null {
  if (!raw || !raw.trim().startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const row = parsed as { messages?: unknown; question?: unknown; modelTurns?: unknown };
  const question = typeof row.question === "string" ? row.question.trim() : "";
  if (!question) return null;
  const messages: FirmInterviewDraftMessage[] = [];
  if (Array.isArray(row.messages)) {
    for (const message of row.messages) {
      if (!message || typeof message !== "object") continue;
      const rec = message as { role?: unknown; content?: unknown };
      if (rec.role !== "user" && rec.role !== "assistant") continue;
      if (typeof rec.content !== "string" || !rec.content.trim()) continue;
      messages.push({ role: rec.role, content: rec.content.trim() });
    }
  }
  const modelTurns =
    typeof row.modelTurns === "number" && row.modelTurns > 0 ? Math.floor(row.modelTurns) : 0;
  return interviewDraftWithQuestion(messages, question, modelTurns);
}

export type InterviewDraftInsert = {
  firm_id: string;
  client_id: null;
  task_type: typeof SETUP_PARTNER_INTERVIEW_TASK;
  source_event: typeof SETUP_PARTNER_INTERVIEW_EVENT;
  source_row_id: null;
  decision: "corrected";
  rule_text: string;
  approver_id: string;
  layer: "private";
  status: "active";
};

export function interviewDraftWrite(
  existingId: string | null,
  input: { firmId: string; approverId: string; draft: FirmInterviewDraft },
):
  | { kind: "update"; id: string; rule_text: string }
  | { kind: "insert"; row: InterviewDraftInsert } {
  const rule_text = interviewDraftRuleText(input.draft);
  if (existingId) return { kind: "update", id: existingId, rule_text };
  return {
    kind: "insert",
    row: {
      firm_id: input.firmId,
      client_id: null,
      task_type: SETUP_PARTNER_INTERVIEW_TASK,
      source_event: SETUP_PARTNER_INTERVIEW_EVENT,
      source_row_id: null,
      decision: "corrected",
      rule_text,
      approver_id: input.approverId,
      layer: "private",
      status: "active",
    },
  };
}
