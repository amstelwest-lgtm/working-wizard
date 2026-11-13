/**
 * Unconfirmed client interview, kept in this tab only.
 * The key is the firm and the client, so one client's draft never opens on another.
 */
import type { FirmInterviewMessage } from "@/lib/setup-partner";

export type ClientInterviewDraft = {
  question: string;
  history: FirmInterviewMessage[];
  questionIndex: number;
  followupIndex: number;
  inFollowups: boolean;
  answers: Record<string, string>;
  draftAnswer: string;
  modelTurns: number;
};

export function clientInterviewDraftKey(firmId: string, clientId: string): string {
  return `milon-client-interview:${firmId}:${clientId}`;
}

function isMessage(value: unknown): value is FirmInterviewMessage {
  if (!value || typeof value !== "object") return false;
  const row = value as { role?: unknown; content?: unknown };
  return (row.role === "assistant" || row.role === "user") && typeof row.content === "string";
}

export function readClientInterviewDraft(firmId: string | null | undefined, clientId: string | null | undefined): ClientInterviewDraft | null {
  if (!firmId || !clientId) return null;
  try {
    const raw = sessionStorage.getItem(clientInterviewDraftKey(firmId, clientId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClientInterviewDraft>;
    if (!Array.isArray(parsed.history) || !parsed.history.every(isMessage)) return null;
    if (parsed.history.length === 0) return null;
    const answers =
      parsed.answers && typeof parsed.answers === "object" && !Array.isArray(parsed.answers)
        ? Object.fromEntries(
            Object.entries(parsed.answers as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string",
            ),
          )
        : {};
    return {
      question: typeof parsed.question === "string" ? parsed.question : "",
      history: parsed.history,
      questionIndex: typeof parsed.questionIndex === "number" ? parsed.questionIndex : 0,
      followupIndex: typeof parsed.followupIndex === "number" ? parsed.followupIndex : 0,
      inFollowups: Boolean(parsed.inFollowups),
      answers,
      draftAnswer: typeof parsed.draftAnswer === "string" ? parsed.draftAnswer : "",
      modelTurns: typeof parsed.modelTurns === "number" ? parsed.modelTurns : 0,
    };
  } catch {
    return null;
  }
}

export function writeClientInterviewDraft(
  firmId: string | null | undefined,
  clientId: string | null | undefined,
  draft: ClientInterviewDraft,
): void {
  if (!firmId || !clientId || draft.history.length === 0) return;
  try {
    sessionStorage.setItem(clientInterviewDraftKey(firmId, clientId), JSON.stringify(draft));
  } catch {
    // Private mode keeps the interview on screen for this visit only.
  }
}

export function clearClientInterviewDraft(firmId: string | null | undefined, clientId: string | null | undefined): void {
  if (!firmId || !clientId) return;
  try {
    sessionStorage.removeItem(clientInterviewDraftKey(firmId, clientId));
  } catch {
    // Nothing stored.
  }
}
