/**
 * Lighthouse accountant_v1 golden default — Theo’s v3 emails, Claude rewrite-only.
 * Run: pnpm test:lighthouse-accountant-golden
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ACCOUNTANT_ONESHOT_ACCOUNTANT_PAGER_URL,
  ACCOUNTANT_ONESHOT_GOLDEN,
  ACCOUNTANT_ONESHOT_OWNER_PAGER_URL,
  ACCOUNTANT_ONESHOT_SEQUENCE_KEY,
  ACCOUNTANT_ONESHOT_TEMPLATE,
  ACCOUNTANT_V1_GOLDEN,
  ACCOUNTANT_V1_SEQUENCE_KEY,
  accountantOneshotCopyReady,
  accountantV1GoldenStep,
  fillAccountantSequenceGolden,
  fillAccountantV1Golden,
  fillGoldenTokens,
  firstNameFromLeadName,
  lighthouseDraftCallsClaude,
  lighthouseOneshotAttachments,
  resolveLighthouseDraftEngine,
  sequenceUsesGoldenDefault,
} from "../src/lib/lighthouse-accountant-golden";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(ACCOUNTANT_V1_GOLDEN.length === 5, "five golden emails");
assert(ACCOUNTANT_V1_GOLDEN.map((g) => g.step).join(",") === "1,2,3,4,5", "steps 1–5");
assert(ACCOUNTANT_V1_GOLDEN.map((g) => g.day).join(",") === "0,4,9,17,28", "cadence 0/4/9/17/28");

const subjects = ACCOUNTANT_V1_GOLDEN.map((g) => g.subject);
assert(subjects[0] === "A different way to scale your bookkeeping", "step 1 subject");
assert(subjects[1] === "Your team shouldn't have to chase clients", "step 2 subject");
assert(subjects[2] === "I think accounting software has become too complicated", "step 3 subject");
assert(subjects[3] === "A slightly unusual question", "step 4 subject");
assert(subjects[4] === "Could {{firm}} handle 2x the clients?", "step 5 subject token");

for (const email of ACCOUNTANT_V1_GOLDEN) {
  assert(email.body.includes("Milōn"), `step ${email.step} preserves Milōn spelling`);
  assert(email.body.trimEnd().endsWith("The Milōn Team"), `step ${email.step} signs The Milōn Team`);
  assert(email.body.includes("{{name}}"), `step ${email.step} has {{name}}`);
}

assert(!ACCOUNTANT_V1_GOLDEN[0].body.includes("http"), "day 0 has no links");
assert(!ACCOUNTANT_V1_GOLDEN[0].body.includes("{{trial_link}}"), "day 0 has no trial token");
assert(ACCOUNTANT_V1_GOLDEN[1].body.includes("https://youtu.be/J4vJki7HcIs"), "day 4 firm teaser");
assert(ACCOUNTANT_V1_GOLDEN[1].body.includes("https://youtu.be/k3aRM4toTvU"), "day 4 owner teaser");
assert(!ACCOUNTANT_V1_GOLDEN[1].body.includes("{{trial_link}}"), "day 4 has no trial token");
assert(ACCOUNTANT_V1_GOLDEN[2].body.includes("{{trial_link}}"), "day 9 trial token");
assert(!ACCOUNTANT_V1_GOLDEN[2].body.includes("youtu.be"), "day 9 has no video links");
assert(!ACCOUNTANT_V1_GOLDEN[3].body.includes("http"), "day 17 has no links");
assert(!ACCOUNTANT_V1_GOLDEN[3].body.includes("{{trial_link}}"), "day 17 has no trial token");
assert(ACCOUNTANT_V1_GOLDEN[4].body.includes("{{trial_link}}"), "day 28 trial token");
assert(ACCOUNTANT_V1_GOLDEN[4].body.includes("https://youtu.be/J4vJki7HcIs"), "day 28 firm teaser");
assert(ACCOUNTANT_V1_GOLDEN[4].body.includes("https://youtu.be/k3aRM4toTvU"), "day 28 owner teaser");

assert(firstNameFromLeadName("Jane Doe") === "Jane", "first name from full name");
assert(firstNameFromLeadName("Theo") === "Theo", "single name");
assert(firstNameFromLeadName("  ") === "", "blank name");
assert(firstNameFromLeadName(null) === "", "null name");

const tokens = {
  name: "Jane Doe",
  firm: "Smith & Co",
  trialLink: "https://app.example/?lh=tok#register",
};
const filled1 = fillAccountantV1Golden(1, tokens);
assert(filled1.subject === subjects[0], "filled step 1 subject unchanged");
assert(filled1.body.startsWith("Hi Jane,"), "fills first name");
assert(filled1.body.includes("at Smith & Co at the moment"), "fills firm");
assert(!filled1.body.includes("{{"), "step 1 has no leftover tokens");

const filled3 = fillAccountantV1Golden(3, tokens);
assert(filled3.body.includes("https://app.example/?lh=tok#register"), "step 3 fills trial_link");
assert(!filled3.body.includes("{{trial_link}}"), "step 3 token consumed");

const filled5 = fillAccountantV1Golden(5, tokens);
assert(filled5.subject === "Could Smith & Co handle 2x the clients?", "step 5 subject fills firm");
assert(filled5.body.includes("If Smith & Co doubled"), "step 5 body fills firm");
assert(filled5.body.includes("https://app.example/?lh=tok#register"), "step 5 fills trial_link");

const noName = fillGoldenTokens("Hi {{name}},\n\nHello {{firm}}.", { name: "", firm: "" });
assert(noName.startsWith("Hi,"), "missing name collapses Hi,");
assert(noName.includes("your firm"), "missing firm falls back");

assert(accountantV1GoldenStep(2).day === 4, "step lookup");
let threw = false;
try {
  accountantV1GoldenStep(9);
} catch {
  threw = true;
}
assert(threw, "unknown step throws");

assert(sequenceUsesGoldenDefault(ACCOUNTANT_V1_SEQUENCE_KEY), "accountant_v1 is golden-default");
assert(sequenceUsesGoldenDefault(ACCOUNTANT_ONESHOT_SEQUENCE_KEY), "oneshot hook is golden-default");
assert(!sequenceUsesGoldenDefault("owner_v1"), "owner_v1 stays Claude-first");

assert(
  resolveLighthouseDraftEngine("accountant_v1", "default") === "golden",
  "accountant default engine is golden",
);
assert(
  resolveLighthouseDraftEngine("accountant_v1", "rewrite") === "claude",
  "accountant rewrite engine is claude",
);
assert(
  resolveLighthouseDraftEngine("owner_v1", "default") === "claude",
  "owner default engine is claude",
);
assert(
  resolveLighthouseDraftEngine("owner_v1", "rewrite") === "claude",
  "owner rewrite engine is claude",
);

assert(!lighthouseDraftCallsClaude("accountant_v1", "default"), "primary accountant path does not call Claude");
assert(lighthouseDraftCallsClaude("accountant_v1", "rewrite"), "rewrite path still can call Claude");
assert(lighthouseDraftCallsClaude("owner_v1", "default"), "owner primary still calls Claude");
assert(!lighthouseDraftCallsClaude("accountant_oneshot_v1", "default"), "oneshot default does not call Claude");
assert(lighthouseDraftCallsClaude("accountant_oneshot_v1", "rewrite"), "oneshot rewrite still can call Claude");

assert(ACCOUNTANT_ONESHOT_TEMPLATE.sequenceKey === ACCOUNTANT_ONESHOT_SEQUENCE_KEY, "oneshot key");
assert(ACCOUNTANT_ONESHOT_TEMPLATE.kind === "oneshot", "oneshot kind");
assert(accountantOneshotCopyReady(), "oneshot copy is in repo");
assert(ACCOUNTANT_ONESHOT_GOLDEN.subject === "A better way to grow advisory", "oneshot subject");
assert(ACCOUNTANT_ONESHOT_GOLDEN.body.includes("{{name}}"), "oneshot has {{name}}");
assert(ACCOUNTANT_ONESHOT_GOLDEN.body.includes("https://youtu.be/J4vJki7HcIs"), "oneshot accountant teaser");
assert(ACCOUNTANT_ONESHOT_GOLDEN.body.includes("https://youtu.be/k3aRM4toTvU"), "oneshot owner teaser");
assert(
  ACCOUNTANT_ONESHOT_GOLDEN.body.includes(ACCOUNTANT_ONESHOT_ACCOUNTANT_PAGER_URL),
  "oneshot accountant one-pager URL",
);
assert(
  ACCOUNTANT_ONESHOT_GOLDEN.body.includes(ACCOUNTANT_ONESHOT_OWNER_PAGER_URL),
  "oneshot owner one-pager URL",
);
assert(ACCOUNTANT_ONESHOT_GOLDEN.body.includes("We’ll give you a call shortly"), "oneshot keeps the call");
assert(ACCOUNTANT_ONESHOT_GOLDEN.body.trimEnd().endsWith("The Milōn Team"), "oneshot signs The Milōn Team");
assert(ACCOUNTANT_ONESHOT_GOLDEN.body.includes("Milōn"), "oneshot preserves Milōn spelling");

const oneshotFilled = fillAccountantSequenceGolden({
  sequenceKey: ACCOUNTANT_ONESHOT_SEQUENCE_KEY,
  stepNo: 1,
  name: "Thandi Molefe",
  firm: "Molefe Inc",
});
assert(oneshotFilled.subject === "A better way to grow advisory", "oneshot filled subject");
assert(oneshotFilled.body.startsWith("Hi Thandi,"), "oneshot fills first name");
assert(!oneshotFilled.body.includes("{{name}}"), "oneshot name token consumed");
assert(oneshotFilled.body.includes("We’ll give you a call shortly"), "filled oneshot still mentions a call");

let oneshotStepThrew = false;
try {
  fillAccountantSequenceGolden({ sequenceKey: ACCOUNTANT_ONESHOT_SEQUENCE_KEY, stepNo: 2 });
} catch {
  oneshotStepThrew = true;
}
assert(oneshotStepThrew, "oneshot has only step 1");

const attached = lighthouseOneshotAttachments();
assert(attached.length === 2, "oneshot attaches both PDFs");
assert(attached[0].path === ACCOUNTANT_ONESHOT_ACCOUNTANT_PAGER_URL, "oneshot accountant PDF path");
assert(attached[1].path === ACCOUNTANT_ONESHOT_OWNER_PAGER_URL, "oneshot owner PDF path");

const viaSeq = fillAccountantSequenceGolden({
  sequenceKey: ACCOUNTANT_V1_SEQUENCE_KEY,
  stepNo: 4,
  name: "Pat Lee",
  firm: "Lee Partners",
});
assert(viaSeq.subject === "A slightly unusual question", "sequence helper step 4 subject");
assert(viaSeq.body.startsWith("Hi Pat,"), "sequence helper fills name");

const fns = readFileSync(resolve("src/lib/lighthouse.functions.ts"), "utf8");
const draftStart = fns.indexOf("export const draftLighthouseTouch");
const draftEnd = fns.indexOf("export const sendLighthouseTouch");
assert(draftStart >= 0 && draftEnd > draftStart, "draft handler bounds");
const draftSlice = fns.slice(draftStart, draftEnd);
assert(draftSlice.includes("resolveLighthouseDraftEngine"), "draft uses engine resolver");
assert(draftSlice.includes("fillAccountantSequenceGolden"), "draft can fill golden");
assert(draftSlice.includes('mode: z.enum(["default", "rewrite"])'), "draft accepts rewrite mode");
assert(draftSlice.includes('if (engine === "golden")'), "golden branch is explicit");

const goldenStart = draftSlice.indexOf('if (engine === "golden")');
const goldenElse = draftSlice.indexOf("} else {", goldenStart);
assert(goldenStart >= 0 && goldenElse > goldenStart, "golden if/else");
const goldenBranch = draftSlice.slice(goldenStart, goldenElse);
assert(!goldenBranch.includes("callClaudeMessages"), "primary golden path does not call Claude");
assert(draftSlice.includes("callClaudeMessages"), "rewrite / owner path still calls Claude");
assert(draftSlice.includes("REWRITE TASK"), "rewrite prompt is labeled");

const sendSlice = fns.slice(fns.indexOf("export const sendLighthouseTouch"));
const sendBody = sendSlice.slice(0, sendSlice.indexOf("export const upsertLighthouseAsset"));
assert(sendBody.includes("lighthouseOnePagerAttachments"), "send still attaches one-pager");
assert(sendBody.includes("lighthouseOneshotAttachments"), "oneshot send attaches both PDFs");
assert(sendBody.includes("assertLighthouseSendRecipientAllowed"), "send allowlist unchanged");
assert(fns.includes("KEEP the line that we will call shortly"), "oneshot rewrite keeps the call");
assert(fns.includes("Do not offer a call, a meeting"), "drip rewrite still forbids a call");
assert(fns.includes("noCallInstruction"), "call instruction is sequence-scoped");

const panel = readFileSync(resolve("src/components/lighthouse-panel.tsx"), "utf8");
assert(panel.includes("Load golden"), "ops primary accountant action is Load golden");
assert(panel.includes("Rewrite"), "ops exposes Rewrite");
assert(panel.includes("Draft with Claude"), "owner path keeps Draft with Claude");
assert(panel.includes("mode: \"rewrite\""), "Rewrite passes rewrite mode");
assert(panel.includes("mode: \"default\""), "Load golden / owner draft pass default mode");
assert(panel.includes("ACCOUNTANT_ONESHOT_SEQUENCE_KEY"), "playbook shows oneshot sequence");
assert(panel.includes("Accountant one-shot / single banger"), "oneshot path is labeled");
assert(panel.includes("One-shot banger"), "ops can pick the one-shot path");
assert(
  panel.includes("disabled={drafting || rewriting || lead.doNotContact}"),
  "Load golden does not require Anthropic",
);

const v3 = readFileSync(resolve("src/lib/lighthouse-accountant-golden.ts"), "utf8");
assert(v3.includes("The Milōn Team"), "golden module has team sign-off");
assert(v3.includes("We’ll give you a call shortly"), "oneshot golden keeps the call");
assert(!v3.includes("Lorem"), "oneshot copy is not filler");

const migration = readFileSync(
  resolve("supabase/migrations/20260911080000_lighthouse_accountant_oneshot_v1.sql"),
  "utf8",
);
assert(migration.includes("accountant_oneshot_v1"), "migration seeds oneshot sequence");
assert(!/WHERE key = ['"]accountant_v1['"]/.test(migration), "oneshot migration does not rewrite drip");
assert(!/WHERE key = ['"]owner_v1['"]/.test(migration), "oneshot migration does not rewrite owner");

console.log("lighthouse-accountant-golden-test: ok");
