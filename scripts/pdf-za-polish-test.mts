/**
 * ZA advisory PDF polish: money has no comma decimals, Prepared for uses a
 * real client name, and the download filename drops the pro-rated sentence.
 * Run: pnpm test:pdf-za-polish
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { formatReportAmount } from "../src/lib/market/format";
import { ZA_MARKET } from "../src/lib/market/resolve";
import { formatPdfMoney } from "../src/lib/pdf-money";
import { pdfDownloadFilename, pdfPreparedForName } from "../src/lib/pdf-download";
import { profitabilityNarrative } from "../src/reports/narrative";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const COMMA_DECIMAL = /\d,\d{2}\b/;
const PERIOD = "Mar\u2013Sep 2026, pro-rated from your Jan\u2013Sep 2026 statement";

assert(formatPdfMoney(320_444) === "R 320 444", formatPdfMoney(320_444));
assert(formatPdfMoney(46_300) === "R 46 300", formatPdfMoney(46_300));
assert(formatReportAmount(320_444, ZA_MARKET) === "R 320 444", "whole rand stays space-grouped");
assert(formatReportAmount(46_300, ZA_MARKET) === "R 46 300", "whole rand stays space-grouped");

const cents = formatPdfMoney(9.27, ZA_MARKET, { fractionDigits: 2 });
assert(cents === "R 9.27", cents);
assert(!COMMA_DECIMAL.test(cents), `PDF cents used a comma decimal: ${cents}`);

const ratioCents = formatReportAmount(9.27, ZA_MARKET, { fractionDigits: 2 });
assert(ratioCents === "R 9.27", ratioCents);
assert(!COMMA_DECIMAL.test(ratioCents), `ratio money used a comma decimal: ${ratioCents}`);
assert(
  formatPdfMoney(320_444.5, ZA_MARKET, { fractionDigits: 2 }) === "R 320 444.50",
  "cents keep the space thousands separator",
);

const waterfall = profitabilityNarrative(
  {
    revenue: 320_444,
    net_profit: 29_711,
    gross_margin_pct: 0.58,
    net_margin_pct: 0.0927,
  },
  null,
  ZA_MARKET,
);
assert(!waterfall.includes("9,27"), `waterfall narrative still has a comma decimal: ${waterfall}`);
assert(waterfall.includes("R 9.27"), waterfall);

assert(
  pdfPreparedForName({ clientName: "Your Business", businessName: "Harbour Cafe" }) ===
    "Harbour Cafe",
  "placeholder yields to the real client name",
);
assert(
  pdfPreparedForName({
    clientName: "Your Business",
    entityName: "Karoo Traders (Pty) Ltd",
  }) === "Karoo Traders (Pty) Ltd",
  "placeholder yields to the statement entity",
);
assert(
  pdfPreparedForName({ clientName: "Harbour Cafe", businessName: "Other Co" }) === "Harbour Cafe",
  "a real client name is kept",
);
assert(pdfPreparedForName({ clientName: "  " }) === "Client", "an empty name is not Your Business");

const filename = pdfDownloadFilename({
  clientName: "Your Business",
  businessName: "Harbour Cafe",
  periodLabel: PERIOD,
  reportName: "ProfitabilityWaterfall",
});
const ugly = `Your_Business_${PERIOD.replace(/\s+/g, "_")}_ProfitabilityWaterfall.pdf`;
assert(filename === "Harbour_Cafe_Mar-Sep_2026_ProfitabilityWaterfall.pdf", filename);
assert(!filename.includes("pro-rated") && !filename.includes("pro_rated"), filename);
assert(!filename.includes("Your_Business"), filename);
assert(filename !== ugly, "filename still embeds the pro-rated sentence");
assert(filename.length < 80, `filename is still long: ${filename}`);

const crossYear = pdfDownloadFilename({
  clientName: "Harbour Cafe",
  periodLabel: "Nov 2025 \u2013 Feb 2026, pro-rated from your Sep 2025 \u2013 Feb 2026 statement",
  reportName: "ProfitabilityWaterfall",
});
assert(crossYear === "Harbour_Cafe_Nov_2025-Feb_2026_ProfitabilityWaterfall.pdf", crossYear);
assert(!crossYear.includes("pro-rated"), crossYear);

const header = readFileSync(resolve("src/components/pdf/report-header.tsx"), "utf8");
assert(
  !/firmName \|\| ["']MILON ADVISORY["']/.test(header),
  "header still falls back to MILON ADVISORY",
);
assert(header.includes("MilonMark"), "header brand uses the macron wordmark");

const waterfallSrc = readFileSync(resolve("src/components/profitability-waterfall.tsx"), "utf8");
assert(!waterfallSrc.includes("Your Business"), "waterfall PDF still hardcodes Your Business");
assert(waterfallSrc.includes("pdfPreparedForName"), "waterfall prepared-for uses the helper");
assert(waterfallSrc.includes("pdfDownloadFilename"), "waterfall download uses the short filename");

const cashSrc = readFileSync(resolve("src/components/cash-forecast.tsx"), "utf8");
assert(!cashSrc.includes("Your Business"), "cash PDF still hardcodes Your Business");
assert(cashSrc.includes("pdfDownloadFilename"), "cash download uses the short filename");
