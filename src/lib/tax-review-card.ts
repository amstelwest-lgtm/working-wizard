/**
 * Accountant card for one tax document review.
 * Labels come from the stored finding. This file has no filing copy.
 */

export type TaxReviewCardFigure = {
  label: string;
  amount: string;
  fileName: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type TaxReviewCardModel = {
  findingId: string;
  sendId: string;
  summary: string;
  figures: TaxReviewCardFigure[];
  flags: string[];
  questions: string[];
  status: "waiting" | "approved" | "dismissed";
};

const CONFIDENCE = new Set(["high", "medium", "low"]);

function record(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function taxReviewCardFromFinding(input: {
  id: string;
  evidence: unknown;
  status: string | null;
  questions: readonly string[];
}): TaxReviewCardModel | null {
  const evidence = record(input.evidence);
  if (!evidence) return null;
  if (evidence.kind !== "tax_document_review") return null;
  if (evidence.audience !== "accountant") return null;
  const sendId = typeof evidence.send_id === "string" ? evidence.send_id : "";
  if (!sendId) return null;
  const figures: TaxReviewCardFigure[] = [];
  const stored = record(evidence.figures);
  if (stored) {
    for (const value of Object.values(stored)) {
      const figure = record(value);
      if (!figure) continue;
      const confidence = typeof figure.confidence === "string" && CONFIDENCE.has(figure.confidence)
        ? (figure.confidence as TaxReviewCardFigure["confidence"])
        : "low";
      const label = typeof figure.label === "string" ? figure.label.trim() : "";
      const fileName = typeof figure.file_name === "string" ? figure.file_name.trim() : "";
      if (!label || !fileName) continue;
      figures.push({
        label,
        amount: typeof figure.amount === "string" ? figure.amount : "not shown",
        fileName,
        confidence,
        reason: typeof figure.reason === "string" ? figure.reason.trim() : "",
      });
    }
  }
  const flags = Array.isArray(evidence.flags)
    ? evidence.flags.filter((flag): flag is string => typeof flag === "string" && flag.trim().length > 0)
    : [];
  const summary = typeof evidence.summary === "string" ? evidence.summary.trim() : "";
  const status =
    input.status === "approved" || input.status === "dismissed" ? input.status : "waiting";
  return {
    findingId: input.id,
    sendId,
    summary,
    figures,
    flags,
    questions: input.questions.filter((question) => question.trim()),
    status,
  };
}
