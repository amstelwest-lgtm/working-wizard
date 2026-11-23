/**
 * Unsent Send an agent draft.
 * The Financial Manager tool and an Implementation Manager routine of kind
 * agent_send both stop here. Approval is the only path into mintClientAgentSend.
 * Nothing in this file inserts a send, sends mail, or posts a ledger.
 */
import { FIRM_NOTE_MAX } from "./client-agent-missions";

export const AGENT_SEND_DRAFT_KIND = "agent_send_draft";
export const PROPOSE_AGENT_SEND_TOOL = "propose_agent_send";
export const AGENT_SEND_ROUTINE = "agent_send";

const COLLECT_FROM = /^collect\s+(.+?)\s+from\s+(.+?)\.?$/i;

export type AgentSendDraft = {
  kind: typeof AGENT_SEND_DRAFT_KIND;
  clientId: string;
  clientName: string;
  checklist: string[];
  message: string;
  recipientEmail: string | null;
  recipientFirstName: string | null;
  sent: false;
  minted: false;
};

export type AgentSendMintInput = {
  clientId: string;
  recipientEmail: string;
  recipientFirstName?: string;
  agent: "financial_manager";
  missionKey: "collect_documents";
  firmNote: string;
};

function cleanLine(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.replace(/\s+/g, " ").trim().slice(0, max);
}

function checklistFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const row of value) {
    const item = cleanLine(row, 200);
    if (!item || items.includes(item)) continue;
    items.push(item);
    if (items.length >= 12) break;
  }
  return items;
}

/** "Collect March statements from Karoo Woodwork" → client, one checklist line, the sentence. */
export function parseAgentSendRequest(text: string): {
  clientName: string;
  checklist: string[];
  message: string;
} | null {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const match = COLLECT_FROM.exec(cleaned);
  if (!match) return null;
  const item = match[1]?.replace(/\s+/g, " ").trim() ?? "";
  const clientName = match[2]?.replace(/\s+/g, " ").trim() ?? "";
  if (!item || !clientName) return null;
  return {
    clientName: clientName.slice(0, 200),
    checklist: [item.slice(0, 200)],
    message: cleaned.replace(/\.$/, "").slice(0, 500),
  };
}

export function buildAgentSendDraft(input: {
  clientId: string;
  clientName: string;
  checklist: readonly string[];
  message: string;
  recipientEmail?: string | null;
  recipientFirstName?: string | null;
}): { ok: true; draft: AgentSendDraft } | { ok: false; error: string } {
  const clientName = cleanLine(input.clientName, 200);
  const checklist = checklistFrom(input.checklist);
  const message = cleanLine(input.message, 500);
  if (!input.clientId) return { ok: false, error: "A draft needs a client." };
  if (!clientName) return { ok: false, error: "A draft needs the client name." };
  if (checklist.length === 0) return { ok: false, error: "A draft needs at least one checklist item." };
  if (!message) return { ok: false, error: "A draft needs a message." };
  return {
    ok: true,
    draft: {
      kind: AGENT_SEND_DRAFT_KIND,
      clientId: input.clientId,
      clientName,
      checklist,
      message,
      recipientEmail: cleanLine(input.recipientEmail, 200) || null,
      recipientFirstName: cleanLine(input.recipientFirstName, 60) || null,
      sent: false,
      minted: false,
    },
  };
}

/**
 * Tool arguments, or one sentence such as "Collect March statements from Karoo Woodwork".
 * The result is a draft. minted and sent stay false.
 */
export function draftFromProposeArgs(
  args: Record<string, unknown>,
  clientId: string,
): { ok: true; draft: AgentSendDraft } | { ok: false; error: string } {
  const request = cleanLine(args.request, 500) || cleanLine(args.message, 500);
  const parsed = request ? parseAgentSendRequest(request) : null;
  const clientName = cleanLine(args.client_name, 200) || parsed?.clientName || "";
  const checklist = checklistFrom(args.checklist);
  const message = cleanLine(args.message, 500) || parsed?.message || request;
  return buildAgentSendDraft({
    clientId,
    clientName,
    checklist: checklist.length > 0 ? checklist : (parsed?.checklist ?? []),
    message,
    recipientEmail: cleanLine(args.recipient_email, 200) || null,
    recipientFirstName: cleanLine(args.recipient_first_name, 60) || null,
  });
}

export function agentSendFirmNote(draft: Pick<AgentSendDraft, "message" | "checklist">): string {
  const lines = [draft.message, ...draft.checklist.map((item) => `Please send: ${item}`)];
  return lines.filter(Boolean).join("\n").trim().slice(0, FIRM_NOTE_MAX);
}

export function agentSendFindingRow(draft: AgentSendDraft, runId: string): Record<string, unknown> {
  return {
    agent: "financial_manager",
    client_id: draft.clientId,
    run_id: runId,
    kind: AGENT_SEND_DRAFT_KIND,
    severity: "info",
    title: `Collect documents from ${draft.clientName}`.slice(0, 200),
    detail: draft.message.slice(0, 2000),
    evidence: {
      figures: { checklistCount: draft.checklist.length },
      draft: true,
      requires_human_approval: true,
      kind: AGENT_SEND_DRAFT_KIND,
      client_name: draft.clientName,
      checklist: draft.checklist,
      message: draft.message,
      recipient_email: draft.recipientEmail,
      recipient_first_name: draft.recipientFirstName,
      mission_key: "collect_documents",
      agent: "financial_manager",
      sent: false,
      minted: false,
    },
  };
}

export function readAgentSendDraft(input: {
  clientId: string;
  evidence: unknown;
}): AgentSendDraft | null {
  if (!input.evidence || typeof input.evidence !== "object" || Array.isArray(input.evidence)) return null;
  const row = input.evidence as Record<string, unknown>;
  if (row.kind !== AGENT_SEND_DRAFT_KIND && row.draft !== true) return null;
  if (row.sent === true || row.minted === true) return null;
  const built = buildAgentSendDraft({
    clientId: input.clientId,
    clientName: typeof row.client_name === "string" ? row.client_name : "",
    checklist: checklistFrom(row.checklist),
    message: typeof row.message === "string" ? row.message : "",
    recipientEmail: typeof row.recipient_email === "string" ? row.recipient_email : null,
    recipientFirstName: typeof row.recipient_first_name === "string" ? row.recipient_first_name : null,
  });
  return built.ok ? built.draft : null;
}

const UNNAMED = /^(the accountant|accountant)$/i;

/**
 * A named accountant is required. The return value is the argument list for
 * mintClientAgentSend. This function does not call it.
 */
export function agentSendApproval(input: {
  draft: AgentSendDraft;
  approverName: string | null | undefined;
  recipientEmail: string;
  recipientFirstName?: string | null;
}):
  | { ok: true; approverName: string; mint: AgentSendMintInput }
  | { ok: false; reason: "needs_named_accountant" | "address" | "already_sent" } {
  if (input.draft.sent || input.draft.minted) return { ok: false, reason: "already_sent" };
  const approverName = (input.approverName ?? "").replace(/\s+/g, " ").trim();
  if (!approverName || UNNAMED.test(approverName)) return { ok: false, reason: "needs_named_accountant" };
  const recipientEmail = input.recipientEmail.replace(/\s+/g, "").trim().toLowerCase();
  if (!recipientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipientEmail)) {
    return { ok: false, reason: "address" };
  }
  const first = cleanLine(input.recipientFirstName ?? input.draft.recipientFirstName, 60);
  return {
    ok: true,
    approverName,
    mint: {
      clientId: input.draft.clientId,
      recipientEmail,
      ...(first ? { recipientFirstName: first } : {}),
      agent: "financial_manager",
      missionKey: "collect_documents",
      firmNote: agentSendFirmNote(input.draft),
    },
  };
}

export type AgentSendRoutinePlan = {
  kind: typeof AGENT_SEND_DRAFT_KIND;
  sent: false;
  minted: false;
  invokeRunner: false;
  postsLedger: false;
  clientId: string;
  clientName: string;
  checklist: string[];
  message: string;
  periodKey: string;
  idempotencyInputs: string;
  draft: AgentSendDraft;
};

function routineRecord(meta: unknown): Record<string, unknown> | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  return meta as Record<string, unknown>;
}

/** Accepted routine map whose routine is agent_send. Other routines return null. */
export function planAgentSendRoutine(
  meta: unknown,
  input: { clientId: string; clientName: string; periodKey: string },
): AgentSendRoutinePlan | null {
  const row = routineRecord(meta);
  if (!row) return null;
  if (row.doc_type !== "im_routine_map") return null;
  if (row.source !== "setup_partner_activation") return null;
  if (row.routine !== AGENT_SEND_ROUTINE) return null;
  if (typeof row.accepted_at !== "string" || !row.accepted_at.trim()) return null;
  const fromSteps = Array.isArray(row.steps)
    ? row.steps
        .map((step) =>
          step && typeof step === "object" && typeof (step as { title?: unknown }).title === "string"
            ? (step as { title: string }).title
            : "",
        )
        .filter(Boolean)
    : [];
  const checklist = checklistFrom(row.checklist);
  const items = checklist.length > 0 ? checklist : checklistFrom(fromSteps);
  const message =
    cleanLine(row.message, 500) ||
    (items.length > 0 ? `Please send: ${items.join(", ")}.` : "");
  const built = buildAgentSendDraft({
    clientId: input.clientId,
    clientName: input.clientName,
    checklist: items.length > 0 ? items : ["Documents for this period"],
    message: message || "Please send the documents on this list.",
  });
  if (!built.ok) return null;
  return {
    kind: AGENT_SEND_DRAFT_KIND,
    sent: false,
    minted: false,
    invokeRunner: false,
    postsLedger: false,
    clientId: input.clientId,
    clientName: built.draft.clientName,
    checklist: built.draft.checklist,
    message: built.draft.message,
    periodKey: input.periodKey,
    idempotencyInputs: `agent-send-draft:${input.clientId}:${input.periodKey}`,
    draft: built.draft,
  };
}

export function proposeAgentSendToolSchema() {
  return {
    name: PROPOSE_AGENT_SEND_TOOL,
    description:
      "Save an unsent Send an agent draft for a named accountant to approve. Pass client_name, checklist, and message. Collect March statements from Karoo Woodwork is one checklist item for that client. Nothing is minted or emailed. Do not say a link was sent.",
    input_schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        client_name: { type: "string", description: "The client the documents are collected from." },
        checklist: {
          type: "array",
          items: { type: "string" },
          description: "Document names on the list. One item is enough.",
        },
        message: { type: "string", description: "The note the client will see. Not a send." },
        request: {
          type: "string",
          description: "The accountant's sentence, when client_name and checklist are taken from it.",
        },
        recipient_email: { type: "string" },
        recipient_first_name: { type: "string" },
      },
    },
  };
}
