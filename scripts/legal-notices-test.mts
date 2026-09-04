/**
 * Public privacy, terms, and AI notices.
 * Run: pnpm test:legal-notices
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  LEGAL_ADDRESS,
  LEGAL_EFFECTIVE,
  LEGAL_ENTITY,
  LEGAL_INFORMATION_OFFICER,
} from "../src/lib/legal";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const privacy = readFileSync(resolve("src/routes/privacy.tsx"), "utf8");
const terms = readFileSync(resolve("src/routes/terms.tsx"), "utf8");
const ai = readFileSync(resolve("src/routes/ai.tsx"), "utf8");
const faq = readFileSync(resolve("src/routes/faq.tsx"), "utf8");
const landing = readFileSync(resolve("src/routes/index.tsx"), "utf8");
const shell = readFileSync(resolve("src/components/marketing-shell.tsx"), "utf8");
const settings = readFileSync(resolve("src/routes/_authenticated/settings.index.tsx"), "utf8");
const auth = readFileSync(resolve("src/routes/auth.tsx"), "utf8");
const tree = readFileSync(resolve("src/routeTree.gen.ts"), "utf8");

assert(privacy.includes("{LEGAL_ENTITY}"), "privacy names the company");
assert(privacy.includes("{LEGAL_EFFECTIVE}"), "privacy has an effective date");
assert(privacy.includes("{LEGAL_INFORMATION_OFFICER}"), "privacy names the Information Officer");
assert(privacy.includes("{LEGAL_ADDRESS_LINES"), "privacy shows the registered address");
assert(LEGAL_ENTITY === "Eish2oh (Pty) Ltd", "legal entity is Eish2oh (Pty) Ltd");
assert(LEGAL_INFORMATION_OFFICER === "Theo", "Information Officer is Theo");
assert(LEGAL_ADDRESS.includes("152 Melville Street"), "address is Melville Street");
assert(LEGAL_ADDRESS.includes("Sunnyside"), "address is Sunnyside Pretoria");
assert(!LEGAL_ENTITY.includes("MILŌN"), "product name is not the registered company");
assert(/\d{4}/.test(LEGAL_EFFECTIVE), "effective date has a year");
assert(privacy.includes("powered by"), "privacy says AI is used");
assert(privacy.includes("Claude"), "privacy names Claude");
assert(privacy.includes("anonymised"), "privacy says financials are anonymised");
assert(privacy.includes("Protection of Personal Information"), "privacy mentions POPIA");
assert(privacy.includes("privacy contact"), "US privacy names a privacy contact");
assert(privacy.includes("California resident"), "US privacy mentions California requests");
assert(privacy.includes("not in borrowed American boilerplate"), "ZA privacy keeps its voice");
assert(privacy.includes("mk-copy-us"), "privacy has a US pack");

assert(terms.includes("not a substitute"), "terms: not a substitute");
assert(terms.includes("Claude"), "terms name Claude");
assert(terms.includes("anonymised"), "terms repeat anonymisation");
assert(terms.includes("South Africa"), "terms sit under SA law");
assert(
  terms.includes("not tax, legal, or investment advice"),
  "US terms: not tax/legal/investment advice",
);
assert(terms.includes("IRS"), "US terms mention IRS");
assert(terms.includes("choice of law"), "US terms do not invent a US venue");

assert(ai.includes("Claude"), "AI notice names Claude");
assert(ai.includes("Anthropic"), "AI notice names the supplier");
assert(!ai.includes("mk-gold"), "AI notice does not gold-highlight Claude");
assert(ai.includes('heroTone="plain"'), "AI notice uses the quiet hero");
assert(ai.includes("No company names"), "AI notice: no company names");
assert(ai.includes("No raw amounts"), "AI notice: no raw amounts");
assert(ai.includes("anonymised"), "AI notice: anonymised");
assert(ai.includes("VAT"), "AI notice: VAT stripped");
assert(ai.includes("EIN"), "AI notice: EIN stripped on US pack");

assert(faq.includes('href="/ai"'), "FAQ links to the AI notice");
assert(faq.includes("powered by Claude"), "FAQ names Claude");
assert(faq.includes("dollar sign glued on"), "FAQ has US invert of the SA-built line");
assert(faq.includes("LIST_PRICES"), "FAQ prices come from the marketing pack");

assert(landing.includes('href="/privacy"'), "landing footer links to privacy");
assert(landing.includes('href="/terms"'), "landing footer links to terms");
assert(landing.includes('href="/ai"'), "landing footer links to AI notice");
assert(!landing.includes('href="/faq">Privacy'), "landing no longer labels FAQ as Privacy");
assert(landing.includes("Eish2oh (Pty) Ltd"), "landing copyright uses the registered company");
assert(landing.includes("LIST_PRICES"), "landing prices come from the marketing pack");
assert(landing.includes("MarketCopy"), "landing dual-copy for US visitors");
const draftDecl = landing.indexOf("const [draftMarket, setDraftMarket]");
const draftDeps = landing.indexOf("}, [draftMarket");
assert(draftDecl !== -1 && draftDeps !== -1, "landing has draftMarket state + persist effect");
assert(
  draftDecl < draftDeps,
  "landing declares draftMarket before persist effect deps (avoids TDZ crash)",
);
assert(landing.includes("if (!mounted) return;"), "landing persist waits for mount");
assert(landing.includes('id="landing-sky"'), "landing has a scrolling starfield band");
assert(landing.includes("landing-sky-photo"), "landing starfield has a photo layer");
const landingCss = readFileSync(resolve("src/styles/landing.css"), "utf8");
assert(landingCss.includes("/landing-sky.jpg"), "landing CSS points at the starfield asset");
assert(landingCss.includes("#landing-sky"), "landing CSS scopes the starfield band");

assert(shell.includes('href="/privacy"'), "collateral footer links to privacy");
assert(shell.includes('href="/terms"'), "collateral footer links to terms");
assert(shell.includes('href="/ai"'), "collateral footer links to AI notice");

assert(settings.includes('href="/privacy"'), "settings links to privacy");
assert(settings.includes("anonymised"), "settings restates anonymisation");
assert(auth.includes('href="/terms"'), "firm signup links to terms");
assert(auth.includes("anonymised"), "firm signup restates anonymisation");

assert(tree.includes("path: '/privacy'"), "router registers /privacy");
assert(tree.includes("path: '/terms'"), "router registers /terms");
assert(tree.includes("path: '/ai'"), "router registers /ai");

console.log("legal-notices-test: ok");
