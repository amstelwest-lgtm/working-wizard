/**
 * Which generation entry points an ended Starter trial blocks.
 * The live check is still `assertStarterTrialAllowsNewWork` (app server)
 * or `paidGenerationTrialBlock` (edge). This list is the decision those
 * call sites must follow. Milōn Bot Q&A stays open.
 */

import { STARTER_TRIAL_ENDED_MESSAGE } from "./firm-starter-trial";

export const STARTER_TRIAL_ENDED_CODE = "starter_trial_ended";

export type GenerationEntry = {
  id: string;
  /** What a person clicks, or the service behind it. */
  surface: string;
  /** True when an enforced Starter trial that has ended must refuse this. */
  paid: boolean;
  /** Where the server check lives. "ungated" when the trial does not apply. */
  gate: string;
};

export const GENERATION_ENTRIES: readonly GenerationEntry[] = [
  {
    id: "add_client",
    surface: "Add client",
    paid: true,
    gate: "loadFirmClientCreateAllowance",
  },
  {
    id: "generate_advisory_pack",
    surface: "Generate pack",
    paid: true,
    gate: "generateAdvisoryPack",
  },
  {
    id: "brain_deliverable_draft",
    surface: "Client Brain — Draft advisory from brain",
    paid: true,
    gate: "brain-deliverable-draft",
  },
  {
    id: "draft_advisory_client_email",
    surface: "Advisory drafter — Client email",
    paid: true,
    gate: "draftAdvisory",
  },
  {
    id: "draft_advisory_meeting_agenda",
    surface: "Advisory drafter — Meeting agenda",
    paid: true,
    gate: "draftAdvisory",
  },
  {
    id: "draft_advisory_exec_summary",
    surface: "Advisory drafter — Exec summary",
    paid: true,
    gate: "draftAdvisory",
  },
  {
    id: "brain_propose",
    surface: "Propose from brain",
    paid: true,
    gate: "brain-propose",
  },
  {
    id: "milon_bot_create",
    surface: "Milōn Bot create deliverable or pack",
    paid: true,
    gate: "persistAdvisoryCreate",
  },
  {
    id: "draft_milon_workflow",
    surface: "Monthly workflow line",
    paid: true,
    gate: "draftMilonWorkflow",
  },
  {
    id: "ask_ai",
    surface: "Ask AI Q&A",
    paid: false,
    gate: "ungated",
  },
  {
    id: "milon_bot_qa",
    surface: "Milōn Bot Q&A",
    paid: false,
    gate: "ungated",
  },
  {
    id: "extract_financials",
    surface: "Statement extraction",
    paid: false,
    gate: "ungated",
  },
  {
    id: "extract_financials_pdf",
    surface: "PDF statement extraction",
    paid: false,
    gate: "ungated",
  },
  {
    id: "bank_statement_draft",
    surface: "Bank statement P&L draft",
    paid: false,
    gate: "ungated",
  },
  {
    id: "cash_from_banks",
    surface: "Cash forecast from bank statements",
    paid: false,
    gate: "ungated",
  },
  {
    id: "industry_news",
    surface: "Industry pulse",
    paid: false,
    gate: "ungated",
  },
  {
    id: "client_invite_email",
    surface: "Owner invite email",
    paid: false,
    gate: "ungated",
  },
  {
    id: "manual_recommendation",
    surface: "Manual recommendation",
    paid: false,
    gate: "ungated",
  },
  {
    id: "lighthouse_draft",
    surface: "Lighthouse sales drafts",
    paid: false,
    gate: "ungated",
  },
] as const;

export type GenerationEntryId = (typeof GENERATION_ENTRIES)[number]["id"];

export function generationEntry(id: string): GenerationEntry {
  const entry = GENERATION_ENTRIES.find((item) => item.id === id);
  if (!entry) throw new Error(`Unknown generation entry: ${id}`);
  return entry;
}

/** True only for a paid entry after the enforced Starter trial has ended. */
export function starterTrialBlocksGeneration(entryId: string, trialExpired: boolean): boolean {
  return trialExpired && generationEntry(entryId).paid;
}

export function messageFromUnknown(error: unknown): string {
  if (!error) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "object") {
    const record = error as { message?: unknown; cause?: unknown; error?: unknown };
    if (typeof record.message === "string" && record.message.trim()) return record.message;
    if (typeof record.error === "string" && record.error.trim()) return record.error;
    if (record.cause) return messageFromUnknown(record.cause);
  }
  return "";
}

export function isStarterTrialEndedMessage(message: string): boolean {
  return (
    message.includes(STARTER_TRIAL_ENDED_MESSAGE) || message.includes(STARTER_TRIAL_ENDED_CODE)
  );
}
