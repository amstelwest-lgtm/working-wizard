/**
 * DMMT client chrome: one primary next action on Overview and Client Brain.
 * Run: pnpm test:dmmt-chrome
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  headerShortcutClass,
  portalButtonClass,
  trackedAskClass,
} from "../src/lib/client-chrome";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

function read(path: string) {
  return readFileSync(resolve(path), "utf8");
}

assert(portalButtonClass("primary") === "btn gold mini", "the one primary is a gold pill");
assert(portalButtonClass("secondary") === "btn ghost mini", "secondary actions stay a ghost pill");
assert(portalButtonClass("secondary", false) === "btn ghost", "a full secondary is still ghost");
assert(headerShortcutClass() === "tb-btn", "a header shortcut is not a gold primary");
assert(!headerShortcutClass().includes("gold"), "header class carries no gold");
assert(
  !trackedAskClass("accountant").includes("from-[#f3d98a]"),
  "accountant tracked asks are not gold pills",
);
assert(trackedAskClass("accountant").includes("border"), "accountant tracked asks stay an outline");
assert(
  trackedAskClass("owner").includes("from-[#f3d98a]"),
  "the owner board keeps the gold ask pill",
);

const client = read("src/routes/_authenticated/clients.$clientId.tsx");
const header = client.slice(client.indexOf("topbar-actions"), client.indexOf("BREADCRUMB"));
assert(header.includes("Reports studio"), "Reports studio stays in the client header");
assert(header.includes("headerShortcutClass()"), "the header shortcut uses the quiet class");
assert(!header.includes("tb-btn gold"), "Reports studio is not a gold primary");

const overview = client.slice(client.indexOf('id="pane-overview"'), client.indexOf('id="pane-summary"'));
assert(overview.includes("<NextStepCard"), "Next Step stays the Overview primary");
assert(overview.includes("data-ask-bot"), "Ask Milōn Bot stays on Overview");
assert(overview.includes("Ask Milōn Bot"), "the Bot entry keeps its label");
assert(overview.includes("Generate report"), "Generate report stays reachable");
assert(overview.includes("Export PDF"), "Export PDF stays reachable");
assert(overview.includes("deliverables-more"), "deliverable tools are tucked");
assert(!overview.includes("btn gold"), "Overview chrome has no gold button");
assert(!overview.includes('portalButtonClass("primary")'), "Overview does not mint a second primary");
assert(
  overview.includes('portalButtonClass("secondary")'),
  "Overview strips use the secondary weight",
);

const brain = read("src/components/client-brain-summary.tsx");
const hero = brain.slice(brain.indexOf('id="wizard-brain-hero"'), brain.indexOf("brain-stack"));
assert(hero.includes("Propose from brain"), "Propose from brain stays the hero action");
assert(hero.includes("Draft advisory from brain"), "Draft advisory stays reachable");
assert(hero.includes("Open Action Plan"), "Action Plan stays reachable");
assert(
  (hero.match(/portalButtonClass\("primary"\)/g) ?? []).length === 0,
  "the brain hero leaves the gold primary to the Books strip",
);
assert(hero.includes('portalButtonClass("secondary")'), "draft and the plan link are secondary");
assert(!hero.includes("btn gold"), "the hero does not hard-code a second gold pill");

const drafts = read("src/components/client-brain-drafts.tsx");
const emptyDrafts = drafts.slice(drafts.indexOf("No packs on this file"), drafts.indexOf("brain-list gap-lg"));
assert(emptyDrafts.includes("Open Advisory"), "Open Advisory stays on an empty draft list");
assert(emptyDrafts.includes('portalButtonClass("secondary")'), "Open Advisory does not compete with Propose");

const asks = read("src/components/data-requests-panel.tsx");
assert(
  (asks.match(/trackedAskClass\(audience\)/g) ?? []).length === 3,
  "email, upload, and enter-balance follow the audience weight",
);

const css = read("src/styles/accountant-portal.css");
const uploadRule = css.slice(css.indexOf(".data-fresh__upload{"), css.indexOf(".data-fresh__upload:hover"));
assert(!uploadRule.includes("#d4a550"), "Brain upload is not a gold fill");
assert(uploadRule.includes("background:transparent"), "Brain upload is an outline");
assert(css.includes(".deliverables-more"), "tucked deliverables have a strip style");

console.log("dmmt-chrome-test: ok");
