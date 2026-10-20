/**
 * SAMPLE company tax. No database and no model.
 * Run: pnpm test:tax-specialist-sample
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  taxSampleCardVisible,
  taxSampleEnabled,
  taxSampleFiguresVisible,
} from "../src/lib/tax-specialist/enabled.ts";
import {
  COMPANY_TAX_NUMERATOR,
  companyTaxDeadlines,
  computeCompanyTax,
  deadlineStanding,
  formatSampleCents,
  sampleCompanyTax,
  yearOfAssessmentStart,
  SAMPLE_COMPANY,
} from "../src/lib/tax-specialist/sample-compute.ts";

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

assert(COMPANY_TAX_NUMERATOR === 27, "the company rate is 27%");
assert(taxSampleEnabled("ZA") === true, "ZA shows the sample");
assert(taxSampleEnabled("US") === false, "US hides the sample");
assert(taxSampleEnabled(null) === false, "a missing market hides the sample");
assert(taxSampleEnabled("za") === false, "only the resolved ZA code turns it on");
assert(taxSampleCardVisible("ZA", true) === true, "a demo client shows the home card");
assert(taxSampleCardVisible("ZA", false) === true, "a real ZA client shows the home card");
assert(taxSampleCardVisible("US", true) === false, "a US demo still hides the home card");
assert(taxSampleCardVisible("US", false) === false, "a US client hides the home card");
assert(taxSampleCardVisible(null, true) === false, "a missing market hides the home card");
assert(taxSampleFiguresVisible("ZA", true) === true, "a demo client can show sample figures");
assert(taxSampleFiguresVisible("ZA", false) === false, "a real ZA client hides sample figures");
assert(taxSampleFiguresVisible("US", true) === false, "a US demo hides sample figures");
assert(taxSampleFiguresVisible(null, false) === false, "a missing market hides sample figures");

const sample = sampleCompanyTax();
assert(sample.taxableIncomeCents === 182_850_000, "sample taxable income is R 1 828 500.00");
assert(sample.taxCents === 49_369_500, "27% of that income is R 493 695.00");
assert(sample.estimateTaxCents === 45_900_000, "the provisional estimate taxes at 27%");
assert(
  sample.period1Cents === 22_950_000 && sample.period2Cents === 22_950_000,
  "IRP6 splits the estimate in half",
);
assert(
  sample.period1Cents + sample.period2Cents === sample.estimateTaxCents,
  "the two periods add back to the estimate",
);
assert(sample.balanceCents === 3_469_500, "the sample balance is the tax less both provisionals");
assert(sample.topUpCents === sample.balanceCents, "the optional top-up is that balance");
assert(sample.donationAllowedCents === 1_500_000, "the sample donation is inside the 10% limit");
assert(sample.estimateClearsEightyPercent === true, "the estimate clears 80% of taxable income");
assert(sample.aboveBasicAmountHarbour === true, "the sample is above the basic-amount harbour");
assert(formatSampleCents(sample.taxCents) === "R 493 695.00", "amounts render as rands and cents");

const capped = computeCompanyTax({
  ...SAMPLE_COMPANY.input,
  donationCents: 50_000_000,
});
assert(capped.donationLimitCents === 18_435_000, "donations stop at 10%");
assert(capped.donationAllowedCents === 18_435_000, "the extra donation is not allowed");
assert(capped.taxableIncomeCents === 165_915_000, "taxable income uses only the allowed donation");

const loss = computeCompanyTax({
  ...SAMPLE_COMPANY.input,
  accountingProfitCents: -1_000,
  depreciationAddBackCents: 0,
  finesAddBackCents: 0,
  wearAndTearCents: 0,
  exemptDividendsCents: 0,
  donationCents: 500,
  provisionalEstimateCents: 0,
});
assert(loss.taxCents === 0, "a loss does not produce tax");
assert(loss.donationAllowedCents === 0, "a loss does not allow a donation deduction");
assert(loss.assessedLossCarriedCents === 1_000, "the loss carries forward");

let threw = false;
try {
  computeCompanyTax({ ...SAMPLE_COMPANY.input, donationCents: 1.5 });
} catch {
  threw = true;
}
assert(threw, "cents must be whole numbers");

assert(yearOfAssessmentStart("2026-02-28") === "2025-03-01", "a February year starts in March");
const feb = companyTaxDeadlines("2026-02-28");
assert(
  feb.map((row) => row.due).join(",") === "2025-08-31,2026-02-28,2026-09-30,2027-02-28",
  "February deadlines",
);
assert(feb[0]?.weekday === "Sun", "31 Aug 2025 is a Sunday");
assert(feb[2]?.form === "IRP6" && feb[3]?.form === "ITR14", "the tracker has IRP6 and ITR14");
assert(
  deadlineStanding("2027-02-28", SAMPLE_COMPANY.asOf) === "upcoming",
  "the return is still ahead of the sample date",
);
assert(
  deadlineStanding("2026-09-30", SAMPLE_COMPANY.asOf) === "passed",
  "the third top-up is before the sample date",
);
assert(
  deadlineStanding(SAMPLE_COMPANY.asOf, SAMPLE_COMPANY.asOf) === "due",
  "the sample date itself is due today",
);

const december = companyTaxDeadlines("2025-12-31");
assert(
  december.map((row) => row.due).join(",") === "2025-06-30,2025-12-31,2026-06-30,2026-12-31",
  "a December year uses six months",
);
const june = companyTaxDeadlines("2026-06-30");
assert(june[2]?.due === "2026-12-31", "a June year top-up is the end of December");
const leap = companyTaxDeadlines("2024-02-29");
assert(
  leap[2]?.due === "2024-09-30" && leap[3]?.due === "2025-02-28",
  "a leap-day year end clamps the return",
);

const forbidden =
  /South Africa|South African|ITR14|IRP6|Tax Specialist|\bSARS\b|ZAR|rand |R799|R299|50%/;
for (const path of [
  "src/lib/tax-specialist/enabled.ts",
  "src/components/tax-specialist/tax-specialist-slot.tsx",
]) {
  const text = readFileSync(path, "utf8");
  assert(!forbidden.test(text), `${path} stays out of the US-reachable copy`);
  assert(
    !text.includes('from "./za-tax-specialist-sample"'),
    `${path} does not static-import the sample`,
  );
}
assert(
  readFileSync("src/components/tax-specialist/tax-specialist-slot.tsx", "utf8").includes(
    'import("./za-tax-specialist-sample")',
  ),
  "the sample loads with a dynamic import",
);

const sampleSrc = [
  "src/lib/tax-specialist/sample-compute.ts",
  "src/components/tax-specialist/za-tax-specialist-sample.tsx",
  "src/components/tax-specialist/za-tax-specialist-sample.css",
]
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");
assert(sampleSrc.includes("SAMPLE"), "the workspace is labelled SAMPLE");
assert(sampleSrc.includes("ITR14") && sampleSrc.includes("IRP6"), "both worksheets are named");
assert(sampleSrc.includes("Hand to Tax Specialist"), "Financial Manager can hand the pack across");
assert(
  !sampleSrc.includes("South Africa") && !sampleSrc.includes("ZAR") && !/rand /.test(sampleSrc),
  "pricing needles stay out of the chunk",
);
assert(!sampleSrc.includes("50%"), "the 50% pricing needle stays out");
for (const banned of ["fetch(", "supabase", "ask-ai", "openai", "XMLHttpRequest"]) {
  assert(!sampleSrc.includes(banned), `the sample does not call ${banned}`);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (/\.(tsx|ts|jsx|js|mjs)$/.test(name)) out.push(path);
  }
  return out;
}

const staticImport = /from\s+["'][^"']*za-tax-specialist-sample["']/;
for (const path of walk("src")) {
  if (path.endsWith("za-tax-specialist-sample.tsx") || path.endsWith("tax-specialist-slot.tsx"))
    continue;
  assert(!staticImport.test(readFileSync(path, "utf8")), `${path} static-imports the sample`);
}

const owner = readFileSync("src/components/owner-door/owner-door.tsx", "utf8");
assert(
  owner.includes("marketCountry={marketCountry}") && owner.includes('audience="owner"'),
  "the owner door passes the stored country into the tax card",
);
assert(
  !owner.includes("marketCountry={market.country}"),
  "the owner door does not pass a coerced market country into the tax card",
);
const practice = readFileSync("src/components/practice-board.tsx", "utf8");
assert(
  practice.includes("marketCountry={parseMarketSelection(firmMarket)?.country ?? null}"),
  "practice home passes the stored firm country",
);
assert(
  !practice.includes("marketForFirm({ market: firmMarket }).country"),
  "practice home does not coerce a null firm market into the tax card",
);
assert(practice.includes('audience="accountant"'), "practice home renders the card");
const client = readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8");
assert(
  client.includes("marketCountry={clientMarket.country}"),
  "the client file uses that client's market",
);
assert(client.includes('audience="accountant"'), "the client file is the accountant side");
for (const path of [
  "src/components/owner-door/owner-home.tsx",
  "src/components/milon-team/milon-team-desk.tsx",
  "src/components/milon-team/agent-stage.tsx",
  "src/components/hand-to-menu.tsx",
]) {
  assert(readFileSync(path, "utf8").includes("TaxSpecialistSlot"), `${path} can show the sample`);
}
const menu = readFileSync("src/components/hand-to-menu.tsx", "utf8");
assert(menu.includes('variant="handoff"'), "Hand to can reach Tax Specialist");
assert(
  menu.includes('variant="host"'),
  "Hand to keeps a sample host mounted after the menu closes",
);
assert(menu.includes('audience="accountant"'), "accountant next moves use the accountant copy");
const homeSrc = readFileSync("src/components/owner-door/owner-home.tsx", "utf8");
assert(
  homeSrc.includes('variant="fm-handoff"'),
  "the home still names the Financial Manager hand-off",
);
assert(
  homeSrc.includes("taxCardOn ? null"),
  "the home hides the hand-off strip when the tax card is on",
);
assert(
  homeSrc.includes("Your agents are watching the books — ask them anything, any time."),
  "ZA home does not count three agents",
);
assert(
  homeSrc.includes("Three agents watching the books — ask them anything, any time."),
  "US home keeps the three-agent subtitle",
);
assert(homeSrc.includes("sampleClient={sampleClient}"), "the home card follows the demo flag");
assert(
  readFileSync("src/components/owner-door/owner-door.tsx", "utf8").includes(
    "sampleClient={sampleClient}",
  ),
  "the owner door passes the demo flag",
);
assert(
  readFileSync("src/routes/app.tsx", "utf8").includes(
    "sampleClient={Boolean(clientMeta?.is_demo)}",
  ),
  "the owner home uses clients.is_demo",
);
assert(
  readFileSync("src/routes/_authenticated/clients.$clientId.tsx", "utf8").includes(
    "sampleClient={Boolean(client.is_demo)}",
  ),
  "a real client file does not force the sample card",
);
assert(
  readFileSync("src/components/practice-board.tsx", "utf8").includes("sampleClient={false}"),
  "practice home is not a sample client",
);
const slotSrc = readFileSync("src/components/tax-specialist/tax-specialist-slot.tsx", "utf8");
assert(slotSrc.includes("taxSampleCardVisible"), "the home card has its own gate");
assert(slotSrc.includes('variant === "card"'), "the home card uses that gate");
assert(
  /if \(!enabled\) return;[\s\S]*import\("\.\/za-tax-specialist-sample"\)/.test(slotSrc),
  "a closed market returns before the sample import",
);
assert(slotSrc.includes("sampleClient={sampleClient}"), "the loaded card receives the demo flag");
assert(sampleSrc.includes("SAMPLE demo · Harbour & Co"), "the demo card names Harbour & Co");
assert(sampleSrc.includes("Open sample"), "the demo card opens the sample");
assert(sampleSrc.includes("money(result.taxCents)"), "the demo card can show the sample tax");
assert(sampleSrc.includes('data-tax-card="sample"'), "the demo card is marked as the sample");
assert(sampleSrc.includes('data-tax-card="preview"'), "a real client gets the preview card");
const previewStart = sampleSrc.indexOf("function PreviewHomeCard");
const previewEnd = sampleSrc.indexOf("function standingLabel");
assert(previewStart >= 0 && previewEnd > previewStart, "the preview card is its own function");
const preview = sampleSrc.slice(previewStart, previewEnd);
assert(
  preview.includes("Prepares ITR14 and IRP6 workings for your sign-off."),
  "the preview card says what she prepares",
);
assert(preview.includes(">Preview<"), "the preview card carries a Preview tag");
assert(preview.includes("Hand to Tax Specialist"), "the primary action is the hand-off");
assert(preview.includes("See a sample"), "a secondary link opens the sample");
assert(preview.includes('data-tax-preview-action="handoff"'), "the hand-off is the primary action");
assert(
  preview.includes('data-tax-preview-action="sample"'),
  "See a sample is the secondary action",
);
assert(!preview.includes("Harbour"), "the preview card has no sample company");
assert(!preview.includes("SAMPLE"), "the preview card has no SAMPLE badge");
assert(!preview.includes("money("), "the preview card has no sample figures");
assert(
  !preview.includes("Xero") && !preview.includes("QuickBooks") && !preview.includes("Sage"),
  "the preview card does not name a ledger",
);
assert(!/\bSARS\b/.test(preview), "the preview card does not name SARS");
assert(!/submit|filed|files/i.test(preview), "the preview card does not imply a filing");
assert(sampleSrc.includes('agent="tax_specialist"'), "the sample uses the shared tax face");
assert(sampleSrc.includes("fmAvatarClip"), "the sample uses the shared clip mapping");
assert(sampleSrc.includes('variant="character"'), "the sample uses the character avatar");
assert(sampleSrc.includes('place="card"'), "the home card shows the face");
assert(sampleSrc.includes('place="desk"'), "the team card shows the face");
assert(sampleSrc.includes('place="menu"'), "Hand to shows the face");
assert(sampleSrc.includes('place="stage"'), "the team stage shows the face");
assert(
  !readFileSync("src/lib/fm-avatar-state.ts", "utf8").includes("Tax Specialist"),
  "the shared avatar map does not name Tax Specialist",
);

console.log("tax-specialist-sample ok");
