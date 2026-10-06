/**
 * SA + US target list: header CSV, country mapping, dedupe, phone E.164,
 * and a held call stopping the cold cadence.
 * Run: pnpm test:lighthouse-targets
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assertColdDraftOpen,
  buildDueQueue,
  isLeadDue,
  nextUpAction,
  type AgentLead,
} from "../src/lib/lighthouse-agent";
import {
  ambiguousLeadReply,
  resolveChatLead,
  runLighthouseChatTurn,
  snapshotFromBook,
  type ChatFirm,
} from "../src/lib/lighthouse-agent-chat";
import { persistPendingLighthouseDraft } from "../src/lib/lighthouse-draft-persist";
import {
  COLD_SEQUENCE_DAYS,
  coldCadenceOpen,
  conversationActivityType,
  displayedLeadMarket,
  applyNormalisedAfterSave,
  formatPhoneDisplay,
  HELD_COLD_APPROVE_REASON,
  heldColdApproveReason,
  inferredTargetCountry,
  isInboundReplyTouch,
  isTargetNotContacted,
  mapLighthouseCountry,
  normalisePhoneE164,
  parseLighthouseImport,
  planLighthouseImport,
  reseedDrawerField,
  resumedColdTouchOn,
  scheduledColdTouchOn,
  shouldFlushContactOnPointerDown,
} from "../src/lib/lighthouse-targets";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const HEADER = "phone,country,name,email,company,website,city,region,persona,signal";

{
  assert(mapLighthouseCountry("South Africa") === "SA", "South Africa maps to SA");
  assert(mapLighthouseCountry("ZA") === "SA", "ZA maps to SA");
  assert(mapLighthouseCountry("sa") === "SA", "sa maps to SA");
  assert(mapLighthouseCountry("United States") === "US", "United States maps to US");
  assert(mapLighthouseCountry("USA") === "US", "USA maps to US");
  assert(mapLighthouseCountry("us") === "US", "us maps to US");
  assert(mapLighthouseCountry("") === null, "blank country stays empty");
  assert(mapLighthouseCountry("Kenya") === "OTHER", "an unlisted country is OTHER");
}

{
  assert(normalisePhoneE164("0821234567") === "+27821234567", "SA local 0 becomes +27");
  assert(normalisePhoneE164("082 123 4567", "South Africa") === "+27821234567", "spaced SA local");
  assert(normalisePhoneE164("+27 82 123 4567") === "+27821234567", "SA already international");
  assert(normalisePhoneE164("4155550100") === "+14155550100", "US 10-digit becomes +1");
  assert(normalisePhoneE164("(415) 555-0100", "USA") === "+14155550100", "formatted US 10-digit");
  assert(normalisePhoneE164("+1 415 555 0100") === "+14155550100", "US already international");
  assert(normalisePhoneE164("call the office") === null, "a non-number is left unnormalised");
  assert(normalisePhoneE164("") === null, "blank phone is empty");
}

{
  const csv = [
    HEADER,
    '082 123 4567,South Africa,"Naidoo, Aneesa",aneesa@capebooks.co.za,Cape Books,https://www.capebooks.co.za,Cape Town,Western Cape,accountant,hiring two clerks',
    "4155550100,United States,Sam Lee,sam@acme.example,Acme Plumbing,acme.example,Austin,Texas,owner,hiring vans",
  ].join("\n");
  const rows = parseLighthouseImport(csv);
  assert(rows.length === 2, "header row is not a lead");
  assert(rows[0].name === "Naidoo, Aneesa", "quoted commas stay in the name");
  assert(rows[0].email === "aneesa@capebooks.co.za", "email is read from a shuffled header");
  assert(rows[0].country === "SA", "South Africa column maps to SA");
  assert(rows[0].city === "Cape Town", "city is read");
  assert(rows[0].region === "Western Cape", "region is read");
  assert(rows[0].personaFromCell === "accountant", "persona cell maps to accountant");
  assert(rows[0].phoneE164 === "+27821234567", "import normalises the SA phone");
  assert(rows[0].website === "https://www.capebooks.co.za", "website is read");
  assert(rows[0].signal === "hiring two clerks", "signal is read");
  assert(rows[1].country === "US", "United States maps on import");
  assert(rows[1].phoneE164 === "+14155550100", "import normalises the US phone");
  assert(rows[1].personaFromCell === "owner", "owner persona is read");
}

{
  const legacy = "Sipho Dlamini, sipho@acme.co.za, Acme Plumbing, hiring 3 vans";
  const rows = parseLighthouseImport(legacy);
  assert(rows.length === 1, "old 4-column form still parses");
  assert(rows[0].name === "Sipho Dlamini", "old form name");
  assert(rows[0].email === "sipho@acme.co.za", "old form email");
  assert(rows[0].company === "Acme Plumbing", "old form company");
  assert(rows[0].signal === "hiring 3 vans", "old form signal");
  assert(rows[0].country === null, "old form has no country");
  assert(rows[0].phone === null, "old form has no phone");
  const plan = planLighthouseImport(rows, [], "accountant");
  assert(plan.inserted === 1 && plan.updated === 0 && plan.skipped === 0, "old form inserts");
  assert(plan.insert[0].persona === "accountant", "old form uses the chosen persona");
}

{
  const rows = parseLighthouseImport(
    [
      "name,email,company,website,phone",
      "Ann,a@acme.co.za,Acme,https://www.acme.co.za,0821111111",
      "Ann again,a@acme.co.za,Acme,https://acme.co.za,0821111111",
      "Ben,b@acme.co.za,Acme,acme.co.za,0822222222",
      "Cara,cara@other.co.za,Other,other.co.za,0833333333",
      ",,,",
    ].join("\n"),
  );
  const plan = planLighthouseImport(
    rows,
    [{ id: "lead-ann", email: "a@acme.co.za", company: "Acme", website: "https://acme.co.za" }],
    "owner",
  );
  assert(plan.updated === 1, "email match updates the existing lead");
  assert(plan.update[0].id === "lead-ann", "email wins over a later firm match");
  assert(plan.inserted === 1, "a different firm is inserted");
  assert(plan.insert[0].email === "cara@other.co.za", "the other firm is the insert");
  assert(plan.skipped === 3, "same email, same firm domain, and a blank line are skipped");
}

{
  const rows = parseLighthouseImport(
    ["name,email,company,website", "Bo,bo@acme.co.za,Acme,https://www.acme.co.za"].join("\n"),
  );
  const plan = planLighthouseImport(
    rows,
    [{ id: "lead-site", email: "older@acme.co.za", company: "Acme", website: "acme.co.za" }],
    "owner",
  );
  assert(plan.updated === 1 && plan.inserted === 0, "same company and website updates");
  assert(plan.update[0].id === "lead-site", "website dedupe hits the existing firm");
  assert(plan.skipped === 0, "a firm match is an update, not a skip");
}

{
  assert(
    coldCadenceOpen({ conversationHeld: false }) === true,
    "an open lead can take a cold step",
  );
  assert(coldCadenceOpen({ conversationHeld: true }) === false, "held=true stops cadence");
  assert(scheduledColdTouchOn(true, "2026-10-20") === null, "a held lead is not scheduled");
  assert(
    scheduledColdTouchOn(false, "2026-10-20") === "2026-10-20",
    "an open lead keeps its next date",
  );
  assert(conversationActivityType("phone") === "call", "phone is a call activity");
  assert(conversationActivityType("video") === "meeting", "video is a meeting activity");
  assert(conversationActivityType("in_person") === "meeting", "in person is a meeting activity");

  const dueLead = (conversationHeld: boolean): AgentLead => ({
    id: "lead-1",
    company: "Cape Books",
    email: "a@capebooks.co.za",
    country: "SA",
    stage: "contacted",
    doNotContact: false,
    conversationHeld,
    nextTouchOn: "2026-10-01",
    lastTouchAt: null,
    sequenceStep: 1,
    touches: [],
  });
  const now = new Date("2026-10-06T13:00:00Z");
  assert(isLeadDue(dueLead(false), now), "a due lead with no call still queues");
  assert(!isLeadDue(dueLead(true), now), "held=true drops the lead from the cold queue");
  assert(
    isTargetNotContacted({ touches: [], repliedAt: null, lastInboundAt: null }),
    "no sends and no reply is a target",
  );
  assert(
    !isTargetNotContacted({
      touches: [{ sentAt: "2026-10-01T00:00:00Z", status: "sent" }],
    }),
    "a sent touch is no longer a fresh target",
  );
  assert(
    !isTargetNotContacted({ touches: [], repliedAt: "2026-10-02T00:00:00Z" }),
    "a reply is no longer a fresh target",
  );
}

{
  const heldBook = snapshotFromBook({
    leads: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        company: "Cape Books",
        name: "Aneesa Naidoo",
        email: "aneesa@capebooks.co.za",
        country: "SA",
        stage: "contacted",
        conversationHeld: true,
        nextTouchOn: "2026-10-01",
        doNotContact: false,
        touches: [],
      },
    ],
  });
  assert(heldBook.dueQueue.length === 0, "the workbench queue skips a held firm");
  let persisted = false;
  const heldTurn = await runLighthouseChatTurn({
    message: "Draft a note for Cape Books",
    snapshot: heldBook,
    createdBy: "owner",
    persistDraft: async () => {
      persisted = true;
      return { touchId: "touch-1", status: "draft" as const };
    },
  });
  assert(persisted === false, "chat does not draft a cold step after a call");
  assert(heldTurn.draft === null, "chat returns no draft for a held firm");
  assert(
    heldTurn.reply ===
      "You've already spoken to Cape Books — cold emails are stopped. Untick Call / meeting held to resume.",
    "chat tells the operator to untick Call / meeting held",
  );

  const openBook = snapshotFromBook({
    leads: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        company: "Cape Books",
        name: "Aneesa Naidoo",
        email: "aneesa@capebooks.co.za",
        country: "SA",
        stage: "contacted",
        conversationHeld: false,
        nextTouchOn: null,
        doNotContact: false,
        touches: [],
      },
    ],
  });
  const openTurn = await runLighthouseChatTurn({
    message: "Draft a note for Cape Books",
    snapshot: openBook,
    createdBy: "owner",
    persistDraft: async () => ({ touchId: "touch-2", status: "draft" as const }),
  });
  assert(openTurn.draft?.status === "draft", "an unheld firm can still be drafted");
}

{
  assert(formatPhoneDisplay("0821234567") === "+27 82 123 4567", "SA local displays as +27 82 123 4567");
  assert(
    formatPhoneDisplay("0821234567", "+27821234567") === "+27 82 123 4567",
    "stored E.164 displays grouped",
  );
  assert(formatPhoneDisplay("4155550100") === "+1 415 555 0100", "US 10-digit displays grouped");
  assert(formatPhoneDisplay("call the office") === "call the office", "unnormalised phone stays raw");
  assert(formatPhoneDisplay("") === "", "blank phone stays blank");
}

{
  assert(
    heldColdApproveReason({ conversationHeld: true }, { angle: "value", stepNo: 2 }) ===
      HELD_COLD_APPROVE_REASON,
    "a held lead blocks approve and send on a cold value draft",
  );
  assert(
    heldColdApproveReason({ conversationHeld: true }, { angle: "reply", stepNo: 6 }) === null,
    "a reply to inbound mail can still be approved",
  );
  assert(
    heldColdApproveReason({ conversationHeld: true }, { angle: "observation", stepNo: 7 }) === null,
    "steps 6–8 stay approvable when a call was held",
  );
  assert(isInboundReplyTouch({ angle: "value", stepNo: 2 }) === false, "a value step is cold cadence");
  assert(
    heldColdApproveReason({ conversationHeld: false }, { angle: "value", stepNo: 2 }) === null,
    "an open cadence can still approve a cold draft",
  );
  assert(
    shouldFlushContactOnPointerDown({
      activeElementId: "lighthouse-lead-phone",
      targetElementId: null,
    }) === true,
    "a click on plain drawer text flushes the phone field",
  );
  assert(
    shouldFlushContactOnPointerDown({
      activeElementId: "lighthouse-lead-phone",
      targetElementId: "lighthouse-lead-website",
    }) === true,
    "moving to another field flushes the one that was focused",
  );
  assert(
    shouldFlushContactOnPointerDown({
      activeElementId: "lighthouse-lead-phone",
      targetElementId: "lighthouse-lead-phone",
    }) === false,
    "a click inside the focused field does not flush",
  );
  assert(
    shouldFlushContactOnPointerDown({ activeElementId: null, targetElementId: null }) === false,
    "pointer down outside a contact field is ignored",
  );
}

{
  const server = "https://milon-dryrun.test/";
  const typed = "https://milon-dryrun.b2.test/";
  const focused = reseedDrawerField({
    current: typed,
    applied: server,
    server,
    focused: true,
    contextChanged: false,
  });
  assert(focused.value === typed, "a refetch leaves a focused website field untouched");
  assert(
    focused.value.indexOf("milon-dryrun") === focused.value.lastIndexOf("milon-dryrun"),
    "a refetch does not splice a second copy of the URL into the edit",
  );
  assert(focused.applied === server, "a focused edit stays dirty against the last applied value");

  const dirty = reseedDrawerField({
    current: typed,
    applied: server,
    server,
    focused: false,
    contextChanged: false,
  });
  assert(dirty.value === typed, "a refetch leaves a dirty field untouched after blur");

  const justFocused = reseedDrawerField({
    current: server,
    applied: server,
    server: "https://milon-dryrun.test/stale",
    focused: true,
    contextChanged: false,
  });
  assert(justFocused.value === server, "a focused field is not replaced before the first keystroke");

  const clean = reseedDrawerField({
    current: server,
    applied: server,
    server: "https://other.test/",
    focused: false,
    contextChanged: false,
  });
  assert(clean.value === "https://other.test/", "a blurred clean field takes the server value");

  const switched = reseedDrawerField({
    current: typed,
    applied: server,
    server: "https://other.test/",
    focused: true,
    contextChanged: true,
  });
  assert(switched.value === "https://other.test/", "a lead change re-seeds even while focused");

  const raced = applyNormalisedAfterSave({
    current: typed,
    sent: server,
    normalised: server,
  });
  assert(raced.accept === false && raced.value === typed, "keystrokes since the save started are kept");
  const stillThere = reseedDrawerField({
    current: raced.value,
    applied: server,
    server,
    focused: true,
    contextChanged: false,
  });
  assert(stillThere.value === typed, "the post-save refetch does not race with the next keystroke");

  const phone = applyNormalisedAfterSave({
    current: "0821234567",
    sent: "0821234567",
    normalised: "+27 82 123 4567",
  });
  assert(phone.accept && phone.value === "+27 82 123 4567", "phone normalises when nothing was typed since send");
}

{
  const steps = COLD_SEQUENCE_DAYS.accountant_v1;
  assert(
    resumedColdTouchOn({
      lastTouchAt: "2026-09-09T08:00:00.000Z",
      sequenceStep: 1,
      steps,
      today: "2026-10-06",
    }) === "2026-10-06",
    "a past cadence date resumes today",
  );
  assert(
    resumedColdTouchOn({
      lastTouchAt: "2026-10-05T08:00:00.000Z",
      sequenceStep: 1,
      steps,
      today: "2026-10-06",
    }) === "2026-10-09",
    "last touch plus the step gap stays in the future",
  );
  assert(
    resumedColdTouchOn({
      lastTouchAt: null,
      sequenceStep: 0,
      steps,
      today: "2026-10-06",
    }) === "2026-10-06",
    "untick never leaves the next date empty",
  );
}

{
  assert(
    displayedLeadMarket({ country: null, email: "team@milon.co.za" }) === "SA",
    "a .co.za address is the SA filter",
  );
  assert(
    displayedLeadMarket({ country: null, phone: "0821234567", email: "team@gmail.com" }) === "SA",
    "an SA phone is the SA filter when country is empty",
  );
  assert(
    displayedLeadMarket({ country: null, timezone: "America/New_York", email: "a@gmail.com" }) === "US",
    "a US timezone is the US filter",
  );
  assert(
    displayedLeadMarket({ country: null, website: "https://example.com", email: "a@gmail.com" }) ===
      "OTHER",
    "a .com site does not become US",
  );
  assert(
    inferredTargetCountry({ country: null, email: "team@milon.co.za" }) === "SA",
    "a save can persist the inferred SA country",
  );
  assert(
    inferredTargetCountry({ country: "US", email: "team@milon.co.za" }) === null,
    "a stored country is not replaced",
  );
}

{
  let threw = false;
  try {
    assertColdDraftOpen({
      conversationHeld: true,
      company: "Cape Books",
      email: "aneesa@capebooks.co.za",
    });
  } catch (error) {
    threw = true;
    assert(
      error instanceof Error && /cold emails are stopped/i.test(error.message),
      "sequence and preview refuse a held lead",
    );
  }
  assert(threw, "assertColdDraftOpen throws for a held lead");
  assertColdDraftOpen({ conversationHeld: false, company: "Cape Books" });

  const now = new Date("2026-10-06T13:00:00Z");
  const held = {
    id: "lead-held",
    company: "Cape Books",
    email: "a@capebooks.co.za",
    country: "SA",
    stage: "contacted",
    doNotContact: false,
    conversationHeld: true,
    nextTouchOn: "2026-10-01",
    lastTouchAt: null,
    sequenceStep: 1,
    touches: [],
  } satisfies AgentLead;
  const open = {
    ...held,
    id: "lead-open",
    company: "Open Books",
    email: "o@open.co.za",
    conversationHeld: false,
  } satisfies AgentLead;
  const queue = buildDueQueue([held, open], now);
  assert(!queue.some((row) => row.leadId === "lead-held"), "Next up queue skips a held lead");
  const next = nextUpAction({ inbox: [], queue, hasFirms: true });
  assert(next.leadId === "lead-open", "Next up follows the open lead");
}

{
  const dry = (
    id: string,
    email: string,
    conversationHeld: boolean,
  ): ChatFirm => ({
    leadId: id,
    title: "Milōn Dry Run",
    email,
    geo: "SA",
    stage: "contacted",
    lastTouch: null,
    nextTouchOn: "2026-09-13",
    nextFollowUpAt: null,
    delivery: null,
    replyStatus: null,
    doNotContact: false,
    conversationHeld,
    sequenceStep: 1,
    touches: [],
  });
  const firms = [
    dry("693c359d-b50e-4fdf-9391-f3739fc3cab4", "team@milon.co.za", true),
    dry("11111111-1111-4111-8111-111111111111", "one@milon.co.za", false),
    dry("22222222-2222-4222-8222-222222222222", "two@milon.co.za", false),
    dry("33333333-3333-4333-8333-333333333333", "three@milon.co.za", false),
  ];
  const vague = resolveChatLead("Draft a note for Milōn Dry Run", firms);
  assert(vague.status === "ambiguous", "a shared firm name is ambiguous");
  if (vague.status === "ambiguous") {
    assert(vague.firms.length === 4, "all four dry-run leads are offered");
    assert(/team@milon.co.za/.test(ambiguousLeadReply(vague.firms)), "the ask lists the email");
  }
  const byEmail = resolveChatLead("Draft a note for team@milon.co.za", firms);
  assert(byEmail.status === "one" && byEmail.firm.email === "team@milon.co.za", "email picks one lead");
  const byId = resolveChatLead(
    "Draft a note for 11111111-1111-4111-8111-111111111111",
    firms,
  );
  assert(byId.status === "one" && byId.firm.leadId.startsWith("11111111"), "lead id picks one lead");

  const book = snapshotFromBook({
    leads: firms.map((firm) => ({
      id: firm.leadId,
      company: firm.title,
      email: firm.email,
      country: "SA",
      stage: "contacted",
      conversationHeld: firm.conversationHeld,
      nextTouchOn: "2026-09-13",
      doNotContact: false,
      touches: [],
    })),
  });
  let draftedFor: string | null = null;
  const ambiguousTurn = await runLighthouseChatTurn({
    message: "Draft a note for Milōn Dry Run",
    snapshot: book,
    createdBy: "owner",
    persistDraft: async (write) => {
      draftedFor = write.leadId;
      return { touchId: "touch-x", status: "draft" as const };
    },
  });
  assert(draftedFor === null, "an ambiguous firm does not draft a sibling");
  assert(ambiguousTurn.draft === null, "an ambiguous firm returns no draft");
  assert(/which lead/i.test(ambiguousTurn.reply), "chat asks which lead");

  const heldTurn = await runLighthouseChatTurn({
    message: "Draft a note for team@milon.co.za",
    snapshot: book,
    createdBy: "owner",
    persistDraft: async () => {
      draftedFor = "held";
      return { touchId: "touch-y", status: "draft" as const };
    },
  });
  assert(draftedFor === null, "the held dry-run lead is not drafted");
  assert(/cold emails are stopped/i.test(heldTurn.reply), "the held email is refused");

  const sibling = await runLighthouseChatTurn({
    message: "Draft a note for one@milon.co.za",
    snapshot: book,
    createdBy: "owner",
    persistDraft: async (write) => {
      draftedFor = write.leadId;
      return { touchId: "touch-z", status: "draft" as const };
    },
  });
  assert(draftedFor === "11111111-1111-4111-8111-111111111111", "the named sibling is the draft");
  assert(sibling.draft?.leadId === draftedFor, "the draft is for that sibling");
}

{
  const writes: string[] = [];
  const adminFor = (held: boolean) => ({
    from(table: string) {
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: async () => {
          if (table === "milon_ops_leads") {
            return {
              data: {
                company: "Cape Books",
                name: "Aneesa",
                email: "aneesa@capebooks.co.za",
                conversation_held: held,
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        insert(row: Record<string, unknown>) {
          writes.push(String(row.lead_id ?? ""));
          return {
            select() {
              return { maybeSingle: async () => ({ data: { id: "touch-new" }, error: null }) };
            },
          };
        },
      };
      return api;
    },
  });
  let refused = false;
  try {
    await persistPendingLighthouseDraft(
      adminFor(true),
      {
        leadId: "22222222-2222-4222-8222-222222222222",
        stepNo: 2,
        angle: "observation",
        subject: "Hi",
        body: "Hi",
        createdBy: "owner",
        action: "draft",
      },
    );
  } catch (error) {
    refused = true;
    assert(error instanceof Error && /cold emails are stopped/i.test(error.message), "persist names the stop");
  }
  assert(refused, "the shared draft write refuses a held lead");
  assert(writes.length === 0, "a held lead does not insert a touch");
  const saved = await persistPendingLighthouseDraft(adminFor(false), {
    leadId: "22222222-2222-4222-8222-222222222222",
    stepNo: 2,
    angle: "observation",
    subject: "Hi",
    body: "Hi",
    createdBy: "owner",
    action: "draft",
  });
  assert(saved.status === "draft", "an open lead can still be drafted");
  assert(writes.length === 1, "an open lead inserts one touch");
}

{
  const fnSrc = readFileSync(resolve("src/lib/lighthouse.functions.ts"), "utf8");
  const panelSrc = readFileSync(resolve("src/components/lighthouse-panel.tsx"), "utf8");
  const chatSrc = readFileSync(resolve("src/lib/lighthouse-agent-chat.ts"), "utf8");
  const agentSrc = readFileSync(resolve("src/lib/lighthouse-agent.ts"), "utf8");
  const persistSrc = readFileSync(resolve("src/lib/lighthouse-draft-persist.ts"), "utf8");
  const sql = readFileSync(
    resolve("supabase/migrations/20261006120000_milon_ops_leads_target_list.sql"),
    "utf8",
  );
  assert(fnSrc.includes("export const setConversationHeld"), "setConversationHeld exists");
  assert(fnSrc.includes("assertOpsConsoleAccess"), "conversation flag uses the ops console gate");
  const heldFn = fnSrc.slice(fnSrc.indexOf("export const setConversationHeld"));
  assert(heldFn.includes("assertOpsConsoleAccess"), "setConversationHeld itself is ops-gated");
  assert(fnSrc.includes("coldCadenceOpen"), "drafting checks the held flag");
  assert(fnSrc.includes("assertColdDraftOpen"), "sequence drafts refuse a held lead");
  assert(fnSrc.includes("resumedColdTouchOn"), "untick recomputes the next cold date");
  assert(fnSrc.includes("inferredTargetCountry"), "a save persists an inferred country");
  const heldFnBody = fnSrc.slice(
    fnSrc.indexOf("export const setConversationHeld"),
    fnSrc.indexOf("async function recordConversationActivity"),
  );
  assert(heldFnBody.includes("updated_at:"), "held writes bump updated_at");
  assert(heldFnBody.includes("next_touch_on: nextTouchOn"), "untick writes the resumed date");
  const replyFn = fnSrc.slice(
    fnSrc.indexOf("export const draftLighthouseReply"),
    fnSrc.indexOf("export const optOutLighthouseLead"),
  );
  assert(!replyFn.includes("assertColdDraftOpen"), "replies to inbound mail may still draft");
  assert(!replyFn.includes("heldColdDraftRefusal"), "reply drafts do not use the cold stop");
  const reviewFn = fnSrc.slice(
    fnSrc.indexOf("export const reviewLighthouseTouch"),
    fnSrc.indexOf("export const sendLighthouseTouch"),
  );
  const rejectBranch = reviewFn.slice(
    reviewFn.indexOf('if (data.action === "reject")'),
    reviewFn.indexOf("const replyTouch"),
  );
  assert(reviewFn.includes("isInboundReplyTouch"), "approve lets an inbound reply through");
  assert(reviewFn.includes("assertColdDraftOpen"), "approve refuses a held cold draft");
  assert(
    reviewFn.indexOf("assertColdDraftOpen") < reviewFn.indexOf('status: "approved"'),
    "approve checks the held flag before it writes",
  );
  assert(!rejectBranch.includes("assertColdDraftOpen"), "reject does not drop the draft via the cold stop");
  const sendFn = fnSrc.slice(
    fnSrc.indexOf("export const sendLighthouseTouch"),
    fnSrc.indexOf("export const upsertLighthouseAsset"),
  );
  assert(sendFn.includes("isInboundReplyTouch"), "send lets an inbound reply through");
  assert(sendFn.includes("assertColdDraftOpen"), "send refuses a held cold draft");
  assert(
    sendFn.indexOf("assertColdDraftOpen") < sendFn.indexOf(".update("),
    "send checks the held flag before it changes the touch",
  );
  assert(persistSrc.includes("assertColdDraftOpen"), "the shared draft write checks the held flag");
  assert(chatSrc.includes("resolveChatLead"), "chat resolves a lead before drafting");
  assert(chatSrc.includes("refuseColdDraft"), "chat refuses a held lead");
  assert(agentSrc.includes("export function refuseColdDraft"), "Next up and preview share the stop");
  assert(agentSrc.includes("export function assertColdDraftOpen"), "preview and sequence share the throw");
  assert(panelSrc.includes("checked={lead.conversationHeld}"), "the checkbox reads the lead");
  assert(panelSrc.includes("pendingLeadPatches"), "the row and checkbox share one optimistic patch");
  assert(panelSrc.includes("displayedLeadMarket"), "the SA/US filter uses inferred country");
  assert(/phoneSaved[\s\S]{0,240}Saved/.test(panelSrc), "phone save shows Saved");
  assert(/websiteSaved[\s\S]{0,240}Saved/.test(panelSrc), "website save shows Saved");
  assert(panelSrc.includes("e.currentTarget.value"), "blur save reads the field, not a stale render");
  assert(panelSrc.includes("shouldFlushContactOnPointerDown"), "a click outside the field flushes the edit");
  assert(panelSrc.includes("reseedDrawerField"), "refetch re-seeds a field only when it is idle");
  assert(panelSrc.includes("applyNormalisedAfterSave"), "a save normalises only the value that was sent");
  assert(panelSrc.includes("phoneFocused") && panelSrc.includes("websiteFocused"), "phone and website track focus");
  const saveContact = panelSrc.slice(
    panelSrc.indexOf("onSaveContact={async"),
    panelSrc.indexOf("onConversationHeld"),
  );
  assert(!saveContact.includes("await refresh()"), "Saved does not wait for the list refetch");
  assert(
    panelSrc.includes('addEventListener("pointerdown", onPointerDown, true)'),
    "the flush runs on pointer down before focus can be cancelled",
  );
  assert(panelSrc.includes("flushPendingContact"), "close, Escape, and the backdrop flush pending edits");
  const closeAt = panelSrc.indexOf("const closeDrawer");
  const closeFn = panelSrc.slice(closeAt, panelSrc.indexOf("return (", closeAt));
  assert(!/event\.preventDefault/.test(closeFn), "the close control does not swallow blur");
  assert(panelSrc.includes("heldColdApproveReason"), "Approve and Send read the held-lead reason");
  assert(panelSrc.includes("Boolean(heldColdReason)"), "Approve and Send are disabled while a call is held");
  assert(fnSrc.includes("scheduledColdTouchOn"), "sending does not schedule a held lead");
  assert(fnSrc.includes('created_by_kind: "human"'), "a held call is recorded as a human activity");
  assert(panelSrc.includes("Call / meeting held"), "the drawer labels the checkbox");
  assert(panelSrc.includes("Target · not contacted"), "the list can filter fresh targets");
  assert(
    panelSrc.includes(">US<") && panelSrc.includes(">SA<") && panelSrc.includes(">All<"),
    "US / SA / All filter",
  );
  assert(panelSrc.includes("· Held"), "rows show a Held indicator");
  assert(sql.includes("ADD COLUMN IF NOT EXISTS country text"), "country is added if missing");
  assert(sql.includes("conversation_held boolean NOT NULL DEFAULT false"), "held defaults off");
  assert(
    sql.includes("CHECK (country IS NULL OR country IN ('US', 'SA', 'OTHER'))"),
    "country check",
  );
  assert(
    sql.includes(
      "CHECK (conversation_kind IS NULL OR conversation_kind IN ('phone', 'video', 'in_person'))",
    ),
    "kind check",
  );
  assert(sql.includes("milon_ops_leads_country_idx"), "country is indexed");
  assert(sql.includes("lower(email)"), "email dedupe uses lower(email)");
  assert(
    sql.includes("CREATE UNIQUE INDEX milon_ops_leads_email_lower_idx"),
    "unique email index when safe",
  );
  assert(
    !sql.includes("INSERT INTO public.lighthouse_"),
    "migration does not copy into Phase-1 CRM tables",
  );
}

console.log("lighthouse-targets: ok");
