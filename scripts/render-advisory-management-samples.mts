/**
 * Render the Advisory Management Report for Chill Pepper and Harbour & Co
 * and write one PNG per page. Local sample for review. Not a client write.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createElement } from "react";
import { assessClientMetrics } from "../src/lib/client-metrics";
import { scorecardHealthFromFinancials } from "../src/lib/health-score";
import { scorecardRatiosFromFinancials } from "../src/lib/scorecard-rows";
import { sampleFinancialsFor } from "../src/lib/sample-business";
import { sampleOpeningCash } from "../src/lib/trial-sample-view";
import { buildAdvisoryPack, packNarrativeRatios, type PackBooks, type PackInputs } from "../src/lib/advisory-pack";
import { ZA_MARKET } from "../src/lib/market/resolve";
import { extractText, getDocumentProxy } from "unpdf";

const OUT = "/opt/cursor/artifacts/advisory-management-report";
const NOW = "2026-09-30T12:00:00.000Z";
const NOW_DATE = new Date(NOW);

const CHILL = {
  revenue: 1_215_000,
  cogs: -56_000,
  ebit: 56_800,
  ebitda: 126_800,
  ebt: 37_000,
  netIncome: 27_010,
  laborCost: 426_000,
  fixedCosts: "",
  payables: 38_000,
  receivables: 21_500,
  inventory: 14_200,
  equity: 54_600,
  totalAssets: 331_600,
  cash: null,
  periodEnd: "2026-09-30",
};

const line = (
  name: string,
  amount: number,
  frequency: "once-off" | "recurring-monthly",
  startWeek: number,
) => ({ name, amount: String(amount), frequency, startWeek });

const CHILL_CASH = {
  openingBalance: "44480",
  seededFromBanksAt: "2026-08-24T20:07:05.368Z",
  startDate: "2026-05-30",
  revenue: [
    line("Netcash", 36360, "recurring-monthly", 3),
    line("Andre Galvao Seminar", 16800, "once-off", 1),
    line("Netcash", 5760, "once-off", 1),
    line("Yoco", 2250, "recurring-monthly", 5),
    line("D Pillay", 900, "once-off", 1),
    line("L Ferreira", 900, "once-off", 1),
    line("J Botha", 795, "once-off", 1),
    line("M Adams", 795, "once-off", 1),
    line("S Naidoo", 595, "once-off", 1),
  ],
  expenses: [
    line("Greeff Properties", 28000, "once-off", 1),
    line("Fuji SA", 9200, "once-off", 1),
    line("Seminar Guest Instructor Fee", 7200, "once-off", 1),
    line("R Dlamini", 6000, "once-off", 1),
    line("B Petersen", 4500, "once-off", 1),
    line("Sparkle Cleaning", 3500, "once-off", 1),
    line("SARS", 3480, "once-off", 1),
    line("City of Cape Town", 2947.5, "recurring-monthly", 2),
    line("Meta", 2800, "once-off", 1),
    line("Ledger & Co", 2500, "once-off", 1),
    line("Santam", 2200, "once-off", 1),
    line("Webafrica", 899, "once-off", 1),
    line("Netcash", 748, "once-off", 1),
    line("Dis-Chem", 392, "once-off", 1),
    line("FNB", 458, "recurring-monthly", 5),
  ],
  other: [line("T Mokoena", 25000, "once-off", 1), line("FNB", 6800, "once-off", 1)],
};

const PROFILE = {
  firmName: "Harbour & Co",
  logoUrl: null,
  primaryColor: "#102A43",
  secondaryColor: "#2563EB",
  accentColor: "#0B5FFF",
  accountantName: "Ada Mbeki",
  accountantEmail: "ada@harbour.example",
  tagline: "Advisory",
  signatureDataUrl: null,
};

function packFor(name: string, financials: Record<string, unknown>, cashflow?: unknown) {
  const books: PackBooks = {
    financials,
    cashflow,
    financialsUpdatedAt: NOW,
    fyStartMonth: 3,
    timeZone: ZA_MARKET.timezone,
    now: NOW_DATE,
    market: ZA_MARKET,
    sourceLabel: cashflow ? "Bank lines and the signed-off statement" : "Sample statement",
    assumptions: ["Forecast inputs approved in Forecast setup."],
  };
  const health = scorecardHealthFromFinancials({ financials, fyStartMonth: 3, market: ZA_MARKET });
  const raw = scorecardRatiosFromFinancials(financials, { fyStartMonth: 3 });
  const ratios: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) ratios[key] = value;
  }
  const assessed = assessClientMetrics({
    financials,
    cashflow,
    financialsUpdatedAt: NOW,
    now: NOW_DATE,
    timeZone: ZA_MARKET.timezone,
    fyStartMonth: 3,
  });
  const input: PackInputs & { books: PackBooks } = {
    clientName: name,
    firmName: PROFILE.firmName,
    hasFirm: true,
    periodLabel: "Results to 30 September 2026",
    priorPeriodLabel: null,
    figuresAsOf: "2026-09-30",
    health,
    ratios,
    narrativeRatios: packNarrativeRatios(financials, ratios),
    priorRatios: null,
    openingBalance: assessed.outlook.openingCash ?? assessed.outlook.opening,
    closings: assessed.outlook.closing,
    floor: assessed.outlook.floor,
    cashRunwayWeeks: assessed.runway.kind === "weeks" ? assessed.runway.weeks : null,
    runwayLabel: assessed.runway.label,
    recommendations: [],
    dataRequests: [],
    openActions: 0,
    overdueActions: 0,
    now: NOW,
    currency: "ZAR",
    market: ZA_MARKET,
    books,
  };
  const content = buildAdvisoryPack(input);
  if (content.schema !== 2) throw new Error("expected schema 2");
  return content;
}

async function textOf(buf: Buffer): Promise<{ pages: number; text: string }> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  try {
    const extracted = await extractText(pdf, { mergePages: false });
    const pages = Array.isArray(extracted.text) ? extracted.text : [String(extracted.text ?? "")];
    return { pages: pages.length, text: pages.join("\n") };
  } finally {
    await pdf.destroy();
  }
}

function pagePngs(pdfPath: string, prefix: string) {
  execFileSync("pdftoppm", ["-png", "-r", "110", pdfPath, prefix], { stdio: "inherit" });
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const { renderToBuffer } = await import("@react-pdf/renderer");
  const { AdvisoryPackPDF } = await import("../src/reports/advisory-pack");
  const harbourFin = {
    ...sampleFinancialsFor("ZA"),
    cash: String(sampleOpeningCash("ZA")),
    periodEnd: "2026-09-30",
  };
  const clients = [
    { slug: "chill-pepper", name: "Chill Pepper Boutique Hotel", financials: CHILL, cashflow: CHILL_CASH },
    { slug: "harbour", name: "Harbour & Co", financials: harbourFin, cashflow: undefined },
  ];
  for (const client of clients) {
    const content = packFor(client.name, client.financials, client.cashflow);
    const buf = await renderToBuffer(
      createElement(AdvisoryPackPDF, {
        smeData: { name: client.name, period: "Results to 30 September 2026" },
        accountantProfile: PROFILE,
        content,
        dateLabel: "30 September 2026",
        draftDisclosure: "Draft for accountant review. Not sent.",
        market: ZA_MARKET,
      }),
    );
    const pdfPath = `${OUT}/${client.slug}.pdf`;
    writeFileSync(pdfPath, buf);
    const info = await textOf(buf);
    console.log(client.slug, "pages", info.pages, "bytes", buf.length);
    if (!info.text.includes("Advisory Management Report")) {
      throw new Error(`${client.slug} missing title`);
    }
    pagePngs(pdfPath, `${OUT}/${client.slug}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
