/**
 * Accountant desktop walkthrough fixes.
 * Run: pnpm test:accountant-walkthrough
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { varianceLine } from "../src/lib/budget.variance";
import {
  blankForecastLines,
  keepOutlookOpening,
  openingCashByWeek,
} from "../src/lib/client-metrics";
import {
  ownerAnswerTiles,
  ownerCardStatuses,
  ownerHomeLines,
  type OwnerBooks,
} from "../src/lib/owner-answers";
import { practiceAgentFromHash, practiceAgentHash } from "../src/lib/practice-agent-hash";
import { ratioActualLine } from "../src/lib/ratio-actuals";
import type { RatioInputs } from "../src/lib/ratios";
import { reportLinkOpensPreview, reportLinkRunsDownload } from "../src/lib/report-preview";
import { decideFirmBillingPathGate, isFirmProductPath } from "../src/lib/stripe-entitlement";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const usd = { currency: "USD" as const, locale: "en-US" };

function books(patch: Partial<OwnerBooks> = {}): OwnerBooks {
  return {
    hasBooks: true,
    ledger: "Xero",
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

assert(practiceAgentFromHash("#ask-financial-manager") === "financial_manager", "FM hash opens the manager");
assert(practiceAgentFromHash("ask-analyst") === "analyst", "analyst hash opens the analyst");
assert(practiceAgentFromHash("ask-advisor") === "advisor", "advisor hash opens the advisor");
assert(practiceAgentFromHash("clients-table") === null, "a clients hash is not an agent");
assert(practiceAgentHash("financial_manager") === "ask-financial-manager", "the manager hash is stable");

const above = books({ cashPosition: { cash: 46300, floor: 36900 } });
const aboveLines = ownerHomeLines(ownerAnswerTiles(above), null);
assert(
  aboveLines.financial_manager[0]?.includes("46,300") &&
    aboveLines.financial_manager[0]?.includes("36,900") &&
    !aboveLines.financial_manager[0]?.includes("50,000"),
  `home cash uses the outlook floor (${aboveLines.financial_manager[0]})`,
);
assert(ownerCardStatuses(above).financial_manager === null, "cash above the floor is not Critical");

const below = books({ cashPosition: { cash: 30000, floor: 36900 } });
const belowLine = ownerHomeLines(ownerAnswerTiles(below), null).financial_manager[0] ?? "";
assert(belowLine.includes("below") && belowLine.includes("36,900"), `a shortfall names the floor (${belowLine})`);
assert(ownerCardStatuses(below).financial_manager?.word === "Critical", "cash under the floor is Critical");
assert(!belowLine.includes("▸"), "the cash line has no stray marker");

const quiet = varianceLine("revenue", "Revenue", 100_000, 99_980, true);
assert(quiet.signal === "inline", `a -$20, -0.0% variance is neutral (${quiet.signal})`);
const real = varianceLine("revenue", "Revenue", 200, 180, true);
assert(real.signal === "adverse", "a real percentage drop stays adverse");

assert(openingCashByWeek(46300, [48000, 47000, 49000])[0] === 46300, "week 1 opens on the balance");
assert(openingCashByWeek(46300, [48000, 47000, 49000])[1] === 48000, "week 2 opens on week 1's close");
assert(openingCashByWeek(46300, [48000, 47000, 49000])[2] === 47000, "week 3 opens on week 2's close");
assert(keepOutlookOpening("0", 46300), "a stored zero does not replace live cash");
assert(keepOutlookOpening("", 46300), "a blank opening does not replace live cash");
assert(!keepOutlookOpening("46300", 46300), "a matching opening can stay");
assert(
  blankForecastLines([
    { amount: "" },
    { amount: "0" },
    { amount: null },
  ]),
  "the three empty revenue placeholders are blank",
);
assert(!blankForecastLines([{ amount: "1200" }]), "a real receipt is not a placeholder");

const periodInputs = {
  revenue: "412000",
  cogs: "100000",
  ebit: "80000",
  ebt: "70000",
  netIncome: "60000",
  ebitda: "90000",
  operatingCashflow: "50000",
  totalAssets: "500000",
  equity: "250000",
  receivables: "40000",
  inventory: "10000",
  payables: "20000",
  fixedCosts: "180000",
  variableCosts: "90000",
  top5Revenue: "100000",
  laborCost: "80000",
  employees: "4",
  founderHours: "1000",
  periodMonths: "9",
} satisfies RatioInputs;
const fcr = ratioActualLine("Fixed Cost Ratio", periodInputs, (n) => `$${Math.round(n).toLocaleString("en-US")}`);
assert(fcr.calculation?.includes("$412,000"), `fixed cost ratio uses period revenue (${fcr.calculation})`);
assert(fcr.calculation?.includes("$180,000"), `fixed cost ratio uses period costs (${fcr.calculation})`);
assert(!fcr.calculation?.includes("549"), `fixed cost ratio does not annualise revenue (${fcr.calculation})`);
const days = ratioActualLine("Debtor Days", periodInputs, (n) => `$${Math.round(n).toLocaleString("en-US")}`);
assert(days.calculation?.includes("$549,333"), `debtor days still annualise revenue (${days.calculation})`);

assert(reportLinkOpensPreview("preview"), "an explicit preview opens the PDF");
assert(!reportLinkOpensPreview(undefined), "a report link without an action does not open the PDF");
assert(!reportLinkOpensPreview("download"), "download is not a preview");
assert(reportLinkRunsDownload("download"), "download still downloads");

assert(!isFirmProductPath("/settings/team"), "team settings are not a billed product path");
assert(
  decideFirmBillingPathGate({
    pathname: "/settings/team",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 1,
  }) === "allow",
  "an unpaid firm can open team settings",
);
assert(
  decideFirmBillingPathGate({
    pathname: "/settings",
    isAccountantFirmUser: true,
    isMilonItMember: false,
    entitled: false,
    insightSeen: true,
    firmClientCount: 1,
  }) === "allow",
  "account settings stay open",
);

const read = (path: string) => readFileSync(resolve(path), "utf8");
const board = read("src/components/practice-board.tsx");
assert(board.includes("<AgentStage"), "the practice dashboard opens the agent stage");
assert(board.includes("practiceAgentFromHash"), "the dashboard reads the ask hash");
assert(board.includes('id="follow-up"'), "Follow up has an anchor");
assert(!board.includes("followUpItems.length > 0 ? ("), "Follow up stays on the page when the queue is empty");
assert(board.includes("<h1>Clients</h1>"), "Clients has an h1");

const pane = read("src/components/milon-team/milon-team-pane.tsx");
assert(pane.includes("homeFinding?.trim() || filedFinding"), "the agent stage prefers the Home finding");
const client = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(client.includes("homeFinding="), "the client agent view receives the Home line");
assert(client.includes("cashPosition:"), "Home cash comes from the Health outlook");
assert(client.includes('useState("Checking the action plan.")'), "the plan strip waits for the plan");
assert(!client.includes("studioDeepLink"), "All reports does not keep a stale report link");

const desk = read("src/components/milon-team/milon-team-desk.tsx");
assert(desk.includes('presentation !== "agent"'), "an open agent does not sit on feed skeletons");
const deskCss = read("src/components/milon-team/milon-team-desk.css");
assert(deskCss.includes(":has(.agent-stage)"), "the agent view is not locked to the viewport");

const drawer = read("src/components/playbook-drawer.tsx");
assert(drawer.includes("displayNumber"), "playbook steps show a sequential number");
assert(drawer.includes("stepNumber={step.step_number}"), "sign-off still uses the stored step");

const studio = read("src/routes/_authenticated/reports-studio.tsx");
assert(studio.includes("reportLinkOpensPreview"), "the PDF modal opens only for a preview action");

const settings = read("src/components/settings-shell.tsx");
assert(settings.includes("<FirmSwitcher"), "settings keeps the firm pill");
assert(settings.includes("<FeatureFinder"), "settings keeps search");

const inbox = read("src/components/accountant-inbox.tsx");
assert(inbox.includes('id="accountant-inbox"'), "Marketplace has an anchor before it finishes loading");

const moves = read("src/components/strategic-moves-panel.tsx");
assert(moves.includes("<ActionHandoffButtons"), "next moves reuse the Hand to buttons");
assert(moves.includes("requestOwnerHandoff"), "next moves use the same hand-off call");
const plan = read("src/components/action-plan.tsx");
assert(plan.includes("onHandOff={isOwner ? (agent) => void assignToAgent"), "the action plan still hands off");

const portalCss = read("src/styles/accountant-portal.css");
assert(!portalCss.includes('content:"▸"'), "the portal does not paint a stray triangle glyph");

console.log("accountant-walkthrough ok");
