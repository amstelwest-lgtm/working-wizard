/**
 * Labelled fixture for the client Home brief. Not a client's books.
 */
import { FinancialManagerBrief } from "@/components/financial-manager-brief";
import { buildFinancialManagerBrief } from "@/lib/financial-manager-brief";
import { formatMoney } from "@/lib/market/format";
import { ZA_MARKET } from "@/lib/market";

const money = (amount: number) => formatMoney(amount, ZA_MARKET);

const brief = buildFinancialManagerBrief({
  clientName: "Fixture Co",
  currentFinancials: {
    periodEnd: "2026-03-31",
    revenue: 120000,
    cash: 40000,
    netIncome: 9000,
    receivables: 15000,
    payables: 4000,
    fixedCosts: 30000,
  },
  currentPeriodEnd: "2026-03-31",
  snapshots: [
    {
      periodDate: "2026-02-28",
      periodLabel: "February 2026",
      financials: {
        revenue: 100000,
        cash: 55000,
        netIncome: 8000,
        receivables: 9000,
        payables: 4000,
        fixedCosts: 22000,
      },
    },
  ],
  openActionTitle: "Chase the March invoices",
  overdueActions: 2,
  cashDipWeek: 6,
  cashOpening: 40000,
  cashFloor: 55000,
  receivables: 15000,
  drafts: [{ id: "d1", title: "Advisory note for February" }],
  formatMoney: money,
});

export function FmBriefPreview() {
  return (
    <div className="min-h-screen bg-[#F4F7FB] px-4 py-6 text-[#102A43]">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#3D5270]">
        Fixture proof — not a client file
      </p>
      <FinancialManagerBrief
        brief={brief}
        onHandToBot={() => undefined}
        onOpen={() => undefined}
      />
    </div>
  );
}
