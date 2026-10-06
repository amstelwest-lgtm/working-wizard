/**
 * Lighthouse Agent chat on /ops.
 * Run: pnpm test:lighthouse-agent-chat
 *
 * Covers the admin 403 gate, empty and missing-table grounding, a draft that
 * lands as pending review, the chat path refusing send/approve, the
 * signer / From / Reply-To locks, and the SA discount staying off US firms.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LighthouseAgentChatView } from "../src/components/lighthouse-agent-chat";
import {
  LIGHTHOUSE_CHAT_FROM,
  LIGHTHOUSE_CHAT_PROMPTS,
  assertChatMutationAllowed,
  chatIntent,
  chatStorageKey,
  chatSystemPrompt,
  clearChatThread,
  composerShouldSend,
  lighthouseChatIdentity,
  lockChatDraft,
  readChatThread,
  replyIsGrounded,
  requireLighthouseChatAdmin,
  runLighthouseChatTurn,
  formatContextBlock,
  snapshotFromBook,
  writeChatThread,
  type ChatLeadInput,
  type ChatSnapshot,
} from "../src/lib/lighthouse-agent-chat";
import {
  isUndefinedTableError,
  loadLighthouseChatSnapshot,
} from "../src/lib/lighthouse-agent-chat.functions";
import {
  pendingDraftPayload,
  persistPendingLighthouseDraft,
} from "../src/lib/lighthouse-draft-persist";
import { LIGHTHOUSE_FROM_EMAIL } from "../src/lib/lighthouse-from";
import { LIGHTHOUSE_REPLY_TO } from "../src/lib/lighthouse-reply-to";
import { LIGHTHOUSE_SENDER_NAME } from "../src/lib/lighthouse-sender";
import { CHAT_TEASER_ACCOUNTANT, CHAT_TEASER_OWNER } from "../src/lib/lighthouse-agent-chat";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const NOW = new Date("2026-10-06T13:00:00Z");

function lead(partial: Partial<ChatLeadInput> & Pick<ChatLeadInput, "id" | "company">): ChatLeadInput {
  return {
    name: "Sam Lee",
    email: "sam@example.com",
    stage: "contacted",
    nextTouchOn: "2026-10-01",
    lastTouchAt: "2026-09-20T12:00:00Z",
    sequenceStep: 0,
    touches: [],
    inbound: [],
    doNotContact: false,
    ...partial,
  };
}

const usLead = lead({
  id: "11111111-1111-4111-8111-111111111111",
  company: "Acme Plumbing",
  country: "US",
  region: "NY",
});

const saLead = lead({
  id: "22222222-2222-4222-8222-222222222222",
  company: "Cape Books",
  name: "Aneesa Naidoo",
  email: "aneesa@capebooks.example",
  country: "SA",
  city: "Cape Town",
});

function book(leads: ChatLeadInput[] | null, missingTables: string[] = []): ChatSnapshot {
  return snapshotFromBook({ leads, missingTables }, NOW);
}

function memoryStorage() {
  const rows = new Map<string, string>();
  return {
    rows,
    getItem: (key: string) => rows.get(key) ?? null,
    setItem: (key: string, value: string) => {
      rows.set(key, value);
    },
    removeItem: (key: string) => {
      rows.delete(key);
    },
  };
}

function scriptedAdmin(
  script: Record<string, { data: unknown; error: { message: string } | null }>,
) {
  return {
    from(table: string) {
      const result = script[table] ?? { data: [], error: null };
      const builder = {
        select() {
          return builder;
        },
        order() {
          return builder;
        },
        limit() {
          return builder;
        },
        then(
          onFulfilled: (value: typeof result) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          return Promise.resolve(result).then(onFulfilled, onRejected);
        },
      };
      return builder;
    },
  };
}

const MISSING = {
  data: null,
  error: { code: "42P01", message: 'relation "public.lighthouse_firms" does not exist' },
};

function touchAdmin(existing: { id: string; status?: string; sent_at?: string | null } | null = null) {
  const writes: Array<{ op: string; row?: Record<string, unknown>; patch?: Record<string, unknown> }> = [];
  const admin = {
    writes,
    from() {
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: async () => ({ data: existing, error: null }),
        update(patch: Record<string, unknown>) {
          writes.push({ op: "update", patch });
          return { eq: async () => ({ error: null }) };
        },
        insert(row: Record<string, unknown>) {
          writes.push({ op: "insert", row });
          return {
            select() {
              return { maybeSingle: async () => ({ data: { id: "touch-new" }, error: null }) };
            },
          };
        },
      };
      return api;
    },
  };
  return admin;
}

// --- Locks -----------------------------------------------------------------

const identity = lighthouseChatIdentity();
assert(identity.autoSend === false, "auto_send stays false");
assert(identity.from === "Milōn <team@trymilon.com>", "From is Milōn <team@trymilon.com>");
assert(identity.from === LIGHTHOUSE_CHAT_FROM, "From constant matches the header");
assert(identity.from.endsWith(`<${LIGHTHOUSE_FROM_EMAIL}>`), "From mailbox is team@trymilon.com");
assert(identity.replyTo === "hello@milonfinance.com", "Reply-To is hello@");
assert(identity.replyTo === LIGHTHOUSE_REPLY_TO, "Reply-To constant");
assert(identity.signer === "The MILŌN Team", "signer is The MILŌN Team");
assert(identity.signer === LIGHTHOUSE_SENDER_NAME, "signer constant");

const prompt = chatSystemPrompt();
assert(prompt.includes("Milōn <team@trymilon.com>"), "prompt locks From");
assert(prompt.includes("hello@milonfinance.com"), "prompt locks Reply-To");
assert(prompt.includes("The MILŌN Team"), "prompt locks the signer");
assert(prompt.includes("auto_send is false"), "prompt locks auto_send");
assert(/never send, approve, or schedule/i.test(prompt) || prompt.includes('Never "send"'), "prompt forbids send");
assert(prompt.includes(CHAT_TEASER_ACCOUNTANT) && prompt.includes("https://youtu.be/J4vJki7HcIs"), "accountant teaser");
assert(prompt.includes(CHAT_TEASER_OWNER) && prompt.includes("https://youtu.be/k3aRM4toTvU"), "owner teaser");
assert(/50% discount only when the firm geo is SA/i.test(prompt), "SA discount is SA-only in the prompt");
assert(/outsourced cfo/i.test(prompt), "prompt bans OCFO wording");
assert(!/claude|anthropic/i.test(prompt.replace(/Never name a model, Claude, or Anthropic\./, "")), "prompt does not brand the model");

// --- Admin gate ------------------------------------------------------------

{
  let threw = false;
  try {
    await requireLighthouseChatAdmin({ userId: "stranger" }, async () => {
      throw new Error("Forbidden — this console is locked to the platform owner and Milōn IT.");
    });
  } catch (error) {
    threw = true;
    assert(error instanceof Response, "non-admin denial is an HTTP response");
    assert((error as Response).status === 403, "non-admin gets 403");
    const text = await (error as Response).text();
    assert(/forbidden/i.test(text), "403 body says forbidden");
  }
  assert(threw, "non-admin does not enter the handler");
}

{
  const gate = await requireLighthouseChatAdmin({ userId: "theo" }, async (ctx) => ctx);
  assert((gate as { userId: string }).userId === "theo", "admin gate returns the caller");
}

const fnSrc = readFileSync(resolve("src/lib/lighthouse-agent-chat.functions.ts"), "utf8");
const chatSrc = readFileSync(resolve("src/lib/lighthouse-agent-chat.ts"), "utf8");
const persistSrc = readFileSync(resolve("src/lib/lighthouse-draft-persist.ts"), "utf8");
const panelSrc = readFileSync(resolve("src/components/lighthouse-panel.tsx"), "utf8");
const uiSrc = readFileSync(resolve("src/components/lighthouse-agent-chat.tsx"), "utf8");
const draftSrc = readFileSync(resolve("src/lib/lighthouse.functions.ts"), "utf8");

assert(fnSrc.includes("assertOpsConsoleAccess"), "chat server fn uses the ops admin gate");
assert(fnSrc.includes("loadLighthouseWorkbenchBook"), "chat reads leads through the workbench loader");
assert(fnSrc.includes("isUndefinedTableError"), "chat classifies a missing table itself");
assert(/code === "42P01"/.test(fnSrc), "only SQLSTATE 42P01 is a missing table");
assert(!fnSrc.includes("country, region, timezone"), "chat does not select geo columns off milon_ops_leads");
assert(!fnSrc.includes("missingRelation"), "chat does not treat every relation error as a missing table");
assert(isUndefinedTableError({ code: "42P01" }), "42P01 is an undefined table");
assert(!isUndefinedTableError({ code: "42703", message: "column country does not exist" } as { code: string }), "a missing column is not a missing table");
assert(!isUndefinedTableError({ code: "42501" }), "an RLS denial is not a missing table");
assert(fnSrc.includes("requireLighthouseChatAdmin"), "chat server fn turns a denial into 403");
assert(fnSrc.includes("requireSupabaseAuth"), "chat server fn requires a session");
assert(!fnSrc.includes("sendLighthouseTouch"), "chat server fn does not call send");
assert(!fnSrc.includes("reviewLighthouseTouch"), "chat server fn does not call approve");
assert(!fnSrc.includes("resend.com"), "chat server fn does not talk to Resend");
assert(!/status:\s*"approved"/.test(fnSrc), "chat server fn does not write approved");
assert(!/status:\s*"sent"/.test(fnSrc), "chat server fn does not write sent");
assert(fnSrc.includes("refuseLocked: true"), "chat refuses to rewrite an approved or sent step");
assert(draftSrc.includes("persistPendingLighthouseDraft"), "composer and chat share the draft write");
assert(persistSrc.includes('status: "draft"'), "shared draft write is pending");
assert(!/status:\s*"approved"/.test(persistSrc), "shared draft write never sets approved");
assert(!/status:\s*"sent"/.test(persistSrc), "shared draft write never sets sent");

// --- Empty book and missing tables -----------------------------------------

{
  const empty = book([]);
  assert(empty.firms.length === 0, "empty book has no firms");
  assert(empty.autoSend === false, "empty snapshot keeps auto_send false");
  const follow = await runLighthouseChatTurn({
    message: "Who should I follow up with today?",
    snapshot: empty,
    createdBy: "theo",
  });
  assert(/book is empty/i.test(follow.reply), "empty follow-up says the book is empty");
  assert(follow.reply.includes("Import cohort"), "empty follow-up suggests Import cohort");
  assert(/Run plan \(dry-run\)/.test(follow.reply), "empty follow-up suggests Run plan dry-run");
  assert(!/acme|cape books/i.test(follow.reply), "empty follow-up invents no firm");
  assert(follow.draft === null, "empty follow-up does not draft");

  const pipeline = await runLighthouseChatTurn({
    message: "How's the pipeline looking?",
    snapshot: empty,
    createdBy: "theo",
  });
  assert(/book is empty/i.test(pipeline.reply), "empty pipeline says the book is empty");
  assert(!/\d+\s+firms/i.test(pipeline.reply), "empty pipeline does not invent a firm count");

  assert(
    replyIsGrounded("Acme Plumbing has 4 firms in trial.", empty, follow.reply) === false,
    "an invented firm is not grounded",
  );
}

{
  const admin = scriptedAdmin({
    milon_ops_leads: MISSING,
    lighthouse_touches: MISSING,
    lighthouse_inbound: MISSING,
    lighthouse_firms: MISSING,
    lighthouse_contacts: MISSING,
    lighthouse_activities: MISSING,
    lighthouse_campaigns: MISSING,
    lighthouse_cadence_steps: MISSING,
  });
  const snapshot = await loadLighthouseChatSnapshot(admin as never, NOW);
  assert(snapshot.leadTableMissing, "missing lead table is reported");
  assert(snapshot.firms.length === 0, "missing lead table yields no firms");
  const answer = await runLighthouseChatTurn({
    message: "How's the pipeline looking?",
    snapshot,
    createdBy: "theo",
  });
  assert(/lead book is missing/i.test(answer.reply), "missing table says the book is missing");
  assert(/will not guess/i.test(answer.reply), "missing table refuses to invent numbers");
  assert(answer.reply.includes("Import cohort"), "missing table still names the next action");
  assert(!/acme|cape books|\d+\s+firms/i.test(answer.reply), "missing table invents no firms or counts");
}

{
  const admin = scriptedAdmin({
    milon_ops_leads: { data: [], error: null },
    lighthouse_firms: MISSING,
    lighthouse_contacts: MISSING,
    lighthouse_activities: MISSING,
    lighthouse_campaigns: MISSING,
    lighthouse_cadence_steps: MISSING,
  });
  const snapshot = await loadLighthouseChatSnapshot(admin as never, NOW);
  assert(!snapshot.leadTableMissing, "an empty lead table is present");
  assert(snapshot.firms.length === 0, "empty lead table is an empty book");
  assert(snapshot.missingTables.includes("lighthouse_firms"), "missing firms table is named");
  assert(snapshot.missingTables.includes("lighthouse_contacts"), "missing contacts table is named");
  assert(snapshot.missingTables.includes("lighthouse_activities"), "missing activities table is named");
  const answer = await runLighthouseChatTurn({
    message: "Any replies I need to handle?",
    snapshot,
    createdBy: "theo",
  });
  assert(/lighthouse_firms/.test(answer.reply), "reply names the missing firms table");
  assert(/book is empty/i.test(answer.reply), "missing phase-1 tables with no leads stay empty");
  assert(/No replies are waiting|book is empty/i.test(answer.reply), "no invented replies");

  const again = await runLighthouseChatTurn({
    message: "How's the pipeline looking?",
    history: [{ role: "assistant", content: answer.reply }],
    snapshot,
    createdBy: "theo",
  });
  assert(!/not in this database/i.test(again.reply), "a later turn does not repeat the missing-table blurb");
}

{
  const admin = scriptedAdmin({
    milon_ops_leads: {
      data: [
        {
          id: usLead.id,
          name: "Sam Lee",
          email: "sam@example.com",
          company: "Acme Plumbing",
          city: "New York",
          stage: "contacted",
          do_not_contact: false,
          next_touch_on: "2026-10-01",
          last_touch_at: "2026-09-20T12:00:00Z",
          sequence_step: 1,
        },
        {
          id: saLead.id,
          name: "Aneesa Naidoo",
          email: "aneesa@capebooks.example",
          company: "Cape Books",
          city: "Cape Town",
          stage: "replied",
          do_not_contact: false,
          next_touch_on: "2026-10-02",
          sequence_step: 0,
        },
      ],
      error: null,
    },
    lighthouse_firms: {
      data: [
        { legacy_lead_id: usLead.id, name: "Acme Plumbing", country: "US" },
        { legacy_lead_id: saLead.id, name: "Cape Books", country: "SA" },
      ],
      error: null,
    },
    lighthouse_contacts: {
      data: [
        {
          legacy_lead_id: usLead.id,
          last_touch_at: "2026-09-20T12:00:00Z",
          last_delivery_status: "delivered",
          last_engagement: "opened",
          next_follow_up_at: "2026-10-06T08:00:00Z",
          suppress: false,
        },
      ],
      error: null,
    },
    lighthouse_touches: {
      data: [
        {
          id: "touch-acme",
          lead_id: usLead.id,
          step_no: 1,
          angle: "observation",
          subject: "Books",
          body: "Hello",
          status: "sent",
          sent_at: "2026-09-20T12:00:00Z",
        },
      ],
      error: null,
    },
    lighthouse_inbound: {
      data: [
        {
          id: "in-1",
          lead_id: saLead.id,
          from_email: "aneesa@capebooks.example",
          subject: "Send the one-pager",
          body: "Please send it.",
          received_at: "2026-10-05T15:00:00Z",
        },
      ],
      error: null,
    },
  });
  const snapshot = await loadLighthouseChatSnapshot(admin as never, NOW);
  assert(!snapshot.leadTableMissing, "a populated lead book is present");
  assert(!snapshot.bookUnreadable, "a populated lead book was readable");
  assert(snapshot.firms.length === 2, "both lead rows become firms");
  assert(snapshot.stageCounts.contacted === 1, "contacted stage count comes from the rows");
  assert(snapshot.stageCounts.replied === 1, "replied stage count comes from the rows");
  assert(snapshot.dueQueue.length === 2, "both firms are follow-ups due");
  assert(snapshot.replies.length === 1, "the inbound row is a recent reply");
  assert(snapshot.review.length === 0, "a sent touch is not sitting in the review inbox");
  const context = formatContextBlock(snapshot);
  assert(/STAGES:/.test(context) && /contacted 1/.test(context), "context has stage counts");
  assert(/80\/20/.test(context), "context has the 80/20 mix target");
  assert(/FOLLOW_UPS_DUE: 2/.test(context), "context counts follow-ups due");
  assert(/E16_CADENCE:/.test(context) && /next follow-up/.test(context), "context includes E16 cadence");
  assert(/INBOUND_REPLIES: 1/.test(context), "context counts recent inbound replies");
  assert(/REVIEW_INBOX: 0/.test(context), "context counts the review inbox");
  assert(!/not in this database/i.test(context), "a real lead book is not described as missing");
  const pipeline = await runLighthouseChatTurn({
    message: "How's the pipeline looking?",
    snapshot,
    createdBy: "theo",
  });
  assert(!/not in this database/i.test(pipeline.reply), "pipeline does not say the table is missing");
  assert(!/lead book is missing/i.test(pipeline.reply), "pipeline does not say the lead book is missing");
  assert(/2 firms/.test(pipeline.reply), "pipeline count comes from the rows");
  assert(/80\/20/.test(pipeline.reply), "pipeline states the 80/20 target");

  const draftAdmin = touchAdmin(null);
  const drafted = await runLighthouseChatTurn({
    message: "Draft a follow-up for Acme Plumbing",
    snapshot,
    createdBy: "theo",
    persistDraft: async (write) =>
      persistPendingLighthouseDraft(draftAdmin, write, NOW, { refuseLocked: true }),
  });
  assert(drafted.draft?.status === "draft", "a named firm becomes a pending draft");
  assert(drafted.draft?.from === "Milōn <team@trymilon.com>", "loader draft keeps From");
  assert(drafted.draft?.replyTo === "hello@milonfinance.com", "loader draft keeps Reply-To");
  assert(drafted.draft?.signer === "The MILŌN Team", "loader draft keeps the signer");
  const row = draftAdmin.writes.find((write) => write.op === "insert")?.row;
  assert(row?.status === "draft", "saved touch stays draft");
  const body = String(row?.body ?? "");
  assert(/QuickBooks Online/i.test(body) && /Xero/i.test(body), "loader draft leads with QBO and Xero");
  assert(body.includes("https://youtu.be/J4vJki7HcIs"), "loader draft includes the accountant teaser");
  assert(body.includes("https://youtu.be/k3aRM4toTvU"), "loader draft includes the owner teaser");
  assert(body.includes("The MILŌN Team"), "loader draft signs as the team");
  assert(!/50\s*%|discount/i.test(body), "US firm from the loader gets no SA discount");
}

{
  for (const error of [
    { code: "42703", message: 'column milon_ops_leads.country does not exist' },
    { code: "42501", message: "permission denied for relation milon_ops_leads" },
  ]) {
    const admin = scriptedAdmin({
      milon_ops_leads: { data: null, error },
    });
    const snapshot = await loadLighthouseChatSnapshot(admin as never, NOW);
    assert(!snapshot.leadTableMissing, `${error.code} is not a missing table`);
    assert(snapshot.bookUnreadable, `${error.code} leaves the book unread`);
    assert(!snapshot.missingTables.includes("milon_ops_leads"), `${error.code} does not name milon_ops_leads as missing`);
    const first = await runLighthouseChatTurn({
      message: "How's the pipeline looking?",
      snapshot,
      createdBy: "theo",
    });
    assert(!/not in this database/i.test(first.reply), `${error.code} does not use the missing-table copy`);
    assert(!/lead book is missing/i.test(first.reply), `${error.code} does not say the lead book is missing`);
    assert(/couldn.t read the lead book/i.test(first.reply), `${error.code} gets a short neutral reply`);
    const second = await runLighthouseChatTurn({
      message: "Who should I follow up with today?",
      history: [
        { role: "user", content: "How's the pipeline looking?" },
        { role: "assistant", content: first.reply },
      ],
      snapshot,
      createdBy: "theo",
    });
    assert(!/not in this database/i.test(second.reply), `${error.code} follow-up still avoids the missing-table copy`);
    assert(!/couldn.t read the lead book/i.test(second.reply), `${error.code} does not repeat the unread blurb`);
    assert(/won.t guess/i.test(second.reply), `${error.code} second turn stays neutral`);
  }
}

{
  const admin = scriptedAdmin({ milon_ops_leads: MISSING });
  const snapshot = await loadLighthouseChatSnapshot(admin as never, NOW);
  const first = await runLighthouseChatTurn({
    message: "Who should I follow up with today?",
    snapshot,
    createdBy: "theo",
  });
  assert(/not in this database/i.test(first.reply), "a real 42P01 may say the table is missing once");
  const second = await runLighthouseChatTurn({
    message: "Draft a follow-up for Acme Plumbing",
    history: [{ role: "assistant", content: first.reply }],
    snapshot,
    createdBy: "theo",
  });
  assert(second.draft === null, "a missing book does not draft");
  assert(!/not in this database/i.test(second.reply), "42P01 does not repeat the missing-table blurb");
  assert(!/lead book is missing/i.test(second.reply), "42P01 does not repeat the lead-book blurb");
}

// --- Grounded book: queue, replies, mix, windows ---------------------------

{
  const snapshot = book([
    {
      ...usLead,
      inbound: [
        {
          id: "in-1",
          fromEmail: "sam@example.com",
          subject: "Can you send the score?",
          receivedAt: "2026-10-05T15:00:00Z",
        },
      ],
    },
    saLead,
  ]);
  assert(snapshot.dueQueue.some((row) => row.title === "Acme Plumbing" && row.open), "US firm is due in the ET window");
  assert(snapshot.dueQueue.some((row) => row.title === "Cape Books" && row.geo === "SA"), "SA firm is in the due queue");
  assert(snapshot.replies.length === 1, "one real reply");
  assert(snapshot.autoSend === false, "live snapshot keeps auto_send false");

  const follow = await runLighthouseChatTurn({
    message: "Who should I follow up with today?",
    snapshot,
    createdBy: "theo",
  });
  assert(follow.reply.includes("Acme Plumbing"), "follow-up names the due US firm");
  assert(follow.reply.includes("Cape Books"), "follow-up names the due SA firm");
  assert(/window open|80\/20|ET|SAST/.test(follow.reply), "follow-up carries the E17 window");
  assert(follow.chips.length >= 1, "follow-up offers a chip");
  assert(follow.draft === null, "a question does not create a draft");

  const replies = await runLighthouseChatTurn({
    message: "Any replies I need to handle?",
    snapshot,
    createdBy: "theo",
  });
  assert(/Can you send the score/.test(replies.reply), "reply question quotes the real subject");
  assert(!/invented reply/i.test(replies.reply), "reply question stays on the book");

  const pipeline = await runLighthouseChatTurn({
    message: "How's the pipeline looking?",
    snapshot,
    createdBy: "theo",
  });
  assert(/2 firms/.test(pipeline.reply), "pipeline count is the real firm count");
  assert(/80\/20/.test(pipeline.reply), "pipeline reports the 80/20 attention target");
  assert(/In sequence 2/.test(pipeline.reply), "pipeline stage count is real");
}

// --- Draft lands pending. US gets no SA discount. -------------------------

{
  const snapshot = book([usLead, saLead]);
  const admin = touchAdmin(null);
  let calls = 0;
  const usTurn = await runLighthouseChatTurn({
    message: "Draft a follow-up for Acme Plumbing",
    snapshot,
    createdBy: "theo",
    complete: async () =>
      JSON.stringify({
        action: "draft",
        reply: "Theo at Outsourced CFO will send this. US firms get a 50% discount.",
        draft: {
          leadId: usLead.id,
          subject: "A note from Theo, Founder",
          body: "Theo here from Outsourced CFO. US firms get a 50% discount. Claude wrote this.",
        },
      }),
    persistDraft: async (write) => {
      calls += 1;
      assert(write.action === "draft", "persist is only asked to draft");
      const saved = await persistPendingLighthouseDraft(admin, write, NOW, { refuseLocked: true });
      return saved;
    },
  });
  assert(calls === 1, "one draft write");
  assert(usTurn.draft?.status === "draft", "turn reports a pending draft");
  assert(usTurn.draft?.from === "Milōn <team@trymilon.com>", "draft From lock");
  assert(usTurn.draft?.replyTo === "hello@milonfinance.com", "draft Reply-To lock");
  assert(usTurn.draft?.signer === "The MILŌN Team", "draft signer lock");
  assert(/review inbox/i.test(usTurn.reply), "draft is described as review inbox");
  assert(/nothing was sent/i.test(usTurn.reply), "chat says it did not send");
  const inserted = admin.writes.find((write) => write.op === "insert")?.row;
  assert(inserted?.status === "draft", "inserted touch is pending");
  assert(inserted?.status !== "approved" && inserted?.status !== "sent", "insert is not a send");
  const body = String(inserted?.body ?? "");
  assert(/QuickBooks Online/i.test(body) && /Xero/i.test(body), "draft leads with QBO and Xero");
  assert(/autonomous agent/i.test(body), "draft calls Milōn an autonomous agent");
  assert(body.includes("https://youtu.be/J4vJki7HcIs"), "draft includes the accountant teaser");
  assert(body.includes("https://youtu.be/k3aRM4toTvU"), "draft includes the owner teaser");
  assert(body.includes("The MILŌN Team"), "draft signs as the team");
  assert(!/50\s*%|discount/i.test(body), "US draft has no SA discount");
  assert(!/theo|founder|outsourced cfo|ocfo|claude|anthropic/i.test(body), "US draft has no person, OCFO, or model");
  assert(!/theo|founder/i.test(String(inserted?.subject ?? "")), "subject drops the founder");

  const withTouch = book([
    {
      ...usLead,
      touches: [
        {
          id: "touch-new",
          stepNo: 1,
          angle: "observation",
          subject: String(inserted?.subject ?? ""),
          body,
          status: "draft",
          sentAt: null,
        },
      ],
    },
  ]);
  assert(
    withTouch.review.some((item) => item.touchId === "touch-new" && item.status === "draft"),
    "pending draft shows in the review inbox",
  );
}

{
  const snapshot = book([saLead]);
  const admin = touchAdmin(null);
  await runLighthouseChatTurn({
    message: "Draft a follow-up for Cape Books",
    snapshot,
    createdBy: "theo",
    persistDraft: async (write) => persistPendingLighthouseDraft(admin, write, NOW, { refuseLocked: true }),
  });
  const body = String(admin.writes.find((write) => write.op === "insert")?.row?.body ?? "");
  assert(/50\s*%/.test(body) && /discount/i.test(body), "SA draft may mention the 50% discount");
  assert(body.includes("The MILŌN Team"), "SA draft still signs as the team");
  assert(!/50\s*%/.test(
    lockChatDraft({
      subject: "Hello",
      body: "South African firms get a 50% discount.\n\nThanks",
      geo: "US",
      firmTitle: "Acme Plumbing",
    }).body,
  ), "lock strips the discount for a US firm");
}

{
  const unnamed = await runLighthouseChatTurn({
    message: "Draft a follow-up for <firm>",
    snapshot: book([usLead]),
    createdBy: "theo",
    persistDraft: async () => {
      throw new Error("should not draft without a real firm");
    },
  });
  assert(unnamed.draft === null, "a placeholder firm is not drafted");
  assert(/name the firm/i.test(unnamed.reply), "chat asks for the firm");
}

// --- Chat cannot send or approve ------------------------------------------

for (const action of ["send", "approve", "schedule", "send_now", "approve_draft"] as const) {
  let threw = false;
  try {
    assertChatMutationAllowed(action);
  } catch (error) {
    threw = true;
    assert(error instanceof Error && /cannot send, approve, or schedule/i.test(error.message), action);
  }
  assert(threw, `${action} is refused`);
}
assertChatMutationAllowed("draft");
assertChatMutationAllowed("answer");

{
  let threw = false;
  try {
    pendingDraftPayload({
      leadId: usLead.id,
      stepNo: 1,
      angle: "observation",
      subject: "Hi",
      body: "Hi",
      createdBy: "theo",
      action: "send",
    });
  } catch (error) {
    threw = true;
    assert(error instanceof Error && /cannot send, approve, or schedule/i.test(error.message), "payload refuses send");
  }
  assert(threw, "a send action never becomes a row");
  const row = pendingDraftPayload({
    leadId: usLead.id,
    stepNo: 1,
    angle: "observation",
    subject: "Hi",
    body: "Hi",
    createdBy: "theo",
    action: "draft",
  });
  assert(row.status === "draft", "the only status a chat write can build is draft");
}

{
  const snapshot = book([usLead]);
  let persisted = false;
  const refused = await runLighthouseChatTurn({
    message: "Please send it now",
    snapshot,
    createdBy: "theo",
    complete: async () =>
      JSON.stringify({
        action: "send",
        reply: "Sending the Acme Plumbing email now.",
        draft: { leadId: usLead.id, subject: "Go", body: "Go" },
      }),
    persistDraft: async () => {
      persisted = true;
      return { touchId: "nope", status: "draft" as const };
    },
  });
  assert(persisted === false, "a model send does not persist");
  assert(refused.draft === null, "a model send returns no draft");
  assert(refused.refusedAction === "send", "send is the refused action");
  assert(/can't send, approve, or schedule/i.test(refused.reply), "the reply tells the admin to use the inbox");
}

{
  let persisted = false;
  const refused = await runLighthouseChatTurn({
    message: "Approve the Acme Plumbing draft",
    snapshot: book([usLead]),
    createdBy: "theo",
    complete: async () =>
      JSON.stringify({
        action: "approve",
        reply: "Approved.",
        draft: null,
      }),
    persistDraft: async () => {
      persisted = true;
      return { touchId: "nope", status: "draft" as const };
    },
  });
  assert(persisted === false, "approve does not persist");
  assert(refused.refusedAction === "approve", "approve is refused");
  assert(refused.draft === null, "approve does not return a draft");
}

assert(chatIntent("Who should I follow up with today?") === "followup", "follow-up intent");
assert(chatIntent("Any replies I need to handle?") === "replies", "replies intent");
assert(chatIntent("How's the pipeline looking?") === "pipeline", "pipeline intent");
assert(chatIntent("Draft a follow-up for Acme Plumbing") === "draft", "draft intent");

// --- Thread storage and composer ------------------------------------------

{
  const storage = memoryStorage();
  assert(chatStorageKey("theo") !== chatStorageKey("other"), "threads are per admin");
  writeChatThread(storage, "theo", [
    { id: "1", role: "user", content: "Who is due?", chips: [], createdAt: "2026-10-06T00:00:00Z" },
  ]);
  writeChatThread(storage, "other", [
    { id: "2", role: "user", content: "Other admin", chips: [], createdAt: "2026-10-06T00:00:00Z" },
  ]);
  assert(readChatThread(storage, "theo")[0]?.content === "Who is due?", "theo's thread is his");
  assert(readChatThread(storage, "other")[0]?.content === "Other admin", "the other admin has a separate thread");
  clearChatThread(storage, "theo");
  assert(readChatThread(storage, "theo").length === 0, "Clear drops that admin's thread");
  assert(readChatThread(storage, "other").length === 1, "Clear does not drop the other admin");
}

assert(composerShouldSend("Enter", false), "Enter sends");
assert(!composerShouldSend("Enter", true), "Shift+Enter does not send");
assert(!composerShouldSend("a", false), "a letter does not send");

// --- UI --------------------------------------------------------------------

assert(panelSrc.includes("LighthouseAgentChat"), "Agent tab mounts the chat");
assert(panelSrc.includes("Review inbox"), "review inbox stays");
assert(panelSrc.includes("Next up"), "next up stays");
assert(panelSrc.includes("See all"), "due list stays reachable");
assert(!panelSrc.includes('LIGHTHOUSE_TABS = ["agent", "firms", "system", "chat"]'), "chat is not a new tab");
assert(uiSrc.includes("localStorage"), "the thread is stored in localStorage");
assert(uiSrc.includes("Clear"), "Clear is in the chat");
assert(uiSrc.includes("Shift+Enter"), "newline hint is in the chat");
assert(!/claude|anthropic/i.test(uiSrc), "chat UI has no model branding");
assert(!uiSrc.includes("Drafts stay in the review inbox"), "the chat header does not repeat the inbox line");
assert(
  (uiSrc.match(/review inbox/gi) ?? []).length === 1,
  "the chat states the review inbox once",
);
assert(!uiSrc.includes("sendLighthouseTouch"), "chat UI does not send mail");
assert(!uiSrc.includes("reviewLighthouseTouch"), "chat UI does not approve");

const html = renderToStaticMarkup(
  createElement(LighthouseAgentChatView, {
    messages: [
      {
        id: "m1",
        role: "assistant",
        content: "Nothing is due.",
        chips: [{ kind: "queue", id: usLead.id, leadId: usLead.id, label: "Acme Plumbing" }],
        createdAt: "2026-10-06T00:00:00Z",
      },
    ],
    input: "",
    busy: true,
    error: "The console is locked.",
    showThread: true,
    collapsed: false,
    mobileOpen: true,
    onInput: () => {},
    onToggleMobile: () => {},
    onToggleCollapse: () => {},
    onSend: () => {},
    onPrompt: () => {},
    onClear: () => {},
    onChip: () => {},
    onKeyDown: () => {},
  }),
);
const htmlText = html
  .replace(/&#x27;|&apos;/g, "'")
  .replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">");
for (const promptText of LIGHTHOUSE_CHAT_PROMPTS) {
  assert(htmlText.includes(promptText), `suggested prompt renders: ${promptText}`);
}
assert(html.includes("Clear"), "Clear renders");
assert(html.includes("Looking at the book"), "loading state renders");
assert(html.includes("The console is locked."), "error state renders");
assert(html.includes("Enter to send"), "Enter hint renders");
assert(html.includes("Shift+Enter"), "Shift+Enter hint renders");
assert(html.includes("Acme Plumbing"), "a chip renders");
assert(!/claude|anthropic/i.test(html), "rendered chat has no model branding");

console.log("lighthouse-agent-chat-test: ok");
