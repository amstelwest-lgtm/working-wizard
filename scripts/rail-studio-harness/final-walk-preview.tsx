/**
 * Local harness for the industry / action / recurring walk.
 * Amounts are the stored Chill Pepper lines. Occupancy, food and beverage,
 * housekeeping and rent stay blank because no budget figure is stored.
 */
import { useState } from "react";
import { BudgetSimpleView } from "@/components/budget/budget-simple-view";
import { CashForecastPanel } from "@/components/cash-forecast";
import { FirmBandUpgrade } from "@/components/firm-band-upgrade";
import { createBudgetDocument } from "@/lib/budget.months";
import type { BudgetDocument } from "@/lib/budget.types";
import { ZA_MARKET } from "@/lib/market";

const extract = {
  period_start: "2026-05-01",
  period_end: "2026-07-01",
  opening_balance: null,
  closing_balance: null,
  currency: "ZAR",
  notes: null,
  transactions: [
    ["2026-05-01", 28000, "Greeff Properties", "rent"],
    ["2026-07-01", 28000, "Greeff Properties", "rent"],
    ["2026-05-01", 25000, "T Mokoena", "payroll"],
    ["2026-07-01", 25000, "T Mokoena", "payroll"],
    ["2026-05-01", 6000, "R Dlamini", "payroll"],
    ["2026-07-01", 6000, "R Dlamini", "payroll"],
    ["2026-05-01", 4500, "B Petersen", "payroll"],
    ["2026-07-01", 4500, "B Petersen", "payroll"],
    ["2026-05-01", 458, "FNB", "opex"],
    ["2026-07-01", 458, "FNB", "opex"],
    ["2026-05-12", 16800, "Andre Galvao Seminar", "trading"],
  ].map(([date, amount, name, bucket]) => ({
    txn_date: date,
    amount,
    direction: bucket === "trading" ? "in" : "out",
    description: name,
    counterparty: name,
    ai_bucket: bucket,
    excluded: false,
  })),
};

const line = (id: string, name: string, amount: string) => ({
  id,
  name,
  amount,
  frequency: "once-off" as const,
  startWeek: 1,
  splitCount: 1,
});

function hotelDoc(): BudgetDocument {
  const doc = createBudgetDocument({
    templateId: "day_labour",
    fyStartMonth: 3,
    ref: new Date("2026-10-19T00:00:00Z"),
    market: ZA_MARKET,
    qualification: {
      payMotion: "time_delivery",
      volumeUnit: "day_shift",
      driverKind: "hours_rate",
      costShape: "payroll_heavy",
      debtorDaysDefault: 7,
      capexMode: "light",
      confirmedAt: "2026-08-24T00:00:00.000Z",
    },
  });
  return { ...doc, openingCash: 44480, openingCashSource: "bank" };
}

export function FinalWalkPreview() {
  const [doc, setDoc] = useState(hotelDoc);
  return (
    <div className="min-h-screen bg-[#F4F7FB] p-4 text-[#102A43]">
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#3D5270]">
        Local build — stored Chill Pepper amounts. Occupancy has no stored figure.
      </p>
      <section id="hotel-budget">
        <BudgetSimpleView
          doc={doc}
          onChange={setDoc}
          clientName="Chill Pepper Boutique Hotel"
          displayTemplateId="hospitality_rooms"
          role="accountant"
        />
      </section>
      <section id="sa-price" className="mt-8 max-w-xl">
        <FirmBandUpgrade
          currentBand="starter"
          interval="month"
          priceCurrency="USD"
          canUpgrade={false}
          clientCount={1}
        />
      </section>
      <section id="cash-grid" className="mt-8">
        <CashForecastPanel
          clientName="Chill Pepper Boutique Hotel"
          simplified
          readOnly
          hideInlineSignOff
          initialBankDraft={{ lines: [], extract }}
          preview={{
            startDate: "2026-10-12",
            openingBalance: "44480",
            revenue: [line("galvao", "Andre Galvao Seminar", "16800")],
            expenses: [
              line("rent", "Greeff Properties", "28000"),
              line("dlamini", "R Dlamini", "6000"),
              line("petersen", "B Petersen", "4500"),
              line("fnb", "FNB", "458"),
            ],
            other: [line("mokoena", "T Mokoena", "25000")],
            note: null,
            cycleNote: null,
            financials: null,
          }}
        />
      </section>
    </div>
  );
}
