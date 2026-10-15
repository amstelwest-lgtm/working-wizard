/**
 * Local proof of the CRIT and HIGH display rules.
 * The figures are a labelled fixture (a stored credit for cost of sales),
 * not a client's books.
 */
import { ProfitabilityWaterfall } from "@/components/profitability-waterfall";
import { SettingsMenu } from "@/components/settings-menu";
import { groundPlaybookSteps } from "@/lib/intervention-grounding";
import { stripMilonProjection } from "@/lib/milon-projection";
import { clientIndustryDisplay } from "@/lib/profile-signals";
import { firmUsageLimit, formatFirmClientUsage } from "@/lib/firm-band-upgrade";
import { formatMoney } from "@/lib/market/format";
import { ZA_MARKET } from "@/lib/market";
import { derivePeriodWaterfallFallback } from "@/lib/weekly-inputs";

const FIXTURE = {
  revenue: 1_000_000,
  cogs: -400_000,
  grossProfit: 600_000,
  ebit: 220_000,
  netIncome: 22_000,
  fixedCosts: 380_000,
};

const money = (amount: number) => formatMoney(amount, ZA_MARKET);

const plan = groundPlaybookSteps(
  [
    {
      ratio_key: "netMargin",
      ratio_name: "Net Margin",
      health_tier: "critical",
      step_number: 1,
      step_title: "Identify whether loss is operating or financing driven",
      step_description: "Discretionary spending at a critical net margin accelerates insolvency.",
    },
  ],
  {
    ratioKey: "netMargin",
    ratioName: "Net Margin",
    tier: "critical",
    value: 0.022,
    formattedValue: "2.2%",
    revenue: FIXTURE.revenue,
    netProfit: FIXTURE.netIncome,
    formatMoney: money,
  },
);

const action = stripMilonProjection(
  'Chase the overdue invoice @@milon-projection@@{"cash":44880} before Friday.',
);

export function PersonaCritPreview() {
  const waterfall = derivePeriodWaterfallFallback(FIXTURE);
  const usage = formatFirmClientUsage(4, firmUsageLimit("active", "starter", 0));
  const hotel = clientIndustryDisplay("Karoo Lodge", { templateId: "day_labour" }, null);
  const wood = clientIndustryDisplay("Cedar Woodwork", { templateId: "hospitality_rooms" }, null);
  const step = plan.steps[0];

  return (
    <div className="min-h-screen bg-[#F4F7FB] px-4 py-6 text-[#102A43] sm:px-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#3D5270]">
        Fixture proof — not a client file
      </p>
      <h1 className="mt-1 text-2xl font-semibold">Persona CRIT and HIGH</h1>

      <section className="mt-6 rounded-xl border border-[#DBEAFE] bg-white p-4">
        <h2 className="text-sm font-semibold">Account menu</h2>
        <div className="mt-3 flex justify-end">
          <SettingsMenu onSettings={() => undefined} onPlan={() => undefined} />
        </div>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2">
        <article className="rounded-xl border border-[#DBEAFE] bg-white p-4">
          <h2 className="text-sm font-semibold">Industries</h2>
          <p className="mt-2 text-sm">Karoo Lodge — {hotel}</p>
          <p className="text-sm">Cedar Woodwork — {wood}</p>
        </article>
        <article className="rounded-xl border border-[#DBEAFE] bg-white p-4">
          <h2 className="text-sm font-semibold">Starter</h2>
          <p className="mt-2 text-sm">{usage} · Starter includes up to 5</p>
        </article>
      </section>

      <section className="mt-4 rounded-xl border border-[#DBEAFE] bg-white p-4">
        <h2 className="text-sm font-semibold">Action text</h2>
        <p className="mt-2 text-sm">{action}</p>
      </section>

      <section className="mt-4 rounded-xl border border-[#DBEAFE] bg-white p-4">
        <h2 className="text-sm font-semibold">Intervention plan</h2>
        <p className="mt-1 text-xs uppercase tracking-wide text-[#3D5270]">{plan.tier}</p>
        <p className="mt-2 text-sm font-semibold">{step?.step_title}</p>
        <p className="mt-1 text-sm leading-relaxed">{step?.step_description}</p>
      </section>

      <section className="mt-4">
        <h2 className="mb-2 text-sm font-semibold">
          Waterfall from stored COGS {money(FIXTURE.cogs)} · bridge COGS {money(waterfall.cogs)}
        </h2>
        <ProfitabilityWaterfall
          clientName="Fixture"
          preferPeriod
          fallback={waterfall}
          hideCardExport
        />
      </section>
    </div>
  );
}
