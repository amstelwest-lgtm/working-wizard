import type { FirmInterviewMessage, SetupPartnerWorkflowMap } from "@/lib/setup-partner";

export type FirmInterviewDraft = {
  messages: FirmInterviewMessage[];
  modelTurns: number;
  phase: "interview" | "map" | "done";
  question: string;
  map: SetupPartnerWorkflowMap | null;
};

export function firmInterviewDraftKey(firmId: string): string {
  return `milon.firm-interview.${firmId}`;
}

export function parseFirmInterviewDraft(raw: string | null): FirmInterviewDraft | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<FirmInterviewDraft>;
    if (!value || !Array.isArray(value.messages)) return null;
    const messages = value.messages.filter(
      (row): row is FirmInterviewMessage =>
        Boolean(row) &&
        (row.role === "assistant" || row.role === "user") &&
        typeof row.content === "string" &&
        !row.content.includes("{"),
    );
    if (!messages.length) return null;
    const phase = value.phase === "map" || value.phase === "done" ? value.phase : "interview";
    return {
      messages,
      modelTurns: typeof value.modelTurns === "number" && value.modelTurns >= 0 ? value.modelTurns : 0,
      phase,
      question: typeof value.question === "string" && !value.question.includes("{") ? value.question : "",
      map: value.map && Array.isArray(value.map.todaysFlow) ? value.map : null,
    };
  } catch {
    return null;
  }
}

export function readFirmInterviewDraft(firmId: string): FirmInterviewDraft | null {
  if (typeof localStorage === "undefined") return null;
  return parseFirmInterviewDraft(localStorage.getItem(firmInterviewDraftKey(firmId)));
}

export function writeFirmInterviewDraft(firmId: string, draft: FirmInterviewDraft): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(firmInterviewDraftKey(firmId), JSON.stringify(draft));
  window.dispatchEvent(new Event("milon-firm-interview"));
}

export function clearFirmInterviewDraft(firmId: string): void {
  if (typeof localStorage === "undefined") return;
  localStorage.removeItem(firmInterviewDraftKey(firmId));
  window.dispatchEvent(new Event("milon-firm-interview"));
}
