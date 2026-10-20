/**
 * Owner tabs are bookmarkable, and Home counts drafts and deliverables together.
 * Run: pnpm test:owner-app-tab
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ownerNeedsView } from "../src/lib/owner-needs";
import {
  isLegacyOwnerBoardTab,
  ownerDoorScreen,
  ownerDoorSearch,
  type OwnerAppSearch,
} from "../src/lib/owner-app-tab";

assert.equal(ownerDoorScreen({}), "home", "a bare /app opens Home");
assert.equal(ownerDoorScreen({ tab: "cash" }), "cash", "/app?tab=cash opens Cash flow");
assert.equal(ownerDoorScreen({ tab: "health" }), "health", "/app?tab=health opens Health");
assert.equal(ownerDoorScreen({ tab: "moves" }), "moves", "/app?tab=moves opens Next moves");
assert.equal(ownerDoorScreen({ tab: "accountant" }), "accountant", "/app?tab=accountant opens the portal");
assert.equal(
  ownerDoorScreen({ screen: "accountant", section: "signed" }),
  "accountant",
  "the older accountant screen link still opens the portal",
);
assert.equal(isLegacyOwnerBoardTab("today"), true, "today stays on the older board");
assert.equal(isLegacyOwnerBoardTab("cash"), false, "cash is an owner door tab");

let search: OwnerAppSearch = {};
search = ownerDoorSearch(search, "cash");
assert.equal(search.tab, "cash");
assert.equal(ownerDoorScreen(search), "cash");
const cash = { ...search };
search = ownerDoorSearch(search, "health");
assert.equal(search.tab, "health");
assert.equal(ownerDoorScreen(search), "health");
assert.equal(ownerDoorScreen(cash), "cash", "Back to the cash entry restores Cash flow");
search = ownerDoorSearch(search, "home");
assert.equal(search.tab, undefined, "Home drops the tab param");
assert.equal(ownerDoorScreen(search), "home");
const onCash = ownerDoorSearch({ tab: "cash" }, "settings");
assert.equal(onCash.screen, "settings");
assert.equal(onCash.tab, "cash", "Settings keeps the tab so Back returns to it");
assert.equal(ownerDoorScreen(onCash), "settings");
const backFromSettings = { ...onCash };
delete backFromSettings.screen;
assert.equal(ownerDoorScreen(backFromSettings), "cash");
search = ownerDoorSearch({ tab: "health", qbo: "connected" } as OwnerAppSearch & { qbo?: string }, "budget");
assert.equal(search.tab, "budget");
assert.equal((search as { qbo?: string }).qbo, "connected", "a tab change keeps the connect return");

const base = {
  ownerEmail: "alex@northline.test",
  actionsReady: true,
  actionsUnavailable: false,
  actions: [],
  draftsReady: true,
  draftsUnavailable: false,
  deliverablesReady: true,
  deliverablesUnavailable: false,
  advisoryTitles: [] as string[],
  quickBooks: { state: "absent" as const },
  xero: { state: "absent" as const },
  when: () => "2 Oct 2026",
};

const drafts = [
  "Chase the top three invoices.",
  "Send the supplier statement.",
  "Confirm the payroll draft.",
];
const contradicted = ownerNeedsView({
  ...base,
  draftTitles: drafts,
  deliverableCount: 0,
});
assert.equal(contradicted.draftsHeading, "3 drafts need your OK");
assert.equal(contradicted.deliverablesHeading, "3 deliverables awaiting review");
assert.equal(contradicted.deliverableLines[0], drafts[0]);
assert.equal(
  contradicted.deliverableLines.some((line) => line.startsWith("No deliverables")),
  false,
  "drafts that need an OK are not an empty deliverable list",
);

const empty = ownerNeedsView({ ...base, draftTitles: [], deliverableCount: 0 });
assert.equal(empty.deliverablesHeading, "Deliverables");
assert.equal(empty.deliverableLines[0], "No deliverables awaiting review.");
assert.equal(empty.draftsHeading, "Drafts");

const app = readFileSync("src/routes/app.tsx", "utf8");
assert.match(app, /routeScreen=\{ownerDoorScreen\(oauthReturn\)\}/, "/app restores the door from the URL");
const openScreen = app.match(/onOpenScreen=\{([\s\S]*?)\n\s*\}/);
assert.ok(openScreen, "opening a tab is wired to the URL");
assert.match(openScreen[1], /ownerDoorSearch\(prev, screen\)/, "opening a tab writes /app?tab=");
assert.equal(/replace/.test(openScreen[1]), false, "a tab change is a history push, so Back and Forward work");
assert.match(
  app,
  /showOwnerDoor = !sampleMode && !isLegacyOwnerBoardTab\(searchTab\)/,
  "legacy board links stay on the older board",
);
assert.match(app, /isOwnerAppTab\(search\.tab\)/, "/app keeps door tabs in the URL");

console.log("owner-app-tab: ok");
