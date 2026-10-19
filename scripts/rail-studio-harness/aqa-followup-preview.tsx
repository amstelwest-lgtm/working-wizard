/**
 * Fixture proof of the AQA follow-up rules. Not a client file.
 */
import { FinancialManagerBrief } from "@/components/financial-manager-brief";
import { OwnerNeedsStrip } from "@/components/owner-door/owner-home";
import { healthMeta } from "@/components/action-plan";
import { deriveActionHealth } from "@/lib/action-item-health";
import { clientListRunwayHeadline } from "@/lib/cash-forecast-parity";
import { buildFinancialManagerBrief } from "@/lib/financial-manager-brief";
import { formatMoney } from "@/lib/market/format";
import { ZA_MARKET } from "@/lib/market";
import { homeActionNeeds, openActionSentence, type OwnerNeedsView } from "@/lib/owner-needs";
import { statementGrossMarginFraction } from "@/lib/period-profit";
import { trendColumnVisible } from "@/lib/portfolio-dashboard";
import { formatQuotedDays } from "@/lib/ratios";

const titles = ["Collect the deposit", "File the VAT return"];
const plan = homeActionNeeds({ known: true, titles, overdue: 1 });
const sentence = openActionSentence(titles);
const needs: OwnerNeedsView = {
  actionsHeading: plan.heading,
  actionLines: plan.lines,
  draftsHeading: "Drafts",
  draftLines: ["No draft waiting."],
  deliverablesHeading: "Reports",
  deliverableLines: ["Nothing ready to send."],
  syncHeading: "Books",
  syncLines: ["No books connected."],
};

const money = (amount: number) => formatMoney(amount, ZA_MARKET);
const brief = buildFinancialManagerBrief({
  clientName: "Fixture Co",
  currentFinancials: { revenue: 100, cogs: -4.6, grossProfit: 60 },
  snapshots: [],
  openActionTitles: titles,
  actionsReady: true,
  draftsReady: true,
  formatMoney: money,
});

const now = new Date("2026-10-15T12:00:00.000Z");
const rows = [
  {
    title: "Collect the deposit",
    progress: 0,
    due: "2026-09-29",
    health: deriveActionHealth(
      { status: "not_started", due_date: "2026-09-29", progress_pct: 0, created_at: "2026-09-01T00:00:00.000Z" },
      now,
    ),
  },
  {
    title: "File the VAT return",
    progress: 0,
    due: "—",
    health: deriveActionHealth(
      { status: "not_started", due_date: null, progress_pct: 0, created_at: "2026-10-01T00:00:00.000Z" },
      now,
    ),
  },
];

const gm = statementGrossMarginFraction({ revenue: 100, cogs: -4.6, grossProfit: 60 });
const underFloor = clientListRunwayHeadline({
  source: "derived",
  opening: 1000,
  closings: Array.from({ length: 13 }, () => -35100),
  floor: 50000,
  totalOutflow: 12000,
  healthOverall: 67,
});
const emptyRunway = clientListRunwayHeadline({
  source: "derived",
  opening: 0,
  closings: Array.from({ length: 13 }, () => 0),
  floor: 50000,
  totalOutflow: 0,
  healthOverall: 67,
});
const showTrend = trendColumnVisible([[], []]);

export function AqaFollowupPreview() {
  return (
    <div className="min-h-screen bg-[#F4F7FB] px-6 py-6 text-[#102A43]">
      <p className="text-xs font-semibold uppercase tracking-widest text-[#3D5270]">
        Fixture proof — not a client file
      </p>
      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <section>
          <p className="mb-2 text-sm" data-open-sentence={sentence ?? ""}>
            Financial Manager: {sentence}
          </p>
          <OwnerNeedsStrip
            needs={needs}
            onMoves={() => undefined}
            onDeliverables={() => undefined}
            onActions={() => undefined}
            onDrafts={() => undefined}
            onBooks={() => undefined}
          />
        </section>
        <FinancialManagerBrief brief={brief} onOpen={() => undefined} />
      </div>
      <table className="mt-6 w-full max-w-3xl text-sm" data-action-health>
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-[#3D5270]">
            <th className="py-2">Action</th>
            <th>Progress</th>
            <th>Due</th>
            <th>Health</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.title} className="border-t border-[#DBEAFE]">
              <td className="py-2">{row.title}</td>
              <td>{row.progress}%</td>
              <td>{row.due}</td>
              <td data-health={row.health}>{healthMeta(row.health).label}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="mt-6 grid max-w-3xl grid-cols-2 gap-2 text-sm">
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#3D5270]">Waterfall gross margin</dt>
          <dd data-gm>{gm == null ? "—" : `${(gm * 100).toFixed(1)}%`}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#3D5270]">Working capital days</dt>
          <dd data-wc>{formatQuotedDays("Working Capital Days", -149)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#3D5270]">Creditor days</dt>
          <dd>{formatQuotedDays("Creditor Days", -248)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#3D5270]">Inventory days</dt>
          <dd>{formatQuotedDays("Inventory Days", -93)}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#3D5270]">Scored forecast runway</dt>
          <dd data-runway-real>{underFloor}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#3D5270]">Empty forecast runway</dt>
          <dd data-runway-empty>{emptyRunway}</dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-[#3D5270]">Trend column</dt>
          <dd data-trend={showTrend ? "shown" : "hidden"}>{showTrend ? "Shown" : "Hidden — no two scores on file"}</dd>
        </div>
      </dl>
    </div>
  );
}
