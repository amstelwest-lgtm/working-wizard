/**
 * Lighthouse Agent chat. Pure: the server function, the panel, and tests
 * share this. Answers are built from a snapshot of the live book. The model
 * may phrase a reply or a draft, and this module drops anything that invents
 * a firm, a count, a send, or an approval.
 *
 * auto_send stays false. From is Milōn <team@trymilon.com>. Reply-To is
 * hello@milonfinance.com. The signer is The MILŌN Team.
 */

import {
  attentionMix,
  buildDueQueue,
  buildReviewInbox,
  firmCardTitle,
  formatOpsCount,
  formatOpsPercent,
  zoneClocks,
  type AgentLead,
  type AgentTouch,
  type AttentionMix,
  type DueQueueRow,
  type ReviewItem,
  type ZoneClock,
} from "@/lib/lighthouse-agent";
import {
  ACCOUNTANT_TEASER_OWNER,
  ACCOUNTANT_TEASER_PRACTICE,
} from "@/lib/lighthouse-draft-cta";
import { LIGHTHOUSE_FROM_EMAIL } from "@/lib/lighthouse-from";
import { LIGHTHOUSE_REPLY_TO } from "@/lib/lighthouse-reply-to";
import { LIGHTHOUSE_SENDER_NAME } from "@/lib/lighthouse-sender";
import { resolveRecipientZone, type LighthouseGeo } from "@/lib/lighthouse-send-windows";
import { coldCadenceOpen } from "@/lib/lighthouse-targets";

export const LIGHTHOUSE_CHAT_FROM = `Milōn <${LIGHTHOUSE_FROM_EMAIL}>`;
export const LIGHTHOUSE_CHAT_AUTO_SEND = false as const;

export const LIGHTHOUSE_CHAT_STORAGE_PREFIX = "milon_lighthouse_agent_chat_v1";

export const LIGHTHOUSE_CHAT_PROMPTS = [
  "Who should I follow up with today?",
  "Any replies I need to handle?",
  "How's the pipeline looking?",
  "Draft a follow-up for <firm>",
] as const;

export const CHAT_TEASER_ACCOUNTANT = ACCOUNTANT_TEASER_PRACTICE;
export const CHAT_TEASER_OWNER = ACCOUNTANT_TEASER_OWNER;

const SA_DISCOUNT_LINE =
  "South African firms can take the 50% discount on this cohort.";

const QBO_XERO_LEAD =
  "QuickBooks Online and Xero plug straight in. Milōn works as an autonomous agent: it diagnoses from the numbers and produces advisory deliverables.";

const FORBIDDEN_ACTIONS = new Set([
  "send",
  "send_now",
  "auto_send",
  "approve",
  "approve_draft",
  "schedule",
  "schedule_send",
  "reject",
]);

const STAGE_ORDER = [
  "sourced",
  "researched",
  "contacted",
  "replied",
  "meeting",
  "trial",
  "activated",
  "won",
  "lost",
  "nurture",
] as const;

const STAGE_LABEL: Record<string, string> = {
  sourced: "Sourced",
  researched: "Researched",
  contacted: "In sequence",
  replied: "Replied",
  meeting: "In conversation",
  trial: "Free trial",
  activated: "Activated",
  won: "Paying",
  lost: "Lost",
  nurture: "Nurture",
};

export type ChatRole = "user" | "assistant";

export type ChatChip = {
  kind: "firm" | "queue" | "review";
  id: string;
  leadId: string;
  label: string;
};

export type ChatMessage = {
  id: string;
  role: ChatRole;
  content: string;
  chips: ChatChip[];
  createdAt: string;
};

export type ChatReply = {
  id: string;
  leadId: string;
  title: string;
  fromEmail: string;
  subject: string | null;
  receivedAt: string;
};

export type ChatFirm = {
  leadId: string;
  title: string;
  email: string | null;
  geo: LighthouseGeo;
  stage: string;
  lastTouch: string | null;
  nextTouchOn: string | null;
  nextFollowUpAt: string | null;
  delivery: string | null;
  replyStatus: string | null;
  doNotContact: boolean;
  conversationHeld?: boolean;
  sequenceStep: number;
  touches: AgentTouch[];
};

export type ChatSnapshot = {
  leadTableMissing: boolean;
  /** A read failed for a reason other than SQLSTATE 42P01. Do not call the table missing. */
  bookUnreadable: boolean;
  missingTables: string[];
  firms: ChatFirm[];
  stageCounts: Record<string, number>;
  dueQueue: DueQueueRow[];
  review: ReviewItem[];
  replies: ChatReply[];
  mix: AttentionMix;
  clocks: ZoneClock[];
  autoSend: false;
  from: string;
  replyTo: string;
  signer: string;
};

export type ChatLeadInput = {
  id: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  city?: string | null;
  country?: string | null;
  region?: string | null;
  state?: string | null;
  timezone?: string | null;
  stage?: string | null;
  doNotContact?: boolean;
  conversationHeld?: boolean;
  nextTouchOn?: string | null;
  nextFollowUpAt?: string | null;
  lastTouchAt?: string | null;
  lastDeliveryStatus?: string | null;
  lastEngagement?: string | null;
  repliedAt?: string | null;
  lastInboundAt?: string | null;
  sequenceStep?: number;
  touches?: AgentTouch[];
  inbound?: Array<{
    id: string;
    fromEmail: string;
    subject: string | null;
    receivedAt: string;
  }>;
};

export function lighthouseChatIdentity() {
  return {
    autoSend: LIGHTHOUSE_CHAT_AUTO_SEND,
    from: LIGHTHOUSE_CHAT_FROM,
    replyTo: LIGHTHOUSE_REPLY_TO,
    signer: LIGHTHOUSE_SENDER_NAME,
  };
}

export function chatStorageKey(adminKey: string): string {
  const id = adminKey.trim() || "ops";
  return `${LIGHTHOUSE_CHAT_STORAGE_PREFIX}:${id}`;
}

type ChatStorage = {
  getItem: (key: string) => string | null;
  setItem?: (key: string, value: string) => void;
  removeItem?: (key: string) => void;
};

export function readChatThread(storage: ChatStorage, adminKey: string): ChatMessage[] {
  try {
    const raw = storage.getItem(chatStorageKey(adminKey));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(normalizeStoredMessage)
      .filter((row): row is ChatMessage => row !== null)
      .slice(-40);
  } catch {
    return [];
  }
}

export function writeChatThread(storage: ChatStorage, adminKey: string, messages: ChatMessage[]): void {
  storage.setItem?.(chatStorageKey(adminKey), JSON.stringify(messages.slice(-40)));
}

export function clearChatThread(storage: ChatStorage, adminKey: string): void {
  storage.removeItem?.(chatStorageKey(adminKey));
}

function normalizeStoredMessage(value: unknown): ChatMessage | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<ChatMessage>;
  if (row.role !== "user" && row.role !== "assistant") return null;
  const content = String(row.content ?? "").trim();
  if (!content) return null;
  const chips = Array.isArray(row.chips)
    ? row.chips.filter(
        (chip): chip is ChatChip =>
          !!chip &&
          (chip.kind === "firm" || chip.kind === "queue" || chip.kind === "review") &&
          typeof chip.id === "string" &&
          typeof chip.leadId === "string" &&
          typeof chip.label === "string",
      )
    : [];
  return {
    id: String(row.id || newChatMessageId()),
    role: row.role,
    content,
    chips,
    createdAt: String(row.createdAt || new Date().toISOString()),
  };
}

export function newChatMessageId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/** Enter sends. Shift+Enter keeps the newline. */
export function composerShouldSend(key: string, shiftKey: boolean): boolean {
  return key === "Enter" && !shiftKey;
}

export function assertChatMutationAllowed(action: string | null | undefined): void {
  const key = String(action ?? "answer")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!key || key === "answer" || key === "draft" || key === "none") return;
  if (FORBIDDEN_ACTIONS.has(key)) {
    throw new Error("Lighthouse chat cannot send, approve, or schedule.");
  }
}

export function forbiddenChatAction(
  action: string | null | undefined,
): "send" | "approve" | "schedule" | null {
  const key = String(action ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (key === "send" || key === "send_now" || key === "auto_send") return "send";
  if (key === "approve" || key === "approve_draft" || key === "reject") return "approve";
  if (key === "schedule" || key === "schedule_send") return "schedule";
  return null;
}

export function saDiscountAllowed(geo: LighthouseGeo | string | null | undefined): boolean {
  return geo === "SA";
}

function toAgentLead(row: ChatLeadInput): AgentLead {
  return {
    id: row.id,
    name: row.name ?? null,
    company: row.company ?? null,
    email: row.email ?? null,
    city: row.city ?? null,
    country: row.country ?? null,
    region: row.region ?? row.state ?? null,
    state: row.state ?? row.region ?? null,
    timezone: row.timezone ?? null,
    stage: row.stage ?? "sourced",
    doNotContact: Boolean(row.doNotContact),
    conversationHeld: Boolean(row.conversationHeld),
    nextTouchOn: row.nextTouchOn ?? null,
    nextFollowUpAt: row.nextFollowUpAt ?? null,
    lastTouchAt: row.lastTouchAt ?? null,
    lastDeliveryStatus: row.lastDeliveryStatus ?? null,
    lastEngagement: row.lastEngagement ?? null,
    repliedAt: row.repliedAt ?? null,
    lastInboundAt: row.lastInboundAt ?? null,
    sequenceStep: row.sequenceStep ?? 0,
    touches: row.touches ?? [],
  };
}

export function snapshotFromBook(
  input: {
    leads: ChatLeadInput[] | null;
    missingTables?: string[];
    bookUnreadable?: boolean;
  },
  now = new Date(),
): ChatSnapshot {
  const identity = lighthouseChatIdentity();
  const missingTables = [...(input.missingTables ?? [])];
  const bookUnreadable = Boolean(input.bookUnreadable) && input.leads != null;
  if (input.leads == null) {
    return {
      leadTableMissing: true,
      bookUnreadable: false,
      missingTables,
      firms: [],
      stageCounts: {},
      dueQueue: [],
      review: [],
      replies: [],
      mix: { us: 0, sa: 0, other: 0, usPct: 0, saPct: 0 },
      clocks: zoneClocks([], now),
      ...identity,
    };
  }

  const agents = input.leads.map(toAgentLead);
  const firms: ChatFirm[] = input.leads.map((row, index) => {
    const agent = agents[index];
    const replyStatus =
      (row.lastEngagement ?? "").trim() ||
      (row.repliedAt || row.lastInboundAt ? "replied" : null);
    return {
      leadId: row.id,
      title: firmCardTitle(agent),
      email: row.email ?? null,
      geo: resolveRecipientZone(agent).geo,
      stage: agent.stage,
      lastTouch: row.lastTouchAt ?? null,
      nextTouchOn: row.nextTouchOn ?? null,
      nextFollowUpAt: row.nextFollowUpAt ?? null,
      delivery: row.lastDeliveryStatus ?? null,
      replyStatus,
      doNotContact: agent.doNotContact,
      conversationHeld: Boolean(row.conversationHeld),
      sequenceStep: agent.sequenceStep,
      touches: agent.touches,
    };
  });

  const stageCounts: Record<string, number> = {};
  for (const stage of STAGE_ORDER) stageCounts[stage] = 0;
  for (const firm of firms) stageCounts[firm.stage] = (stageCounts[firm.stage] ?? 0) + 1;

  const replies: ChatReply[] = [];
  for (const row of input.leads) {
    const title = firms.find((firm) => firm.leadId === row.id)?.title ?? row.id;
    for (const inbound of row.inbound ?? []) {
      replies.push({
        id: inbound.id,
        leadId: row.id,
        title,
        fromEmail: inbound.fromEmail,
        subject: inbound.subject,
        receivedAt: inbound.receivedAt,
      });
    }
    if ((row.inbound ?? []).length === 0 && (row.repliedAt || row.lastInboundAt)) {
      replies.push({
        id: `reply-${row.id}`,
        leadId: row.id,
        title,
        fromEmail: row.email ?? "",
        subject: null,
        receivedAt: row.lastInboundAt || row.repliedAt || "",
      });
    }
  }
  replies.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

  return {
    leadTableMissing: false,
    bookUnreadable,
    missingTables,
    firms,
    stageCounts,
    dueQueue: buildDueQueue(agents, now),
    review: buildReviewInbox(agents),
    replies: replies.slice(0, 12),
    mix: attentionMix(agents, now),
    clocks: zoneClocks(agents, now),
    ...identity,
  };
}

export function formatContextBlock(snapshot: ChatSnapshot): string {
  const lines: string[] = [
    `auto_send: ${snapshot.autoSend ? "true" : "false"}`,
    `From: ${snapshot.from}`,
    `Reply-To: ${snapshot.replyTo}`,
    `Signer: ${snapshot.signer}`,
  ];
  if (snapshot.bookUnreadable) {
    lines.push("LEAD_BOOK: unread");
  } else if (snapshot.leadTableMissing) {
    lines.push("LEAD_BOOK: missing");
  } else {
    lines.push(`FIRM_COUNT: ${formatOpsCount(snapshot.firms.length)}`);
    lines.push(
      `STAGES: ${STAGE_ORDER.map((stage) => `${stage} ${formatOpsCount(snapshot.stageCounts[stage] ?? 0)}`).join(", ")}`,
    );
  }
  lines.push(`FOLLOW_UPS_DUE: ${formatOpsCount(snapshot.dueQueue.length)}`);
  lines.push(`REVIEW_INBOX: ${formatOpsCount(snapshot.review.length)}`);
  lines.push(`INBOUND_REPLIES: ${formatOpsCount(snapshot.replies.length)}`);
  if (snapshot.missingTables.length) {
    lines.push(`MISSING_TABLES: ${snapshot.missingTables.join(", ")}`);
  } else {
    lines.push("MISSING_TABLES: none");
  }
  lines.push(
    `US_SA_MIX: US ${formatOpsPercent(snapshot.mix.usPct)} (${formatOpsCount(snapshot.mix.us)}) / SA ${formatOpsPercent(snapshot.mix.saPct)} (${formatOpsCount(snapshot.mix.sa)}) this week. Target about 80/20.`,
  );
  lines.push("WINDOWS:");
  for (const clock of snapshot.clocks) {
    lines.push(
      `- ${clock.zone} ${clock.open ? "Open" : clock.countdownLabel} · due now ${formatOpsCount(clock.dueNow)} · queue ${formatOpsCount(clock.due)}`,
    );
  }
  lines.push("DUE_QUEUE:");
  if (!snapshot.dueQueue.length) lines.push("- none");
  for (const row of snapshot.dueQueue.slice(0, 20)) {
    lines.push(
      `- ${row.leadId} | ${row.title} | ${row.geo} | ${row.zone ?? "—"} | ${row.open ? "open" : "closed"} | ${row.countdownLabel}`,
    );
  }
  lines.push("REVIEW:");
  if (!snapshot.review.length) lines.push("- none");
  for (const item of snapshot.review.slice(0, 20)) {
    lines.push(
      `- ${item.touchId} | ${item.leadId} | ${item.title} | ${item.subject} | ${item.status}`,
    );
  }
  lines.push("REPLIES:");
  if (!snapshot.replies.length) lines.push("- none");
  for (const reply of snapshot.replies.slice(0, 12)) {
    lines.push(
      `- ${reply.leadId} | ${reply.title} | ${reply.fromEmail || "—"} | ${reply.subject ?? "(no subject)"} | ${reply.receivedAt || "—"}`,
    );
  }
  lines.push("E16_CADENCE:");
  if (!snapshot.firms.length) lines.push("- none");
  for (const firm of snapshot.firms.slice(0, 20)) {
    lines.push(
      `- ${firm.leadId} | last touch ${firm.lastTouch ?? "—"} | delivery ${firm.delivery ?? "—"} | engagement ${firm.replyStatus ?? "—"} | next follow-up ${firm.nextFollowUpAt ?? firm.nextTouchOn ?? "—"}`,
    );
  }
  lines.push("FIRMS:");
  if (!snapshot.firms.length) lines.push("- none");
  for (const firm of snapshot.firms.slice(0, 40)) {
    lines.push(
      [
        firm.leadId,
        firm.title,
        firm.geo,
        firm.stage,
        firm.lastTouch ?? "—",
        firm.nextTouchOn ?? "—",
        firm.nextFollowUpAt ?? "—",
        firm.delivery ?? "—",
        firm.replyStatus ?? "—",
      ].join(" | "),
    );
  }
  return lines.join("\n");
}

export function chatSystemPrompt(): string {
  return `You are the Lighthouse operator assistant on /ops. You talk to the ops admin about the book in the context block. You do not send, approve, or schedule email.

Locks:
- auto_send is false. Never claim it is on.
- From is ${LIGHTHOUSE_CHAT_FROM} only.
- Reply-To is ${LIGHTHOUSE_REPLY_TO} only.
- Sign every draft as ${LIGHTHOUSE_SENDER_NAME} only. Never a founder or a person's name.
- Never mention Outsourced CFO or OCFO, or any employer.
- Never name a model, Claude, or Anthropic.
- Use only firms and numbers that appear in the context. If the book is empty or a table is missing, say so. Do not invent firms or counts.
- The path is due queue, then a draft for human review, then E16 cadence (last touch, delivery, engagement, next follow-up), then E17 send windows. US/SA attention target is about 80/20.
- One next action.

When you draft, the body is plain text, short, and human.
- Lead with QuickBooks Online and Xero plug-and-play, and Milōn as an autonomous agent that diagnoses from the numbers and produces advisory deliverables.
- Include both teasers when a draft is the right move: ${CHAT_TEASER_ACCOUNTANT} and ${CHAT_TEASER_OWNER}.
- Mention the South African 50% discount only when the firm geo is SA. Never mention it for a US firm.
- action must be "answer" or "draft". Never "send", "approve", or "schedule".

Return ONLY JSON: {"reply":"...","action":"answer","chips":[{"kind":"firm","id":"...","label":"..."}],"draft":null}`;
}

function stageLine(snapshot: ChatSnapshot): string {
  return STAGE_ORDER.map(
    (stage) => `${STAGE_LABEL[stage] ?? stage} ${formatOpsCount(snapshot.stageCounts[stage] ?? 0)}`,
  ).join(", ");
}

export const CHAT_TABLE_MISSING_COPY = "not in this database yet";
export const CHAT_BOOK_UNREADABLE = "I couldn't read the lead book just now.";

function missingNote(snapshot: ChatSnapshot): string {
  if (snapshot.bookUnreadable || !snapshot.missingTables.length) return "";
  return `${snapshot.missingTables.join(", ")} ${snapshot.missingTables.length === 1 ? "is" : "are"} ${CHAT_TABLE_MISSING_COPY}, so those fields are blank. Counts below use the rows that are actually there.`;
}

function assistantAlreadySaid(
  history: Array<{ role: ChatRole; content: string }> | undefined,
  pattern: RegExp,
): boolean {
  return (history ?? []).some((row) => row.role === "assistant" && pattern.test(row.content));
}

export function nextAction(snapshot: ChatSnapshot): { text: string; chips: ChatChip[] } {
  if (snapshot.leadTableMissing) {
    return {
      text: "Next: Import cohort once the lead book is available, or Run plan (dry-run).",
      chips: [],
    };
  }
  if (snapshot.firms.length === 0) {
    return { text: "Next: Import cohort, or Run plan (dry-run).", chips: [] };
  }
  const pending = snapshot.review.find((item) => item.status === "draft");
  if (pending) {
    return {
      text: `Next: review the draft for ${pending.title}. Chat cannot approve or send it.`,
      chips: [
        {
          kind: "review",
          id: pending.touchId,
          leadId: pending.leadId,
          label: `Review · ${pending.title}`,
        },
      ],
    };
  }
  const dueOpen = snapshot.dueQueue.find((row) => row.open);
  if (dueOpen) {
    return {
      text: `Next: open ${dueOpen.title}. Their send window is open.`,
      chips: [
        { kind: "queue", id: dueOpen.leadId, leadId: dueOpen.leadId, label: dueOpen.title },
      ],
    };
  }
  const due = snapshot.dueQueue[0];
  if (due) {
    return {
      text: `Next: open ${due.title}. The window is closed (${due.countdownLabel}).`,
      chips: [{ kind: "queue", id: due.leadId, leadId: due.leadId, label: due.title }],
    };
  }
  const reply = snapshot.replies[0];
  if (reply) {
    return {
      text: `Next: handle the reply from ${reply.title}.`,
      chips: [{ kind: "firm", id: reply.leadId, leadId: reply.leadId, label: reply.title }],
    };
  }
  return {
    text: "Next: Run plan (dry-run). Nothing is due and nothing is waiting for review.",
    chips: [],
  };
}

type ChatIntent = "draft" | "replies" | "pipeline" | "followup" | "general";

export function chatIntent(message: string): ChatIntent {
  const text = message.toLowerCase();
  if (/\bdraft\b/.test(text)) return "draft";
  if (/repl(y|ies)|inbound/.test(text)) return "replies";
  if (/pipeline|how.?s the book|attention|80\/20|\bmix\b/.test(text)) return "pipeline";
  if (/follow|who should|\bdue\b|today/.test(text)) return "followup";
  return "general";
}

function listDue(snapshot: ChatSnapshot): string {
  if (!snapshot.dueQueue.length) return "Nothing is due inside a send window.";
  const rows = snapshot.dueQueue.slice(0, 5).map((row) => {
    const when = row.open ? "window open" : `${row.zone ?? "—"} · ${row.countdownLabel}`;
    return `${row.title} (${row.geo}, ${when})`;
  });
  const extra = snapshot.dueQueue.length - rows.length;
  return `Due: ${rows.join("; ")}${extra > 0 ? `; and ${formatOpsCount(extra)} more` : ""}.`;
}

function listReplies(snapshot: ChatSnapshot): string {
  if (!snapshot.replies.length) return "No replies are waiting.";
  const rows = snapshot.replies.slice(0, 5).map((reply) => {
    const subject = reply.subject?.trim() || "no subject";
    return `${reply.title} (${subject})`;
  });
  return `Replies to handle: ${rows.join("; ")}.`;
}

function mixLine(snapshot: ChatSnapshot): string {
  return `US/SA attention this week is ${formatOpsPercent(snapshot.mix.usPct)} / ${formatOpsPercent(snapshot.mix.saPct)} (${formatOpsCount(snapshot.mix.us)} US / ${formatOpsCount(snapshot.mix.sa)} SA). Target is about 80/20.`;
}

export function answerFromSnapshot(
  message: string,
  snapshot: ChatSnapshot,
  history?: Array<{ role: ChatRole; content: string }>,
): {
  reply: string;
  chips: ChatChip[];
  intent: ChatIntent;
} {
  const intent = chatIntent(message);
  const action = nextAction(snapshot);
  const parts: string[] = [];

  if (snapshot.bookUnreadable) {
    const already = assistantAlreadySaid(history, /couldn't read the lead book|Nothing new until the book loads/i);
    return {
      reply: already
        ? "Nothing new until the book loads. I won't guess firms or counts."
        : CHAT_BOOK_UNREADABLE,
      chips: [],
      intent,
    };
  }

  const note = missingNote(snapshot);
  const missingAlreadySaid = assistantAlreadySaid(history, new RegExp(CHAT_TABLE_MISSING_COPY, "i"));
  if (note && !missingAlreadySaid) parts.push(note);

  if (snapshot.leadTableMissing) {
    const leadAlreadySaid = assistantAlreadySaid(history, /lead book is missing/i);
    if (!leadAlreadySaid) {
      parts.push(
        "The lead book is missing, so there is nothing to count. I will not guess firms or numbers.",
      );
    }
    parts.push(action.text);
    return { reply: parts.filter(Boolean).join("\n\n"), chips: action.chips, intent };
  }

  if (snapshot.firms.length === 0) {
    parts.push(
      "The book is empty. No firms, no due queue, no replies, and no drafts waiting. I will not invent any.",
    );
    parts.push(action.text);
    return { reply: parts.join("\n\n"), chips: action.chips, intent };
  }

  if (intent === "followup") {
    parts.push(listDue(snapshot));
  } else if (intent === "replies") {
    parts.push(listReplies(snapshot));
    const pending = snapshot.review.filter((item) => item.status === "draft").length;
    parts.push(`${formatOpsCount(pending)} draft${pending === 1 ? "" : "s"} waiting in the review inbox.`);
  } else if (intent === "pipeline" || intent === "general") {
    parts.push(
      `${formatOpsCount(snapshot.firms.length)} firm${snapshot.firms.length === 1 ? "" : "s"}. ${stageLine(snapshot)}.`,
    );
    parts.push(mixLine(snapshot));
    parts.push(listDue(snapshot));
    if (intent === "pipeline") parts.push(listReplies(snapshot));
  } else if (intent === "draft") {
    parts.push("Say which firm and I will put a draft in the review inbox. I will not send it.");
  }

  if (intent !== "draft") parts.push(action.text);
  return { reply: parts.filter(Boolean).join("\n\n"), chips: action.chips, intent };
}

export function firmNamedInMessage(message: string, firms: ChatFirm[]): ChatFirm | null {
  const text = message.toLowerCase();
  const hits = firms
    .map((firm) => ({ firm, name: firm.title.trim().toLowerCase() }))
    .filter((hit) => hit.name.length > 1 && hit.name !== "unnamed" && text.includes(hit.name))
    .sort((a, b) => b.name.length - a.name.length);
  return hits[0]?.firm ?? null;
}

export function nextDraftStep(firm: ChatFirm): number {
  const sent = new Set(
    firm.touches
      .filter((touch) => touch.sentAt || touch.status === "sent" || touch.status === "approved")
      .map((touch) => touch.stepNo),
  );
  let step = Math.max(1, (firm.sequenceStep || 0) + 1);
  while (sent.has(step) && step < 8) step += 1;
  return Math.min(8, step);
}

export function composeFollowUpDraft(firm: ChatFirm): { subject: string; body: string } {
  const greeting = "Hi,";
  const sa = saDiscountAllowed(firm.geo) ? `\n${SA_DISCOUNT_LINE}\n` : "";
  const body = `${greeting}

${QBO_XERO_LEAD}

Two short clips, one for the accountant and one for the owner:
${CHAT_TEASER_ACCOUNTANT}
${CHAT_TEASER_OWNER}
${sa}
Worth a reply if that is the gap at ${firm.title}?

${LIGHTHOUSE_SENDER_NAME}`;
  return { subject: "QuickBooks, Xero, and the books", body: body.replace(/\n{3,}/g, "\n\n").trim() };
}

const BANNED_DRAFT =
  /\b(outsourced\s+cfo|ocfo|theo|westhuizen|founder|claude|anthropic)\b/i;

export function lockChatDraft(input: {
  subject: string;
  body: string;
  geo: LighthouseGeo;
  firmTitle: string;
}): {
  subject: string;
  body: string;
  from: string;
  replyTo: string;
  signer: string;
  status: "draft";
} {
  let body = input.body.replace(/\r\n/g, "\n");
  body = body
    .split("\n")
    .filter((line) => !BANNED_DRAFT.test(line))
    .filter((line) => (saDiscountAllowed(input.geo) ? true : !/50\s*%|discount/i.test(line)))
    .join("\n");
  body = body.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "");
  body = body.replace(/[!]{1,}/g, ".");
  body = body.replace(
    /\n*(the mil[oō]n team|best regards|kind regards|regards|thanks|thank you|cheers)[,.]?\s*$/i,
    "",
  );
  body = body.replace(/\n{3,}/g, "\n\n").trim();

  if (!/quickbooks/i.test(body) || !/xero/i.test(body) || !/autonomous agent/i.test(body)) {
    body = `${QBO_XERO_LEAD}\n\n${body}`.trim();
  }
  if (!body.includes(CHAT_TEASER_ACCOUNTANT) || !body.includes(CHAT_TEASER_OWNER)) {
    body = `${body}\n\nAccountant: ${CHAT_TEASER_ACCOUNTANT}\nOwner: ${CHAT_TEASER_OWNER}`.trim();
  }
  if (saDiscountAllowed(input.geo) && !/50\s*%/.test(body)) {
    body = `${body}\n\n${SA_DISCOUNT_LINE}`.trim();
  }
  if (!saDiscountAllowed(input.geo)) {
    body = body
      .split("\n")
      .filter((line) => !/50\s*%|discount/i.test(line))
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  body = `${body}\n\n${LIGHTHOUSE_SENDER_NAME}`;

  let subject = input.subject
    .replace(new RegExp(BANNED_DRAFT.source, "gi"), "")
    .replace(/[!]/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/\s+([,.:])/g, "$1")
    .trim();
  if (!saDiscountAllowed(input.geo)) subject = subject.replace(/50\s*%|discount/gi, "").trim();
  if (!subject || /^(a note from,?|hi,?|hello,?)$/i.test(subject)) {
    subject = "QuickBooks, Xero, and the books";
  }
  if (subject.length > 120) subject = subject.slice(0, 120).trim();

  return {
    subject,
    body,
    from: LIGHTHOUSE_CHAT_FROM,
    replyTo: LIGHTHOUSE_REPLY_TO,
    signer: LIGHTHOUSE_SENDER_NAME,
    status: "draft",
  };
}

export type ChatModelPayload = {
  reply: string;
  action: string;
  chips: Array<{ kind: string; id: string; label: string }>;
  draft: { leadId: string; subject: string; body: string } | null;
};

export function parseChatModelPayload(raw: string): ChatModelPayload | null {
  const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]) as {
      reply?: unknown;
      action?: unknown;
      chips?: unknown;
      draft?: unknown;
    };
    const draftRaw = parsed.draft;
    let draft: ChatModelPayload["draft"] = null;
    if (draftRaw && typeof draftRaw === "object") {
      const row = draftRaw as { leadId?: unknown; subject?: unknown; body?: unknown };
      const leadId = String(row.leadId ?? "").trim();
      const subject = String(row.subject ?? "").trim();
      const body = String(row.body ?? "").trim();
      if (leadId && (subject || body)) draft = { leadId, subject, body };
    }
    const chips = Array.isArray(parsed.chips)
      ? parsed.chips
          .map((chip) => {
            const row = chip as { kind?: unknown; id?: unknown; label?: unknown };
            return {
              kind: String(row.kind ?? ""),
              id: String(row.id ?? ""),
              label: String(row.label ?? ""),
            };
          })
          .filter((chip) => chip.id)
      : [];
    return {
      reply: String(parsed.reply ?? "").trim(),
      action: String(parsed.action ?? "answer").trim() || "answer",
      chips,
      draft,
    };
  } catch {
    return null;
  }
}

const ALLOWED_PHRASES = [
  "quickbooks online",
  "quickbooks",
  "south africa",
  "south african",
  "united states",
  "the milōn team",
  "import cohort",
  "run plan",
  "review inbox",
  "send now",
];

export function replyIsGrounded(reply: string, snapshot: ChatSnapshot, factual: string): boolean {
  const allowedText = `${factual}\n${formatContextBlock(snapshot)}`.toLowerCase();
  const numbers = reply.match(/\d+(?:\.\d+)?%?/g) ?? [];
  if (numbers.some((value) => !allowedText.includes(value.toLowerCase()) && !factual.includes(value))) {
    return false;
  }
  const names = reply.match(/\b[A-Z][a-z]+(?:\s+[A-Z][A-Za-z0-9&]+)+\b/g) ?? [];
  const known = snapshot.firms.map((firm) => firm.title.toLowerCase());
  for (const name of names) {
    const key = name.toLowerCase();
    if (known.some((title) => title.includes(key) || key.includes(title))) continue;
    if (ALLOWED_PHRASES.some((phrase) => phrase.includes(key) || key.includes(phrase))) continue;
    return false;
  }
  return true;
}

export function knownChips(
  chips: Array<{ kind: string; id: string; label?: string }>,
  snapshot: ChatSnapshot,
): ChatChip[] {
  const out: ChatChip[] = [];
  for (const chip of chips) {
    if (chip.kind === "review") {
      const item = snapshot.review.find((row) => row.touchId === chip.id);
      if (!item) continue;
      out.push({
        kind: "review",
        id: item.touchId,
        leadId: item.leadId,
        label: `Review · ${item.title}`,
      });
      continue;
    }
    if (chip.kind === "queue" || chip.kind === "firm") {
      const firm = snapshot.firms.find((row) => row.leadId === chip.id);
      const due = snapshot.dueQueue.find((row) => row.leadId === chip.id);
      if (!firm && !due) continue;
      out.push({
        kind: chip.kind,
        id: chip.id,
        leadId: chip.id,
        label: firm?.title || due?.title || chip.id,
      });
    }
  }
  return out.slice(0, 4);
}

export type ChatTurnResult = {
  reply: string;
  chips: ChatChip[];
  draft: null | {
    touchId: string;
    leadId: string;
    subject: string;
    status: "draft";
    from: string;
    replyTo: string;
    signer: string;
  };
  refusedAction: "send" | "approve" | "schedule" | null;
};

export type ChatDraftWrite = {
  leadId: string;
  stepNo: number;
  angle: string;
  subject: string;
  body: string;
  createdBy: string;
  action: "draft";
};

function userAskedForbiddenAction(message: string): "send" | "approve" | "schedule" | null {
  const text = message.toLowerCase();
  if (/\bdraft a\b/.test(text) && !/\b(approve|schedule|send)\b/.test(text)) return null;
  if (/\bapprove\b/.test(text)) return "approve";
  if (/\bschedule\b/.test(text)) return "schedule";
  if (/\bsend\b/.test(text)) return "send";
  return null;
}

export async function runLighthouseChatTurn(input: {
  message: string;
  history?: Array<{ role: ChatRole; content: string }>;
  snapshot: ChatSnapshot;
  createdBy: string;
  now?: Date;
  complete?: (prompt: string) => Promise<string>;
  persistDraft?: (write: ChatDraftWrite) => Promise<{ touchId: string; status: "draft" }>;
}): Promise<ChatTurnResult> {
  const asked = userAskedForbiddenAction(input.message);
  if (asked) {
    return {
      reply: "I can't send, approve, or schedule from chat. Approve the draft in the review inbox, then use Send now.",
      chips: nextAction(input.snapshot).chips,
      draft: null,
      refusedAction: asked,
    };
  }
  const factual = answerFromSnapshot(input.message, input.snapshot, input.history);
  let reply = factual.reply;
  let chips = factual.chips;
  let refusedAction: ChatTurnResult["refusedAction"] = null;
  let modelDraft: { leadId: string; subject: string; body: string } | null = null;

  if (input.complete && !input.snapshot.leadTableMissing && !input.snapshot.bookUnreadable) {
    const history = (input.history ?? [])
      .slice(-8)
      .map((row) => `${row.role}: ${row.content}`)
      .join("\n");
    const prompt = `${chatSystemPrompt()}

CONTEXT
${formatContextBlock(input.snapshot)}

THREAD
${history || "(none)"}

USER
${input.message}`;
    try {
      const raw = await input.complete(prompt);
      const parsed = parseChatModelPayload(raw);
      if (parsed) {
        const blocked = forbiddenChatAction(parsed.action);
        if (blocked) {
          refusedAction = blocked;
        } else if (parsed.reply && replyIsGrounded(parsed.reply, input.snapshot, factual.reply)) {
          reply = parsed.reply;
          const groundedChips = knownChips(parsed.chips, input.snapshot);
          if (groundedChips.length) chips = groundedChips;
        }
        if (!blocked && (parsed.action === "draft" || parsed.draft)) modelDraft = parsed.draft;
      }
    } catch {
      // A model miss falls back to the snapshot answer. Do not surface vendor errors.
    }
  }

  if (refusedAction) {
    return {
      reply: "I can't send, approve, or schedule from chat. Approve the draft in the review inbox, then use Send now.",
      chips,
      draft: null,
      refusedAction,
    };
  }

  if (factual.intent !== "draft") {
    return { reply, chips, draft: null, refusedAction: null };
  }

  const named =
    firmNamedInMessage(input.message, input.snapshot.firms) ||
    (modelDraft
      ? input.snapshot.firms.find((firm) => firm.leadId === modelDraft?.leadId) ?? null
      : null);
  if (!named) {
    return {
      reply: input.snapshot.firms.length
        ? "Name the firm and I will draft the follow-up. I will not invent one, and I will not send it."
        : factual.reply,
      chips: factual.chips,
      draft: null,
      refusedAction: null,
    };
  }
  if (named.doNotContact) {
    return {
      reply: `${named.title} is suppressed. I will not draft for them.`,
      chips: [{ kind: "firm", id: named.leadId, leadId: named.leadId, label: named.title }],
      draft: null,
      refusedAction: null,
    };
  }
  if (!coldCadenceOpen(named)) {
    return {
      reply: `Call / meeting held for ${named.title}. I will not draft another cold step.`,
      chips: [{ kind: "firm", id: named.leadId, leadId: named.leadId, label: named.title }],
      draft: null,
      refusedAction: null,
    };
  }

  const seed =
    modelDraft && modelDraft.leadId === named.leadId
      ? { subject: modelDraft.subject, body: modelDraft.body }
      : composeFollowUpDraft(named);
  const locked = lockChatDraft({
    subject: seed.subject,
    body: seed.body,
    geo: named.geo,
    firmTitle: named.title,
  });
  if (!input.persistDraft) {
    return {
      reply: `Draft for ${named.title} is ready to save as pending. Nothing was sent.`,
      chips: [{ kind: "firm", id: named.leadId, leadId: named.leadId, label: named.title }],
      draft: {
        touchId: "",
        leadId: named.leadId,
        subject: locked.subject,
        status: "draft",
        from: locked.from,
        replyTo: locked.replyTo,
        signer: locked.signer,
      },
      refusedAction: null,
    };
  }

  const saved = await input.persistDraft({
    leadId: named.leadId,
    stepNo: nextDraftStep(named),
    angle: "observation",
    subject: locked.subject,
    body: locked.body,
    createdBy: input.createdBy,
    action: "draft",
  });
  if (saved.status !== "draft") {
    throw new Error("Lighthouse chat cannot send, approve, or schedule.");
  }
  return {
    reply: `Draft for ${named.title} is in the review inbox as pending. Nothing was sent. Approve it there, then Send now if the window is open.`,
    chips: [{ kind: "firm", id: named.leadId, leadId: named.leadId, label: named.title }],
    draft: {
      touchId: saved.touchId,
      leadId: named.leadId,
      subject: locked.subject,
      status: "draft",
      from: locked.from,
      replyTo: locked.replyTo,
      signer: locked.signer,
    },
    refusedAction: null,
  };
}

/** Non-admins get a 403. The server function uses this around the ops gate. */
export function denyOpsChat(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Forbidden";
  return new Response(message, { status: 403 });
}

export async function requireLighthouseChatAdmin<T>(
  ctx: T,
  assertAccess: (ctx: T) => Promise<unknown>,
): Promise<unknown> {
  try {
    return await assertAccess(ctx);
  } catch (error) {
    throw denyOpsChat(error);
  }
}
