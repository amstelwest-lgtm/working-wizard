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
import { clientAgentWork, practiceAgentWork } from "../src/lib/agent-work";
import { clientBackTarget } from "../src/lib/client-back";
import { practiceAgentFromHash, practiceAgentHash } from "../src/lib/practice-agent-hash";
import { ratioActualLine } from "../src/lib/ratio-actuals";
import type { RatioInputs } from "../src/lib/ratios";
import {
  CHUNK_RELOAD_BOOT_SCRIPT,
  CHUNK_RELOAD_KEY,
  isChunkLoadError,
  reloadForChunkError,
} from "../src/lib/chunk-reload";
import { markTourSeen, tourSeen } from "../src/lib/onboarding";
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

const above = books({
  cashOutlook: { opening: 46300, closing: [46300], floor: 36900, dipsBelowFloorWeek: null },
});
const aboveLines = ownerHomeLines(ownerAnswerTiles(above), null);
assert(
  aboveLines.financial_manager[0]?.includes("46,300") &&
    aboveLines.financial_manager[0]?.includes("36,900") &&
    !aboveLines.financial_manager[0]?.includes("50,000"),
  `home cash uses the outlook floor (${aboveLines.financial_manager[0]})`,
);
assert(ownerCardStatuses(above).financial_manager === null, "cash above the floor is not Critical");

const below = books({
  cashOutlook: { opening: 30000, closing: [30000], floor: 36900, dipsBelowFloorWeek: null },
});
const belowLine = ownerHomeLines(ownerAnswerTiles(below), null).financial_manager[0] ?? "";
assert(belowLine.includes("under") && belowLine.includes("36,900"), `a shortfall names the floor (${belowLine})`);
assert(
  ownerCardStatuses(below).financial_manager?.word === "Critical: cash below floor",
  "cash under the floor is Critical",
);
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

const fmWork = practiceAgentWork("financial_manager", {
  loading: false,
  clients: [{ id: "a", name: "Harbour Glass", openQueries: 2 }],
  attention: [],
  followUps: [],
});
assert(fmWork.items[0]?.title === "Harbour Glass", "the financial manager lists the client with queries");
assert(fmWork.items[0]?.link.search?.agent === "financial_manager", "that row opens the client agent");
const quietBook = practiceAgentWork("advisor", {
  loading: false,
  clients: [],
  attention: [],
  followUps: [],
});
assert(quietBook.items[0]?.link.hash === "follow-up", "an empty advisor page links to follow up");
const loadingBook = practiceAgentWork("analyst", {
  loading: true,
  clients: [],
  attention: [],
  followUps: [],
});
assert(loadingBook.items.length === 0 && loadingBook.empty === "Loading the book.", "a loading book is a sentence, not a skeleton");
assert(clientAgentWork("financial_manager", "c")[0]?.link.search?.section === "forecast", "the client agent links to the cash line");
assert(clientBackTarget({ tab: "ratios", section: "score" })?.label === "Health", "a score page goes back to Health");
assert(clientBackTarget({ tab: "overview", agent: "analyst" })?.tab === "home", "an agent page goes back to Home");
assert(clientBackTarget({ tab: "overview" }) === null, "Home has no back target");

const read = (path: string) => readFileSync(resolve(path), "utf8");
const board = read("src/components/practice-board.tsx");
const thread = read("src/components/practice-agent-thread.tsx");
assert(board.includes("PracticeAgentThread"), "the practice dashboard opens the agent thread");
assert(thread.includes("<AgentStage"), "the practice agent thread opens the agent stage");
assert(board.includes("<AgentWork"), "the practice agent page lists the book");
assert(!board.includes('width: "60%"'), "playbook cards do not draw a fake progress bar");
assert(board.includes("askAgentFromHash"), "the dashboard reads the ask hash");
assert(board.includes('id="follow-up"'), "Follow up has an anchor");
assert(!board.includes("followUpItems.length > 0 ? ("), "Follow up stays on the page when the queue is empty");
assert(board.includes("<h1>Clients</h1>"), "Clients has an h1");

const pane = read("src/components/milon-team/milon-team-pane.tsx");
assert(
  pane.includes("homeFinding?.trim() || findingFallback?.trim() || filedFinding"),
  "the agent stage prefers the Home finding",
);
const client = read("src/routes/_authenticated/clients.$clientId.tsx");
assert(client.includes("homeFinding="), "the client agent view receives the Home line");
assert(client.includes("<ClientBackLink"), "client pages have a header back control");
assert(client.includes("hideScore"), "Health does not repeat the score");
assert(client.includes("Edit the period figures on Health."), "Profit links to Health for the figures");
assert(!client.includes("profitFinCollapse"), "Profit does not edit the same figures as Health");
const openAgent = client.slice(client.indexOf("const openHomeAgent"), client.indexOf("const openHomeSection"));
assert(!openAgent.includes("replace:"), "opening an agent pushes history");
const openSection = client.slice(client.indexOf("const openHomeSection"), client.indexOf("const openReportPage"));
assert(!openSection.includes("replace:"), "opening a section pushes history");
assert(client.includes("cashOutlook:"), "Home cash comes from the Health outlook");
assert(client.includes("planKnown ? planSentence"), "the plan strip waits for the plan");
assert(!client.includes("studioDeepLink"), "All reports does not keep a stale report link");

const desk = read("src/components/milon-team/milon-team-desk.tsx");
assert(desk.includes('presentation !== "agent"'), "an open agent does not sit on feed skeletons");
const deskCss = read("src/components/milon-team/milon-team-desk.css");
assert(deskCss.includes(":has(.agent-stage)"), "the agent view is not locked to the viewport");
assert(
  deskCss.includes(".accountant-portal:has(.agent-stage) .milon-desk-scroll"),
  "the agent desk grows with its content",
);
assert(pane.includes("<AgentWork"), "the client agent page lists its work");

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
const handTo = read("src/components/hand-to-menu.tsx");
assert(moves.includes("<MoveHandTo"), "next moves open the shared Hand to menu");
assert(handTo.includes("<ActionHandoffButtons"), "Hand to reuses the cobalt buttons");
assert(handTo.includes("requestOwnerHandoff"), "Hand to uses the same hand-off call");
const plan = read("src/components/action-plan.tsx");
assert(plan.includes("onHandOff={isOwner ? (agent) => void assignToAgent"), "the action plan still hands off");

const portalCss = read("src/styles/accountant-portal.css");
assert(!portalCss.includes('content:"▸"'), "the portal does not paint a stray triangle glyph");
assert(
  portalCss.includes(".topbar-menu-btn{\n    display:inline-flex;"),
  "the Menu label sits on the same row as its icon",
);
assert(!portalCss.includes("footer-tagline"), "the footer slogan style is gone");
assert(!board.includes("The passion to perform"), "the practice footer drops the old slogan");
assert(!client.includes("The passion to perform"), "the client footer drops the old slogan");

const notes = read("src/components/note-layer.tsx");
assert(!notes.includes("z-[99993]"), "the notes tray does not cover the page");
assert(notes.includes("notes-tray--pill"), "a closed notes tray is a pill");

const wizard = read("src/components/walkthrough-wizard.tsx");
assert(wizard.includes('"#accountant-menu"'), "the tour leaves the Menu button clickable");
assert(wizard.includes('"#accountant-nav"'), "the tour leaves the drawer clickable");
assert(wizard.includes('"[data-ask]"'), "the tour leaves Ask buttons clickable");
assert(wizard.includes("markTourSeen"), "the long tours are remembered");
assert(wizard.includes("drawerOpen"), "an open drawer dismisses the tour overlay");

const menu = read("src/components/accountant-nav.tsx");
assert(menu.includes('id="accountant-menu"'), "the Menu button has a stable id");
assert(menu.includes('id="accountant-nav"'), "the rail has a stable id");

assert(isChunkLoadError(new Error("Failed to fetch dynamically imported module")), "dynamic import failures count");
assert(isChunkLoadError("Loading chunk 8 failed"), "chunk load failures count");
assert(isChunkLoadError("/assets/app-chrome-abc123.js"), "app-chrome 404s count");
assert(isChunkLoadError("/assets/upload-abc.js"), "upload chunk 404s count");
assert(isChunkLoadError("/assets/settings-menu-abc.js"), "settings menu chunk 404s count");
assert(isChunkLoadError("/assets/use-share-abc.js"), "share chunk 404s count");
assert(!isChunkLoadError(new Error("ResizeObserver loop")), "ordinary errors do not reload");
assert(CHUNK_RELOAD_BOOT_SCRIPT.includes(CHUNK_RELOAD_KEY), "the boot script uses the reload flag");

const memory = new Map<string, string>();
const storage = {
  getItem: (key: string) => memory.get(key) ?? null,
  setItem: (key: string, value: string) => {
    memory.set(key, value);
  },
  removeItem: (key: string) => {
    memory.delete(key);
  },
  clear: () => memory.clear(),
  key: () => null,
  length: 0,
} as Storage;
assert(reloadForChunkError(storage), "the first chunk failure reloads once");
assert(memory.get(CHUNK_RELOAD_KEY) === "1", "the reload flag is stored");
assert(!reloadForChunkError(storage), "a second chunk failure does not reload again");

const tours = new Map<string, string>();
const previous = globalThis.localStorage;
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (key: string) => tours.get(key) ?? null,
  setItem: (key: string, value: string) => {
    tours.set(key, value);
  },
  removeItem: (key: string) => {
    tours.delete(key);
  },
  clear: () => tours.clear(),
  key: (index: number) => [...tours.keys()][index] ?? null,
  get length() {
    return tours.size;
  },
};
assert(!tourSeen("milon_accountant_dash_tour_v10", "user-a"), "a new user has not seen the dashboard tour");
markTourSeen("milon_accountant_dash_tour_v10", "user-a");
assert(tourSeen("milon_accountant_dash_tour_v10", "user-a"), "the dashboard tour is remembered for that user");
assert(!tourSeen("milon_accountant_dash_tour_v10", "user-b"), "another user still sees the dashboard tour");
(globalThis as unknown as { localStorage: Storage }).localStorage = previous;

console.log("accountant-walkthrough ok");
