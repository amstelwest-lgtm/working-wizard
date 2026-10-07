/**
 * DMMT accountant first-paint: tab URL, acting-as crumb, greeting.
 * Run: pnpm test:dmmt-polish
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  accountantClientTabSearch,
  normalizeAccountantClientTab,
} from "../src/lib/client-route-search";
import { firmClientCrumbLabel, isActingAsThisClient } from "../src/lib/acting-as-client";
import {
  firstNameOf,
  mergeNeedsAttention,
  practiceGreeting,
  type AttentionItem,
} from "../src/lib/portfolio-dashboard";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const fromPlan = accountantClientTabSearch(
  { tab: "plan", filter: "overdue", coach: "margin", why: "because", focus: "health", qbo: "connected" },
  "reports",
);
assert(fromPlan.tab === "reports", "Reports replaces ?tab=plan");
assert(!("filter" in fromPlan), "an Action Plan filter does not stick to Reports");
assert(!("coach" in fromPlan) && !("why" in fromPlan) && !("focus" in fromPlan), "coach crumbs clear");
assert(fromPlan.qbo === "connected", "unrelated search keys stay");
assert(accountantClientTabSearch({ tab: "plan" }, "report").tab === "reports", "report alias sticks as reports");
assert(normalizeAccountantClientTab("reports") === "reports", "direct ?tab=reports is already reports");
assert(
  accountantClientTabSearch({ tab: "reports", filter: "overdue" }, "plan").filter === "overdue",
  "opening Action Plan keeps an overdue filter",
);

const yankees = "11111111-1111-4111-8111-111111111111";
assert(!isActingAsThisClient(null, yankees), "a normal firm open is not acting as the client");
assert(!isActingAsThisClient("", yankees), "an empty impersonation id is not acting");
assert(!isActingAsThisClient("other-client", yankees), "acting as someone else is not this client");
assert(isActingAsThisClient(yankees, yankees), "Enter as client matches this client");
assert(firmClientCrumbLabel("New York Yankees", false) === "New York Yankees", "firm crumb is the client name");
assert(
  !firmClientCrumbLabel("New York Yankees", false).includes("Acting as client"),
  "firm open does not say Acting as client",
);
assert(
  firmClientCrumbLabel("New York Yankees", true) === "Acting as client: New York Yankees",
  "real impersonation names the acting state",
);

const morning = new Date(2026, 9, 7, 9, 0, 0);
assert(firstNameOf("A. Sample") === "Sample", "an initial is not the short name");
assert(firstNameOf("Ben Accountants") === "Ben", "a given name stays the first token");
assert(firstNameOf("A.") === "A", "a lone initial drops the trailing dot");
assert(firstNameOf("") === "there", "empty name falls back");
assert(practiceGreeting("A. Sample", morning) === "Good morning, Sample.", "greeting uses the short name");
assert(!practiceGreeting("A. Sample", morning).includes("A.."), "greeting is not A..");
assert(practiceGreeting("Ben Accountants", morning) === "Good morning, Ben.", "given name greeting");

const health: AttentionItem = {
  clientId: yankees,
  name: "New York Yankees",
  severity: "high",
  severityLabel: "High",
  reason: "Cash Stability under pressure",
  detail: "4 recommended actions",
  openPlan: true,
};
const merged = mergeNeedsAttention(
  [health],
  [
    {
      clientId: yankees,
      name: "New York Yankees",
      exceptions: [
        { severity: 1, label: "Pack v1 waiting for your sign-off", tab: "advisory" },
      ],
    },
    {
      clientId: "22222222-2222-4222-8222-222222222222",
      name: "QA Test Co",
      exceptions: [
        { severity: 1, label: "Pack v2 waiting for your sign-off", tab: "advisory" },
      ],
    },
  ],
);
assert(merged.length === 2, "health and sign-off are one queue, one row per client");
const yankeesRow = merged.find((row) => row.clientId === yankees);
assert(Boolean(yankeesRow), "Yankees stays in the queue");
assert(
  yankeesRow?.reason.includes("Cash Stability under pressure") &&
    yankeesRow.reason.includes("Pack v1 waiting for your sign-off"),
  "one row carries health and pack sign-off",
);
assert(yankeesRow?.tab === "advisory", "the urgent pack opens Advisory");
assert(merged[0]?.tab === "advisory", "sign-off ranks with the urgent rows");

const clientSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(clientSrc.includes("accountantClientTabSearch"), "the studio writes tab through the helper");
assert(clientSrc.includes("firmClientCrumbLabel"), "the crumb uses the acting-as helper");
assert(!clientSrc.includes("Acting as client: <b"), "the crumb is not hard-coded as acting");
assert(clientSrc.includes('revealTab("reports")') || clientSrc.includes("revealTab(tab"), "Reports still opens through revealTab");
assert(/activeTab === "budget" \? "flex" : "none"/.test(clientSrc), "health has no complexity toggle");
assert(!clientSrc.includes('viewMode === "complex"'), "health complex mode is gone");

const dash = readFileSync(resolve("src/routes/_authenticated/dashboard.tsx"), "utf8");
assert(dash.includes("practiceGreeting"), "the practice home uses the greeting helper");
assert(dash.includes("dash-trial-banner"), "an ended trial is a thin banner");
assert(dash.includes('to="/settings"'), "the thin banner links to Settings");
assert(dash.includes("healthItems={attentionItems}"), "health alerts join the one queue");
assert(dash.includes('aria-label="Enter as client"'), "Enter as client is named");
assert(dash.includes(">Enter as client<"), "Enter as client has a visible label");

const settings = readFileSync(resolve("src/routes/_authenticated/settings.index.tsx"), "utf8");
assert(settings.includes("TrialEndedPlanBlock"), "Settings mounts the trial-ended plan card");
const card = readFileSync(resolve("src/components/trial-ended-plan-block.tsx"), "utf8");
assert(card.includes("trial-ended-block"), "the plan card keeps its existing surface class");

console.log("dmmt-polish-test: ok");
