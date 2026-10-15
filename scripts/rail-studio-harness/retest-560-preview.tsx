/**
 * Local proof of the #560 retest display rules.
 * The figures are a labelled fixture, not a client's books.
 */
import { findingMetricContext } from "@/lib/milon-team-activity";
import { stripMilonProjection } from "@/lib/milon-projection";
import { ownerAmount, ownerAnswerTiles, ownerHomeLines, type OwnerBooks } from "@/lib/owner-answers";
import { operatingCycleDays } from "@/lib/ratios";
import { formatFirmOverLimitNote } from "@/lib/firm-band-upgrade";
import { forecastRunwayHeadlineShared } from "@/lib/cash-forecast-parity";
import { ZA_MARKET } from "@/lib/market";

const books: OwnerBooks = {
  hasBooks: true,
  ledger: "Xero",
  revenue: 1_215_000,
  priorRevenue: null,
  cogs: -56_000,
  priorCogs: null,
  grossProfit: 1_159_000,
  netIncome: 27_010,
  receivables: null,
  cashflow: null,
  openAction: null,
  actionsReady: true,
  signedBy: null,
  signedOn: null,
  market: ZA_MARKET,
};

const action = stripMilonProjection(
  'Get customers to pay faster @@milon-projection@@{"v":1,"driverKey":"workingCapitalDays","current":161.6}@@/milon-projection@@',
);
const analyst = ownerHomeLines(ownerAnswerTiles(books), null).analyst[0] ?? "";
const flags =
  findingMetricContext({
    figures: {
      grossMargin: 1.046,
      creditorDays: -248,
      inventoryDays: -93,
      debtorDays: 6,
    },
  }) ?? "";
const cycle = operatingCycleDays({
  revenue: 1_215_000,
  cogs: -56_000,
  receivables: (6 * 1_215_000) / 365,
  inventory: (93 * 56_000) / 365,
  payables: (248 * 56_000) / 365,
});
const runway = forecastRunwayHeadlineShared({
  opening: 80_000,
  closings: Array.from({ length: 13 }, (_, week) => (week < 6 ? 10_000 : 80_000)),
  floor: 50_000,
  runwayLabel: "Cash generative",
  cashGenerative: true,
}).headline;
const over = formatFirmOverLimitNote({ count: 8, limit: 5, planName: "Starter" });

export function Retest560Preview() {
  return (
    <div className="min-h-screen bg-[#F4F7FB] px-4 py-6 text-[#102A43] sm:px-8">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#3D5270]">
        Fixture proof — not a client file
      </p>
      <h1 className="mt-1 text-2xl font-semibold">Retest 560</h1>

      <section className="mt-6 rounded-xl border border-[#DBEAFE] bg-white p-4">
        <h2 className="text-sm font-semibold">Action</h2>
        <p className="mt-2 text-sm font-semibold">Get customers to pay faster</p>
        <p className="mt-1 text-sm">{action}</p>
      </section>

      <section className="mt-4 rounded-xl border border-[#DBEAFE] bg-white p-4">
        <h2 className="text-sm font-semibold">Analyst</h2>
        <p className="mt-2 text-sm">{analyst}</p>
      </section>

      <section className="mt-4 rounded-xl border border-[#DBEAFE] bg-white p-4">
        <h2 className="text-sm font-semibold">Data flags</h2>
        <p className="mt-2 text-sm">{flags}</p>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2">
        <article className="rounded-xl border border-[#DBEAFE] bg-white p-4">
          <h2 className="text-sm font-semibold">Working capital days</h2>
          <p className="mt-2 text-sm">{cycle.workingCapitalDays}d</p>
          <p className="text-xs text-[#3D5270]">
            Inventory {cycle.inventoryDays}d · creditors {cycle.creditorDays}d
          </p>
        </article>
        <article className="rounded-xl border border-[#DBEAFE] bg-white p-4">
          <h2 className="text-sm font-semibold">Clients runway</h2>
          <p className="mt-2 text-sm">Cash Critical</p>
          <p className="text-sm">{runway}</p>
        </article>
      </section>

      <section className="mt-4 rounded-xl border border-[#DBEAFE] bg-white p-4">
        <h2 className="text-sm font-semibold">Plan</h2>
        <p className="mt-2 text-sm">Starter</p>
        <p className="text-xs text-[#3D5270]">Up to 5 active clients</p>
        <p className="text-xs text-[#3D5270]">8 of 5 clients</p>
        <p className="mt-2 text-sm font-semibold text-[#9b2c2c]" role="status">
          {over}
        </p>
        <button type="button" className="mt-3 rounded-md bg-[#0B5FFF] px-3 py-2 text-sm font-semibold text-white">
          Upgrade
        </button>
      </section>
    </div>
  );
}
