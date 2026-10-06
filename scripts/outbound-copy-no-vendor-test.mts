/**
 * Outbound prospect copy must not name an AI vendor or model.
 * Run: pnpm test:outbound-copy-no-vendor
 *
 * Covers Lighthouse golden templates, cadence email bodies, and the
 * drafts the agent would actually save. Public routes, legal pages,
 * settings, and in-product disclosure are out of scope.
 */
import {
  ACCOUNTANT_ONESHOT_GOLDEN,
  ACCOUNTANT_ONESHOT_TEMPLATE,
  ACCOUNTANT_V1_GOLDEN,
  fillAccountantSequenceGolden,
} from "../src/lib/lighthouse-accountant-golden";
import { composeFollowUpDraft, lockChatDraft, type ChatFirm } from "../src/lib/lighthouse-agent-chat";

const VENDOR = /\b(claude|anthropic|openai|gpt)\b/i;

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function assertClean(label: string, text: string) {
  const hit = text.match(VENDOR);
  assert(!hit, `${label} names a model vendor (${hit?.[0]})`);
}

for (const email of ACCOUNTANT_V1_GOLDEN) {
  assertClean(`accountant_v1 step ${email.step} subject`, email.subject);
  assertClean(`accountant_v1 step ${email.step} body`, email.body);
}

assertClean("oneshot subject", ACCOUNTANT_ONESHOT_GOLDEN.subject);
assertClean("oneshot body", ACCOUNTANT_ONESHOT_GOLDEN.body);
assertClean("oneshot template subject", ACCOUNTANT_ONESHOT_TEMPLATE.subject);
assertClean("oneshot template body", ACCOUNTANT_ONESHOT_TEMPLATE.body);

for (const stepNo of [1, 2, 3, 4, 5]) {
  const filled = fillAccountantSequenceGolden({
    sequenceKey: "accountant_v1",
    stepNo,
    name: "Thandi Molefe",
    firm: "Molefe Inc",
    trialLink: "https://app.example/?lh=tok#register",
  });
  assertClean(`filled drip step ${stepNo} subject`, filled.subject);
  assertClean(`filled drip step ${stepNo} body`, filled.body);
}

const filledOneshot = fillAccountantSequenceGolden({
  sequenceKey: "accountant_oneshot_v1",
  stepNo: 1,
  name: "Thandi Molefe",
  firm: "Molefe Inc",
});
assertClean("filled oneshot subject", filledOneshot.subject);
assertClean("filled oneshot body", filledOneshot.body);

const oneshot = ACCOUNTANT_ONESHOT_GOLDEN.body;
assert(oneshot.includes("our AI agent"), "oneshot says our AI agent");
assert(oneshot.includes("https://youtu.be/J4vJki7HcIs"), "oneshot keeps the firm teaser");
assert(oneshot.includes("https://youtu.be/k3aRM4toTvU"), "oneshot keeps the owner teaser");
assert(oneshot.trimEnd().endsWith("The Milōn Team"), "oneshot signs The Milōn Team");
assert(oneshot.includes("We’ll give you a call shortly"), "oneshot keeps the follow-up call");
assert(!/\btheo\b/i.test(oneshot), "oneshot has no founder name");
assert(!/outsourced\s+cfo|\bocfo\b/i.test(oneshot), "oneshot never mentions Outsourced CFO");

function firm(geo: "US" | "SA"): ChatFirm {
  return {
    leadId: "lead-1",
    title: geo === "US" ? "Acme Plumbing" : "Cape Books",
    email: "ada@example.com",
    geo,
    stage: "contacted",
    lastTouch: null,
    nextTouchOn: null,
    nextFollowUpAt: null,
    delivery: null,
    replyStatus: null,
    doNotContact: false,
    sequenceStep: 1,
    touches: [],
  };
}

for (const geo of ["US", "SA"] as const) {
  const draft = composeFollowUpDraft(firm(geo));
  assertClean(`${geo} follow-up subject`, draft.subject);
  assertClean(`${geo} follow-up body`, draft.body);
  assert(/QuickBooks/i.test(draft.body) && /Xero/i.test(draft.body), `${geo} follow-up keeps the QBO and Xero lead`);
  assert(draft.body.includes("https://youtu.be/J4vJki7HcIs"), `${geo} follow-up keeps the firm teaser`);
  assert(draft.body.includes("https://youtu.be/k3aRM4toTvU"), `${geo} follow-up keeps the owner teaser`);
}

const locked = lockChatDraft({
  subject: "A note from Theo, Founder",
  body: "Theo here from Outsourced CFO. US firms get a 50% discount. Claude wrote this.",
  geo: "US",
  firmTitle: "Acme Plumbing",
});
assertClean("locked draft subject", locked.subject);
assertClean("locked draft body", locked.body);
assert(locked.body.includes("The MILŌN Team"), "locked draft signs the team");
assert(/QuickBooks/i.test(locked.body) && /Xero/i.test(locked.body), "locked draft keeps the QBO and Xero lead");
assert(!/outsourced\s+cfo|\bocfo\b/i.test(locked.body), "locked draft drops Outsourced CFO");

console.log("outbound-copy-no-vendor-test: ok");
