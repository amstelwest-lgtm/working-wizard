/**
 * Local harness. Lines and the statement are the live Chill Pepper file.
 */
import { CashForecastPanel } from "@/components/cash-forecast";
import { FinancialManagerBrief } from "@/components/financial-manager-brief";
import { OwnerHome } from "@/components/owner-door/owner-home";
import { buildFinancialManagerBrief } from "@/lib/financial-manager-brief";
import { formatMoney } from "@/lib/market/format";
import { ZA_MARKET } from "@/lib/market";
import { emptyAgentActivity } from "@/lib/milon-team-activity";
import { ownerAnswerTiles, ownerHomeLines, type OwnerBooks } from "@/lib/owner-answers";
import { ownerPresence } from "@/lib/owner-presence";
import { chillCashflow, chillFinancials } from "./chill-pepper-lines";

const money = (amount: number) => formatMoney(amount, ZA_MARKET);

const line = (
  name: string,
  amount: string,
  frequency: "once-off" | "recurring-monthly",
  startWeek: number,
) => ({
  id: `${frequency}-${name}-${amount}-${startWeek}`,
  name,
  amount,
  frequency,
  startWeek,
  splitCount: 1,
});

const books: OwnerBooks = {
  hasBooks: true,
  ledger: "Xero",
  revenue: chillFinancials.revenue,
  priorRevenue: null,
  cogs: chillFinancials.cogs,
  priorCogs: null,
  receivables: null,
  cashflow: chillCashflow,
  cashOutlook: {
    opening: 201_159,
    closing: [201_159],
    floor: 34_903,
    dipsBelowFloorWeek: null,
  },
  openAction: null,
  actionsReady: true,
  signedBy: null,
  signedOn: null,
  market: ZA_MARKET,
};

const brief = buildFinancialManagerBrief({
  clientName: "Chill Pepper Boutique Hotel",
  currentFinancials: chillFinancials,
  snapshots: [],
  cashflow: chillCashflow,
  cashOpening: 201_159,
  cashFloor: 34_903,
  cashClosing: [201_159],
  market: ZA_MARKET,
  formatMoney: money,
});

export function Retest578Preview() {
  return (
    <div className="min-h-screen bg-[#F4F7FB] p-4 text-[#102A43]">
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#3D5270]">
        Local build — Chill Pepper lines on file. The card is handed the old floor and ignores it.
      </p>
      <div className="owner-door" data-client-home="true">
        <FinancialManagerBrief brief={brief} onHandToBot={() => undefined} onOpen={() => undefined} />
        <OwnerHome
          title="Your whole finance team"
          variant="character"
          showInvite={false}
          audience="accountant"
          marketCountry="ZA"
          sampleClient={false}
          presence={ownerPresence(emptyAgentActivity())}
          lines={ownerHomeLines(ownerAnswerTiles(books), null)}
          onOpen={() => undefined}
          onAsk={() => undefined}
        />
      </div>
      <section id="cash-grid" className="mt-8">
        <CashForecastPanel
          clientName="Chill Pepper Boutique Hotel"
          hideInlineSignOff
          preview={{
            startDate: chillCashflow.startDate,
            openingBalance: chillCashflow.openingBalance,
            revenue: chillCashflow.revenue.map((row) => line(row.name, row.amount, row.frequency, row.startWeek)),
            expenses: chillCashflow.expenses.map((row) => line(row.name, row.amount, row.frequency, row.startWeek)),
            other: chillCashflow.other.map((row) => line(row.name, row.amount, row.frequency, row.startWeek)),
            note: null,
            cycleNote: null,
            financials: chillFinancials,
            singleMonth: true,
          }}
        />
      </section>
    </div>
  );
}
