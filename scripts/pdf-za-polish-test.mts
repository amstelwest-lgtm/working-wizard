/**
 * ZA advisory PDF polish: money has no comma decimals, Prepared for uses a
 * real client name, the download filename drops the pro-rated sentence, and
 * the Milōn wordmark keeps U+014D.
 * Run: pnpm test:pdf-za-polish
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { getDocumentProxy } from "unpdf";
import { isProductBrandName, MILON_WORDMARK } from "../src/components/pdf/milon-wordmark";
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

assert(MILON_WORDMARK === "Mil\u014Dn", "the wordmark constant is the macron form");
assert(isProductBrandName(""), "an empty firm is the product wordmark");
assert(isProductBrandName("Milon"), "ASCII Milon is not a custom firm");
assert(isProductBrandName("Mil\u014Dn"), "the macron name is the product wordmark");
assert(isProductBrandName("MILON ADVISORY"), "the old header fallback is the product wordmark");
assert(!isProductBrandName("Harbour Accounting"), "a real firm name stays on the header");

const footer = readFileSync(resolve("src/components/pdf/report-footer.tsx"), "utf8");
const glyphs = readFileSync(resolve("src/components/pdf/glyphs.tsx"), "utf8");
const pdfSources = [
  "src/components/pdf/report-footer.tsx",
  "src/components/pdf/report-header.tsx",
  "src/components/pdf/glyphs.tsx",
  "src/components/pdf/pdf-document.tsx",
  "src/components/pdf/milon-wordmark.ts",
  "src/components/pdf/milon-font.ts",
];
for (const rel of pdfSources) {
  const src = readFileSync(resolve(rel), "utf8");
  assert(!src.includes("Prepared with Milon"), `${rel} still contains Prepared with Milon`);
}
assert(/<MilonMark\b[^>]*\bmacron\b/.test(footer), "footer wordmark is the ASCII o fallback");
assert(/<MilonMark\b[^>]*\bmacron\b/.test(header), "header wordmark is the ASCII o fallback");
const macronBranch = glyphs.slice(glyphs.indexOf("if (macron)"));
assert(macronBranch.includes("MILON_WORDMARK"), "the macron branch does not set U+014D");
assert(
  !macronBranch.slice(0, macronBranch.indexOf("const family")).includes(">o<"),
  "the macron branch still paints an ASCII o",
);

type TextItem = { str: string };

async function pageText(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const lines: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    lines.push((content.items as TextItem[]).map((item) => item.str).join(" "));
  }
  return lines.join("\n").replace(/\s+/g, " ");
}

function assertMacronBrand(text: string, label: string) {
  assert(
    text.includes("Prepared with Mil\u014Dn"),
    `${label} footer is not Prepared with Milōn: ${text}`,
  );
  const tokens = text.match(/Mil[oōOŌ]n/g) ?? [];
  assert(tokens.length > 0, `${label} shows no brand`);
  for (const token of tokens) {
    assert(/ō|Ō/.test(token), `${label} brand is ASCII ${token}`);
  }
}

const emptyProfile = {
  firmName: "",
  logoUrl: null,
  primaryColor: "#102A43",
  secondaryColor: "#16213e",
  accentColor: "#0f3460",
  accountantName: "",
  accountantEmail: "",
  tagline: null,
  signatureDataUrl: null,
};

async function renderedBrand(firmName: string): Promise<string> {
  const { renderToBuffer, View } = await import("@react-pdf/renderer");
  const { PDFDocument } = await import("../src/components/pdf/pdf-document.tsx");
  const buf = await renderToBuffer(
    createElement(PDFDocument, {
      title: "Profitability waterfall",
      smeData: { name: "Harbour Cafe", period: "Mar–Sep 2026" },
      accountantProfile: { ...emptyProfile, firmName },
      market: ZA_MARKET,
      children: createElement(View),
    }) as Parameters<typeof renderToBuffer>[0],
  );
  return pageText(buf);
}

const owner = await renderedBrand("");
assertMacronBrand(owner, "owner PDF");
assert(!/\bMilon\b/.test(owner), `owner PDF still has ASCII Milon: ${owner}`);

const productName = await renderedBrand("Milon");
assertMacronBrand(productName, "product-name brand");
assert(
  !/\bMilon\b/.test(productName),
  `product-name brand still prints ASCII Milon: ${productName}`,
);

const accountant = await renderedBrand("Harbour Accounting");
assertMacronBrand(accountant, "accountant PDF");
assert(accountant.includes("HARBOUR ACCOUNTING"), `custom firm missing: ${accountant}`);
