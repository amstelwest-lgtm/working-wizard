/**
 * Send-an-agent mission catalog. Code, not a table the firm edits.
 * Prompts that name a form live in client-agent-mission-prompts.ts
 * and are filled on the server at Send.
 */
import {
  stageAgentJobLine,
  stageAgentKeys,
  stageAgentShortName,
} from "@/lib/tax-specialist/agents";
import type { AvatarFace } from "@/lib/fm-avatar-state";

export const MISSION_KEYS = [
  "collect_documents",
  "deadline_reminder",
  "informal_consult",
  "confirm_balances",
  "vat_pack",
  "signoff_reminder",
] as const;

export type MissionKey = (typeof MISSION_KEYS)[number];

export const SEND_AGENT_KEYS = [
  "financial_manager",
  "analyst",
  "advisor",
  "tax_specialist",
] as const;

export type SendAgentKey = (typeof SEND_AGENT_KEYS)[number];

export const FIRM_NOTE_MAX = 500;
export const UPLOAD_LABEL_MAX = 200;
export const MISSION_MESSAGE_MAX = 2000;

export const FORECAST_OPENING_CONTEXT =
  "The 13-week cash forecast has no opening bank balance on file.";

const MISSION_TITLE: Record<MissionKey, string> = {
  collect_documents: "Collect documents",
  deadline_reminder: "Deadline reminder",
  informal_consult: "Informal consult",
  confirm_balances: "Confirm bank balances",
  vat_pack: "VAT pack",
  signoff_reminder: "Sign-off reminder",
};

/** Who may run which mission. VAT pack is also hidden outside South Africa. */
const MISSION_AGENTS: Record<MissionKey, readonly SendAgentKey[]> = {
  collect_documents: ["financial_manager", "tax_specialist"],
  deadline_reminder: ["financial_manager", "advisor", "tax_specialist"],
  informal_consult: ["analyst", "advisor"],
  confirm_balances: ["financial_manager"],
  vat_pack: ["financial_manager", "tax_specialist"],
  signoff_reminder: ["advisor", "tax_specialist"],
};

export type MissionEmail = {
  subject: string;
  sentences: [string, string, string];
  button: string;
};

export function isMissionKey(value: string | null | undefined): value is MissionKey {
  return !!value && (MISSION_KEYS as readonly string[]).includes(value);
}

export function isSendAgentKey(value: string | null | undefined): value is SendAgentKey {
  return !!value && (SEND_AGENT_KEYS as readonly string[]).includes(value);
}

/** Legacy rows stored the hyphenated slug. New sends use the face key. */
export function normalizeSendAgent(agent: string | null | undefined): SendAgentKey | null {
  if (agent === "tax-specialist") return "tax_specialist";
  return isSendAgentKey(agent) ? agent : null;
}

export function sendAgentFace(agent: string | null | undefined): AvatarFace {
  return normalizeSendAgent(agent) ?? "tax_specialist";
}

export function sendAgentShortName(agent: string | null | undefined): string {
  const key = normalizeSendAgent(agent);
  return key ? stageAgentShortName(key) : "Tax Specialist";
}

export function sendAgentJobLine(agent: SendAgentKey): string {
  return stageAgentJobLine(agent);
}

export function missionTitle(key: MissionKey): string {
  return MISSION_TITLE[key];
}

/** History label. A physio row with no mission key stays "Collect documents". */
export function sendMissionTitle(missionKey: string | null | undefined): string {
  return isMissionKey(missionKey) ? MISSION_TITLE[missionKey] : "Collect documents";
}

export type MissionStatus = "Docs received" | "Replied" | "Opened" | "Sent";

export function sendMissionStatus(row: {
  docsReceivedAt?: string | null;
  repliedAt?: string | null;
  openedAt?: string | null;
  completedAt?: string | null;
  consentAt?: string | null;
}): MissionStatus {
  if (row.docsReceivedAt || row.completedAt) return "Docs received";
  if (row.repliedAt) return "Replied";
  if (row.openedAt || row.consentAt) return "Opened";
  return "Sent";
}

export type SendProgressState = "done" | "now" | "waiting";

export type SendProgressStep = {
  id: "sent" | "opened" | "replied" | "documents" | "reviewed";
  label: string;
  detail: string;
  state: SendProgressState;
};

/**
 * Accountant progress for one send. Sent is always done.
 * The highlighted step is the next thing still open: the client opening
 * the link, documents arriving, then the firm's review. A chat reply is
 * recorded when it happens and does not block the later steps.
 */
export function sendProgressSteps(input: {
  opened: boolean;
  replied: boolean;
  documents: boolean;
  reviewed: boolean;
}): SendProgressStep[] {
  const opened = input.opened || input.replied || input.documents || input.reviewed;
  const documents = input.documents || input.reviewed;
  const reviewed = input.reviewed;
  const now = !opened ? "opened" : !documents ? "documents" : !reviewed ? "reviewed" : null;
  const state = (id: SendProgressStep["id"], done: boolean): SendProgressState => {
    if (done) return "done";
    return now === id ? "now" : "waiting";
  };
  return [
    {
      id: "sent",
      label: "Sent",
      detail: "The email is with the client.",
      state: "done",
    },
    {
      id: "opened",
      label: "Opened",
      detail: opened ? "The client opened the link." : "Waiting for the client to open the link.",
      state: state("opened", opened),
    },
    {
      id: "replied",
      label: "Replied",
      detail: input.replied ? "The client replied in the chat." : "No reply in the chat yet.",
      state: input.replied ? "done" : "waiting",
    },
    {
      id: "documents",
      label: "Documents",
      detail: documents ? "Files are in Client library." : "Waiting for documents.",
      state: state("documents", documents),
    },
    {
      id: "reviewed",
      label: "Reviewed",
      detail: reviewed ? "You marked this reviewed." : "Waiting for your review.",
      state: state("reviewed", reviewed),
    },
  ];
}

/** A typed name wins. A blank name uses the file name so upload is not blocked. */
export function uploadLabelOrFileName(
  typed: string | null | undefined,
  fileName: string | null | undefined,
): { ok: true; label: string } | { ok: false } {
  const named = cleanUploadLabel(typed);
  if (named.ok) return named;
  const stem = (fileName ?? "").replace(/\.[^.]+$/, "");
  const fromStem = cleanUploadLabel(stem);
  if (fromStem.ok) return fromStem;
  return cleanUploadLabel(fileName);
}

/** Four agents in South Africa, three elsewhere. Same rule as stageAgentKeys. */
export function sendAgentsForMarket(country: string | null | undefined): SendAgentKey[] {
  return stageAgentKeys(country).filter(isSendAgentKey);
}

export function missionsForAgent(
  agent: string | null | undefined,
  country: string | null | undefined,
): MissionKey[] {
  const key = normalizeSendAgent(agent);
  if (!key) return [];
  if (!sendAgentsForMarket(country).includes(key)) return [];
  return MISSION_KEYS.filter((mission) => {
    if (mission === "vat_pack" && country !== "ZA") return false;
    return MISSION_AGENTS[mission].includes(key);
  });
}

export function agentMayRunMission(
  agent: string | null | undefined,
  missionKey: string | null | undefined,
  country: string | null | undefined,
): boolean {
  if (!isMissionKey(missionKey)) return false;
  return missionsForAgent(agent, country).includes(missionKey);
}

export function cleanFirmNote(
  value: string | null | undefined,
): { ok: true; note: string | null } | { ok: false; reason: "note" } {
  const note = (value ?? "").trim();
  if (!note) return { ok: true, note: null };
  if (note.length > FIRM_NOTE_MAX) return { ok: false, reason: "note" };
  return { ok: true, note };
}

export function cleanUploadLabel(
  value: string | null | undefined,
): { ok: true; label: string } | { ok: false } {
  const label = (value ?? "").replace(/\s+/g, " ").trim();
  if (!label || label.length > UPLOAD_LABEL_MAX) return { ok: false };
  return { ok: true, label };
}

export function cleanMissionMessage(
  value: string | null | undefined,
): { ok: true; body: string } | { ok: false } {
  const body = (value ?? "").replace(/\s+/g, " ").trim();
  if (!body || body.length > MISSION_MESSAGE_MAX) return { ok: false };
  return { ok: true, body };
}

export function chooseMission(input: {
  agent: string | null | undefined;
  missionKey: string | null | undefined;
  country: string | null | undefined;
  firmNote?: string | null;
}):
  | { ok: true; agent: SendAgentKey; missionKey: MissionKey; title: string; note: string | null }
  | { ok: false; reason: "agent" | "mission" | "note" } {
  const agent = normalizeSendAgent(input.agent);
  if (!agent || !sendAgentsForMarket(input.country).includes(agent)) {
    return { ok: false, reason: "agent" };
  }
  if (
    !isMissionKey(input.missionKey) ||
    !agentMayRunMission(agent, input.missionKey, input.country)
  ) {
    return { ok: false, reason: "mission" };
  }
  const note = cleanFirmNote(input.firmNote);
  if (!note.ok) return note;
  return {
    ok: true,
    agent,
    missionKey: input.missionKey,
    title: MISSION_TITLE[input.missionKey],
    note: note.note,
  };
}

function practice(value: string): string {
  return value.replace(/\s+/g, " ").trim() || "Your accountant";
}

/** Subject, three sentences, and the button. The firm note is not an input. */
export function missionEmailCopy(input: {
  missionKey: MissionKey;
  practiceName: string;
  agentShortName: string;
}): MissionEmail {
  const firm = practice(input.practiceName);
  const agent = input.agentShortName.replace(/\s+/g, " ").trim() || "Tax Specialist";
  switch (input.missionKey) {
    case "collect_documents":
      return {
        subject: `${firm} asked for a few documents`,
        button: "Open your document list",
        sentences: [
          "To help with your accounts, we need a few documents from you.",
          `This link opens a short conversation with our ${agent}. You'll be asked to agree before anything is stored.`,
          "Only send what you have. Skip anything that doesn't apply.",
        ],
      };
    case "deadline_reminder":
      return {
        subject: `${firm} sent a reminder`,
        button: "Read the reminder",
        sentences: [
          `${firm} asked us to send you a short reminder.`,
          `This link opens a conversation with our ${agent}. You'll be asked to agree before anything is stored.`,
          "You can reply on the page, and you can attach a file if you already have one.",
        ],
      };
    case "informal_consult":
      return {
        subject: `${firm} would like a short conversation`,
        button: "Start the conversation",
        sentences: [
          `${firm} would like a short conversation with you.`,
          `This link opens a chat with our ${agent}. You'll be asked to agree before the conversation is stored.`,
          "It is informal. Reply in your own words. You can attach a file if it helps.",
        ],
      };
    case "confirm_balances":
      return {
        subject: `${firm} asked you to confirm the bank balances`,
        button: "Confirm the balances",
        sentences: [
          `${firm} needs the current bank balances confirmed.`,
          "This link opens a short conversation with our Financial Manager. You'll be asked to agree before anything is stored.",
          "You can type the balances, and you can attach a statement if you have one.",
        ],
      };
    case "vat_pack":
      return {
        subject: `${firm} asked for the VAT pack`,
        button: "Send the VAT pack",
        sentences: [
          "To prepare the VAT for the period we discussed, we need the supporting papers from you.",
          `This link opens a short conversation with our ${agent}. You'll be asked to agree before anything is stored.`,
          "Only send what you have. Skip anything that doesn't apply.",
        ],
      };
    case "signoff_reminder":
      return {
        subject: `${firm} asked you to review and reply`,
        button: "Review and reply",
        sentences: [
          `${firm} has something ready for you to review.`,
          `This link opens a short conversation with our ${agent}. You'll be asked to agree before your reply is stored.`,
          "A yes or a short list of changes is enough. You can attach a marked copy if you have one.",
        ],
      };
  }
}

function hello(firstName: string | null | undefined, agent: string, firm: string): string {
  const name = (firstName ?? "").trim();
  return name ? `Hi ${name}, I'm the ${agent} at ${firm}.` : `Hi, I'm the ${agent} at ${firm}.`;
}

/** Fixed page intro. The firm note is not included. */
export function missionClientIntro(input: {
  missionKey: MissionKey;
  practiceName: string;
  agentShortName: string;
  firstName?: string | null;
}): string {
  const firm = practice(input.practiceName);
  const agent = input.agentShortName.replace(/\s+/g, " ").trim() || "Tax Specialist";
  const line = hello(
    input.firstName,
    input.missionKey === "confirm_balances" ? "Financial Manager" : agent,
    firm,
  );
  switch (input.missionKey) {
    case "collect_documents":
      return `${line} Please upload the documents for this request, each with a short name. Skip anything that doesn't apply.`;
    case "deadline_reminder":
      return `${line} This is a short reminder. You can reply here, and you can attach a file if you already have one.`;
    case "informal_consult":
      return `${line} This is a short conversation. Reply in your own words. You can attach a file if it helps.`;
    case "confirm_balances":
      return `${line} Please confirm the bank balances. You can type them here, and you can attach a statement if you have one.`;
    case "vat_pack":
      return `${line} Please send the VAT papers for the period, each file with a short name. Only send what you have.`;
    case "signoff_reminder":
      return `${line} Please review what is ready and reply yes, or say what to change. You can attach a marked copy if you have one.`;
  }
}

/** One paragraph after I'm done. Names the agent and the practice. */
export function missionThanks(input: {
  agentShortName: string;
  practiceName: string;
  firstName?: string | null;
}): string {
  const firm = practice(input.practiceName);
  const agent = input.agentShortName.replace(/\s+/g, " ").trim() || "Tax Specialist";
  const name = (input.firstName ?? "").trim();
  const thanks = name ? `Thank you, ${name}.` : "Thank you.";
  return `${thanks} ${agent} at ${firm} has what you sent on this request. We'll be in touch if anything else is needed.`;
}

export function contactGreeting(firstName: string | null | undefined): string {
  const name = (firstName ?? "").replace(/\s+/g, " ").trim();
  return name ? `the client, whose name is ${name}` : "the client";
}

export function missionContextLines(input: {
  practiceName: string;
  businessName: string;
  senderName: string;
  country: "ZA" | "US" | null;
  missionKey: MissionKey;
  forecastOpen: boolean;
}): string {
  const lines = [
    `Practice: ${practice(input.practiceName)}`,
    `Business: ${(input.businessName || "the business").replace(/\s+/g, " ").trim()}`,
    `Sender: ${(input.senderName || "the accountant").replace(/\s+/g, " ").trim()}`,
  ];
  if (input.country === "ZA") lines.push("Market: South Africa");
  if (input.country === "US") lines.push("Market: United States");
  if (input.missionKey === "confirm_balances" && input.forecastOpen) {
    lines.push(FORECAST_OPENING_CONTEXT);
  }
  return lines.join("\n");
}

export type SendFeedEvent =
  | { kind: "sent"; at: string }
  | { kind: "opened"; at: string }
  | { kind: "message"; at: string; role: "client" | "agent"; body: string }
  | {
      kind: "file";
      at: string;
      label: string;
      mime: string;
      fileName: string;
      documentPath: string | null;
    }
  | { kind: "done"; at: string };

export function buildSendFeed(input: {
  createdAt: string;
  openedAt?: string | null;
  completedAt?: string | null;
  messages: readonly { createdAt: string; role: "client" | "agent"; body: string }[];
  files: readonly {
    createdAt: string;
    label: string;
    mime: string;
    fileName: string;
    documentPath?: string | null;
  }[];
}): SendFeedEvent[] {
  const events: SendFeedEvent[] = [];
  if (input.createdAt) events.push({ kind: "sent", at: input.createdAt });
  if (input.openedAt) events.push({ kind: "opened", at: input.openedAt });
  for (const message of input.messages) {
    if (!message.body.trim()) continue;
    events.push({
      kind: "message",
      at: message.createdAt,
      role: message.role,
      body: message.body,
    });
  }
  for (const file of input.files) {
    events.push({
      kind: "file",
      at: file.createdAt,
      label: file.label,
      mime: file.mime,
      fileName: file.fileName,
      documentPath: file.documentPath ?? null,
    });
  }
  if (input.completedAt) events.push({ kind: "done", at: input.completedAt });
  return events;
}

/** Written when the model is unavailable. Quotes only what the client sent. */
export function fallbackMissionReport(input: {
  clientLines: readonly string[];
  fileLabels: readonly string[];
  done: boolean;
}): string {
  const said = input.clientLines.map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const answered = said.length
    ? `The client said: ${said.join(" ")}`
    : "The client has not replied in the chat.";
  const files = input.fileLabels.map((label) => label.replace(/\s+/g, " ").trim()).filter(Boolean);
  const received = files.length ? `Files: ${files.join(", ")}.` : "No files yet.";
  const open = input.done ? "The client marked the visit finished." : "The visit is still open.";
  return `${answered} ${received} ${open}`.slice(0, 2000);
}
