/**
 * Chill Pepper data-request days. Run: pnpm test:diagnose-days-guard
 * On 0c37f532 the unicode minus stays in the narrative. The guard removes it.
 */
import { readFileSync } from "node:fs";
import { actionRowDisplayState } from "../src/lib/action-handoff.ts";
import { actionMatchesOwnerFilter, ownerLoadPick, ownerLoadRows, visibleActionNumbers } from "../src/components/action-plan.tsx";
import { groundAdvisoryNarrative } from "../src/lib/advisory-narrative.ts";
import { polishAgentCopy } from "../src/lib/agent-bus.ts";
import { presentLiveDraft } from "../src/lib/draft-figures.ts";
import { findingCardCopy, findingMetricContext } from "../src/lib/milon-team-activity.ts";
import { ZA_MARKET } from "../src/lib/market/index.ts";

const MINUS = "\u2212";
const prose = `The books show creditor days ${MINUS}248 and inventory days ${MINUS}93. Gross margin is 95.4%.`;
const ascii = "The books show creditor days -248 and inventory days -93. Gross margin is 95.4%.";
const ratios: Record<string, number> = {
  "Gross Margin": 0.954,
  "Creditor Days": Number.NaN,
  "Inventory Days": Number.NaN,
  "Debtor Days": 6.6,
  "Working Capital Days": Number.NaN,
};

function forbidDays(label: string, text: string) {
  for (const bad of ["-248", `${MINUS}248`, "-93", `${MINUS}93`]) {
    if (text.includes(bad)) throw new Error(`${label} still quotes ${bad}: ${text}`);
  }
  if (/\b248\b/.test(text) || /\b93\b/.test(text)) {
    throw new Error(`${label} kept the day magnitude: ${text}`);
  }
}

const card = findingCardCopy(
  {
    kind: "data_request_draft",
    title: prose,
    detail: ascii,
    evidence: {
      request: { title: prose },
      figures: {
        grossMargin: 1.046,
        creditorDays: -248,
        inventoryDays: -93,
        debtorDays: 6.6,
      },
    },
  },
  ZA_MARKET,
  ratios,
);
forbidDays("data-request card", `${card.lead} ${card.context ?? ""}`);

const home = presentLiveDraft(prose, { ratios });
forbidDays("home draft", home.text);

forbidDays("groundAdvisoryNarrative", `${groundAdvisoryNarrative(prose, ratios)} ${groundAdvisoryNarrative(ascii, ratios)}`);

const context = findingMetricContext(
  {
    figures: {
      grossMargin: 1.046,
      creditorDays: -248,
      inventoryDays: -93,
      debtorDays: 6.6,
    },
  },
  ZA_MARKET,
  ratios,
);
forbidDays("findingMetricContext", context ?? "");

const written = polishAgentCopy({
  text: prose,
  role: "detail",
  kind: "data_request_draft",
  canonicalRatios: ratios,
});
if (!written.ok) throw new Error(written.error);
forbidDays("execute write path", written.text);
for (const text of [card.lead, card.context ?? "", home.text, context ?? "", written.text]) {
  if (!text.includes("95.4%")) throw new Error(`corrected margin dropped: ${text}`);
  if (!text.includes("not enough data")) throw new Error(`day count was not replaced: ${text}`);
}
const execute = readFileSync("supabase/functions/agent-analyst/execute.ts", "utf8");
if (!execute.includes("guardQuotedRatios(")) {
  throw new Error("the analyst write path does not call the shared guard");
}

const finished = actionRowDisplayState({
  health: "overdue",
  progressPct: 0,
  status: "in_progress",
  pickupLabel: "Done by Financial Manager · 27 Oct. See result.",
  draftId: "finding-1",
  title: "Chase the supplier pack",
});
if (finished.overdue || finished.progressPct !== 100 || finished.health === "complete") {
  throw new Error(`bot finish still looks overdue or done: ${JSON.stringify(finished)}`);
}
const signoff = actionRowDisplayState({
  health: "overdue",
  progressPct: 0,
  status: "in_progress",
  pickupLabel: "Done by Financial Manager · 27 Oct. See result.",
  title: "Sign off the management pack",
});
if (signoff.health === "complete" || signoff.overdue) {
  throw new Error(`sign-off was marked done: ${JSON.stringify(signoff)}`);
}

const load = ownerLoadRows(
  [
    { id: "1", status: "in_progress", owner_id: null, owner_name: "Financial Manager" },
    { id: "2", status: "in_progress", owner_id: null, owner_name: "Financial Manager" },
    { id: "3", status: "in_progress", owner_id: null, owner_name: "Analyst" },
    { id: "4", status: "in_progress", owner_id: null, owner_name: null },
  ],
  [],
);
if (load.find((row) => row.name === "Financial Manager")?.count !== 2) {
  throw new Error(`agent assignments fell into Unassigned: ${JSON.stringify(load)}`);
}
if (load.find((row) => row.name === "Unassigned")?.count !== 1) {
  throw new Error(`blank assignee was not Unassigned: ${JSON.stringify(load)}`);
}
if (JSON.stringify(visibleActionNumbers(3)) !== "[1,2,3]") {
  throw new Error("visible numbers are not the kept rows");
}
const agentKey = load.find((row) => row.name === "Financial Manager")?.key;
if (agentKey !== "agent:Financial Manager" || ownerLoadPick(agentKey) !== agentKey) {
  throw new Error(`clicking an agent bucket does not pick that agent: ${agentKey}`);
}
if (ownerLoadPick("unassigned") !== null) throw new Error("Unassigned should clear the filter");
if (
  !actionMatchesOwnerFilter(
    { owner_id: null, owner_name: "Financial Manager" },
    "agent:Financial Manager",
  )
) {
  throw new Error("an agent filter does not match that agent's rows");
}

console.log("diagnose days guard ok");
