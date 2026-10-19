/**
 * Local harness for the #578 retest. One stored month, no bank history.
 * Amounts are the Chill Pepper lines already on file.
 */
import { CashForecastPanel } from "@/components/cash-forecast";
import { FirmBandUpgrade } from "@/components/firm-band-upgrade";
import { MarketSettingsCard } from "@/components/market-settings-card";

const line = (id: string, name: string, amount: string) => ({
  id,
  name,
  amount,
  frequency: "once-off" as const,
  startWeek: 1,
  splitCount: 1,
});

export function Retest578Preview() {
  return (
    <div className="min-h-screen bg-[#F4F7FB] p-4 text-[#102A43]">
      <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-[#3D5270]">
        Local build — one month on file. Rent and staff are assumed monthly. Fuji stays a purchase. Receipts repeat.
      </p>
      <section id="sa-plan" className="max-w-xl">
        <FirmBandUpgrade
          currentBand="starter"
          interval="month"
          priceCurrency="USD"
          canUpgrade={false}
          clientCount={6}
          saDiscount
        />
        <MarketSettingsCard
          kind="firm"
          recordId={null}
          initial={{ country: "US", regionCode: "NY" }}
          zarPlan
        />
      </section>
      <section id="cash-grid" className="mt-8">
        <CashForecastPanel
          clientName="Chill Pepper Boutique Hotel"
          simplified
          readOnly
          hideInlineSignOff
          preview={{
            startDate: "2026-10-12",
            openingBalance: "44480",
            revenue: [line("guest", "D Pillay", "900")],
            expenses: [
              line("rent", "Greeff Properties", "28000"),
              line("fuji", "Fuji SA", "9200"),
              line("dlamini", "R Dlamini", "6000"),
              line("petersen", "B Petersen", "4500"),
              line("chem", "Dis-Chem", "392"),
              line("santam", "Santam", "2200"),
              { ...line("city", "City of Cape Town", "2947.5"), frequency: "recurring-monthly" as const, startWeek: 2 },
            ],
            other: [line("mokoena", "T Mokoena", "25000")],
            note: null,
            cycleNote: null,
            financials: null,
            singleMonth: true,
          }}
        />
      </section>
    </div>
  );
}
