/**
 * Owner door answers, presence, and motion clocks.
 * Empty books never invent a figure. Run: pnpm test:owner-door
 */
import { existsSync, readFileSync } from "node:fs";
import { ownerBotLayout } from "../src/components/owner-door/owner-home.tsx";
import { avatarRhythm } from "../src/components/owner-door/owner-rhythm.ts";
import { agentShortName } from "../src/lib/milon-team.ts";
import { emptyAgentActivity, isVisibleAgentFinding, type AgentActivitySnapshot } from "../src/lib/milon-team-activity.ts";
import {
  guardOwnerLine,
  ownerAmount,
  ownerAnswerTiles,
  ownerCardStatuses,
  ownerHomeLines,
  cashFloorCopy,
  cashFloorForHome,
  practiceCardStatuses,
  practiceHomeLines,
  ownerTileLabel,
  type OwnerBooks,
} from "../src/lib/owner-answers.ts";
import { ZA_MARKET } from "../src/lib/market/resolve.ts";
import { ownerMoney, ownerOutflow } from "../src/lib/owner-money.ts";
import { ownerPlanFreeLine, ownerPlanLine } from "../src/lib/owner-plan.ts";
import { ownerNeedsView } from "../src/lib/owner-needs.ts";
import {
  canonicalOwnerScreen,
  isOwnerDeliverablesRequest,
  OWNER_SIGNED_SECTION_ID,
  ownerDeliverablesRedirectTarget,
} from "../src/lib/owner-nav.ts";
import {
  draftFindingKindLabel,
  draftFindingLabel,
  DRAFT_NEEDS_ACCOUNTANT,
  DRAFT_NEEDS_OWNER,
  handoffComingOnline,
  ownerRunPhase,
} from "../src/hooks/owner-agent-ui.ts";
import {
  AVATAR_CLIP_FPS,
  FM_AVATAR_CLIPS,
  FM_AVATAR_VERSION,
  avatarClipAtEnd,
  AVATAR_FOLDERS,
  avatarPoster,
  displayFmClip,
  fmAvatarClip,
  fmClipSources,
  fmIdleBudget,
  nextFmClip,
  nextFmIdleLoops,
} from "../src/lib/fm-avatar-state.ts";
import { ownerPresence, steerAssignedWork, steerOpenHandoffs } from "../src/lib/owner-presence.ts";
import {
  handedHomeAction,
  latestStoredAssignment,
  openHandoffAgents,
  preferPendingHandoff,
  rowAssignment,
  withPendingAssignment,
} from "../src/lib/open-plan-home.ts";
import type { AgentKey } from "../src/lib/milon-team-feed.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const usd = { currency: "USD" as const, locale: "en-US" };

function books(patch: Partial<OwnerBooks> = {}): OwnerBooks {
  return {
    hasBooks: false,
    ledger: null,
    revenue: null,
    priorRevenue: null,
    cogs: null,
    receivables: null,
    cashflow: null,
    openAction: null,
    actionsReady: true,
    signedBy: null,
    signedOn: null,
    market: usd,
    ...patch,
  };
}

const empty = ownerAnswerTiles(books());
for (const tile of empty) {
  assert(!/\$\s?\d/.test(tile.sentence), `empty tile has a figure: ${tile.sentence}`);
  assert(tile.signed === false, "an empty door is not signed off");
}
assert(
  empty.find((tile) => tile.id === "signed")?.sentence === "Invite your accountant to sign off.",
  "missing sign-off invites the accountant",
);
assert(
  empty.every((tile) => !/\bsigned off\b/i.test(tile.sentence)),
  "unsigned tiles do not say signed off",
);
assert(
  empty.find((tile) => tile.id === "cash")?.sentence === "Connect QuickBooks or Xero.",
  "cash asks to connect",
);

const filled = ownerAnswerTiles(
  books({
    hasBooks: true,
    ledger: "QuickBooks",
    revenue: 120000,
    priorRevenue: 100000,
    cogs: 48000,
    priorCogs: 40000,
    receivables: 18000,
    openAction: "Approve the payroll run.",
    actionsReady: true,
    signedBy: "Alex Morgan",
    signedOn: "2 Oct 2026",
    cashflow: {
      openingBalance: "80000",
      revenue: [{ amount: "5000", frequency: "recurring-weekly", startWeek: 1 }],
      expenses: [{ amount: "3000", frequency: "recurring-weekly", startWeek: 1 }],
    },
  }),
);
const cash = filled.find((tile) => tile.id === "cash");
assert(
  cash && !cash.empty && /\$\d/.test(cash.sentence.replace(/,/g, "")),
  `cash uses a real forecast (${cash?.sentence})`,
);
assert(ownerAmount(720000, ZA_MARKET).includes("\u00a0"), "grouped rand amounts do not break");
assert(
  filled.find((tile) => tile.id === "owes")?.sentence.startsWith("Customers owe"),
  "debtors come from the books",
);
assert(
  /Gross profit is/.test(filled.find((tile) => tile.id === "profit")?.sentence ?? ""),
  "profit is gross profit",
);
assert(
  filled.find((tile) => tile.id === "answer")?.sentence === "Approve the payroll run.",
  "the open action is the sentence",
);
const signed = filled.find((tile) => tile.id === "signed");
assert(
  signed?.signed === true && signed.sentence.startsWith("Alex Morgan signed off"),
  "only a named sign-off says so",
);
assert(ownerTileLabel(cash!, agentShortName).startsWith("Ask "), "ask labels use the short name");
const homeLines = ownerHomeLines(filled, "Collect the two largest invoices");
assert(homeLines.financial_manager.length === 2, "the financial manager has cash and the open answer");
assert(
  homeLines.financial_manager[0] !== cash?.sentence &&
    /^Cash stays above your \$[\d,]+ minimum\. The low point is \$[\d,]+\.$/.test(homeLines.financial_manager[0] ?? ""),
  `cash on home is a sentence (${homeLines.financial_manager[0]})`,
);
assert(homeLines.financial_manager[1] === "Approve the payroll run.", "the waiting answer stays under the financial manager");
assert(
  /^Gross profit is \$[\d,]+, up on last period\.$/.test(homeLines.analyst[0] ?? ""),
  `profit on home is a sentence (${homeLines.analyst[0]})`,
);
assert(homeLines.analyst[1]?.startsWith("Customers owe"), "debtors stay under the analyst");
assert(homeLines.advisor[0] === "Collect the two largest invoices.", "the advisor carries the top next move");
const handed = ownerHomeLines(filled, "Move fixed contracts to variable / usage-based pricing", "advisor");
assert(
  !handed.financial_manager.some((line) => line === "Approve the payroll run."),
  "a handed action leaves the financial manager",
);
assert(
  handed.advisor.includes("Approve the payroll run."),
  "a handed action sits on the assigned agent",
);
assert(
  handed.advisor.includes("Move fixed contracts to variable / usage-based pricing."),
  "the advisor still carries the next move",
);
const handedMove = ownerHomeLines(
  filled,
  "Move fixed contracts to variable / usage-based pricing",
  "advisor",
  "Audit and renegotiate your top 5 supplier contracts",
);
assert(
  handedMove.advisor.includes("Audit and renegotiate your top 5 supplier contracts."),
  "the newly handed action sits on the advisor",
);
assert(
  handedMove.financial_manager.includes("Approve the payroll run."),
  "an older open action stays on the financial manager",
);
for (const line of [...homeLines.financial_manager, ...homeLines.analyst, ...homeLines.advisor]) {
  assert(/^[A-Z]/.test(line) && /[.!?]$/.test(line), `a home line is a full sentence (${line})`);
}
const underBooks = ownerAnswerTiles(
  books({
    hasBooks: true,
    ledger: "QuickBooks",
    cashflow: {
      openingBalance: "20000",
      expenses: [{ amount: "4000", frequency: "recurring-weekly", startWeek: 1 }],
    },
  }),
);
const underHome = ownerHomeLines(underBooks, null);
assert(
  /^Cash \$[\d,]+, \$[\d,]+ below your \$[\d,]+ minimum\.$/.test(underHome.financial_manager[0] ?? ""),
  `a dip under the floor names the balance and the gap (${underHome.financial_manager[0]})`,
);
const outlookBooks = books({
  hasBooks: true,
  ledger: "QuickBooks",
  cashOutlook: {
    opening: 46330,
    closing: [46330],
    floor: 36900,
    dipsBelowFloorWeek: null,
  },
});
const outlookHome = ownerHomeLines(ownerAnswerTiles(outlookBooks), null);
assert(
  outlookHome.financial_manager[0] === "Cash is $46,330, above the $36,900 floor.",
  `home cash uses the health outlook (${outlookHome.financial_manager[0]})`,
);
assert(
  ownerCardStatuses(outlookBooks).financial_manager == null,
  "cash above the health floor is not Critical",
);
assert(
  ownerCardStatuses(
    books({
      hasBooks: true,
      ledger: "QuickBooks",
      cashflow: {
        openingBalance: "20000",
        expenses: [{ amount: "4000", frequency: "recurring-weekly", startWeek: 1 }],
      },
    }),
  ).financial_manager?.word === "Below your minimum",
  "cash under the floor is a floor alert, not the Watch band",
);
assert(
  ownerCardStatuses(
    books({
      hasBooks: true,
      revenue: 72000,
      priorRevenue: 90000,
      cogs: 20000,
      priorCogs: 20000,
    }),
  ).analyst?.tone === "attention",
  "a profit decline is Attention",
);
assert(
  ownerCardStatuses(books({ hasBooks: true, overdueReceivables: 1500 })).analyst?.word === "Attention",
  "overdue debtors are Attention",
);
assert(
  ownerCardStatuses(
    books({
      hasBooks: true,
      revenue: 120000,
      priorRevenue: 100000,
      cogs: 48000,
      priorCogs: 40000,
      overdueReceivables: 0,
    }),
  ).analyst === null,
  "profit up with nothing overdue has no chip",
);
assert(guardOwnerLine("get emails out to 10 clients") === "Get emails out to 10 clients.", "a fragment becomes a sentence");
assert(
  ownerCardStatuses(
    books({
      hasBooks: true,
      cashflow: {
        openingBalance: "80000",
        revenue: [{ amount: "5000", frequency: "recurring-weekly", startWeek: 1 }],
        expenses: [{ amount: "1000", frequency: "recurring-weekly", startWeek: 1 }],
      },
    }),
  ).financial_manager === null,
  "cash above the floor is not a problem",
);
assert(
  /13-week line is/.test(underBooks.find((tile) => tile.id === "cash")?.sentence ?? ""),
  "the cash tile keeps the long sentence",
);
const zaHome = ownerHomeLines(
  ownerAnswerTiles(
    books({
      hasBooks: true,
      ledger: "Xero",
      market: ZA_MARKET,
      revenue: 120000,
      priorRevenue: 100000,
      cogs: 48000,
      priorCogs: 40000,
      receivables: 18000,
    }),
  ),
  null,
);
assert(
  (zaHome.analyst[0] ?? "").includes("\u00a0") && (zaHome.analyst[1] ?? "").includes("\u00a0"),
  "home amounts keep a non-breaking space",
);
const emptyLines = ownerHomeLines(empty, null);
assert(emptyLines.financial_manager[0] === "Connect QuickBooks or Xero.", "an empty cash line stays honest");
assert(emptyLines.financial_manager[1] === "Nothing is waiting on you.", "an empty answer line stays honest");
assert(emptyLines.advisor[0] === "Connect QuickBooks or Xero.", "no books does not invent a next move");
assert(
  ownerHomeLines(ownerAnswerTiles(books({ hasBooks: true, actionsReady: true })), null).advisor[0] ===
    "No next move yet.",
  "books with no ranked move stay empty",
);

const quiet = ownerPresence(emptyAgentActivity());
assert(
  quiet.agents.every((agent) => agent.motion === "idle"),
  "no run is idle",
);
assert(
  quiet.agents.every((agent) => agent.fmClip === "idle"),
  "a quiet team rests on the idle clip",
);
assert(quiet.handoff === null, "no hand-off beam without a message");

function activity(patch: Partial<AgentActivitySnapshot>): AgentActivitySnapshot {
  return { ...emptyAgentActivity(), ...patch };
}

const working = ownerPresence(
  activity({
    runs: [
      {
        id: "run-1",
        agent: "analyst",
        client_id: "c",
        status: "running",
        queued_at: "2026-10-01T00:00:00.000Z",
        started_at: "2026-10-01T00:00:01.000Z",
        finished_at: null,
      },
    ],
  }),
);
assert(
  working.agents.find((agent) => agent.agent === "analyst")?.motion === "working",
  "a running job is working",
);
assert(
  working.agents.find((agent) => agent.agent === "analyst")?.sentence === "Working…",
  "working copy",
);
assert(
  working.agents.find((agent) => agent.agent === "analyst")?.fmClip === "working",
  "a running analyst plays the working clip",
);

const found = ownerPresence(
  activity({
    runs: [
      {
        id: "run-2",
        agent: "advisor",
        client_id: "c",
        status: "succeeded",
        queued_at: "2026-10-01T00:00:00.000Z",
        started_at: "2026-10-01T00:00:01.000Z",
        finished_at: "2026-10-01T00:05:00.000Z",
      },
    ],
    findings: [
      {
        id: "find-1",
        agent: "advisor",
        client_id: "c",
        title: "Two moves are ready.",
        detail: null,
        evidence: {},
        as_of: null,
        created_at: "2026-10-01T00:04:00.000Z",
      },
    ],
  }),
);
assert(
  found.agents.find((agent) => agent.agent === "advisor")?.motion === "found",
  "a finished finding is found",
);
assert(
  found.agents.find((agent) => agent.agent === "advisor")?.fmClip === "found-issue",
  "an advisor finding plays the found-issue clip",
);

const handoff = ownerPresence(
  activity({
    messages: [
      {
        id: "msg-1",
        client_id: "c",
        from_agent: "analyst",
        to_agent: "advisor",
        type: "handoff",
        payload: { text: "September made less." },
        created_at: "2026-10-02T00:00:00.000Z",
      },
    ],
  }),
);
assert(
  handoff.handoff?.from === "analyst" && handoff.handoff.to === "advisor",
  "hand-off keeps both ends",
);
assert(
  handoff.agents.find((agent) => agent.agent === "analyst")?.lookAt === "advisor",
  "the sender looks across",
);
assert(
  handoff.agents.find((agent) => agent.agent === "advisor")?.motion !== "working",
  "a hand-off message does not paint Working without an open action",
);
const hiddenByLaterNote = ownerPresence(
  activity({
    messages: [
      {
        id: "msg-old",
        client_id: "c",
        from_agent: "advisor",
        to_agent: "financial_manager",
        type: "handoff",
        payload: { text: "Profit Drivers is the weakest pillar." },
        created_at: "2026-10-02T00:00:00.000Z",
      },
      {
        id: "msg-new",
        client_id: "c",
        from_agent: "analyst",
        to_agent: "advisor",
        type: "status",
        payload: { text: "Run finished." },
        created_at: "2026-10-03T00:00:00.000Z",
      },
    ],
  }),
);
assert(
  hiddenByLaterNote.handoff?.sentence.includes("Profit Drivers is the weakest pillar"),
  "a later non-assignment message does not drop the hand-off note",
);
assert(
  hiddenByLaterNote.agents.find((agent) => agent.agent === "financial_manager")?.motion !== "working",
  "the financial manager is not Working with no open action",
);
assert(
  handoff.agents.find((agent) => agent.agent === "analyst")?.fmClip === "handoff" &&
    handoff.agents.find((agent) => agent.agent === "advisor")?.fmClip === "handoff",
  "both ends of a hand-off play the handoff clip",
);

const fmWorking = ownerPresence(
  activity({
    runs: [
      {
        id: "run-fm",
        agent: "financial_manager",
        client_id: "c",
        status: "running",
        queued_at: "2026-10-03T00:00:00.000Z",
        started_at: "2026-10-03T00:00:01.000Z",
        finished_at: null,
      },
    ],
  }),
);
const steered = steerAssignedWork(fmWorking, "advisor", { agent: "financial_manager", status: "running" });
assert(
  steered.agents.find((agent) => agent.agent === "advisor")?.motion === "working",
  "a handed run shows Working on the assigned agent",
);
assert(
  steered.agents.find((agent) => agent.agent === "financial_manager")?.motion === "idle",
  "Working leaves the financial manager when the action was handed on",
);
const foundAdvisor = ownerPresence(
  activity({
    findings: [
      {
        id: "find-old",
        agent: "advisor",
        client_id: "c",
        title: "Move fixed contracts to variable pricing.",
        detail: null,
        evidence: {},
        as_of: null,
        created_at: "2026-10-01T00:04:00.000Z",
      },
    ],
    runs: [
      {
        id: "run-old",
        agent: "advisor",
        client_id: "c",
        status: "succeeded",
        queued_at: "2026-10-01T00:00:00.000Z",
        started_at: "2026-10-01T00:00:01.000Z",
        finished_at: "2026-10-01T00:03:00.000Z",
      },
    ],
  }),
);
const workingHand = steerAssignedWork(foundAdvisor, "advisor", { agent: "advisor", status: "queued" });
assert(
  workingHand.agents.find((agent) => agent.agent === "advisor")?.motion === "working",
  "a new hand-off shows Working on the advisor even when an older finding is found",
);
const openAssignment = steerAssignedWork(foundAdvisor, "advisor", null);
assert(
  openAssignment.agents.find((agent) => agent.agent === "advisor")?.motion === "working",
  "an open assigned action shows Working ahead of found something",
);
assert(
  openAssignment.agents.find((agent) => agent.agent === "advisor")?.sentence === "Working…",
  "the assigned card says Working",
);
const picked = handedHomeAction(
  [
    { id: "old", title: "Collect the two largest invoices" },
    { id: "new", title: "Audit and renegotiate your top 5 supplier contracts" },
  ],
  new Map([["new", { agent: "advisor", at: "2026-10-04T00:00:00.000Z" }]]),
  new Map([["new", { agent: "advisor", status: "queued", at: "2026-10-04T00:00:01.000Z" }]]),
);
assert(picked?.title === "Audit and renegotiate your top 5 supplier contracts", "home follows the handed action, not the first row");
assert(picked?.agent === "advisor" && picked.run?.status === "queued", "the handed action is Working");
const reassigned = handedHomeAction(
  [
    { id: "older", title: "Collect the two largest invoices" },
    { id: "newer", title: "Set a quarterly revenue target" },
  ],
  new Map([
    ["older", { agent: "analyst", at: "2026-10-01T00:00:00.000Z" }],
    ["newer", { agent: "advisor", at: "2026-10-05T00:00:00.000Z" }],
  ]),
  new Map([["older", { agent: "analyst", status: "running", at: "2026-10-01T00:00:01.000Z" }]]),
);
assert(reassigned?.agent === "advisor", "a newer hand-off replaces the previous Working assignee");
const pendingAdvisor = preferPendingHandoff(
  reassigned && reassigned.agent === "analyst" ? reassigned : { id: "older", title: "Collect the two largest invoices", agent: "analyst", run: { agent: "analyst", status: "running" } },
  { id: "newer", title: "Set a quarterly revenue target", agent: "advisor" },
  new Map([["older", { agent: "analyst" }]]),
);
assert(pendingAdvisor?.agent === "advisor" && pendingAdvisor.run?.status === "queued", "a hand-off in flight stays on the new assignee");
const confirmed = preferPendingHandoff(
  reassigned,
  { id: "newer", title: "Set a quarterly revenue target", agent: "advisor" },
  new Map([["newer", { agent: "advisor" }]]),
);
assert(confirmed?.agent === "advisor", "a stored note keeps the new assignee");
const finished = handedHomeAction(
  [{ id: "move", title: "Move fixed contracts to variable / usage-based pricing" }],
  new Map([["move", { agent: "analyst", at: "2026-10-19T15:17:00.000Z" }]]),
  new Map([["move", { agent: "analyst", status: "succeeded", at: "2026-10-19T15:16:50.000Z" }]]),
);
assert(
  finished?.agent === "analyst" && finished.run?.status === "succeeded",
  "a finished hand-off keeps the run status after reload",
);
const finishedCards = steerAssignedWork(ownerPresence(activity({})), "analyst", finished?.run ?? null);
assert(
  finishedCards.agents.find((agent) => agent.agent === "analyst")?.motion !== "working",
  "a finished run does not paint Working on reload",
);
const handedBack = handedHomeAction(
  [{ id: "move", title: "Move fixed contracts to variable / usage-based pricing" }],
  new Map([["move", { agent: "advisor", at: "2026-10-19T16:20:00.000Z" }]]),
  new Map([["move", { agent: "analyst", status: "succeeded", at: "2026-10-19T15:16:50.000Z" }]]),
);
assert(
  handedBack?.agent === "advisor" && handedBack.run?.status === "queued",
  "the stored assignee wins over the previous bot's finished run",
);
const reloaded = steerAssignedWork(foundAdvisor, "advisor", handedBack?.run ?? null);
assert(
  reloaded.agents.find((agent) => agent.agent === "advisor")?.motion === "working",
  "the stored assignee is Working after reload",
);
assert(
  reloaded.agents.find((agent) => agent.agent === "analyst")?.motion !== "working",
  "the previous assignee drops Working after reload",
);
const analystRow = rowAssignment({
  id: "row-1",
  notes: [
    { note: "Status moved to in progress.", at: "2026-10-19T16:00:00.000Z" },
    { note: "Handed to Milōn Analyst.", at: "2026-10-19T15:00:00.000Z" },
  ],
  run: { agent: "analyst", status: "succeeded", at: "2026-10-19T15:10:00.000Z" },
});
const advisorRow = rowAssignment({
  id: "row-2",
  notes: [{ note: "Handed to Milōn Advisor.", at: "2026-10-19T14:00:00.000Z" }],
  run: { agent: "advisor", status: "queued", at: "2026-10-19T14:01:00.000Z" },
});
assert(
  analystRow.assigneeName === "Milōn Analyst" && analystRow.open === false,
  "a finished hand-off keeps the row label and is not Working",
);
assert(advisorRow.assigneeName === "Milōn Advisor" && advisorRow.open, "an open hand-off on another row stays Working");
assert(
  openHandoffAgents([analystRow, advisorRow]).join(",") === "advisor",
  "Working is the bots that still have an open hand-off",
);
const reassignedRow = rowAssignment({
  id: "row-1",
  notes: [
    { note: "Assigned to theo.", at: "2026-10-19T17:00:00.000Z" },
    { note: "Handed to Milōn Advisor.", at: "2026-10-19T14:00:00.000Z" },
  ],
  run: { agent: "advisor", status: "queued", at: "2026-10-19T14:01:00.000Z" },
  ownerName: "theo",
});
assert(
  reassignedRow.assigneeName === "theo" && reassignedRow.agent === null && reassignedRow.open === false,
  "assigning one row to a person clears that row's bot",
);
assert(
  openHandoffAgents([reassignedRow, advisorRow]).join(",") === "advisor",
  "the other row's advisor hand-off is still Working",
);
const personReload = rowAssignment({
  id: "row-1",
  ownerName: "theo",
  notes: [{ note: "Assigned to theo.", at: "2026-10-19T17:00:00.000Z" }],
  run: null,
});
assert(personReload.assigneeName === "theo" && personReload.open === false, "a person assignment is still the row label after reload");
const pendingRows = withPendingAssignment(
  [advisorRow],
  { id: "row-1", agent: "analyst", assigneeName: "Milōn Analyst" },
  null,
);
assert(
  pendingRows.find((row) => row.id === "row-2")?.open === true &&
    pendingRows.find((row) => row.id === "row-1")?.agent === "analyst",
  "a new hand-off does not clear the other row",
);
const bothOpen = steerOpenHandoffs(ownerPresence(activity({})), openHandoffAgents(pendingRows));
assert(
  bothOpen.agents.find((agent) => agent.agent === "analyst")?.motion === "working" &&
    bothOpen.agents.find((agent) => agent.agent === "advisor")?.motion === "working",
  "two open hand-offs show Working on both bots",
);
assert(
  latestStoredAssignment([
    { note: "Advisor → Financial Manager: Profit Drivers is the weakest pillar.", at: "2026-10-19T18:00:00.000Z" },
    { note: "Handed to Milōn Analyst.", at: "2026-10-19T15:00:00.000Z" },
  ])?.kind === "bot",
  "a later sentence that is not an assignment does not drop the hand-off note",
);
const floorMarket = { currency: "USD" as const, locale: "en-US" };
const comfortCue = cashFloorForHome({
  cashOutlook: null,
  cashflow: {
    openingBalance: "4335",
    expenses: [{ name: "Rent", amount: "100", frequency: "once-off", startWeek: 1 }],
  },
  market: floorMarket,
  money: (amount) => `$${Math.round(amount)}`,
});
assert(
  comfortCue?.healthCue === "Below your $50k minimum · see FM",
  comfortCue?.healthCue ?? "health uses the card cashflow when there is no outlook",
);
const belowCue = cashFloorCopy({
  opening: 4335,
  floor: 50000,
  money: (amount) => `$${amount}`,
  market: floorMarket,
});
assert(belowCue.healthCue === "Below your $50k minimum · see FM", belowCue.healthCue ?? "missing cue");
assert(belowCue.chip === "Below your minimum", "the health line uses the floor chip");
const dipCopy = cashFloorCopy({
  opening: 44480,
  floor: 32688,
  dipsBelowFloorWeek: 4,
  closing: [30000],
  money: (amount) => `R ${amount}`,
  market: { currency: "ZAR", locale: "en-ZA" },
});
assert(
  dipCopy.sentence === "Cash R 30000, R 2688 below your R 32688 minimum.",
  dipCopy.sentence,
);
assert(
  dipCopy.healthCue?.includes("minimum · see FM") === true,
  dipCopy.healthCue ?? "a dip that the card flags also lines the cash pillar",
);
assert(dipCopy.chip === "Below your minimum", "a projected dip keeps the floor chip");

const speaking = ownerPresence(emptyAgentActivity(), {
  agent: "financial_manager",
  mode: "speaking",
});
assert(
  speaking.agents.find((agent) => agent.agent === "financial_manager")?.motion === "speaking",
  "chat can speak",
);
assert(
  speaking.agents.find((agent) => agent.agent === "financial_manager")?.fmClip === "idle",
  "speaking has no clip, so the face stays silent",
);

const fmRun = {
  id: "fm-run",
  agent: "financial_manager" as const,
  client_id: "c",
  queued_at: "2026-10-01T00:00:00.000Z",
  started_at: "2026-10-01T00:00:01.000Z",
  finished_at: null as string | null,
};
assert(fmAvatarClip({ run: { ...fmRun, status: "queued" } }) === "thinking", "a queued run is thinking");
assert(fmAvatarClip({ run: { ...fmRun, status: "running" } }) === "working", "a running run is working");
assert(
  fmAvatarClip({ run: { ...fmRun, status: "running", trigger: "upload" } }) === "reading",
  "an upload in progress is reading",
);
assert(
  fmAvatarClip({ run: { ...fmRun, status: "queued", trigger: "sync" } }) === "reading",
  "a sync in progress is reading",
);
assert(
  fmAvatarClip({
    run: { ...fmRun, status: "succeeded", finished_at: "2026-10-01T00:05:00.000Z" },
  }) === "done",
  "a clean finish is done",
);
assert(
  fmAvatarClip({
    run: { ...fmRun, status: "succeeded", finished_at: "2026-10-01T00:05:00.000Z" },
    finding: {
      kind: "variance",
      severity: "act",
      evidence: {},
      created_at: "2026-10-01T00:04:00.000Z",
    },
  }) === "found-issue",
  "an act finding is found-issue",
);
assert(
  fmAvatarClip({
    finding: {
      kind: "variance",
      severity: "watch",
      evidence: {},
      created_at: "2026-10-01T00:04:00.000Z",
    },
  }) === "concerned",
  "a watch finding is concerned",
);
assert(
  fmAvatarClip({
    run: { ...fmRun, status: "succeeded", finished_at: "2026-10-01T00:05:00.000Z" },
    finding: {
      kind: "note",
      severity: "info",
      evidence: {},
      created_at: "2026-10-01T00:04:00.000Z",
    },
  }) === "done",
  "an info finding is not an issue",
);
assert(
  fmAvatarClip({
    finding: {
      kind: "next_move_draft",
      severity: "info",
      evidence: { draft: true, requires_human_approval: true, kind: "next_move_draft" },
      created_at: "2026-10-01T00:04:00.000Z",
    },
  }) === "idea",
  "a next move is an idea",
);
assert(
  fmAvatarClip({
    finding: {
      kind: "data_request_draft",
      evidence: { draft: true, requires_human_approval: true, kind: "data_request_draft" },
      created_at: "2026-10-01T00:04:00.000Z",
    },
  }) === "waiting",
  "a data request is waiting",
);
assert(
  fmAvatarClip({
    finding: {
      kind: "accountant_handoff_draft",
      evidence: { draft: true, requires_human_approval: true, kind: "accountant_handoff_draft" },
      created_at: "2026-10-01T00:04:00.000Z",
    },
  }) === "handoff",
  "an accountant hand-off uses the handoff clip",
);
assert(
  fmAvatarClip({
    run: { ...fmRun, status: "running", trigger: "upload" },
    handoff: { at: "2026-10-02T00:00:00.000Z" },
  }) === "reading",
  "a live run wins over an older hand-off",
);
assert(fmAvatarClip({ talk: "listening" }) === "waiting", "listening needs the user");
assert(fmAvatarClip({ talk: "working" }) === "thinking", "a chat reply is thinking");
assert(fmAvatarClip({ talk: "speaking" }) === "idle", "speech does not pick a clip");
assert(fmAvatarClip({ run: { ...fmRun, status: "failed" } }) === "idle", "a failed run stays quiet");
assert(displayFmClip("idle", "working") === "working", "a forced working motion still plays");
assert(displayFmClip("done", "idle") === "done", "a finished run keeps the done clip");
assert(displayFmClip(null, "speaking") === "idle", "speaking motion does not invent a face");
assert(fmIdleBudget(0) === 2 && fmIdleBudget(0.5) === 3 && fmIdleBudget(0.99) === 4, "idle flourishes land every 2 to 4 loops");
assert(
  nextFmClip({ playing: "idle", desired: "idle", idleLoops: 0, budget: 2, flourish: "calm" }) === "idle",
  "the first idle play stays idle",
);
assert(
  nextFmClip({ playing: "idle", desired: "idle", idleLoops: 1, budget: 2, flourish: "curious" }) === "curious",
  "the budget-th idle play queues a flourish",
);
assert(
  nextFmClip({ playing: "pleased", desired: "idle", idleLoops: 0, budget: 3, flourish: "calm" }) === "idle",
  "a flourish returns to idle",
);
assert(nextFmIdleLoops("idle", "idle", 0) === 1, "an idle loop counts");
assert(nextFmIdleLoops("idle", "calm", 2) === 0, "a flourish resets the idle count");
const frame = 1 / AVATAR_CLIP_FPS;
assert(avatarClipAtEnd(5 - frame, 5), "a 120-frame clip swaps on its last frame");
assert(!avatarClipAtEnd(5 - frame * 2, 5), "a 120-frame clip plays the earlier frames");
assert(avatarClipAtEnd(121 / 24 - frame, 121 / 24), "a 121-frame clip swaps on its last frame");
assert(!avatarClipAtEnd(121 / 24 - frame * 2, 121 / 24), "a 121-frame clip does not swap a frame early");
assert(avatarClipAtEnd(5, 5), "a playhead at the end counts");
assert(!avatarClipAtEnd(0, 5), "the opening frame is not the end");
assert(!avatarClipAtEnd(1, Number.NaN), "an unknown duration does not swap");
assert(
  fmClipSources("idle").webm === `/avatars/fm/fm-idle.webm?v=${FM_AVATAR_VERSION}`,
  "financial manager clips stay in fm/ and carry a cache version",
);
assert(
  avatarPoster("financial_manager").jpg === `/avatars/fm/fm-poster.jpg?v=${FM_AVATAR_VERSION}`,
  "the financial manager poster carries the same cache version",
);
assert(!avatarPoster("analyst").webp.includes("?"), "analyst posters stay unversioned");
assert(
  fmClipSources("reading", "analyst").mp4 === "/avatars/analyst/analyst-reading.mp4",
  "analyst clips use the analyst folder",
);
assert(
  fmClipSources("handoff", "advisor").webm === "/avatars/advisor/advisor-handoff.webm",
  "advisor clips use the advisor folder",
);
assert(avatarPoster("analyst").webp === "/avatars/analyst/analyst-poster.webp", "the analyst poster is webp");
assert(avatarPoster("advisor").jpg === "/avatars/advisor/advisor-poster.jpg", "the advisor poster is jpg");
assert(AVATAR_FOLDERS.tax_specialist === "tax", "the tax face uses the tax folder");
assert(
  fmClipSources("idle", "tax_specialist").webm === "/avatars/tax/tax-idle.webm",
  "tax clips stay at the stable tax filenames",
);
assert(
  avatarPoster("tax_specialist").jpg === "/avatars/tax/tax-poster.jpg",
  "the tax poster stays at the stable filename",
);
assert(!fmClipSources("handoff", "tax_specialist").webm.includes("?"), "tax filenames stay unversioned");
for (const folder of ["fm", "analyst", "advisor", "tax"] as const) {
  for (const name of FM_AVATAR_CLIPS) {
    assert(existsSync(`public/avatars/${folder}/${folder}-${name}.webm`), `${folder} ${name} webm is shipped`);
    assert(existsSync(`public/avatars/${folder}/${folder}-${name}.mp4`), `${folder} ${name} mp4 is shipped`);
  }
  assert(existsSync(`public/avatars/${folder}/${folder}-poster.webp`), `${folder} poster webp is shipped`);
  assert(existsSync(`public/avatars/${folder}/${folder}-poster.jpg`), `${folder} poster jpg is shipped`);
}
const video = readFileSync("src/components/owner-door/fm-video-avatar.tsx", "utf8");
assert(video.includes('muted') && video.includes("playsInline"), "the clips stay muted and inline");
assert(video.includes("IntersectionObserver"), "clips wait until the face is near the viewport");
assert(video.includes('preload="none"') || video.includes('preload = "none"'), "nothing preloads before the face is visible");
assert(video.includes("FM_CROSSFADE_MS"), "clips crossfade on the shared 300ms clock");
assert(
  video.indexOf('"video/webm"') !== -1 && video.indexOf('"video/webm"') < video.indexOf('"video/mp4"'),
  "webm is first and mp4 is the fallback",
);
assert(video.includes("usePrefersReducedMotion"), "reduced motion keeps the poster");
assert(!video.includes("speechSynthesis") && !video.includes("Audio("), "the avatar never speaks");
assert(video.includes("requestVideoFrameCallback"), "the crossfade waits for a decoded frame");
assert(
  video.includes('"playing"') && video.includes('"canplaythrough"'),
  "the crossfade waits until the incoming clip can play",
);
assert(
  video.includes("revealed && video === videos[visibleSlot]"),
  "the visible clip does not have its source reset",
);
assert(video.includes('"ended"'), "the next clip starts when the current one ends");
assert(video.includes("avatarClipAtEnd"), "the swap uses the file's own last frame");
assert(video.includes("incoming.loop = false"), "a clip ends so the next one can start");
assert(video.includes('agent === "tax_specialist" && desired === "idle"'), "tax opens on a moving flourish");
assert(video.includes('"curious"'), "the tax sheet opens on the curious clip");
assert(video.includes('restOnIntro && playing === "curious"'), "the tax flourish plays once and then holds");
assert(video.includes("holdLastFrame"), "the last frame stays up so the hand-off is not blank");
assert(!video.includes("currentTime < 0.15"), "clips do not switch mid-play");
assert(!video.includes("121"), "the player does not assume a 121-frame clip");
assert(!video.includes("poster="), "the video element does not flash its poster");
assert(video.includes("canPlayType(\"video/mp4\")"), "Safari loads MP4 when WebM cannot play");

const clocks = (
  ["financial_manager", "analyst", "advisor"] as const satisfies readonly AgentKey[]
).map((agent) => avatarRhythm(agent));
const breathes = clocks.map((clock) => clock.breathe);
assert(new Set(breathes).size === 3, "each agent breathes on its own clock");
for (const value of breathes) {
  const seconds = Number(value.replace("s", ""));
  assert(seconds >= 4 && seconds <= 6, `breathe stays in 4–6s (${value})`);
}

const css = readFileSync("src/components/owner-door/owner-door.css", "utf8");
assert(css.includes("prefers-reduced-motion"), "reduced motion has a still pose");
assert(
  css.includes(".owner-presence.is-fm-clip .owner-drift") &&
    css.includes(".owner-presence.is-fm-clip .owner-breathe") &&
    css.includes(".owner-presence.is-fm-clip .owner-micro") &&
    /\.owner-presence\.is-fm-clip \.owner-drift[\s\S]*?animation:\s*none/.test(css),
  "a character video frame does not drift, breathe, or scale",
);
assert(css.includes(".owner-fm-face video.is-hold"), "the outgoing clip stays visible through the fade");
assert(css.includes(".owner-fm-face.is-live .owner-fm-poster"), "the poster stays hidden once a clip is showing");
assert(css.includes(".owner-drift {"), "orb faces still drift");
assert(css.includes("tabular-nums"), "amounts use tabular numerals");
assert(css.includes("min-height: 44px"), "ask buttons meet the tap target");
assert(!/#[0-9a-fA-F]{3,8}\b/.test(css), "owner door colours come from theme tokens");
assert(!css.includes("var(--gold-grad)"), "owner buttons no longer use the gold gradient");
assert(css.includes("var(--cobalt)"), "owner actions use cobalt");
assert(
  /\.owner-turn\.is-owner\s*\{[^}]*background:\s*var\(--pale\)/.test(css),
  "owner messages use the pale blue token",
);
assert(
  !/\.owner-turn\.is-owner\s*\{[^}]*--gold/.test(css),
  "owner messages do not use a gold fill",
);
assert(css.includes("list-style: decimal outside"), "numbered replies keep their numbers");
assert(css.includes("list-style: disc outside"), "reply bullets stay visible");
assert(css.includes("font-size: 16px"), "body text is at least 16px");
assert(css.includes("font-size: 14px"), "secondary text is at least 14px");
assert(css.includes("--owner-edge: color-mix(in srgb, var(--ink) 55%, var(--bg))"), "borders mix ink into the background");
assert(
  css.includes('--owner-sans: var(--font-sans, "Owner Sans Fallback", sans-serif)'),
  "the owner shell uses the shared sans token",
);
const rootCss = readFileSync("src/styles.css", "utf8");
assert(rootCss.includes('"Plus Jakarta Sans Variable"'), "the shared sans is Plus Jakarta Sans");
assert(css.includes("lining-nums"), "tables and amounts use lining figures");
assert(css.includes("--type-h1-size"), "the owner type scale is tokenised");
assert(css.includes("--owner-space-1: 8px"), "spacing follows an 8px grid");
assert(css.includes("font-display: swap"), "owner fonts swap in without blocking");
assert(css.includes(".owner-door .owner-btn-secondary"), "secondary buttons are a distinct role");
assert(css.includes(".owner-door .owner-btn-tertiary"), "tertiary buttons are a distinct role");
assert(css.includes(".owner-door .btn.gold:focus-visible"), "the primary button shows focus");
assert(css.includes(".owner-door .owner-btn-secondary:disabled"), "a secondary button has a disabled state");
assert(css.includes(".owner-door .owner-btn-tertiary:hover"), "a tertiary button has a hover state");
assert(!css.includes("Inter"), "the owner shell does not force Inter");
const home = readFileSync("src/components/owner-door/owner-home.tsx", "utf8");
assert(home.includes('className="owner-ask"'), "home ask is the outlined button");
assert(home.includes("owner-status"), "a problem card shows a status chip");
assert(home.includes('className="owner-money"'), "home amounts are bold");
assert(home.includes("ownerHomeLines") === false && home.includes("lines["), "home reads the bot lines");
assert(ownerMoney(-1200, ZA_MARKET) === "−R 1 200", "a rand loss uses one unicode minus");
assert(ownerMoney(-1200, usd) === "−$1,200", "a dollar loss uses the same minus");
assert(ownerMoney(1200, ZA_MARKET) === "R 1 200", "a positive rand amount has no sign");
assert(ownerOutflow("$1,200") === "−$1,200", "an outflow uses the same minus");
assert(ownerOutflow("R 1 200") === "−R 1 200", "a rand outflow keeps the space");
assert(ownerBotLayout("") === "row" && ownerBotLayout("?bots=row") === "row", "three across stays the default bot layout");
assert(ownerBotLayout("?bots=stack") === "stack", "the stack flag is the wide-row trial");
assert(css.includes('data-bots="stack"') && css.includes("grid-template-columns: 1fr"), "phone and the stack flag use one column");
assert(css.includes("width: 172px") && css.includes("height: 172px"), "desktop avatars are the hero size");
assert(css.includes("width: 96px") && css.includes("height: 96px"), "phone avatars are the hero size");
assert(
  css.includes('.owner-door .owner-pane[data-owner-home="true"] .owner-ask') &&
    css.includes("margin-top: auto"),
  "ask pills sit on the bottom line of equal cards",
);
assert(css.includes("min-height: 2.7em"), "home text keeps a two-line slot");
assert(!css.includes("-webkit-line-clamp"), "home lines are not truncated");
assert(css.includes("text-overflow: unset"), "home lines do not ellipsis");
assert(!home.includes("owner-promises"), "home does not render the answer tiles");
assert(!home.includes("owner-health-hero"), "home does not render the health orb");
assert(!home.includes("What your accountant signed"), "sign-off is not a home tile");
assert(/\.owner-tile p \{[^}]*color: var\(--ink\)/.test(css), "tile sentences use the foreground colour");
const shell = readFileSync("src/components/owner-door/owner-shell.tsx", "utf8");
assert(shell.includes("<ThemeToggle />"), "the owner shell uses the shared theme toggle");
assert(shell.split("<ThemeToggle />").length >= 3, "the toggle sits in the header and in the menu");
assert(shell.includes('label: "Health"'), "health is on the rail");
assert(shell.includes('label: "Cash flow"'), "cash flow is on the rail");
assert(shell.includes('label: "Budget"'), "budget is on the rail");
assert(shell.includes('label: "Profit"'), "profit stays reachable");
assert(shell.includes('label: "Next moves"'), "next moves stay reachable");
assert(!shell.includes('label: "Action plan"'), "action plan is not a separate rail item");
assert(!shell.includes('label: "Actions"'), "actions is not a separate rail item");
const railLabels = [...shell.matchAll(/label: "([^"]+)"/g)].map((match) => match[1]);
assert(
  railLabels.join(" | ") ===
    "Home | Health | Cash flow | Profit | Budget | Next moves | Accountant portal",
  `rail order is ${railLabels.join(" | ")}`,
);
assert(!shell.includes('label: "Deliverables"'), "Deliverables is not an owner rail item");
assert(
  [...shell.matchAll(/label: "([^"]+)"/g)].every((match) => match[1] !== "Accountant"),
  "the owner tab is not labelled Accountant",
);
assert(shell.includes("aria-label={item.label}"), "rail items expose their label to assistive tech");
assert(shell.includes('label: "Accountant portal"'), "the phone pill and the rail share Accountant portal");
assert(shell.includes("AccountantMenuButton"), "phone sections open from a menu button");
assert(shell.includes('event.key !== "Escape"'), "escape closes the owner menu");
assert(css.includes("color: var(--navy)"), "owner menu items use brand navy");
assert(css.includes(".owner-door.accountant-portal.nav-open .deliverable-rail"), "phone nav is a vertical drawer");
assert(!css.includes("overscroll-behavior-x: contain"), "the phone section menu is not a horizontal strip");
const app = readFileSync("src/routes/app.tsx", "utf8");
assert(app.includes("<OwnerHealthOrb"), "health keeps the orb");
assert(app.includes("const OwnerHealthOrb = SphereHero"), "health reuses the sphere");
assert(!app.includes("hero="), "home does not mount the health orb");
assert(app.includes("onDriverClick"), "the health orb still drills into a driver");
assert(app.includes("topMove="), "the advisor line is the top next move");
assert(
  css.includes(".owner-door .health-orb:hover") && css.includes(".owner-door .health-orb:focus-visible"),
  "the home orb shows hover and focus",
);
assert(app.includes("readOnly"), "cash flow and budget can be shown without editing");
assert(app.includes("Your accountant sets this up"), "an unconfigured view tells the owner who sets it up");

function channel(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function linear(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const [r, g, b] = channel(hex);
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}
function contrast(a: string, b: string): number {
  const hi = Math.max(luminance(a), luminance(b));
  const lo = Math.min(luminance(a), luminance(b));
  return (hi + 0.05) / (lo + 0.05);
}
function mix(ink: string, bg: string, amount: number): string {
  const [ir, ig, ib] = channel(ink);
  const [br, bgc, bb] = channel(bg);
  const blend = (a: number, b: number) => Math.round(a * amount + b * (1 - amount));
  const hex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${hex(blend(ir, br))}${hex(blend(ig, bgc))}${hex(blend(ib, bb))}`;
}
function token(source: string, name: string): string {
  const found = source.match(new RegExp(`${name}:(#[0-9a-fA-F]{6})`));
  if (!found) throw new Error(`missing ${name}`);
  return found[1];
}
const portal = readFileSync("src/styles/accountant-portal.css", "utf8");
const darkBlock = portal.slice(portal.indexOf(":root{"), portal.indexOf("html[data-theme=\"light\"]"));
const lightBlock = portal.slice(portal.indexOf("html[data-theme=\"light\"]"), portal.indexOf(".accountant-portal{"));
for (const block of [darkBlock, lightBlock]) {
  const bg = token(block, "--bg");
  const ink = token(block, "--ink");
  const dim = token(block, "--ink-dim");
  assert(contrast(ink, bg) >= 4.5, `body ink on background is ${contrast(ink, bg).toFixed(2)}`);
  assert(contrast(dim, bg) >= 4.5, `secondary ink on background is ${contrast(dim, bg).toFixed(2)}`);
  const edge = mix(ink, bg, 0.55);
  assert(contrast(edge, bg) >= 3, `owner edge on background is ${contrast(edge, bg).toFixed(2)}`);
}
const buttonInk = "#1b1300";
assert(portal.includes("color:var(--on-cobalt)"), "the primary button uses white on cobalt");
function tokenOr(source: string, name: string, fallback: string): string {
  const found = source.match(new RegExp(`${name}:(#[0-9a-fA-F]{6})`));
  return found ? found[1] : fallback;
}
for (const [theme, block] of [
  ["dark", darkBlock],
  ["light", lightBlock],
] as const) {
  for (const name of ["--gold-deep", "--gold", "--gold-bright"] as const) {
    const stop = tokenOr(block, name, token(darkBlock, name));
    const ratio = contrast(buttonInk, stop);
    assert(ratio >= 4.5, `${theme} gold button text on ${name} ${stop} is ${ratio.toFixed(2)}`);
  }
}
assert(css.includes("background-color: var(--cobalt)"), "owner primary buttons are cobalt");
assert(css.includes("background-color: var(--royal)"), "owner primary buttons turn royal on hover");
assert(css.includes("border: 1px solid var(--cobalt)"), "home ask buttons are outlined cobalt");
const avatar = readFileSync("src/components/owner-door/owner-avatar.tsx", "utf8");
assert(!avatar.includes('d="M32 28l8 6 8-6"'), "the advisor brow is not a frown");
assert(!avatar.includes('className="smile"'), "the advisor face is not a smile");
assert(avatar.includes('className="mark"'), "the advisor orb keeps a neutral mark");
assert(avatar.includes('className="badge"'), "the advisor orb keeps the headset badge");
assert(!avatar.includes('className="visor"'), "the financial manager face is no longer the visor");
assert(!avatar.includes('className="monocle"'), "the analyst character is no longer the monocle drawing");
assert(!avatar.includes('rx="12"'), "the advisor character is no longer the illustrated body");
assert(avatar.includes("FmVideoAvatar"), "character faces share the video player");
assert(avatar.includes("agent={agent}"), "each agent plays its own clips");
assert(
  avatar.includes("reduced || videoFace || before === motion"),
  "a video frame does not jump or settle",
);
assert(avatar.includes('const videoFace = variant === "character"'), "every character face uses video");
assert(
  !avatar.includes('agent === "financial_manager" && variant === "character"'),
  "analyst and advisor use the same player as the financial manager",
);
assert(css.includes(".owner-presence.is-advisor .mark"), "the advisor mark is drawn with the other faces");
assert(
  css.includes(".owner-presence.is-advisor .badge") && css.includes("color-mix(in srgb, var(--ice)"),
  "the advisor badge uses the ice fill",
);
assert(css.includes('button[aria-label="Share Milōn"]'), "the owner door hides the phone share button");
const pages = readFileSync("src/components/owner-door/owner-pages.tsx", "utf8");
assert(pages.includes("What your accountant signed"), "sign-off lives on the accountant tab");
assert((pages.match(/What your accountant signed/g) ?? []).length >= 1, "the accountant tab names the sign-off");
assert(
  pages.includes('title="Accountant portal"') &&
    readFileSync("src/components/owner-ui.tsx", "utf8").includes('<h1 className="owner-title">{title}</h1>'),
  "the page heading is Accountant portal",
);
assert(pages.includes('aria-label="breadcrumb"'), "the portal page has a breadcrumb");
assert(pages.includes('aria-current="page">Accountant portal'), "the breadcrumb names Accountant portal");
assert(pages.includes("OWNER_SIGNED_SECTION_ID"), "signed deliverables stay on Accountant portal");
assert(OWNER_SIGNED_SECTION_ID === "owner-signed-deliverables", "the signed section has a stable id");
assert(pages.includes('aria-label="Signed deliverables"'), "the moved section is labelled");
assert(!pages.includes('data-owner-page="deliverables"'), "Deliverables is not its own owner page");
const studioChrome = readFileSync("src/components/client-studio-chrome.tsx", "utf8");
assert(studioChrome.includes('label: "Books"'), "the accountant rail names Books");
assert(studioChrome.includes('label: "Action plan"'), "the accountant rail names Action plan");
const goldInk = token(lightBlock, "--gold-ink");
const pillarCard = token(lightBlock, "--bg-2");
const landing = readFileSync("src/styles/landing.css", "utf8");
const landingLight = landing.slice(landing.indexOf('html[data-landing="1"][data-theme="light"]'));
assert(goldInk === token(landingLight, "--gold-ink"), "portal light mode uses the landing dark-gold ink");
assert(
  contrast(goldInk, pillarCard) >= 4.5,
  `dark-gold ink on the white pillar card is ${contrast(goldInk, pillarCard).toFixed(2)}`,
);
assert(
  css.includes("html:not(.dark) .owner-door .owner-pillar-score.text-emerald-400") &&
    css.includes("color: var(--ok)"),
  "healthy pillar scores use the healthy green",
);
assert(
  css.includes(
    'html:not(.dark) .owner-door [data-owner-page="health"] .owner-pillar-score.text-amber-400',
  ) && css.includes("color: var(--warn)"),
  "watch pillar scores use the attention colour",
);
assert(
  css.includes("html:not(.dark) .owner-door .owner-pillar-score.text-rose-400") &&
    css.includes("color: var(--risk)"),
  "critical pillar scores use the critical red",
);
assert(
  css.includes("html:not(.dark) .owner-door .health-orb .text-slate-200") &&
    css.includes("color: var(--navy)"),
  "the health score label is navy",
);
const sphere = readFileSync("src/components/sphere-hero.tsx", "utf8");
const ownerApp = readFileSync("src/routes/app.tsx", "utf8");
assert(sphere.includes("onOrbOpen"), "the orb can open Health instead of drilling in place");
assert(sphere.includes("owner-pillar-score"), "pillar numbers carry a status class");
assert(
  ownerApp.includes("HEALTH_RING_CAPTION") &&
    sphere.includes("export const HEALTH_RING_CAPTION = HEALTH_DRILL_CUE") &&
    readFileSync("src/components/health-drill-cue.tsx", "utf8").includes(
      'HEALTH_DRILL_CUE = "Tap to see more"',
    ),
  "the owner health ring uses the same Tap to see more cue as the pillar cards",
);
assert(sphere.includes("onClick={() => (onOrbOpen ? onOrbOpen() : go(level === 1 ? 2 : 1))}"), "the health orb stays a button");
assert(sphere.includes("bg-white"), "the pillar card is white");
assert(shell.includes('className="brand"'), "the owner wordmark uses the accountant brand size");
assert(shell.includes('className="gold-text">MILŌN'), "the owner wordmark uses the accountant gold colour");
assert(!shell.includes("milon-wordmark.png"), "the tiny image wordmark is gone");
assert(!home.includes("Milōn Financial Manager"), "the view does not hardcode a display name");
const door = readFileSync("src/components/owner-door/owner-door.tsx", "utf8");
assert(door.includes("onOpen={openChat}") && door.includes("onAsk={openChat}"), "the avatar and the ask pill open the same chat");
assert(door.includes("window.history.back"), "closing a bot the owner opened uses the browser back stack");
assert(door.includes("runBotTransition"), "opening a bot runs the shared-element transition");
assert(app.includes('search.bot === "analyst"'), "a bot deep link is kept on /app");
const chatSrc = readFileSync("src/components/owner-door/owner-chat.tsx", "utf8");
assert(chatSrc.includes('size="stage"'), "the open bot is the large stage");
assert(chatSrc.includes('aria-label="Close"'), "the stage has a close control");
assert(chatSrc.includes('event.key !== "Escape"'), "escape closes the stage");
const avatarSrc = readFileSync("src/components/owner-door/owner-avatar.tsx", "utf8");
assert(avatarSrc.includes("viewTransitionName"), "the home avatar and the stage share a transition name");
assert(avatarSrc.includes('"stage"'), "the stage is an avatar size");
const botMotion = readFileSync("src/components/owner-door/owner-bot-motion.ts", "utf8");
assert(botMotion.includes("startViewTransition"), "the zoom uses the view transition API");
assert(botMotion.includes("prefers-reduced-motion"), "reduced motion is detected before the zoom");
assert(botMotion.includes('dataset.botFade = "cross"'), "reduced motion crossfades the zoom");
assert(botMotion.includes('dataset.botFade = "plain"'), "a browser without view transitions crossfades");
assert(css.includes(".owner-presence.is-stage") && css.includes("width: 280px"), "the open bot is 280px on a desktop");
assert(css.includes("width: 160px"), "the open bot is 160px on a phone");
assert(
  css.includes("::view-transition-group(*)") && css.includes("animation: none"),
  "reduced motion drops the spatial zoom",
);
assert(css.includes("@keyframes owner-bot-in") && css.includes("@keyframes owner-bot-out"), "the fallback is a crossfade");
assert(home.includes("share"), "the home avatar opts into the shared element");
assert(shell.includes('screen: "moves"'), "next moves stays on the rail");
assert(!door.includes('setScreen("actions")'), "the separate actions screen is gone");
assert(!door.includes('setScreen("tasks")'), "the separate action plan screen is gone");
const plan = readFileSync("src/components/action-plan.tsx", "utf8");
assert(plan.includes("ownerView"), "the owner rail uses a compact action plan");
assert(plan.includes("HandToMenu"), "each action has a Hand to control");
assert(plan.includes("commitActionHandoff"), "handing off commits the assignment");
const handoffClient = readFileSync("src/lib/owner-handoff-client.ts", "utf8");
assert(handoffClient.includes("handoffComingOnline"), "the missing-runner check is the hand-off path");
const handoffButtons = readFileSync("src/components/action-handoff-buttons.tsx", "utf8");
assert(handoffButtons.includes("Coming online soon"), "a missing runner says it is coming online");
assert(handoffButtons.includes("data-bot-handoff"), "the hand-off controls are in the action row");
assert(handoffClient.includes("requestOwnerHandoff"), "handing off calls the owner-handoff function");
assert(
  handoffComingOnline("No runner exists for financial_manager. supabase/functions has agent-analyst only."),
  "the financial manager refusal is not an error",
);
assert(
  handoffComingOnline("No runner exists for advisor. supabase/functions has agent-analyst only."),
  "the advisor refusal is not an error",
);
assert(handoffComingOnline("no_runner"), "the no_runner code is the same quiet state");
assert(handoffComingOnline("runner_disabled"), "a switched-off runner is coming online");
assert(
  handoffComingOnline(
    "Milōn Financial Manager has a runner at supabase/functions/agent-financial-manager, but agent_settings.financial_manager_enabled is false, so a hand-off will not start it.",
  ),
  "the runner_disabled sentence is not an error",
);
assert(
  handoffComingOnline(
    "The analyst runner exists at supabase/functions/agent-analyst, but agent_settings.enabled is false, so a hand-off will not start it.",
  ),
  "a disabled runner stays quiet",
);
assert(!handoffComingOnline("Not signed in."), "a real hand-off error still shows");
assert(
  ownerRunPhase(
    { id: "q", agent: "financial_manager", client_id: "c", status: "queued", queued_at: "2026-10-01T00:00:00.000Z", started_at: null, finished_at: null },
    [],
  ) === "queued",
  "queued stays queued",
);
assert(
  ownerRunPhase(
    { id: "d", agent: "advisor", client_id: "c", status: "succeeded", queued_at: "2026-10-01T00:00:00.000Z", started_at: "2026-10-01T00:00:01.000Z", finished_at: "2026-10-01T00:05:00.000Z" },
    [],
  ) === "done",
  "a finish with no finding is done",
);
assert(
  ownerRunPhase(
    { id: "s", agent: "advisor", client_id: "c", status: "skipped", queued_at: "2026-10-01T00:00:00.000Z", started_at: null, finished_at: null },
    [],
  ) === "skipped",
  "skipped is nothing to do",
);
assert(
  ownerRunPhase(
    { id: "f", agent: "advisor", client_id: "c", status: "failed", queued_at: "2026-10-01T00:00:00.000Z", started_at: null, finished_at: null },
    [],
  ) === "stalled",
  "failed stays a quiet stall",
);
assert(
  ownerRunPhase(
    { id: "x", agent: "advisor", client_id: "c", status: "cancelled", queued_at: "2026-10-01T00:00:00.000Z", started_at: null, finished_at: null },
    [],
  ) === null,
  "cancelled returns to idle",
);
const draftEvidence = { draft: true, requires_human_approval: true, figures: { cash: 1 } };
assert(
  draftFindingLabel({ kind: "next_move_draft", evidence: draftEvidence }) === DRAFT_NEEDS_OWNER,
  "a next-move draft needs the owner's OK",
);
assert(
  draftFindingLabel({ kind: "accountant_handoff_draft", evidence: draftEvidence }) === DRAFT_NEEDS_ACCOUNTANT,
  "an accountant hand-off draft needs the accountant",
);
assert(draftFindingLabel({ kind: "next_move_draft", evidence: { figures: { cash: 1 } } }) === null, "a published finding is not a draft");
const nestedEvidence = {
  draft: true,
  requires_human_approval: true,
  snapshot_id: null,
  period_label: null,
  figures: { "Oct 2026": { "Gross Margin": 0.6, "Debtor Days": 43.8 } },
};
assert(
  draftFindingLabel({ kind: "data_request_draft", evidence: nestedEvidence }) === DRAFT_NEEDS_OWNER,
  "a data request with nested figures and no recipient needs the owner",
);
assert(
  draftFindingKindLabel({ kind: "data_request_draft", evidence: nestedEvidence }) === "Data request",
  "a data request keeps its kind label",
);
assert(
  draftFindingLabel({ kind: null, evidence: { ...nestedEvidence, kind: "accountant_handoff_draft" } }) ===
    DRAFT_NEEDS_ACCOUNTANT,
  "an evidence kind still reaches the accountant",
);
assert(
  draftFindingKindLabel({ kind: "advisory_deliverable_draft", evidence: nestedEvidence }) === "Advisory",
  "an advisory draft keeps its kind label",
);
assert(isVisibleAgentFinding({ status: "approved" }), "an approved draft stays on the list");
assert(!isVisibleAgentFinding({ status: "dismissed" }), "a dismissed draft stays hidden");
assert(!isVisibleAgentFinding({ dismissed_reason: "dismissed by user" }), "a dismissed reason stays hidden");
assert(!isVisibleAgentFinding({ superseded_by: "other" }), "a superseded draft stays hidden");
assert(plan.includes("OwnerDraftCard"), "Next moves renders a draft card");
assert(plan.includes("DRAFT_NEEDS_OWNER"), "owner drafts are the ones that can be decided");
assert(plan.includes('data-owner-drafts='), "Next moves marks the draft section");
const card = readFileSync("src/components/owner-draft-card.tsx", "utf8");
assert(card.includes("Approve") && card.includes("Dismiss") && card.includes("Confirm"), "an owner draft can be approved or dismissed");
assert(card.includes("ownerOk && !blocked && !approved"), "buttons stay off an accountant draft and an approved row");
assert(card.includes("setOptimistic(null)"), "a failed decision rolls the card back");
assert(!plan.includes("does not enqueue agent_runs"), "the owner view no longer describes the hand-off as a placeholder");
assert(!plan.includes('.from("agent_runs")'), "the owner view does not insert agent runs itself");
assert(app.includes("ownerView"), "Next moves renders the owner action list");
assert(!door.includes("Dana"), "the door does not use a retired name");
const prompt = readFileSync("supabase/functions/ask-ai/prompt.ts", "utf8");
assert(prompt.includes("askAiAgentPersona"), "ask-ai keeps an agent persona");
assert(!prompt.includes("Milōn Financial Manager"), "the persona does not hardcode a display name");

assert(
  ownerPlanLine({ visitor: "za", accountantOnMilon: false, firmName: null, zaMonthly: "R299/mo" }) ===
    "Owner plan · R299/mo",
  "SA visitors see the rand price",
);
assert(
  !ownerPlanLine({ visitor: "za", accountantOnMilon: false, firmName: null, zaMonthly: "R299/mo" }).includes("$39"),
  "SA plan hides the dollar price",
);
assert(ownerPlanLine({ visitor: "us", accountantOnMilon: false, firmName: null }) === "Owner plan · $39/mo", "US visitors see the dollar price");
assert(!ownerPlanLine({ visitor: "us", accountantOnMilon: false, firmName: null }).includes("R299"), "US plan hides the rand price");
assert(!ownerPlanLine({ visitor: "us", accountantOnMilon: false, firmName: null }).includes("R799"), "US plan hides the firm rand price");
assert(
  ownerPlanLine({ visitor: "za", accountantOnMilon: true, firmName: "Northline" }) ===
    "Owner plan · included — Northline is on Milōn",
  "a linked accountant replaces the price",
);
assert(!ownerPlanLine({ visitor: null, accountantOnMilon: false, firmName: null }).match(/R299|R799|\$39/), "no price before the visitor is known");
assert(ownerPlanFreeLine() === "Free when your accountant joins.", "the free line has no price");
const homeSrc = readFileSync("src/components/owner-door/owner-home.tsx", "utf8");
assert(!homeSrc.includes("R299") && !homeSrc.includes("R799") && !homeSrc.includes("$39"), "home does not show a price");
const pagesSrc = readFileSync("src/components/owner-door/owner-pages.tsx", "utf8");
assert(pagesSrc.includes("ownerPlanLine"), "the plan view is where the price lives");
assert(pagesSrc.includes("ownerPlanFreeLine"), "the free line is on the invite surfaces");

const emptyNeeds = ownerNeedsView({
  ownerEmail: "alex@northline.test",
  actionsReady: true,
  actionsUnavailable: false,
  actions: [{ title: "Staff task", email: "ada@example.test" }],
  draftsReady: true,
  draftsUnavailable: false,
  draftTitles: [],
  deliverablesReady: true,
  deliverablesUnavailable: false,
  deliverableCount: 0,
  advisoryTitles: [],
  quickBooks: { state: "absent" },
  xero: { state: "absent" },
  when: () => "2 Oct 2026",
});
assert(emptyNeeds.actionsHeading === "1 open action", "home lists the plan's open action");
assert(emptyNeeds.actionLines[0] === "Staff task", "home and the plan share the open action");
assert(emptyNeeds.draftLines[0] === "No drafts need your OK.", "an empty draft list stays empty");
assert(emptyNeeds.deliverableLines[0] === "No deliverables awaiting review.", "an empty deliverable list stays empty");
assert(emptyNeeds.syncLines[0] === "Books are not connected yet.", "no ledger stays unconnected");

const filledNeeds = ownerNeedsView({
  ownerEmail: "alex@northline.test",
  actionsReady: true,
  actionsUnavailable: false,
  actions: [
    { title: "Approve the payroll run.", email: "alex@northline.test" },
    { title: "Call the two largest overdue accounts.", email: "Alex@northline.test" },
    { title: "Send the supplier statement.", email: "alex@northline.test" },
  ],
  draftsReady: true,
  draftsUnavailable: false,
  draftTitles: ["Chase the top three invoices."],
  deliverablesReady: true,
  deliverablesUnavailable: false,
  deliverableCount: 2,
  advisoryTitles: [],
  quickBooks: { state: "linked", at: "2026-10-02T08:00:00.000Z" },
  xero: { state: "absent" },
  when: () => "2 Oct 2026",
});
assert(filledNeeds.actionsHeading === "3 open actions", "the strip counts the owner's open actions");
assert(filledNeeds.actionLines.length === 3, "the strip lists every open action it counts");
assert(filledNeeds.actionLines[0] === "Approve the payroll run.", "the first owner action leads");
assert(filledNeeds.actionLines[2] === "Send the supplier statement.", "the third action is on the strip");
assert(filledNeeds.draftsHeading === "1 draft needs your OK", "a draft that needs an OK is counted");
assert(filledNeeds.deliverablesHeading === "2 deliverables awaiting review", "unsigned deliverables are counted");
assert(filledNeeds.syncHeading === "QuickBooks", "the sync names the ledger");
assert(filledNeeds.syncLines[0] === "Last synced 2 Oct 2026.", "the sync shows the last time");
assert(homeSrc.includes("What needs you"), "home has the needs strip");
assert(homeSrc.includes("OwnerNeedsStrip"), "the strip is the home block");
assert(!homeSrc.includes('className="btn gold"'), "the home strip does not add another primary button");
assert(css.includes(".owner-needs"), "the strip has its own rhythm");
assert(door.includes("onMoves={() => go(\"moves\")}"), "open actions and drafts open Next moves");
assert(door.includes("onDeliverables={() => go(\"deliverables\")}"), "the needs strip still opens the old deliverables target");
assert(canonicalOwnerScreen("deliverables") === "accountant", "that target is Accountant portal");
assert(canonicalOwnerScreen("home") === "home", "other owner screens stay put");
assert(door.includes("canonicalOwnerScreen"), "the door remaps deliverables before it renders");
assert(
  ownerDeliverablesRedirectTarget("https://milonfinance.com/deliverables") ===
    "/app?screen=accountant&section=signed",
  "/deliverables opens Accountant portal",
);
assert(
  ownerDeliverablesRedirectTarget("https://milonfinance.com/app/deliverables?bot=analyst") ===
    "/app?bot=analyst&screen=accountant&section=signed",
  "/app/deliverables keeps unrelated params",
);
assert(
  ownerDeliverablesRedirectTarget("https://milonfinance.com/app?screen=deliverables") ===
    "/app?screen=accountant&section=signed",
  "screen=deliverables opens Accountant portal",
);
assert(
  ownerDeliverablesRedirectTarget("https://milonfinance.com/app?tab=deliverables&section=pack") ===
    "/app?screen=accountant&section=signed",
  "tab=deliverables and its section open Accountant portal",
);
assert(
  ownerDeliverablesRedirectTarget("https://milonfinance.com/app?section=reports") ===
    "/app?screen=accountant&section=signed",
  "a deliverable section param opens Accountant portal",
);
assert(
  ownerDeliverablesRedirectTarget("https://milonfinance.com/app?tab=deliverables&section=plan") ===
    "/app?screen=accountant&section=signed",
  "the deliverables plan section opens Accountant portal",
);
assert(
  ownerDeliverablesRedirectTarget("https://milonfinance.com/clients/abc?tab=deliverables&section=pack") === null,
  "accountant Deliverables URLs stay",
);
assert(
  ownerDeliverablesRedirectTarget("https://milonfinance.com/app?screen=accountant&section=signed") === null,
  "the canonical portal URL does not redirect again",
);
assert(ownerDeliverablesRedirectTarget("https://milonfinance.com/app?tab=today") === null, "owner board tabs stay");
assert(
  ownerDeliverablesRedirectTarget("https://milonfinance.com/app?section=plan") === null,
  "a bare plan section is not the old deliverables tab",
);
assert(
  isOwnerDeliverablesRequest({ pathname: "/app", screen: "settings", section: "signed" }) === false,
  "settings keeps a leftover signed section",
);
const appRoute = readFileSync("src/routes/app.tsx", "utf8");
assert(appRoute.includes("ownerDeliverablesRedirectTarget"), "the owner app redirects old deliverables URLs");
const server = readFileSync("src/server.ts", "utf8");
assert(server.includes("ownerDeliverablesRedirectTarget"), "full page loads redirect old deliverables URLs");

const quietBook = {
  clientCount: 4,
  avgHealth: 72,
  needAttention: 0,
  reviewNow: 0,
  openQueries: 0,
  followUps: 0,
};
const quietLines = practiceHomeLines(quietBook);
assert(quietLines.financial_manager[0] === "4 clients on the book.", "practice Home counts the book");
assert(quietLines.financial_manager[1] === "No open queries.", "a clear book has no open queries");
assert(quietLines.analyst[0] === "Average health is 72 out of 100.", "practice Home states average health");
assert(quietLines.analyst[1] === "No client needs attention.", "a clear book needs no attention");
assert(quietLines.advisor[0] === "No follow-up waiting.", "a clear book has no follow-up");
const quietStatus = practiceCardStatuses(quietBook);
assert(
  quietStatus.financial_manager === null && quietStatus.analyst === null && quietStatus.advisor === null,
  "a clear book has no status chip",
);
const busyLines = practiceHomeLines({
  clientCount: 1,
  avgHealth: null,
  needAttention: 2,
  reviewNow: 1,
  openQueries: 3,
  followUps: 1,
});
assert(busyLines.financial_manager.join(" ") === "1 client on the book. 3 open queries.", "one client and open queries");
assert(busyLines.analyst[0] === "No scored clients yet.", "unscored book does not invent a health number");
assert(busyLines.advisor[0] === "1 client to follow up.", "one follow-up is singular");
const busyStatus = practiceCardStatuses({
  clientCount: 1,
  avgHealth: null,
  needAttention: 2,
  reviewNow: 1,
  openQueries: 3,
  followUps: 1,
});
assert(busyStatus.financial_manager?.word === "Attention", "open queries are Attention");
assert(busyStatus.analyst?.word === "Critical", "review now is Critical");
assert(busyStatus.advisor?.word === "Attention", "follow-up is Attention");
const watching = practiceCardStatuses({
  clientCount: 2,
  avgHealth: 40,
  needAttention: 1,
  reviewNow: 0,
  openQueries: 0,
  followUps: 0,
});
assert(watching.analyst?.word === "Attention", "watching without review now is Attention");

console.log("owner-door tests passed");
