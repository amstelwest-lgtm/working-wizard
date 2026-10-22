/**
 * Owner /app?bot= chat. A trial-ended reply is a calm card, not the red line.
 * Run: pnpm test:owner-bot-trial-ended
 */
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { FirmBandUpgrade } from "../src/components/firm-band-upgrade.tsx";
import { OwnerChat } from "../src/components/owner-door/owner-chat.tsx";
import { OWNER_ACCOUNTANT_TRIAL_NOTE } from "../src/lib/owner-trial-ended.ts";
import { ownerPlanLine } from "../src/lib/owner-plan.ts";
import { OWNER_SUBSCRIBE_LABEL } from "../src/lib/owner-subscribe.ts";
import { loadSaPricingCopy } from "../src/lib/pricing/za-pricing-chunk.server.ts";
import { STARTER_TRIAL_ENDED_CODE, STARTER_TRIAL_ENDED_MESSAGE } from "../src/lib/starter-trial-constants.ts";
import { FIRM_BAND_CATALOG, firmClientLimitLabel } from "../src/lib/stripe-plans.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function textOf(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/** Visible title of the calm trial card. The accessible name is asserted separately. */
function cardTitle(html: string): string {
  const match = html.match(/class="owner-trial-ended-title">([^<]*)</);
  assert(match, "the trial card has a title");
  return textOf(match[1]);
}

function cardLabel(html: string): string {
  const at = html.indexOf('class="owner-trial-ended"');
  assert(at >= 0, "the trial card is mounted");
  const match = html.slice(at).match(/aria-label="([^"]*)"/);
  assert(match, "the trial card has an accessible name");
  return textOf(match[1]);
}

function cardNote(html: string): string {
  const match = html.match(/class="owner-trial-ended-note">([^<]*)</);
  assert(match, "the accountant card has a note");
  return textOf(match[1]);
}

const ACCOUNTANT_FIRM_TRIAL_TITLE = "Your accountant's plan needs renewing";
const OWNER_PLAN_TRIAL_TITLE = "Your trial has ended, choose a plan";
const ACCOUNTANT_FIRM_TRIAL_BODY =
  "Your accountant's Milōn plan needs to be renewed before the team can answer here. Ask your accountant to choose a plan.";

const market = { locale: "en-US", timezone: "America/New_York" };

function chat(error: string | null, extra?: { errorCode?: string | null; accountantFirm?: boolean; visitor?: "us" | "za" | null; zaMonthly?: string | null }) {
  const visitor = extra?.visitor === undefined ? "us" : extra.visitor;
  return renderToStaticMarkup(
    createElement(OwnerChat, {
      agent: "analyst",
      variant: "character",
      motion: "idle",
      sentence: "Health, margins, and what changed.",
      messages: [{ role: "owner", text: "What is this client's health score?" }],
      draft: "",
      listening: false,
      busy: false,
      error,
      errorCode: extra?.errorCode ?? null,
      plan: {
        accountantFirm: extra?.accountantFirm ?? false,
        visitor,
        zaMonthly: extra?.zaMonthly ?? null,
        firmName: extra?.accountantFirm ? "Northline" : null,
        billing: { kind: "subscribe" },
        onSubscribe: () => undefined,
      },
      market,
      onDraft: () => undefined,
      onSend: () => undefined,
      onListen: () => undefined,
      onBack: () => undefined,
    }) as ReactElement,
  );
}

const accountant = chat(STARTER_TRIAL_ENDED_MESSAGE, { accountantFirm: true });
assert(!accountant.includes("owner-error"), "owner trial-ended is still the red line");
assert(accountant.includes('data-owner-trial-ended="accountant"'), "an accountant's client gets the calm card");
assert(
  cardTitle(accountant) === ACCOUNTANT_FIRM_TRIAL_TITLE,
  `an accountant's client sees the renewing title (got ${JSON.stringify(cardTitle(accountant))})`,
);
assert(
  cardLabel(accountant) === ACCOUNTANT_FIRM_TRIAL_TITLE,
  `the accountant card's accessible name is the renewing title (got ${JSON.stringify(cardLabel(accountant))})`,
);
assert(cardTitle(accountant) !== OWNER_PLAN_TRIAL_TITLE, "the accountant card does not keep the choose-a-plan title");
assert(OWNER_ACCOUNTANT_TRIAL_NOTE === ACCOUNTANT_FIRM_TRIAL_BODY, "the accountant card body is unchanged");
assert(cardNote(accountant) === ACCOUNTANT_FIRM_TRIAL_BODY, "the card tells the owner to ask their accountant");
assert(!accountant.includes(">Retry<"), "the trial-ended card has no Retry");
assert(!accountant.includes("Subscribe"), "an accountant's client does not get the owner checkout button");
assert(!accountant.includes("$99"), "an owner does not see the Solo price");
assert(!accountant.includes("$149"), "an owner does not see the Small price");
assert(!/\$\d/.test(accountant), "an accountant's client sees no dollar price");
assert(!/R\s?\d/.test(accountant), "an accountant's client sees no rand price");

const coded = chat("Draft was not saved.", { accountantFirm: true, errorCode: STARTER_TRIAL_ENDED_CODE });
assert(!coded.includes("owner-error"), "a starter_trial_ended code is not the red line");
assert(cardTitle(coded) === ACCOUNTANT_FIRM_TRIAL_TITLE, "a coded trial end uses the renewing title");
assert(cardNote(coded) === ACCOUNTANT_FIRM_TRIAL_BODY, "the code still opens the accountant note");

const ownUs = chat(STARTER_TRIAL_ENDED_MESSAGE, { accountantFirm: false, visitor: "us" });
const usLine = ownerPlanLine({ visitor: "us", accountantOnMilon: false, firmName: null });
assert(STARTER_TRIAL_ENDED_MESSAGE === OWNER_PLAN_TRIAL_TITLE, "the owner-plan title sentence is unchanged");
assert(ownUs.includes('data-owner-trial-ended="owner"'), "an owner without an accountant gets the owner plan card");
assert(
  cardTitle(ownUs) === OWNER_PLAN_TRIAL_TITLE,
  `an owner without an accountant keeps the choose-a-plan title (got ${JSON.stringify(cardTitle(ownUs))})`,
);
assert(
  cardLabel(ownUs) === OWNER_PLAN_TRIAL_TITLE,
  `the owner plan card's accessible name stays the choose-a-plan title (got ${JSON.stringify(cardLabel(ownUs))})`,
);
assert(!ownUs.includes("owner-error"), "the owner plan card is not red");
assert(textOf(ownUs).includes(usLine), `the owner plan line is the catalog price (${usLine})`);
assert(ownUs.includes(OWNER_SUBSCRIBE_LABEL), "the owner plan card keeps the subscribe CTA");
assert(!ownUs.includes(OWNER_ACCOUNTANT_TRIAL_NOTE), "the owner plan card does not use the accountant note");
assert(!ownUs.includes(">Retry<"), "the owner plan card has no Retry");

const zaMonthly = loadSaPricingCopy().ownerMonthly;
const ownZa = chat(STARTER_TRIAL_ENDED_MESSAGE, { accountantFirm: false, visitor: "za", zaMonthly });
const zaLine = ownerPlanLine({ visitor: "za", accountantOnMilon: false, firmName: null, zaMonthly });
assert(textOf(ownZa).includes(zaLine), `a ZA owner sees the server rand label (${zaLine})`);
assert(cardTitle(ownZa) === OWNER_PLAN_TRIAL_TITLE, "a ZA owner without an accountant keeps the choose-a-plan title");
assert(!ownZa.includes("$39"), "a ZA owner plan card does not show the dollar price");

const generic = chat("Could not check the plan. Nothing was generated.");
assert(generic.includes("owner-error"), "a generic failure stays the error line");
assert(
  textOf(generic).includes("Could not check the plan. Nothing was generated."),
  "the generic message is shown",
);
assert(!generic.includes("owner-trial-ended"), "a generic failure is not the trial card");
assert(!generic.includes(">Retry<"), "this panel still has no Retry control on a generic failure");

const css = readFileSync(new URL("../src/components/owner-door/owner-door.css", import.meta.url), "utf8");
const trialCss = css.slice(css.indexOf(".owner-door .owner-trial-ended"));
assert(trialCss.startsWith(".owner-door .owner-trial-ended"), "the trial card has its own style");
const trialRule = trialCss.slice(0, trialCss.indexOf(".owner-door .owner-composer"));
assert(!trialRule.includes("--risk"), "the trial card does not use the red error color");
assert(css.includes(".owner-door .owner-error"), "generic failures still have the error style");

const bands = renderToStaticMarkup(
  createElement(FirmBandUpgrade, {
    currentBand: null,
    interval: "month",
    priceCurrency: "USD",
    canUpgrade: true,
    clientCount: 1,
    onUpgrade: () => undefined,
  }),
);

function capLine(html: string, bandId: "solo" | "small"): string {
  const at = html.indexOf(`value="${bandId}"`);
  assert(at >= 0, `${bandId} is on the plan card`);
  const slice = html.slice(at, html.indexOf("</label>", at));
  const found = slice.match(/Up to \d+ active clients|Unlimited active clients/);
  assert(found, `${bandId} has a cap line`);
  return found[0];
}

const soloCap = capLine(bands, "solo");
const smallCap = capLine(bands, "small");
assert(soloCap === firmClientLimitLabel("solo"), `Solo cap line follows the catalog (${soloCap})`);
assert(smallCap === firmClientLimitLabel("small"), `Small cap line follows the catalog (${smallCap})`);
assert(FIRM_BAND_CATALOG.solo.clientLimit !== FIRM_BAND_CATALOG.small.clientLimit, "Solo and Small catalog caps differ");
assert(soloCap !== smallCap, "Solo and Small do not share a cap line");
assert(bands.includes("$99/mo"), "Solo stays the catalog dollar price");
assert(bands.includes("$149/mo"), "Small stays the catalog dollar price");

console.log("owner-bot-trial-ended-test: ok");
