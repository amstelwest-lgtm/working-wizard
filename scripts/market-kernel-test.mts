/**
 * Market kernel: region + US state, formatters, sales-tax vs VAT cash.
 * Run: pnpm test:market
 */
import { fmtRand } from "../src/components/pdf/theme";
import {
  assertMarketSelection,
  bankDraftPrompt,
  coerceMarketSelection,
  currencySymbol,
  draftToSelection,
  financialExtractionPrompt,
  formatMoney,
  formatMoneyCompact,
  formatMoneyUnit,
  formatNumber,
  canShowIndustryMedian,
  industryBenchmarkCaption,
  LIST_PRICES,
  localizeCopy,
  localizePlaybookStep,
  salesPerEmployeeBenchmarkLabel,
  salesPerEmployeeHealthy,
  scoreSalesPerEmployee,
  MarketSelectionError,
  newsSearchUrl,
  parseMarketSelection,
  playbookStepFitsMarket,
  resolveMarket,
  t,
  US_STATES,
  visitorCopyPack,
  askAiSystemBase,
  ZA_MARKET,
  ZA_VAT_RATE,
} from "../src/lib/market";
import { scoreRatio } from "../src/lib/health-score";
import { computeBudgetMonths } from "../src/lib/budget.compute";
import { createBudgetDocument } from "../src/lib/budget.months";
import type { BudgetQualification } from "../src/lib/budget.types";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(US_STATES.length === 51, `expected 51 jurisdictions, got ${US_STATES.length}`);

assert(parseMarketSelection({ country: "ZA", regionCode: null })?.country === "ZA", "parse ZA");
assert(parseMarketSelection({ country: "US" }) == null, "US without state is incomplete");
assert(parseMarketSelection({ country: "US", regionCode: "TX" })?.regionCode === "TX", "parse TX");

try {
  assertMarketSelection({ country: "US", regionCode: null });
  throw new Error("US without state should throw");
} catch (e) {
  assert(e instanceof MarketSelectionError, "US missing state is MarketSelectionError");
}

try {
  assertMarketSelection({ country: "ZA", regionCode: "TX" });
  throw new Error("ZA with state should throw");
} catch (e) {
  assert(e instanceof MarketSelectionError, "ZA+state is MarketSelectionError");
}

assert(coerceMarketSelection(null).country === "ZA", "legacy null is ZA");
assert(draftToSelection({ country: "US", regionCode: null }) == null, "draft US incomplete");
assert(draftToSelection({ country: "US", regionCode: "CA" })?.regionCode === "CA", "draft CA");

const za = resolveMarket({ country: "ZA", regionCode: null });
assert(za.currency === "ZAR" && za.locale === "en-ZA", "ZA currency/locale");
assert(za.fyStartMonthDefault === 3, "ZA FY March");
assert(
  za.tax.regime === "vat" && za.tax.regime === "vat" && za.tax.vatRate === ZA_VAT_RATE,
  "ZA VAT 15%",
);
assert(za.timezone === "Africa/Johannesburg", "ZA tz");

const tx = resolveMarket({ country: "US", regionCode: "TX" });
assert(tx.currency === "USD" && tx.locale === "en-US", "TX currency/locale");
assert(tx.fyStartMonthDefault === 1, "US FY January");
assert(tx.tax.regime === "sales_tax", "TX sales tax");
if (tx.tax.regime !== "sales_tax") throw new Error("unreachable");
assert(Math.abs(tx.tax.stateRate - 0.0625) < 1e-9, `TX state ${tx.tax.stateRate}`);
assert(Math.abs(tx.tax.combinedRate - 0.082) < 1e-9, `TX combined ${tx.tax.combinedRate}`);
assert(tx.tax.collects === true, "TX collects by default");

const or = resolveMarket({ country: "US", regionCode: "OR" });
assert(or.tax.regime === "none", "Oregon has no sales tax");

const ak = resolveMarket({ country: "US", regionCode: "AK" });
assert(ak.tax.regime === "none", "Alaska defaults to no collect (local optional)");

const caNo = resolveMarket({ country: "US", regionCode: "CA" }, { collects: false });
assert(caNo.tax.regime === "none", "CA opt-out of collecting");

assert(formatMoney(1299, ZA_MARKET).includes("1"), "ZA money has digits");
assert(formatMoney(1299, ZA_MARKET).startsWith("R"), "ZA money uses R");
assert(formatMoney(1299, tx).startsWith("$"), "US money uses $");
assert(formatMoney(-40, tx) === "-$40", `US negative ${formatMoney(-40, tx)}`);

const q: BudgetQualification = {
  payModel: "products",
  subtype: "retail",
  driverKind: "units_price",
  costShape: "balanced",
  debtorDaysDefault: 0,
  capexMode: "none",
  confirmedAt: new Date().toISOString(),
};

const zaDoc = createBudgetDocument({ templateId: "retail_units", qualification: q, market: za });
assert(zaDoc.fyStartMonth === 3, "ZA budget FY");
assert(zaDoc.vatRate === 0.15, "ZA budget VAT");
zaDoc.revenueLines[0].months[zaDoc.fyStart] = { volume: 10, price: 100 };
zaDoc.gpPct = 40;
zaDoc.openingCash = 5000;
zaDoc.wc.debtorDays = 0;
zaDoc.wc.creditorDays = 0;
zaDoc.wc.inventoryDays = 0;
const zaRows = computeBudgetMonths(zaDoc, "base");
assert(zaRows[0].revenue === 1000, `ZA rev ${zaRows[0].revenue}`);
assert(Math.round(zaRows[0].cashIn) === 1150, `ZA cashIn still includes VAT ${zaRows[0].cashIn}`);
assert(
  Math.round(zaRows[0].vatNet) === Math.round(150 - 90),
  `ZA VAT net output-input ${zaRows[0].vatNet}`,
);

const txDoc = createBudgetDocument({ templateId: "retail_units", qualification: q, market: tx });
assert(txDoc.fyStartMonth === 1, "TX budget FY January");
txDoc.revenueLines[0].months[txDoc.fyStart] = { volume: 10, price: 100 };
txDoc.gpPct = 40;
txDoc.openingCash = 5000;
txDoc.wc.debtorDays = 0;
txDoc.wc.creditorDays = 0;
txDoc.wc.inventoryDays = 0;
const txRows = computeBudgetMonths(txDoc, "base");
const txRate = tx.tax.regime === "sales_tax" ? tx.tax.combinedRate : 0;
assert(txRows[0].revenue === 1000, `TX P&L is ex-tax ${txRows[0].revenue}`);
assert(
  Math.round(txRows[0].cashIn) === Math.round(1000 * (1 + txRate)),
  `TX cashIn includes collections ${txRows[0].cashIn}`,
);
assert(
  Math.round(txRows[0].vatNet) === Math.round(1000 * txRate),
  `TX remits collections, no input credit ${txRows[0].vatNet}`,
);
assert(
  Math.round(txRows[0].netCash) === 400,
  `TX sales tax is a same-month wash ${txRows[0].netCash}`,
);

const orDoc = createBudgetDocument({ templateId: "retail_units", qualification: q, market: or });
orDoc.revenueLines[0].months[orDoc.fyStart] = { volume: 10, price: 100 };
orDoc.gpPct = 40;
orDoc.wc.debtorDays = 0;
orDoc.wc.creditorDays = 0;
orDoc.wc.inventoryDays = 0;
const orRows = computeBudgetMonths(orDoc, "base");
assert(orRows[0].cashIn === 1000, `OR cashIn ${orRows[0].cashIn}`);
assert(orRows[0].vatNet === 0, "OR no sales tax remittance");

assert(
  formatMoneyCompact(1_250_000, ZA_MARKET) === "R\u00a01.3m",
  `ZA compact ${formatMoneyCompact(1_250_000, ZA_MARKET)}`,
);
assert(
  formatMoneyCompact(1_250_000, tx) === "$1.3m",
  `US compact ${formatMoneyCompact(1_250_000, tx)}`,
);
assert(formatNumber(1299, ZA_MARKET).includes("1"), "ZA formatNumber digits");
assert(formatNumber(1299, tx).includes("1"), "US formatNumber digits");
assert(currencySymbol(ZA_MARKET) === "R", "ZA symbol");
assert(currencySymbol(tx) === "$", "US symbol");
assert(formatMoneyUnit(1, ZA_MARKET) === "R1", "ZA unit");
assert(formatMoneyUnit(1, tx) === "$1", "US unit");
assert(formatMoneyUnit(100, tx) === "$100", "US unit 100");
assert(localizeCopy("Debtor Days", ZA_MARKET) === "Debtor Days", "ZA copy unchanged");
assert(localizeCopy("Debtor Days", tx) === "Days sales outstanding", "US Debtor Days");
assert(
  localizeCopy("Of every R1", tx) === "Of every $1",
  `US R1 ${localizeCopy("Of every R1", tx)}`,
);
assert(localizeCopy("each rand of sales", tx) === "each dollar of sales", "US rand word");
assert(
  localizeCopy("Debtors slow, stock heavy", tx) === "Accounts receivable slow, stock heavy",
  "US Debtors",
);
assert(localizeCopy("GP per R1 of labour", tx) === "GP per $1 of labor", "US labour/R1");
assert(fmtRand(40, tx).startsWith("$"), `fmtRand US ${fmtRand(40, tx)}`);
assert(fmtRand(40, ZA_MARKET).startsWith("R"), `fmtRand ZA ${fmtRand(40, ZA_MARKET)}`);

const zaExtract = financialExtractionPrompt(ZA_MARKET);
assert(zaExtract.includes("South African"), "ZA extraction prompt names South Africa");
assert(zaExtract.includes('"functional_currency": "ZAR"'), "ZA extraction currency key");

const usExtract = financialExtractionPrompt(tx);
assert(usExtract.includes("United States"), "US extraction prompt names United States");
assert(usExtract.includes('"functional_currency": "USD"'), "US extraction currency key");
assert(usExtract.includes("debtors"), "US extraction keeps debtors JSON key");

const bankUs = bankDraftPrompt(tx);
assert(/sales tax/i.test(bankUs), "US bank draft mentions sales tax");
assert(!/provisional tax/i.test(bankUs), "US bank draft omits provisional tax");
assert(!/VAT payments/i.test(bankUs), "US bank draft omits VAT payments");

const newsUs = newsSearchUrl("foo", tx);
assert(newsUs.includes("gl=US"), `US news search gl ${newsUs}`);
assert(newsSearchUrl("foo", ZA_MARKET).includes("gl=ZA"), "ZA news search gl");

assert(
  !playbookStepFitsMarket(
    { step_title: "File with SARS", step_description: "Submit the FNB 32-day notice return" },
    tx,
  ),
  "US hides SARS/FNB playbook step",
);
assert(
  playbookStepFitsMarket(
    { step_title: "Chase slow payers", step_description: "Call customers who owe you this week" },
    tx,
  ),
  "US keeps generic playbook step",
);
assert(
  !playbookStepFitsMarket(
    {
      step_title: "Sales tax remittance",
      step_description: "collect sales tax on every invoice this month",
    },
    or,
  ),
  "Oregon hides sales-tax-only step",
);
assert(
  playbookStepFitsMarket(
    {
      step_title: "Sales tax remittance",
      step_description: "collect sales tax on every invoice this month",
    },
    tx,
  ),
  "Texas keeps sales-tax step",
);

const localized = localizePlaybookStep(
  { step_title: "Protect every rand", step_description: "Cut rand waste in opex" },
  tx,
);
assert(localized.step_title.includes("dollar"), `localize title ${localized.step_title}`);
assert(
  localized.step_description.includes("dollar"),
  `localize body ${localized.step_description}`,
);

assert(visitorCopyPack({ country: "US" }) === "us", "US visitor copy pack");
assert(visitorCopyPack({ country: "ZA" }) === "za", "ZA visitor copy pack");
assert(visitorCopyPack({ country: null }) === "za", "unset visitor defaults ZA");
assert(LIST_PRICES.us.orbit.startsWith("$"), "US Orbit is dollars");
assert(LIST_PRICES.za.orbit.startsWith("R"), "ZA Orbit is rand");
assert(LIST_PRICES.us.firm150.startsWith("$"), "US firm price is dollars");
assert(t("nameExample", tx) === "Jordan Hale", "US name example");
assert(t("nameExample", ZA_MARKET) === "Thabo Nkosi", "ZA name example");
assert(t("entityExample", tx) === "Acme LLC", "US entity example");
assert(t("sharePrimary", tx) === "Email", "US share primary is email");
assert(t("sharePrimary", ZA_MARKET) === "WhatsApp", "ZA share primary is WhatsApp");
assert(t("phoneExample", tx) === "+1 512 555 0100", "US phone example");

assert(salesPerEmployeeHealthy(ZA_MARKET) === 300_000, "ZA SPE healthy 300k");
assert(salesPerEmployeeHealthy(tx) === 150_000, "US SPE healthy 150k");
assert(Math.round(scoreSalesPerEmployee(300_000, ZA_MARKET)) === 100, "ZA SPE 300k → 100");
assert(Math.round(scoreSalesPerEmployee(150_000, tx)) === 100, "US SPE 150k → 100");
assert(Math.round(scoreSalesPerEmployee(75_000, tx)) === 50, "US SPE 75k → 50");
assert(
  Math.round(scoreRatio("Sales-per-Employee Ratio", 300_000)) === 100,
  "scoreRatio default ZA",
);
assert(
  Math.round(scoreRatio("Sales-per-Employee Ratio", 150_000, tx)) === 100,
  "scoreRatio US 150k → 100",
);
assert(
  salesPerEmployeeBenchmarkLabel(tx).includes("$"),
  `US SPE label ${salesPerEmployeeBenchmarkLabel(tx)}`,
);
assert(
  !canShowIndustryMedian(tx, { metricKey: "salesPerEmployee", format: "money" }),
  "US hides money industry median",
);
assert(
  canShowIndustryMedian(tx, { metricKey: "debtorDays", format: "days" }),
  "US keeps days bands",
);
assert(
  canShowIndustryMedian(ZA_MARKET, { metricKey: "salesPerEmployee", format: "money" }),
  "ZA shows money industry median",
);
assert(/global SME/i.test(askAiSystemBase("us")), "US Ask AI names global SME bands");
assert(!/global SME/i.test(askAiSystemBase("za")), "ZA Ask AI does not mention global SME bands");
assert(/global SME/i.test(industryBenchmarkCaption(tx)), "US benchmark disclaimer");
assert(
  !/global SME/i.test(industryBenchmarkCaption(ZA_MARKET)),
  "ZA caption is industry median, not global SME",
);

console.log("market kernel ok");
