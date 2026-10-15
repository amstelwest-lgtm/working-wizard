/**
 * AQA walk findings: client Home, chase draft, business name, plan gap.
 * Run: pnpm test:aqa-med-findings
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chaseDraftMessage } from "../src/lib/chase-draft";
import { clientDisplayName } from "../src/lib/client-display-name";
import { clientHomeSearch } from "../src/lib/client-home-search";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(clientHomeSearch().tab === "home", "opening a client addresses Home");

const draft = chaseDraftMessage({
  clientName: "Chill Pepper",
  firmName: "My practice",
  actions: [
    { title: "Send the management pack", overdue: false },
    { title: "Collect the March invoice", overdue: true },
  ],
});
assert(draft.subject.includes("Chill Pepper"), "chase subject names the client");
assert(draft.body.includes("Collect the March invoice"), "overdue title is in the draft");
assert(!draft.body.includes("Send the management pack"), "an open title is left out when an overdue one exists");
assert(draft.body.includes("My practice"), "the firm name already on the book is the sign-off");
assert(!/send email|mailto:|functions\/v1/i.test(`${draft.subject}\n${draft.body}`), "the draft is not a send");

const empty = chaseDraftMessage({ clientName: "Chill Pepper", firmName: null, actions: [] });
assert(!empty.body.includes("R"), "an empty chase invents no amount");
assert(empty.body.includes("Chill Pepper"), "an empty chase still names the client");

assert(
  clientDisplayName({
    storedName: "Theo van der Westhuizen",
    ownerFullName: "Theo van der Westhuizen",
    ledgerNames: ["Chill Pepper"],
  }) === "Chill Pepper",
  "a personal stored name yields the ledger name",
);
assert(
  clientDisplayName({
    storedName: "Chill Pepper",
    ownerFullName: "Theo van der Westhuizen",
    ledgerNames: ["Other Books"],
  }) === "Chill Pepper",
  "a business stored name stays",
);
assert(
  clientDisplayName({
    storedName: "Theo van der Westhuizen",
    ownerFullName: "Theo van der Westhuizen",
    ledgerNames: ["Theo van der Westhuizen"],
  }) === "Theo van der Westhuizen",
  "the same ledger name is not swapped for a made-up one",
);

const dialog = readFileSync(resolve("src/components/chase-draft-dialog.tsx"), "utf8");
assert(dialog.includes("data-chase-draft"), "the chase dialog is marked");
assert(dialog.includes("Copy draft"), "the chase dialog can be copied");
assert(!dialog.includes("Send email"), "the chase dialog has no send");
assert(!dialog.includes("sendAssignment"), "the chase dialog does not call the mailer");

const board = readFileSync(resolve("src/components/practice-board.tsx"), "utf8");
assert(board.includes("<th>Trend</th>"), "the clients table has a trend column");
assert(board.includes("KpiTrendline"), "the trend column draws the stored series");
assert(!/KpiTrendline[^>]*placeholder/.test(board), "the trend column does not ask for a ghost line");

const ask = readFileSync(resolve("src/lib/ask-ai.js"), "utf8");
assert(ask.includes('THREAD_PREFIX + clientId + ":" + agent'), "each agent has its own thread key");
assert(ask.includes("financial_manager"), "a legacy thread stays with Financial Manager");

console.log("aqa-med-findings-test: ok");
