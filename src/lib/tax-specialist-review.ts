/**
 * One accountant review of a natural person's document pack.
 * Server and tests only. The public page must not import this module.
 * No filing steps, no login, no submission, and no text for the client.
 */
import { analystRunCostUsd } from "./agent-analyst.ts";
import { CLAUDE_SONNET_55 } from "./claude-request.ts";

/** One call, under the $0.06 multi-turn runner ceiling. */
export const TAX_REVIEW_COST_CAP_USD = 0.04;

const CHARS_PER_TOKEN = 4;

export const TAX_REVIEW_DOCUMENT_TYPES = [
  "practice_income_expenses",
  "irp6",
  "medical_aid",
  "ra_contributions",
  "travel_logbook",
  "interest",
  "maintenance",
  "other",
] as const;

export type TaxDocumentType = (typeof TAX_REVIEW_DOCUMENT_TYPES)[number];

/** Output reserved for one file of that type. Seven types together stay inside the cap. */
export const TAX_REVIEW_OUTPUT_TOKENS: Record<TaxDocumentType, number> = {
  practice_income_expenses: 280,
  irp6: 220,
  medical_aid: 240,
  ra_contributions: 120,
  travel_logbook: 200,
  interest: 120,
  maintenance: 180,
  other: 80,
};

export type TaxArtifact = {
  id: string;
  fileName: string;
  itemKey: string | null;
  text: string;
};

export type TaxReviewFigure = {
  key: string;
  label: string;
  amount: string;
  artifactId: string;
  fileName: string;
  confidence: "high" | "medium" | "low";
  reason: string;
};

export type TaxReviewQuestion = {
  question_key: string;
  prompt_text: string;
  audience: "accountant";
};

export type TaxReviewWrite = {
  skippedForCost: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
  title: string;
  detail: string;
  evidence: Record<string, unknown>;
  questions: TaxReviewQuestion[];
};

export type TaxReviewTokenLine = {
  documents: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
};

export type TaxReviewTokenEstimate = {
  byType: Record<TaxDocumentType, TaxReviewTokenLine>;
  promptTokens: number;
  inputTokens: number;
  outputTokens: number;
  usd: number;
};

const CONFIDENCE = new Set(["high", "medium", "low"]);
const ORDER = /divorce|maintenance order|court order/i;
const EXEMPT = /exempt/i;
const MAINTENANCE = /maintenance/i;

export function taxDocumentType(artifact: Pick<TaxArtifact, "fileName" | "itemKey" | "text">): TaxDocumentType {
  const key = artifact.itemKey ?? "";
  if (key === "practice_income_expenses") return "practice_income_expenses";
  if (key === "medical_aid_certificate") return "medical_aid";
  if (key === "ra_contribution_certificate") return "ra_contributions";
  if (key === "travel_logbook") return "travel_logbook";
  if (key === "it3b") return "interest";
  const blob = `${artifact.fileName}\n${artifact.text}`.toLowerCase();
  if (blob.includes("irp6")) return "irp6";
  if (ORDER.test(blob) || blob.includes("maintenance")) return "maintenance";
  if (blob.includes("medical")) return "medical_aid";
  if (blob.includes("retirement") || /\bra\b/.test(blob)) return "ra_contributions";
  if (blob.includes("logbook") || blob.includes("odometer")) return "travel_logbook";
  if (blob.includes("it3") || blob.includes("interest")) return "interest";
  if (blob.includes("income") || blob.includes("expense")) return "practice_income_expenses";
  return "other";
}

function tokens(text: string): number {
  return Math.ceil(Math.max(0, text.length) / CHARS_PER_TOKEN);
}

export function taxReviewSystemPrompt(): string {
  return [
    "You review documents for a South African natural person who is a provisional taxpayer.",
    "The reader is the accountant. Write nothing for the client.",
    "Do not give filing instructions. Do not mention a SARS login, eFiling, or submission.",
    "Do not tell anyone to pay, file, or sign in.",
    "If a figure is unclear, ask the accountant a short question instead of guessing.",
    "Cover only what the files show:",
    "Practice income and expenses: the totals, and any line that looks personal rather than practice.",
    "IRP6 first and second payments. The second is normally due at the end of February. Flag when the second payment is still an estimate.",
    "Medical aid: medical scheme fees tax credit inputs only. Months, dependants, contributions, and out-of-pocket amounts where the file shows them.",
    "Retirement annuity contributions.",
    "Travel logbook: business kilometres, total kilometres, opening odometer, and closing odometer.",
    "Interest from an IT3(b).",
    "Maintenance received. Call it likely exempt only when a divorce order or a maintenance order in these files confirms that. Never assume it. If the order is not in the files, ask the accountant.",
    "Reply with JSON only, no markdown, in this shape:",
    '{"summary":"","figures":[{"key":"","label":"","amount":"","artifact_id":"","confidence":"high","reason":""}],"flags":[""],"questions":[""]}',
    "confidence is high, medium, or low. amount is the digits as shown, with no currency code.",
    "Every figure cites an artifact_id from the list. Keep each reason under 200 characters.",
  ].join("\n");
}

function artifactBlock(artifact: TaxArtifact): string {
  const body = artifact.text.trim().slice(0, 8000);
  return [`File: ${artifact.fileName}`, `Artifact: ${artifact.id}`, body].join("\n");
}

export function taxReviewUserPrompt(artifacts: readonly TaxArtifact[]): string {
  return artifacts.map(artifactBlock).join("\n\n");
}

function emptyLines(): Record<TaxDocumentType, TaxReviewTokenLine> {
  const out = {} as Record<TaxDocumentType, TaxReviewTokenLine>;
  for (const type of TAX_REVIEW_DOCUMENT_TYPES) {
    out[type] = { documents: 0, inputTokens: 0, outputTokens: 0, usd: 0 };
  }
  return out;
}

/** Token spend for one send. The prompt is shared once across the files in the pack. */
export function estimateTaxReviewTokens(artifacts: readonly TaxArtifact[]): TaxReviewTokenEstimate {
  const promptTokens = tokens(taxReviewSystemPrompt());
  const byType = emptyLines();
  let documentTokens = 0;
  const present = new Set<TaxDocumentType>();
  for (const artifact of artifacts) {
    const type = taxDocumentType(artifact);
    const input = tokens(artifactBlock(artifact));
    documentTokens += input;
    present.add(type);
    byType[type].documents += 1;
    byType[type].inputTokens += input;
    byType[type].outputTokens += TAX_REVIEW_OUTPUT_TOKENS[type];
  }
  const share = present.size > 0 ? Math.round(promptTokens / present.size) : 0;
  let outputTokens = 0;
  for (const type of present) {
    byType[type].inputTokens += share;
    outputTokens += byType[type].outputTokens;
    byType[type].usd = analystRunCostUsd(byType[type].inputTokens, byType[type].outputTokens, 0, 0, CLAUDE_SONNET_55);
  }
  const inputTokens = promptTokens + documentTokens;
  return {
    byType,
    promptTokens,
    inputTokens,
    outputTokens,
    usd: analystRunCostUsd(inputTokens, outputTokens, 0, 0, CLAUDE_SONNET_55),
  };
}

export function taxReviewExceedsCap(estimate: Pick<TaxReviewTokenEstimate, "usd">): boolean {
  return estimate.usd > TAX_REVIEW_COST_CAP_USD;
}

function displayAmount(value: unknown): string {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())
        ? Number(value.trim())
        : null;
  if (numeric == null || !Number.isFinite(numeric)) {
    const raw = typeof value === "string" ? value.trim() : "";
    return raw ? raw.slice(0, 80) : "not shown";
  }
  const negative = numeric < 0;
  const [whole, frac] = Math.abs(numeric).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const text = frac === "00" ? grouped : `${grouped}.${frac}`;
  return negative ? `-${text}` : text;
}

function confidenceOf(value: unknown): "high" | "medium" | "low" {
  return typeof value === "string" && CONFIDENCE.has(value) ? (value as "high" | "medium" | "low") : "low";
}

function orderInPack(artifacts: readonly TaxArtifact[]): boolean {
  return artifacts.some((artifact) => ORDER.test(artifact.fileName) || ORDER.test(artifact.text));
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function parseTaxReviewModel(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === "string") {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      return asRecord(JSON.parse(raw.slice(start, end + 1)));
    } catch {
      return null;
    }
  }
  return asRecord(raw);
}

const MAINTENANCE_QUESTION =
  "Please confirm whether the maintenance received is covered by a divorce or maintenance order. The files do not show that order.";

function buildReview(input: {
  sendId: string;
  artifacts: readonly TaxArtifact[];
  model: Record<string, unknown> | null;
  skippedForCost: boolean;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheWriteTokens: number;
  cacheReadTokens: number;
}): TaxReviewWrite {
  const byId = new Map(input.artifacts.map((artifact) => [artifact.id, artifact]));
  const confirmed = orderInPack(input.artifacts);
  const figures: TaxReviewFigure[] = [];
  const flags: string[] = [];
  const questions: string[] = [];
  const seenQuestions = new Set<string>();
  const pushQuestion = (text: string) => {
    const prompt = text.trim().slice(0, 500);
    if (!prompt || seenQuestions.has(prompt)) return;
    seenQuestions.add(prompt);
    questions.push(prompt);
  };

  const modelFigures = Array.isArray(input.model?.figures) ? input.model.figures : [];
  for (const item of modelFigures) {
    const row = asRecord(item);
    if (!row) continue;
    const artifact = byId.get(typeof row.artifact_id === "string" ? row.artifact_id : "");
    if (!artifact) continue;
    const label = String(row.label ?? "").trim().slice(0, 120) || artifact.fileName;
    let reason = String(row.reason ?? "").trim().slice(0, 200);
    let confidence = confidenceOf(row.confidence);
    const maintenance = MAINTENANCE.test(label) || MAINTENANCE.test(String(row.key ?? ""));
    if (maintenance && EXEMPT.test(reason) && !confirmed) {
      reason = "The files do not include a divorce or maintenance order, so this is not treated as exempt.";
      confidence = "low";
      pushQuestion(MAINTENANCE_QUESTION);
    }
    if (!reason) reason = "Read from the named file.";
    const key = String(row.key ?? label)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "")
      .slice(0, 60);
    if (!key || figures.some((figure) => figure.key === key)) continue;
    figures.push({
      key,
      label,
      amount: displayAmount(row.amount),
      artifactId: artifact.id,
      fileName: artifact.fileName,
      confidence,
      reason,
    });
  }

  const modelFlags = Array.isArray(input.model?.flags) ? input.model.flags : [];
  for (const flag of modelFlags) {
    if (typeof flag !== "string") continue;
    const text = flag.trim().slice(0, 240);
    if (!text) continue;
    if (MAINTENANCE.test(text) && EXEMPT.test(text) && !confirmed) {
      pushQuestion(MAINTENANCE_QUESTION);
      continue;
    }
    flags.push(text);
  }
  const modelQuestions = Array.isArray(input.model?.questions) ? input.model.questions : [];
  for (const question of modelQuestions) {
    if (typeof question === "string") pushQuestion(question);
  }

  if (figures.length === 0) {
    const artifact = input.artifacts[0];
    figures.push({
      key: "documents_seen",
      label: "Documents in this pack",
      amount: "not shown",
      artifactId: artifact?.id ?? "",
      fileName: artifact?.fileName ?? "No file",
      confidence: "low",
      reason: input.skippedForCost
        ? "The pack is above the cost cap, so the words were not sent for review."
        : artifact
          ? "No figure could be tied to a file."
          : "No shared file was stored for this send.",
    });
    pushQuestion(
      artifact
        ? "Please review this pack. A figure could not be tied to a file."
        : "Please review this send. No shared file was stored.",
    );
  }

  let summary = String(input.model?.summary ?? "").trim().slice(0, 800);
  if (/log\s*in|efiling|submit|filing instruction/i.test(summary)) {
    summary = "";
    pushQuestion("The draft mentioned filing. Please review the documents yourself.");
  }
  if (MAINTENANCE.test(summary) && EXEMPT.test(summary) && !confirmed) {
    summary = summary.replace(/likely exempt/gi, "not confirmed");
    pushQuestion(MAINTENANCE_QUESTION);
  }
  if (!summary) {
    summary = input.skippedForCost
      ? "This pack was not sent for review because it is above the cost cap."
      : "Figures from the files are below. Please check anything marked low.";
  }

  const figureRecord: Record<string, unknown> = {};
  for (const figure of figures) {
    figureRecord[figure.key] = {
      label: figure.label,
      amount: figure.amount,
      artifact_id: figure.artifactId,
      file_name: figure.fileName,
      confidence: figure.confidence,
      reason: figure.reason,
    };
  }

  return {
    skippedForCost: input.skippedForCost,
    costUsd: input.costUsd,
    inputTokens: input.inputTokens,
    outputTokens: input.outputTokens,
    cacheWriteTokens: input.cacheWriteTokens,
    cacheReadTokens: input.cacheReadTokens,
    title: "Tax Specialist review",
    detail: summary,
    evidence: {
      draft: true,
      requires_human_approval: true,
      audience: "accountant",
      kind: "tax_document_review",
      send_id: input.sendId,
      summary,
      flags,
      figures: figureRecord,
    },
    questions: questions.map((prompt, index) => ({
      question_key: `tax_review:${input.sendId}:${index}`,
      prompt_text: prompt,
      audience: "accountant" as const,
    })),
  };
}

export function reviewTaxSend(input: {
  sendId: string;
  artifacts: readonly TaxArtifact[];
  model: unknown;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheWriteTokens?: number;
    cacheReadTokens?: number;
  };
}): TaxReviewWrite {
  const estimate = estimateTaxReviewTokens(input.artifacts);
  const usage = input.usage;
  const spent = usage
    ? analystRunCostUsd(
        usage.inputTokens,
        usage.outputTokens,
        usage.cacheWriteTokens ?? 0,
        usage.cacheReadTokens ?? 0,
        CLAUDE_SONNET_55,
      )
    : 0;
  const tooBig = taxReviewExceedsCap(estimate) || spent > TAX_REVIEW_COST_CAP_USD;
  if (tooBig) {
    return buildReview({
      sendId: input.sendId,
      artifacts: input.artifacts,
      model: null,
      skippedForCost: true,
      costUsd: spent,
      inputTokens: usage?.inputTokens ?? estimate.inputTokens,
      outputTokens: usage?.outputTokens ?? 0,
      cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
      cacheReadTokens: usage?.cacheReadTokens ?? 0,
    });
  }
  return buildReview({
    sendId: input.sendId,
    artifacts: input.artifacts,
    model: parseTaxReviewModel(input.model),
    skippedForCost: false,
    costUsd: spent,
    inputTokens: usage?.inputTokens ?? estimate.inputTokens,
    outputTokens: usage?.outputTokens ?? 0,
    cacheWriteTokens: usage?.cacheWriteTokens ?? 0,
    cacheReadTokens: usage?.cacheReadTokens ?? 0,
  });
}
