/**
 * Review sign-off: gold CTA, per-tab scopes, handwritten signature.
 * Run: pnpm test:review-signoff
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  REVIEW_SCOPES,
  indexReviewSignoffs,
  initialsFromName,
  type ClientReviewSignoff,
  type ReviewScope,
} from "../src/lib/review-signoffs.functions";
import { stampFromSignoff } from "../src/lib/review-signoff-stamp";
import { computeIsStale, SIGNOFF_GOLD_BTN, SCOPE_SHORT_LABEL } from "../src/components/review-signoff";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(REVIEW_SCOPES.includes("financials"), "financials scope");
assert(REVIEW_SCOPES.includes("profitability"), "profit tab has its own scope");
assert(REVIEW_SCOPES.includes("action_plan"), "action plan has its own scope");
assert(REVIEW_SCOPES.includes("advisory"), "advisory has its own scope");
assert(new Set(REVIEW_SCOPES).size === REVIEW_SCOPES.length, "scopes are unique");
assert(SCOPE_SHORT_LABEL.profitability === "profitability", "profit label");

const rows: ClientReviewSignoff[] = [
  {
    id: "1",
    client_id: "c",
    scope: "financials",
    signed_off_by_id: "u",
    signed_off_by_name: "Ada Lovelace",
    signed_off_by_initials: "AL",
    signed_off_by_title: null,
    firm_name: "Babbage & Co",
    note: null,
    signature_data: "data:image/png;base64,AAA",
    signed_off_at: "2026-08-01T10:00:00.000Z",
  },
  {
    id: "2",
    client_id: "c",
    scope: "profitability",
    signed_off_by_id: "u",
    signed_off_by_name: "Ada Lovelace",
    signed_off_by_initials: "AL",
    signed_off_by_title: null,
    firm_name: "Babbage & Co",
    note: null,
    signature_data: null,
    signed_off_at: "2026-08-02T10:00:00.000Z",
  },
];
const indexed = indexReviewSignoffs(rows);
assert(indexed.financials?.id === "1", "index financials");
assert(indexed.profitability?.id === "2", "index profitability");
assert(indexed.cash_forecast == null, "unsigned scope stays empty");
assert(indexed.financials?.signature_data !== indexed.profitability?.signature_data, "signature is per deliverable");

const healthStamp = stampFromSignoff(indexed.financials, false);
assert(healthStamp?.signatureData === "data:image/png;base64,AAA", "stamp copies signature");
assert(stampFromSignoff(indexed.financials, true) === null, "stale sign-off is not stamped");
assert(stampFromSignoff(indexed.profitability, false)?.signatureData == null, "profit stamp has no health signature");

assert(computeIsStale(indexed.financials!, "2026-07-01T00:00:00.000Z") === false, "older data is not stale");
assert(computeIsStale(indexed.financials!, "2026-08-03T00:00:00.000Z") === true, "newer data is stale");
assert(initialsFromName("Ada Lovelace") === "AL", "initials");

assert(SIGNOFF_GOLD_BTN.includes("#d4af37") || SIGNOFF_GOLD_BTN.includes("#ac8400"), "sign-off CTA is gold");

const appSrc = readFileSync(resolve("src/routes/app.tsx"), "utf8");
assert(!/header[\s\S]{0,1200}ReviewSignoffBadge/.test(appSrc), "client header does not show a global sign-off");
assert(!/header[\s\S]{0,1200}OwnerTabSignoffRow/.test(appSrc), "client header does not host the per-tab stamp");
assert(!/mt-6[\s\S]{0,180}ReviewSignoffBadge/.test(appSrc), "owner stamps are not parked at the bottom of tabs");
assert(appSrc.includes('placement="corner"'), "health orb card hosts the corner signature");
assert(appSrc.includes("OwnerTabSignoffRow"), "other owner tabs pin the signature top-right");
assert(appSrc.includes('scope="profitability"'), "client profit tab uses profitability scope");
assert(appSrc.includes('scope="action_plan"'), "client action plan tab has its own sign-off");
assert(appSrc.includes('scope="financials"'), "client health tab keeps financials sign-off");
assert(appSrc.includes('scope="cash_forecast"'), "client cash tab has its own sign-off");
assert(appSrc.includes('scope="budget"'), "client budget tab has its own sign-off");

const clientSrc = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(clientSrc.includes('scope="profitability"'), "accountant profit tab has its own sign-off");
assert(clientSrc.includes('scope="action_plan"'), "accountant action plan tab has its own sign-off");
assert(clientSrc.includes('scope="advisory"'), "accountant advisory tab has its own sign-off");
assert(!clientSrc.includes("Report sign-offs"), "reports tab no longer hosts every sign-off");

const fnSrc = readFileSync(resolve("src/lib/review-signoffs.functions.ts"), "utf8");
assert(fnSrc.includes("signature_data"), "sign-off persists a drawn signature");
assert(fnSrc.includes("profitability"), "server accepts profitability scope");

const mig = readFileSync(resolve("supabase/migrations/20260831120000_review_signoff_signature_scopes.sql"), "utf8");
assert(mig.includes("signature_data"), "migration adds signature column");
assert(mig.includes("action_plan"), "migration allows action_plan scope");

const uiSrc = readFileSync(resolve("src/components/review-signoff.tsx"), "utf8");
assert(uiSrc.includes("Your signature"), "accountant can draw a signature");
assert(uiSrc.includes("data-signoff-certificate"), "proof uses the gold certificate");
assert(uiSrc.includes("data-signoff-corner"), "owner board uses the corner signature stamp");
assert(uiSrc.includes('placement="corner"'), "tab headers request the corner placement");
assert(uiSrc.includes("this deliverable only"), "copy says stamp is per deliverable");

void (null as unknown as ReviewScope);
console.log("review-signoff-test: ok");
