/**
 * Solution-play catalogue for the Implementation Manager plan.
 * Run: pnpm test:im-solution-plays
 */
import { existsSync, readFileSync } from "node:fs";
import { buildCapabilityManifest } from "../src/lib/im-capability-manifest.ts";
import {
  applyOpusIntegrationPlan,
  buildIntegrationPlanTable,
  integrationPlanPrompt,
  type IntegrationPlanRow,
} from "../src/lib/im-integration-plan.ts";
import {
  IM_PLAN_APPROVE,
  SOLUTION_PLAY_IDS,
  solutionPlays,
} from "../src/lib/im-solution-plays.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const manifest = buildCapabilityManifest("ZA");
const plays = solutionPlays(manifest);
assert(plays.map((play) => play.id).join(",") === SOLUTION_PLAY_IDS.join(","), "the catalogue is the nine approved plays");
assert(new Set(plays.map((play) => play.id)).size === plays.length, "play ids are unique");
for (const play of plays) {
  assert(existsSync(play.source), `${play.id} maps to a real file`);
  assert(play.question.trim().endsWith("?"), `${play.id} problem is a question`);
  assert(play.output.trim().length > 0, `${play.id} names an output`);
  assert(play.routine.trim().length > 0, `${play.id} has a default routine`);
  assert(/asks the client/i.test(play.clientSees), `${play.id} says what the client is asked to do`);
  assert(
    ["Financial Manager", "Analyst", "Advisor", "Tax Specialist"].includes(play.bot),
    `${play.id} bot is one of the four`,
  );
}
assert(readFileSync("src/lib/dupont-diagnosis.ts", "utf8").includes("diagnoseDuPont"), "diagnose maps to DuPont");
assert(
  readFileSync("src/lib/client-agent-send.functions.ts", "utf8").includes("checklist"),
  "document collection maps to send-an-agent",
);
assert(
  readFileSync("src/lib/agent-financial-manager.ts", "utf8").includes("get_cash_13_week"),
  "cash flow maps to get_cash_13_week",
);
assert(
  readFileSync("src/lib/budget.variance.ts", "utf8").includes("computeMonthVariance"),
  "budget maps to budget versus actual",
);
assert(readFileSync("src/lib/im-integration-plan.ts", "utf8").includes("milonWillDo") === false, "fixed Milōn sentences are gone");

const stripped = buildCapabilityManifest("ZA");
const fm = stripped.agents.find((agent) => agent.displayName === "Financial Manager");
if (fm) fm.tools = fm.tools.filter((tool) => tool !== "13-week cash");
stripped.classifiers = stripped.classifiers.filter((row) => row.stepType !== "cash_forecast");
assert(!solutionPlays(stripped).some((play) => play.id === "cash-flow"), "a play drops when the manifest loses its tool");
const analyst = stripped.agents.find((agent) => agent.displayName === "Analyst");
if (analyst) analyst.tools = analyst.tools.filter((tool) => tool !== "Health");
assert(!solutionPlays(stripped).some((play) => play.id === "diagnose"), "diagnose drops without the Analyst health tool");

function sectionsInOrder(rows: readonly IntegrationPlanRow[]) {
  const lead = rows.filter((row) => row.section === "lead");
  assert(lead.length >= 3 && lead.length <= 5, `lead plays are 3 to 5 (${lead.length})`);
  const firstCovered = rows.findIndex((row) => row.section === "already_covered");
  if (firstCovered === -1) return;
  assert(rows.slice(0, firstCovered).every((row) => row.section === "lead"), "lead rows come first");
  assert(
    rows.slice(firstCovered).every((row) => row.section === "already_covered"),
    "already covered rows are at the end",
  );
}

const ranked = buildIntegrationPlanTable({
  interview: "A: The painful one is cash. We only see it when we cannot pay salaries.",
  steps: [
    {
      step: "Clients send invoices and bank statements to the firm as PDF email attachments — Clients; Email (PDF attachments); Monthly",
      bucket: "client_setup",
    },
    { step: "Review budget versus actual drift — Firm; Monthly", bucket: "covered" },
  ],
  country: "ZA",
});
sectionsInOrder(ranked);
assert(ranked[0]?.playId === "cash-flow", "the strongest pain is the first play");
assert(ranked[0]?.milon === "13-week cash forecast with a red-week warning", "cash names the forecast output");
assert(ranked[0]?.routine === "Every week", "cash keeps the default routine");
assert(ranked[0]?.bot === "Financial Manager", "cash stays with Financial Manager");
assert(ranked[0]?.problem.startsWith("Will cash run short in the next 13 weeks?"), "the problem stays a question");
assert(/you said/i.test(ranked[0]?.problem ?? ""), "the question is made specific with the interview");
assert(ranked[0]?.approve === IM_PLAN_APPROVE, "approval copy is the fixed line");
assert(/asks the client/i.test(ranked[0]?.clientSees ?? ""), "the client sees an ask");
assert(ranked.find((row) => row.playId === "budget")?.section === "already_covered", "covered work sits at the end");
assert(
  ranked.every((row) => (SOLUTION_PLAY_IDS as readonly string[]).includes(row.playId)),
  "every row is a catalogue play",
);
const rankedBlob = JSON.stringify(ranked);
assert(!/posted to (?:Xero|QuickBooks|Sage|SARS)/i.test(rankedBlob), "nothing is posted to a ledger or SARS");
assert(!rankedBlob.includes("Drafts this step for your review"), "rows are not the old generic sentence");
const whatsapp = JSON.stringify(
  buildIntegrationPlanTable({
    interview: "A: We chase the missing documents on WhatsApp.",
    country: "ZA",
  }),
);
assert(!whatsapp.includes("WhatsApp"), "accountant copy does not say WhatsApp");
assert(/a message/i.test(whatsapp), "a WhatsApp chase is described as a message");
const signOff = buildIntegrationPlanTable({
  steps: [{ step: "Who signs the pack", bucket: "client_setup" }],
  country: "ZA",
});
const signOffBlob = JSON.stringify(signOff);
assert(signOffBlob.includes("Who signs the pack"), "a sign-off step stays in the plan");
assert(signOff.find((row) => row.playId === "management-pack")?.bot === "Analyst", "sign-off stays on the management pack");
assert(!/Product gap|Client setup|Already covered|Bespoke/.test(signOffBlob), "triage labels stay off a sign-off plan");

const tax = buildIntegrationPlanTable({
  steps: [{ step: "Prepare the VAT201 for review — Firm; Monthly", bucket: "client_setup" }],
  country: "ZA",
}).find((row) => row.playId === "tax-deadlines");
assert(tax?.bot === "Tax Specialist", "tax dates belong to the Tax Specialist");
assert(/nothing is filed/i.test(`${tax?.milon} ${tax?.clientSees}`), "the tax play files nothing");
assert(/SARS/.test(`${tax?.milon} ${tax?.clientSees}`), "a ZA tax play says SARS");
assert(!/\bHMRC\b|\bIRS\b/.test(`${tax?.milon} ${tax?.clientSees}`), "a ZA tax play does not say HMRC or IRS");

const fallback = buildIntegrationPlanTable({
  interview: "A: Clients never hear what we did, and cash is the worry.",
  steps: [],
  country: "ZA",
});
const accepted = applyOpusIntegrationPlan(
  JSON.stringify({
    ranked: ["cash-flow", "not-a-play", "monthly-client-update"],
    alreadyCovered: ["budget", "nope"],
  }),
  fallback,
  { country: "ZA", interview: "A: Clients never hear what we did, and cash is the worry.", plays },
);
assert(accepted.rejected.includes("not-a-play") && accepted.rejected.includes("nope"), "unknown play ids are rejected");
assert(
  accepted.rows.every((row) => row.playId !== "not-a-play" && row.playId !== "nope"),
  "a rejected id is not a row",
);
assert(
  accepted.rows.every((row) => (SOLUTION_PLAY_IDS as readonly string[]).includes(row.playId)),
  "accepted rows stay on the catalogue",
);
assert(accepted.rows[0]?.playId === "cash-flow", "Opus rank order is kept");
assert(accepted.rows.find((row) => row.playId === "budget")?.section === "already_covered", "Opus already-covered ids stay at the end");
sectionsInOrder(accepted.rows);
const onlyUnknown = applyOpusIntegrationPlan(
  JSON.stringify({ ranked: ["made-up"], alreadyCovered: ["also-made-up"] }),
  fallback,
  { country: "ZA", interview: "A: cash", plays },
);
assert(onlyUnknown.rejected.includes("made-up"), "an unknown-only reply is rejected");
assert(!onlyUnknown.rows.some((row) => row.playId === "made-up"), "the fallback does not grow an unknown play");

const usPrompt = integrationPlanPrompt({
  plays,
  interview: "A: File the return with HMRC.",
  country: "US",
});
assert(usPrompt.includes("cash-flow") && usPrompt.includes("Interview answers"), "Opus gets the catalogue and the interview");
assert(/\bIRS\b/.test(usPrompt) && /sales tax/i.test(usPrompt), "a US prompt says IRS and sales tax");
assert(!/\bSARS\b|\bHMRC\b|\bZA\b/.test(usPrompt), "a US prompt does not say SARS, HMRC, or ZA");
const zaPrompt = integrationPlanPrompt({
  plays,
  interview: "A: File the return with HMRC.",
  country: "ZA",
});
assert(/\bSARS\b/.test(zaPrompt), "a ZA prompt says SARS");
assert(!/\bHMRC\b|\bIRS\b/.test(zaPrompt), "a ZA prompt does not say HMRC or IRS");
const ukPrompt = integrationPlanPrompt({
  plays,
  interview: "A: File the return with SARS.",
  country: "UK",
});
assert(/\bHMRC\b/.test(ukPrompt), "a UK prompt says HMRC");
assert(!/\bSARS\b|\bIRS\b/.test(ukPrompt), "HMRC appears only for a UK prompt");

const activation = readFileSync("src/lib/im-activation.functions.ts", "utf8");
assert(activation.includes("applyOpusIntegrationPlan"), "the server applies the Opus id list");
assert(activation.includes("rejected"), "the server reports rejected ids");
assert(!activation.includes("milon: z.string()"), "the server does not accept a free-typed Milōn sentence");
const panel = readFileSync("src/components/practice-setup-panel.tsx", "utf8");
assert(panel.includes("The problem") && panel.includes("What Milōn does"), "the table uses the play columns");
assert(panel.includes("What the client sees") && panel.includes("You approve"), "the client and approval columns are shown");
assert(panel.includes("Already covered"), "already covered rows are labelled");
assert(!panel.includes("What Milōn will do"), "the generic column is gone");
assert(!panel.includes("rows: localRows"), "the panel does not send prewritten solution sentences");

console.log("im-solution-plays-test: ok");
