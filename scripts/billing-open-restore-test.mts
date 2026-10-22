/**
 * Stored-plan open still shows the trial banners and sends Add client
 * straight to the wall. On main the stored answer is an idle allowance,
 * so these checks fail there.
 *
 * Run: pnpm test:billing-open-restore
 */
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { FirmStarterTrialBanner } from "../src/components/firm-starter-trial-banner";
import { firmAddClientDestination, showStarterTrialEndedCopy } from "../src/lib/firm-client-cap";
import { entitlementFromStoredPlan } from "../src/lib/firm-billing-open.server";
import { CARD_FREE_TRIAL_LINE, STARTER_TRIAL_ENDED_MESSAGE } from "../src/lib/starter-trial-constants";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const DAY = 86_400_000;
const now = new Date();
const cardFreeFacts = {
  starterTrialEnforced: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  trialClockStartOverride: new Date(now.getTime() - 2 * DAY).toISOString(),
  clientCount: 0,
};
const endedFacts = {
  ...cardFreeFacts,
  trialClockStartOverride: new Date(now.getTime() - 20 * DAY).toISOString(),
  clientCount: 2,
};
const wallFacts = {
  ...cardFreeFacts,
  clientCount: 1,
};

const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS  ${name}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    failures.push(`${name}: ${message}`);
    console.log(`FAIL  ${name}: ${message}`);
  }
}

check("a card-free enforced firm sees the trial banner", () => {
  const open = entitlementFromStoredPlan("none", cardFreeFacts);
  const trial = open.allowance?.starterTrial;
  assert(trial?.cardFree === true && trial.expired === false, `card-free clock, saw ${JSON.stringify(trial)}`);
  const html = renderToStaticMarkup(
    createElement(FirmStarterTrialBanner, {
      trial: trial!,
      upgrade: open.allowance?.upgrade,
      firmId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1",
    }),
  );
  assert(html.includes(CARD_FREE_TRIAL_LINE), "the practice banner uses the card-free sentence");
  assert(html.includes("data-card-free-trial"), "the card-free banner is the trial banner");
});

check("an ended trial firm sees the ended banner", () => {
  const open = entitlementFromStoredPlan("none", endedFacts);
  const trial = open.allowance?.starterTrial;
  const phase = open.allowance?.upgrade?.phase;
  assert(trial?.expired === true, `ended clock, saw ${JSON.stringify(trial)}`);
  assert(
    showStarterTrialEndedCopy(phase, trial?.expired),
    "the practice home uses the ended-trial banner",
  );
  const board = readFileSync(new URL("../src/components/practice-board.tsx", import.meta.url), "utf8");
  assert(board.includes("dash-trial-banner"), "the ended trial stays the thin practice banner");
  assert(board.includes("STARTER_TRIAL_ENDED_MESSAGE"), "the ended banner keeps its sentence");
  assert(STARTER_TRIAL_ENDED_MESSAGE === "Your trial has ended, choose a plan", "ended copy is unchanged");
});

check("enforced plan none with clients goes straight to the wall", () => {
  const open = entitlementFromStoredPlan("none", wallFacts);
  assert(open.allowance?.allowed === false, "the second client is not allowed from the stored plan");
  assert(open.allowance?.code === "billing_required", `option A code, saw ${open.allowance?.code}`);
  assert(
    open.allowance ? firmAddClientDestination(open.allowance) === "/billing/required" : false,
    "Add client leaves for /billing/required before the dialog",
  );
  const first = entitlementFromStoredPlan("none", cardFreeFacts);
  assert(first.allowance?.allowed === true, "the first client stays open");
  assert(
    first.allowance ? firmAddClientDestination(first.allowance) === null : false,
    "the first client does not go to the wall",
  );
  const board = readFileSync(new URL("../src/components/practice-board.tsx", import.meta.url), "utf8");
  const clickStart = board.indexOf('id="wizard-add-client"');
  const click = board.slice(clickStart, board.indexOf("Add client", clickStart));
  assert(click.includes("firmAddClientDestination"), "Add client checks the stored destination first");
  assert(click.includes('"/billing/required"') || click.includes("openBillingRequired"), "the click opens the wall");
  assert(board.includes("getFirmClientCreateAllowance"), "the dialog still runs the live allowance backstop");
});

if (failures.length) {
  console.log(`\n${failures.length} failed`);
  for (const failure of failures) console.log(`  ${failure}`);
  process.exit(1);
}

console.log("billing open restore ok");
