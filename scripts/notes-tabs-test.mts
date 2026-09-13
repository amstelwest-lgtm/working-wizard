/**
 * Owner/accountant note tab aliases and Open queries click-through.
 * Run: pnpm test:notes-tabs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  accountantWorkspaceTab,
  destinationTab,
  noteTabLabel,
  noteTabsMatch,
  ownerWorkspaceTab,
  showOnPageLabel,
  stayInListHint,
} from "../src/lib/notes-tabs";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(noteTabsMatch("waterfall", "profit"), "owner Profit pins belong on accountant Profit");
assert(noteTabsMatch("profit", "waterfall"), "accountant Profit pins belong on owner Profit");
assert(noteTabsMatch("today", "ratios"), "owner Health pins belong on accountant Health");
assert(noteTabsMatch("today-complex", "ratios"), "complex Health is still Health");
assert(noteTabsMatch("tasks", "plan"), "owner Action Plan pins belong on accountant Action Plan");
assert(noteTabsMatch("cash", "cash"), "Cash already matches");
assert(noteTabsMatch("budget", "budget"), "Budget already matches");
assert(!noteTabsMatch("waterfall", "ratios"), "Profit is not Health");
assert(!noteTabsMatch("next", "advisory"), "Next moves is not Advisory");
assert(!noteTabsMatch("ask", "today"), "Milōn Bot is not Health");

assert(accountantWorkspaceTab("waterfall") === "profit", "deep link tab=waterfall opens Profit");
assert(accountantWorkspaceTab("today") === "ratios", "deep link tab=today opens Health");
assert(accountantWorkspaceTab("today-complex") === "ratios", "today-complex opens Health");
assert(accountantWorkspaceTab("tasks") === "plan", "old staff-tasks links open Action Plan");
assert(accountantWorkspaceTab("cash") === "cash", "Cash stays Cash");
assert(accountantWorkspaceTab("next") === null, "Next moves has no accountant page");
assert(accountantWorkspaceTab("ask") === "ask", "Milōn Bot stays on the studio");
assert(accountantWorkspaceTab("summary") === "summary", "Summary stays Summary");

assert(ownerWorkspaceTab("profit") === "waterfall", "accountant Profit pins open owner Profit");
assert(ownerWorkspaceTab("ratios") === "today", "accountant Health pins open owner Health");
assert(ownerWorkspaceTab("plan") === "tasks", "accountant Action Plan pins open owner Plan");
assert(ownerWorkspaceTab("reports") === null, "Reports has no owner page");
assert(ownerWorkspaceTab("advisory") === null, "Advisory has no owner page");
assert(ownerWorkspaceTab("ask") === null, "Milōn Bot has no owner page");
assert(ownerWorkspaceTab("next") === "next", "Next moves stays on the owner board");

assert(destinationTab("waterfall", "accountant") === "profit", "destination helper matches accountant map");
assert(noteTabLabel("waterfall") === "Profit", "badge copy is Profit not waterfall");
assert(noteTabLabel("today") === "Health", "badge copy is Health not Today");
assert(showOnPageLabel("waterfall", "accountant") === "Show on Profit", "CTA names the accountant tab");
assert(showOnPageLabel("profit", "owner") === "Show on Profit", "CTA names the owner tab");
assert(showOnPageLabel("next", "accountant") === null, "no fake jump for Next moves");
assert(showOnPageLabel("reports", "owner") === null, "no fake jump for Reports");
assert(
  stayInListHint("next", "accountant").includes("Next moves"),
  "accountant sees why a Next moves pin stays in the list",
);

const archive = readFileSync(resolve("src/components/note-archive.tsx"), "utf8");
assert(archive.includes("showOnPageLabel"), "archive rows jump to the pin when a page exists");
assert(archive.includes("closeArchive"), "jumping closes the sheet so the pin is visible");
assert(archive.includes("requestOpenNote"), "jumping focuses the pin");
assert(
  archive.includes("stayInListHint"),
  "notes without a matching page stay in the list with an explanation",
);

const ctx = readFileSync(resolve("src/contexts/notes.tsx"), "utf8");
assert(ctx.includes("noteTabsMatch"), "tab notes include owner/accountant aliases");
assert(ctx.includes("workspace"), "surface records which workspace registered it");

const layer = readFileSync(resolve("src/components/note-layer.tsx"), "utf8");
assert(layer.includes("noteTabsMatch"), "pins compare equivalent tabs, not raw IDs");
assert(layer.includes("destinationTab"), "deep links switch to the workspace tab");
assert(layer.includes("highlightNoteId") || layer.includes("data-note-focus"), "focused pin is visually marked");

const client = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(client.includes("accountantWorkspaceTab"), "accountant deep links map owner tab IDs");
assert(client.includes('workspace="accountant"'), "accountant NoteLayer is marked accountant");

const owner = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(owner.includes('workspace="owner"'), "owner NoteLayer is marked owner");
assert(owner.includes("onNeedTab"), "owner archive jumps can switch board tabs");

console.log("notes-tabs-test: ok");
