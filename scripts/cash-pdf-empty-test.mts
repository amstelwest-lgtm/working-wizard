/**
 * An empty owner cash forecast must not export a zero runway.
 * The floor engine still scores a flat zero series; the PDF must not print it.
 * Run: pnpm test:cash-pdf-empty
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { getDocumentProxy } from "unpdf";
import { forecastFloorPosition } from "../src/lib/cash-forecast-parity";
import { resolveMarket } from "../src/lib/market/resolve";
import { cashForecastSeriesBlank, type CashForecastWeek } from "../src/reports/cash-forecast";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

const US = resolveMarket({ country: "US", regionCode: "NY" });

type TextItem = { str: string; transform: number[] };

async function pageText(buf: Buffer): Promise<string> {
  const pdf = await getDocumentProxy(new Uint8Array(buf));
  const lines: string[] = [];
  for (let n = 1; n <= pdf.numPages; n += 1) {
    const page = await pdf.getPage(n);
    const content = await page.getTextContent();
    const buckets = new Map<number, Array<{ x: number; str: string }>>();
    for (const item of content.items as TextItem[]) {
      if (!item.str || !item.str.trim()) continue;
      const y = item.transform[5] ?? 0;
      const key = Math.round(y / 2) * 2;
      const row = buckets.get(key) ?? [];
      row.push({ x: item.transform[4] ?? 0, str: item.str });
      buckets.set(key, row);
    }
    for (const [, parts] of [...buckets.entries()].sort((a, b) => b[0] - a[0])) {
      lines.push(
        parts
          .sort((a, b) => a.x - b.x)
          .map((part) => part.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim(),
      );
    }
  }
  return lines.join("\n");
}

function week(partial: Partial<CashForecastWeek> & { period_label: string }): CashForecastWeek {
  return {
    opening_balance: 0,
    total_receipts: 0,
    total_payments: 0,
    net_movement: 0,
    closing_balance: 0,
    scenario: "moderate",
    runway_weeks: 0,
    ...partial,
  };
}

const blankWeeks = Array.from({ length: 13 }, (_, i) => week({ period_label: `Week ${i + 1}` }));

assert(cashForecastSeriesBlank(blankWeeks), "a flat zero series is blank");
assert(cashForecastSeriesBlank([]), "no weeks is blank");
assert(
  cashForecastSeriesBlank([
    {
      opening_balance: null,
      total_receipts: null,
      total_payments: null,
      net_movement: null,
      closing_balance: null,
    },
  ]),
  "null balances are blank",
);
assert(
  !cashForecastSeriesBlank([week({ period_label: "Week 1", opening_balance: 80_000, closing_balance: 80_000 })]),
  "a real opening is a forecast",
);

const floor = forecastFloorPosition({
  opening: 0,
  closings: blankWeeks.map((row) => row.closing_balance),
  floor: 50_000,
});
assert(floor.weeksBelow === 13, "the floor engine still counts a zero series");
assert(floor.firstDipWeek === 1, "the floor engine still marks week 1");

const panel = readFileSync(resolve("src/components/cash-forecast.tsx"), "utf8");
assert(
  panel.includes("if (linesBlank || forecastEmpty) return;"),
  "export returns before building a PDF with no lines",
);
assert(
  panel.includes("disabled={exporting || linesBlank || forecastEmpty}"),
  "Export PDF stays disabled while the forecast is blank",
);
assert(panel.includes("data-cash-export-reason"), "the empty forecast states why export is off");
assert(
  panel.includes("The 13-week chart appears once a forecast line is entered."),
  "the visible reason matches the chart placeholder",
);

const narrative = readFileSync(resolve("src/reports/narrative.ts"), "utf8");
const cashNarrative = narrative.slice(narrative.indexOf("export function cashForecastNarrative"));
assert(cashNarrative.includes('if (d.empty) return "Not enough data"'), "an empty forecast narrative stops before runway");
const floorSource = readFileSync(resolve("src/lib/cash-forecast-parity.ts"), "utf8");
assert(!floorSource.includes("Not enough data"), "the scoring engine is unchanged");

const SME = { name: "Northline Studio", period: "October 2026" };
const ACCOUNTANT = {
  firmName: "Test Accounting Co",
  logoUrl: null,
  primaryColor: "#1a1a2e",
  secondaryColor: "#16213e",
  accentColor: "#0f3460",
  accountantName: "Jane Doe",
  accountantEmail: "jane@testfirm.co.za",
  tagline: null,
};

const FORBIDDEN = [
  "Projected runway is 0 weeks",
  "opening bank balance of $0",
  "13 weeks below",
  "Weeks Below Minimum 13",
];

async function main() {
  const { renderToBuffer } = await import("@react-pdf/renderer");
  const { CashForecastPDF } = await import("../src/reports/cash-forecast.js");

  const emptyBuf = await renderToBuffer(
    createElement(CashForecastPDF, {
      smeData: SME,
      accountantProfile: ACCOUNTANT,
      market: US,
      cashForecast: blankWeeks,
      scenario: "base",
      minimumThreshold: 50_000,
      assumptions: [
        "Forecast starts October 5, 2026 with an opening bank balance of $0.",
        "Revenue and expenses are the amounts entered, with no scenario adjustment.",
      ],
    }),
  );
  const emptyText = await pageText(emptyBuf);
  const flat = emptyText.replace(/\s+/g, " ");
  assert(flat.includes("Not enough data"), "an empty forecast says Not enough data");
  for (const phrase of FORBIDDEN) {
    assert(!flat.toLowerCase().includes(phrase.toLowerCase()), `empty forecast contains ${phrase}`);
  }
  assert(!/weeks below minimum\s+13\b/i.test(flat), "Weeks Below Minimum is not 13");
  assert(/weeks below minimum\s+—/i.test(flat), `Weeks Below Minimum shows a dash:\n${emptyText}`);

  const filled = Array.from({ length: 13 }, (_, i) =>
    week({
      period_label: `Week ${i + 1}`,
      opening_balance: 80_000,
      total_receipts: 12_000,
      total_payments: 4_000,
      net_movement: 8_000,
      closing_balance: 80_000 + (i + 1) * 8_000,
      runway_weeks: 13 - i,
    }),
  );
  const filledBuf = await renderToBuffer(
    createElement(CashForecastPDF, {
      smeData: SME,
      accountantProfile: ACCOUNTANT,
      market: US,
      cashForecast: filled,
      scenario: "base",
      minimumThreshold: 50_000,
      assumptions: ["Forecast starts October 5, 2026 with an opening bank balance of $80,000."],
    }),
  );
  const filledText = (await pageText(filledBuf)).replace(/\s+/g, " ");
  assert(
    filledText.includes("opening bank balance of $80,000"),
    "a real forecast still prints its opening assumption",
  );
  assert(!filledText.includes("Not enough data"), "a real forecast is not treated as empty");
  assert(
    /Projected runway/.test(filledText),
    "a real forecast still states runway",
  );

  console.log("cash-pdf-empty: ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
