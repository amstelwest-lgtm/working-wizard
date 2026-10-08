/**
 * Action Plan and Advisory pack answer strips.
 * Pack status words come from signoffStatusLine. The pack pane keeps the
 * existing advisory sign-off and still mounts PrecardCapCard.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import assert from "node:assert/strict";
import { PrecardCapCard } from "../src/components/precard-cap-card";
import { PRECARD_CAP_MESSAGE } from "../src/lib/precard-cap";
import { packAnswerSentence, packStatusText, planAnswerSentence } from "../src/lib/plan-pack-copy";
import { PAGE_FIGURES_CHANGED_CLAUSE, signoffStatusLine } from "../src/lib/signoff-status";

const september = { periodLabel: "September 2026", sectionCount: 6 };

assert.equal(
  packAnswerSentence({ ...september, status: "draft" }),
  "September pack: 6 sections drafted. Draft.",
);
assert.equal(
  packAnswerSentence({ ...september, status: "in_review" }),
  "September pack: 6 sections drafted. Ready for review.",
);
assert.equal(
  packAnswerSentence({
    ...september,
    status: "signed",
    signedBy: "Ada Mbeki",
    signedDate: "2 Oct 2026",
  }),
  "Signed off by Ada Mbeki · 2 Oct 2026.",
);
assert.equal(
  packAnswerSentence({
    ...september,
    status: "signed_stale",
    signedBy: "Ada Mbeki",
    signedDate: "2 Oct 2026",
  }),
  "Signed off by Ada Mbeki · 2 Oct 2026. Figures have changed since; re-review.",
);
assert.equal(
  packAnswerSentence({ periodLabel: null, sectionCount: 0, status: "draft" }),
  "No pack on file yet. Generate one from the figures already on this file.",
);
assert.equal(
  packAnswerSentence({ periodLabel: "Q3 close", sectionCount: 1, status: "draft" }),
  "Q3 close pack: 1 section drafted. Draft.",
);

assert.equal(packStatusText({ status: "in_review" }), signoffStatusLine({ kind: "ready" }));
assert.equal(
  packStatusText({ status: "signed_stale", signedBy: "Ada Mbeki", signedDate: "2 Oct 2026" }),
  signoffStatusLine({ kind: "stale", name: "Ada Mbeki" }),
);
assert.equal(
  packStatusText({ status: "signed", signedBy: "Ada Mbeki", signedDate: "2 Oct 2026" }),
  "Signed off by Ada Mbeki · 2 Oct 2026",
);
assert.ok(
  packStatusText({ status: "signed_stale", signedBy: "Ada Mbeki", signedDate: "2 Oct 2026" }).includes(
    PAGE_FIGURES_CHANGED_CLAUSE,
  ),
  "the stale pill uses the shared figures-changed clause",
);
assert.equal(
  packStatusText({ status: "signed_stale", signedBy: "Ada Mbeki", signedDate: "2 Oct 2026" }).includes(
    "2 Oct 2026",
  ),
  false,
);

assert.equal(planAnswerSentence([]), "No actions in the plan yet.");
assert.equal(
  planAnswerSentence([{ title: "Call the two largest overdue accounts" }]),
  "1 action in the plan. Start with: call the two largest overdue accounts.",
);
assert.equal(
  planAnswerSentence([
    { title: "Raise prices on your best-selling products" },
    { title: "Chase the oldest invoice" },
  ]),
  "2 actions in the plan. Start with: raise prices on your best-selling products.",
);
assert.equal(
  planAnswerSentence([{ title: "AI review of pricing" }, { title: "File the return" }]),
  "2 actions in the plan. Start with: AI review of pricing.",
);

const clientSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const planAt = clientSrc.indexOf('id="pane-plan"');
const advisoryAt = clientSrc.indexOf('id="pane-advisory"');
assert.ok(planAt > 0 && advisoryAt > planAt, "plan and pack panes are in the route");
const planPane = clientSrc.slice(planAt, advisoryAt);
const footerAt = clientSrc.indexOf('className="footer-note"', advisoryAt);
assert.ok(footerAt > advisoryAt, "the pack pane ends before the footer");
const advisoryPane = clientSrc.slice(advisoryAt, footerAt);

assert.ok(planPane.includes("DeliverableAnswerStrip"), "the plan pane uses the answer strip");
assert.ok(planPane.includes('scope="action_plan"'), "the plan keeps its sign-off scope");
assert.ok(planPane.includes("ActionPlanPanel"), "the plan pane still mounts the work list");
assert.ok(planPane.includes("ReviewInputsDrawer"), "plan inputs sit in the drawer");
assert.equal(planPane.includes("client management"), false, "the plan lede no longer says client management");
assert.equal(planPane.includes("point of the tab"), false, "the plan lede no longer explains the point of the tab");
assert.equal(planPane.includes("PrecardCapCard"), false, "the plan pane does not gain a precard card");

assert.ok(advisoryPane.includes("AdvisoryPackPanel"), "the pack path still mounts the pack");
assert.ok(advisoryPane.includes("RecommendationsPanel"), "recommendations stay stacked on the pack");
assert.ok(advisoryPane.includes("AdvisoryDrafter"), "the drafter stays stacked on the pack");
assert.ok(advisoryPane.includes("AdvisoryTabSignoff"), "the pack path keeps the one sign-off control");
assert.ok(advisoryPane.includes("onSignoffAction={setPackSignoff}"), "that control signs the pack");
assert.equal(/ReviewSignoffButton/.test(advisoryPane), false, "the pack path has no second sign-off");
assert.equal(/scope="advisory"/.test(advisoryPane), false, "the pack path does not write a page stamp");
assert.equal(advisoryPane.includes("DeliverableTabHead"), false, "the shared drafter head is gone");

const precardSites = [
  "src/components/advisory-pack-panel.tsx",
  "src/components/advisory-drafter.tsx",
  "src/components/client-brain-summary.tsx",
  "src/components/recommendations-panel.tsx",
];
for (const file of precardSites) {
  const src = readFileSync(resolve(file), "utf8");
  assert.ok(src.includes("<PrecardCapCard"), `${file} still renders PrecardCapCard`);
}
const panelSrc = readFileSync(resolve("src/components/advisory-pack-panel.tsx"), "utf8");
assert.equal(
  panelSrc.split("<PrecardCapCard").length - 1,
  2,
  "the pack fixture and the live pack both keep PrecardCapCard",
);
assert.ok(panelSrc.includes("headerOwnsSignOff"), "the panel hides its own sign-off when the strip owns it");
assert.ok(panelSrc.includes("packDisplayedSignoffLine"), "the lifted line still uses the pack sign-off helper");
assert.ok(panelSrc.includes('id="advisory-pack-export-pdf"'), "export stays on the pack");
assert.ok(panelSrc.includes("data-signoff-line"), "the sentence is the sign-off line");
assert.equal(panelSrc.includes("packStatusLabel"), false, "the pack surface retires the old status labels");
assert.equal(panelSrc.includes("Ready for you"), false, "the pack surface does not say Ready for you");
assert.equal(panelSrc.includes("Ready for your review"), false, "the sentence uses Ready for review");

const tabSrc = readFileSync(resolve("src/components/advisory-tab-signoff.tsx"), "utf8");
assert.equal(tabSrc.split("data-approve").length - 1, 1, "the tab component has one Sign off control");
assert.ok(tabSrc.includes("hideLine"), "the strip does not repeat the tab line");

const card = renderToStaticMarkup(createElement(PrecardCapCard));
assert.ok(card.includes("precard-cap-card"), "PrecardCapCard still renders");
assert.ok(card.includes(PRECARD_CAP_MESSAGE), "the card still shows its own message");

const copySrc = readFileSync(resolve("src/lib/plan-pack-copy.ts"), "utf8");
assert.ok(copySrc.includes("signoffStatusLine"), "pack status is the shared line");
assert.equal(copySrc.includes("advisory-signoff"), false, "the copy helper stays out of the Bot sign-off module");

console.log("answer-strip-plan-pack-test: ok");
