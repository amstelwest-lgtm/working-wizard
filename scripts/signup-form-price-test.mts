/**
 * Accountant signup prices follow the country select.
 * South Africa is rand. Every other country is dollars. The old card line is gone.
 * Run: pnpm test:signup-form-price
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import {
  firmSignupOwnerPayLine,
  firmSignupStarterMonthly,
  firmSignupTrialReminder,
} from "../src/lib/firm-signup-copy";
import { OWNER_MONTHLY_USD_LABEL } from "../src/lib/owner-plan";
import { approvedFirmMonthlyRands, approvedPrice } from "../src/lib/pricing/price-table.server";
import { signupQuotePack } from "../src/lib/pricing/price-quote.server";
import { FIRM_TRIAL_CARD_NOTE, FIRM_TRIAL_SENTENCE, firmUsdListPrice } from "../src/lib/stripe-plans";
import type { DraftMarket } from "../src/lib/market/types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const TRIAL =
  "Your first client is free to explore. Add a card to start your 14-day free trial · up to 5 clients.";
const OLD_LINE = FIRM_TRIAL_CARD_NOTE;

const starterUsd = firmUsdListPrice("starter", "month");
const zaPack = signupQuotePack("ZA");
const usPack = signupQuotePack("US");
assert(starterUsd === "$39", "Starter's dollar catalog price is $39");
assert(approvedFirmMonthlyRands("starter") === 299, "Starter's rand catalog price is 299");
assert(approvedPrice("owner", "month", "ZAR")?.unitAmount === 29_900, "the owner rand catalog price is 299 rand");
assert(OWNER_MONTHLY_USD_LABEL === "$39/mo", "the owner dollar catalog price is $39/mo");

assert(zaPack.starterMonthly === "R299/mo", "South Africa shows Starter R299/mo");
assert(firmSignupStarterMonthly("ZA", zaPack.starterMonthly) === "R299/mo", "a ZA quote stays tight");
assert(firmSignupStarterMonthly("ZA") === "", "South Africa omits the amount until the quote arrives");
assert(firmSignupStarterMonthly("US") === "$39/mo", "the US shows Starter $39/mo");
assert(firmSignupStarterMonthly(null) === "$39/mo", "a missing country shows Starter $39/mo");
assert(firmSignupStarterMonthly("GB") === "$39/mo", "any other country shows Starter $39/mo");

assert(
  zaPack.ownerPayLine ===
    "Business owners pay R299/mo, or nothing when their accountant is on Milōn.",
  "South Africa says business owners pay R299/mo",
);
assert(
  firmSignupOwnerPayLine("ZA") ===
    "Business owners are on the Owner plan, or pay nothing when their accountant is on Milōn.",
  "a missing ZA quote does not say pay Owner plan",
);
assert(
  usPack.ownerPayLine ===
    "Business owners pay $39/mo, or nothing when their accountant is on Milōn.",
  "the US says business owners pay $39/mo",
);
assert(firmSignupOwnerPayLine("GB").includes("Business owners pay $39/mo"), "any other country stays on dollars");
assert(!zaPack.ownerPayLine.toLowerCase().includes("vat"), "the owner line has no VAT wording");
assert(!zaPack.starterMonthly.toLowerCase().includes("vat"), "the Starter line has no VAT wording");

const zaTrial = firmSignupTrialReminder("Starter", "ZA", zaPack.starterMonthly);
const usTrial = firmSignupTrialReminder("Starter", "US", usPack.starterMonthly);
assert(zaTrial === `${TRIAL} Then R299/mo.`, "ZA signup uses the approved rand trial line");
assert(usTrial === `${TRIAL} Then $39/mo.`, "US signup uses the approved dollar trial line");
assert(firmSignupTrialReminder("Solo", null) === usTrial, "a missing country uses the dollar trial line");
assert(!zaTrial.includes(OLD_LINE), "the ZA trial line drops the old card sentence");
assert(!usTrial.includes(OLD_LINE), "the US trial line drops the old card sentence");
assert(zaTrial.includes(FIRM_TRIAL_SENTENCE), "the trial line keeps the 14-day sentence");
assert(!zaTrial.toLowerCase().includes("vat"), "the trial line has no VAT wording");

const root = resolve(import.meta.dirname, "..");
const index = readFileSync(resolve(root, "src/routes/index.tsx"), "utf8");
const register = readFileSync(resolve(root, "src/components/landing/register-form.tsx"), "utf8");
const terms = readFileSync(resolve(root, "src/components/firm-signup-terms.tsx"), "utf8");
const auth = readFileSync(resolve(root, "src/routes/auth.tsx"), "utf8");
assert(index.includes("firmSignupOwnerPayLine(draftMarket.country)"), "the signup section follows the country select");
assert(!index.includes("saPricing?.ownerRegisterNote"), "the signup owner line is not the IP sentence");
assert(register.includes("country={draftMarket.country}"), "the landing form passes the country select");
assert(
  register.includes('firmSignupTrialReminder("Starter", draftMarket.country, starterMonthly)'),
  "the landing trial line follows the select",
);
assert(
  terms.includes("firmSignupTrialReminder(registerLabelForPlan(plan), country, starterMonthly)"),
  "auth and landing share the trial helper",
);
assert(auth.includes("country={draftMarket.country}"), "Create Firm passes the country select");
assert(!register.includes(OLD_LINE), "the register form no longer inlines the old card line");
assert(!terms.includes(OLD_LINE), "the signup terms no longer inline the old card line");

process.env.SUPABASE_URL ??= "https://example.supabase.co";
process.env.SUPABASE_PUBLISHABLE_KEY ??= "test-anon-key";
process.env.VITE_SUPABASE_URL ??= process.env.SUPABASE_URL;
process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??= process.env.SUPABASE_PUBLISHABLE_KEY;

const window = new Window({
  url: "http://127.0.0.1:5000/",
  width: 1280,
  height: 800,
  settings: {
    disableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true,
  },
});
for (const key of [
  "window",
  "document",
  "navigator",
  "HTMLElement",
  "HTMLInputElement",
  "HTMLSelectElement",
  "HTMLButtonElement",
  "HTMLLabelElement",
  "HTMLFormElement",
  "Element",
  "Node",
  "Document",
  "Event",
  "InputEvent",
  "KeyboardEvent",
  "MouseEvent",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "MutationObserver",
  "sessionStorage",
  "localStorage",
] as const) {
  Object.defineProperty(globalThis, key, {
    configurable: true,
    writable: true,
    value: window[key],
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

const { createElement, useState } = await import("react");
const { act } = await import("react");
const { createRoot } = await import("react-dom/client");
const { LandingRegisterForm } = await import("../src/components/landing/register-form");

type FormEventLike = { preventDefault: () => void };

function SignupSection({ initial }: { initial: "ZA" | "US" }) {
  const [draft, setDraft] = useState<DraftMarket>({
    country: initial,
    regionCode: initial === "US" ? "NY" : null,
  });
  const pack = signupQuotePack(draft.country);
  return createElement(
    "section",
    { id: "register" },
    createElement("p", { className: "sub" }, pack.ownerPayLine),
    createElement(LandingRegisterForm, {
      inviteClientId: null,
      inviteBusiness: null,
      inviteNeedsCode: false,
      inviteIsLegacyUuid: false,
      user: null,
      regClientCode: "",
      setRegClientCode: () => {},
      regBusy: false,
      regError: "",
      showRegisterError: () => {},
      regName: "",
      setRegName: () => {},
      regEmail: "",
      setRegEmail: () => {},
      regPassword: "",
      setRegPassword: () => {},
      regRole: "Accountant / Advisory firm",
      setRegRole: () => {},
      regPlan: "Starter",
      setRegPlan: () => {},
      regFirmName: "",
      setRegFirmName: () => {},
      regBusiness: "",
      setRegBusiness: () => {},
      draftMarket: draft,
      setDraftMarket: setDraft,
      firmInterval: "month",
      copyMarket: { copyPack: "us" as const },
      ownerNote: pack.ownerPayLine,
      starterMonthly: pack.starterMonthly,
      handleRegister: (event: FormEventLike) => event.preventDefault(),
      goToFirmSignup: () => {},
      goToOwnerSpark: () => {},
    }),
  );
}

async function mount(country: "ZA" | "US") {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(SignupSection, { initial: country }));
  });
  return async () => {
    await act(async () => {
      root.unmount();
    });
    host.remove();
  };
}

function text(): string {
  return document.getElementById("register")?.textContent ?? "";
}

async function pickCountry(country: "ZA" | "US") {
  const select = document.getElementById("milon-market-country");
  assert(select instanceof HTMLSelectElement, "the signup form has a country select");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
    setter?.call(select, country);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

const unmountZa = await mount("ZA");
const zaText = text();
assert(zaText.includes("Then R299/mo."), "the form renders R299 with South Africa selected");
assert(zaText.includes("Business owners pay R299/mo"), "South Africa says business owners pay R299/mo");
assert(!zaText.includes("$39"), "South Africa does not show the dollar price");
assert(!zaText.includes(OLD_LINE), "the old card line is gone when South Africa is selected");
assert(!/vat/i.test(zaText), "the South Africa form has no VAT wording");
await unmountZa();

const unmountUs = await mount("US");
const usText = text();
assert(usText.includes("Then $39/mo."), "the form renders $39 with the US selected");
assert(usText.includes("Business owners pay $39/mo"), "the US says business owners pay $39/mo");
assert(!usText.includes("R299") && !usText.includes("R 299"), "the US form has no rand price");
assert(!usText.includes(OLD_LINE), "the old card line is gone when the US is selected");

await pickCountry("ZA");
const switched = text();
assert(switched.includes("Then R299/mo."), "picking South Africa switches the trial line to rand");
assert(switched.includes("Business owners pay R299/mo"), "picking South Africa switches the owner line to rand");
assert(!switched.includes("$39"), "picking South Africa removes the dollar price");
assert(!switched.includes(OLD_LINE), "picking South Africa does not bring back the old card line");

await pickCountry("US");
const back = text();
assert(back.includes("Then $39/mo."), "picking the US switches the trial line back to dollars");
assert(back.includes("Business owners pay $39/mo"), "picking the US switches the owner line back to dollars");
assert(!back.includes("R299") && !back.includes("R 299"), "picking the US removes the rand price");
await unmountUs();

console.log("signup-form-price: ok");
