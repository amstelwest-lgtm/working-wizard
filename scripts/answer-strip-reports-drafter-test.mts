/**
 * Reports strip and the Advisory drafter section.
 * Run: pnpm test:answer-strip-reports-drafter
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { drafterSectionForHash } from "../src/lib/client-route-search";
import { botSignoffCtas, botSignoffDestination } from "../src/lib/bot-signoff-path";
import {
  DRAFTER_EMPTY_SENTENCE,
  DRAFTER_HISTORY_SENTENCE,
  SENT_HISTORY_INTRO,
  drafterAnswerSentence,
  plainSentDate,
  reportStripNames,
  reportsAnswerSentence,
  reportsPrimaryLabel,
} from "../src/lib/reports-drafter-copy";

assert.equal(
  reportsAnswerSentence({ readyNames: [], periodLabel: "September" }),
  "No reports yet. Pick one to build from this client's figures.",
);
const catalogue = ["Financial Health Scorecard", "Priority Intervention Plan"];
assert.deepEqual(
  reportStripNames({ loadedNames: null, figuresOnFile: true, catalogueNames: catalogue }),
  catalogue,
  "figures already on file use the catalogue while a report page is still loading",
);
assert.deepEqual(
  reportStripNames({ loadedNames: [], figuresOnFile: true, catalogueNames: catalogue }),
  [],
  "a loaded empty catalogue stays empty",
);
assert.deepEqual(
  reportStripNames({ loadedNames: null, figuresOnFile: false, catalogueNames: catalogue }),
  [],
  "no figures and no load stays empty",
);
assert.equal(
  reportsAnswerSentence({
    readyNames: ["Financial Health Scorecard", "Priority Intervention Plan", "13-Week Cash Flow Forecast"],
    periodLabel: "September",
  }),
  "3 reports ready for September. Start with: Financial Health Scorecard.",
);
assert.equal(reportsPrimaryLabel(0), "Create report");
assert.equal(reportsPrimaryLabel(3), "Open report");
assert.equal(drafterAnswerSentence({}), DRAFTER_EMPTY_SENTENCE);
assert.equal(
  DRAFTER_HISTORY_SENTENCE,
  "Everything you copy, email or share is saved to Sent history.",
);
assert.equal(
  SENT_HISTORY_INTRO,
  "Every email, WhatsApp share and PDF you've sent from here, with the figures it used. A share means you opened it to send; we can't confirm the client received it.",
);
assert.equal(
  drafterAnswerSentence({
    last: { kind: "advisory_draft", recipient: "Harbour Glass", dateLabel: "2 Oct 2026" },
  }),
  "Last sent: Client email to Harbour Glass · 2 Oct 2026.",
);
assert.equal(plainSentDate("02 Oct 2026"), "2 Oct 2026");
assert.equal(plainSentDate("2 Oct 2026"), "2 Oct 2026");
assert.equal(drafterSectionForHash("pack", "#drafter"), "drafts");
assert.equal(drafterSectionForHash("pack", "#sent-history"), "sent");
assert.equal(drafterSectionForHash("drafter", "#sent"), "sent");

const packCta = botSignoffCtas({
  created: { packId: "p1" },
  tools: [{ name: "draft_deliverable", status: "ok" }],
})[0];
assert.ok(packCta, "a saved pack still has a sign-off CTA");
assert.deepEqual(
  { tab: botSignoffDestination(packCta).tab, section: botSignoffDestination(packCta).section },
  { tab: "reports", section: "drafts" },
  "the bot pack link opens Reports drafts",
);

const clientSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
const reportsAt = clientSrc.indexOf('id="pane-reports"');
const draftsAt = clientSrc.indexOf('id="reports-drafts"');
const pdfsAt = clientSrc.indexOf('id="reports-pdfs"');
const sentAt = clientSrc.indexOf('id="reports-sent"');
const planAt = clientSrc.indexOf('id="pane-plan"');
assert.ok(reportsAt > 0 && draftsAt > reportsAt && pdfsAt > draftsAt && sentAt > pdfsAt && planAt > sentAt);
const reportsPane = clientSrc.slice(reportsAt, planAt);
const draftsPane = clientSrc.slice(draftsAt, pdfsAt);
const sentPane = clientSrc.slice(sentAt, planAt);

assert.ok(reportsPane.includes("ReportsStudioPanel"), "the reports tab still mounts the studio");
assert.ok(
  reportsPane.includes("sourceChip={healthChip}") &&
    clientSrc.includes("const healthChip = figureSourceChipLabel(figureSource)"),
  "the reports strip uses the figure chip",
);
assert.equal(reportsPane.includes("DeliverableAnswerStrip"), false, "reports has no sign-off strip");
assert.equal(reportsPane.includes("Board-ready"), false, "the reports lede leaves the tab");
assert.ok(draftsPane.includes("AdvisoryPackPanel"), "the pack sits in Drafts");
assert.ok(draftsPane.includes("RecommendationsPanel"), "recommendations sit in Drafts");
assert.ok(draftsPane.includes("OutcomesPanel"), "outcomes sit in Drafts");
assert.ok(draftsPane.includes("AdvisoryDrafter"), "the drafter sits in Drafts");
assert.equal(draftsPane.includes("AdvisorySentHistory"), false, "sent history leaves Drafts");
assert.equal((sentPane.match(/AdvisorySentHistory/g) ?? []).length, 1, "sent history is rendered once");

const studio = readFileSync(resolve("src/routes/_authenticated/reports-studio.tsx"), "utf8");
assert.ok(studio.includes("ArapAnswerStrip"), "the embedded reports tab uses the no-status strip");
assert.ok(studio.includes("data-reports-primary"), "one gold control opens a report");
assert.ok(studio.includes('aria-label="Export all reports"'), "export is the quiet icon");
assert.ok(studio.includes("ReviewInputsDrawer"), "settings stay in the drawer");
{
  const drawerStart = studio.indexOf("<ReviewInputsDrawer");
  const drawerEnd = studio.indexOf("</ReviewInputsDrawer>");
  const drawer = studio.slice(drawerStart, drawerEnd);
  assert.ok(drawerStart > 0 && drawerEnd > drawerStart, "the reports drawer is present");
  assert.equal(drawer.includes("{reportCatalogue}"), false, "templates stay in the page body");
  assert.equal(drawer.includes("<AdvisorySentHistory"), false, "the generated list stays in the page body");
  assert.ok(drawer.includes("<SettingsPanel"), "settings stay in the drawer");
  assert.ok(drawer.includes("pin={false}"), "embedded settings are not sticky");
  assert.equal(studio.includes("AdvisorySentHistory"), false, "sent history is not in the studio");
  assert.ok(studio.indexOf("{reportCatalogue}") < drawerStart, "templates render above the drawer");
}
assert.ok(studio.includes("downloadOutline"), "card downloads are not a second gold primary");
assert.ok(studio.includes("report-card__rule"), "the template cards stay");

const drafter = readFileSync(resolve("src/components/advisory-drafter.tsx"), "utf8");
assert.ok(drafter.includes("DRAFTER_HISTORY_SENTENCE"), "the helper is the plain history sentence");
assert.equal(drafter.includes("not postal proof"), false, "the postal-proof aside is gone");
assert.equal(drafter.includes("share opened"), false, "the share-opened aside is gone");
assert.ok(drafter.includes("<PrecardCapCard"), "the drafter still renders PrecardCapCard");
assert.ok(drafter.includes("data-draft"), "Draft stays the gold control");
assert.ok(drafter.includes("placeholder="), "the steer input stays");
assert.ok(drafter.includes("Last downloaded:"), "a PDF download is not a share");
assert.equal(drafter.includes("Last shared:"), false, "a download is not labelled Last shared");

const precardSites = [
  "src/components/advisory-pack-panel.tsx",
  "src/components/advisory-drafter.tsx",
  "src/components/client-brain-summary.tsx",
  "src/components/recommendations-panel.tsx",
];
for (const file of precardSites) {
  assert.ok(
    readFileSync(resolve(file), "utf8").includes("<PrecardCapCard"),
    `${file} still renders PrecardCapCard`,
  );
}

console.log("answer-strip-reports-drafter-test: ok");
