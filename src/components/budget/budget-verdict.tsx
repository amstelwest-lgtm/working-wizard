/**
 * The first thing on the Budget tab: this period, on or off the plan.
 */

import type { ReactNode } from "react";
import { ReviewSignoffButton } from "@/components/review-signoff";
import { SignoffStatusChip } from "@/components/signoff-status-chip";
import { fmtBudgetMoney } from "@/lib/budget.compute";
import {
  budgetSeededFromStatement,
  showBudgetSourceChip,
  type BudgetActualsChip,
} from "@/lib/budget.bridges";
import { formatVariancePct, varianceLine } from "@/lib/budget.variance";
import type { ResolvedMarket } from "@/lib/market";
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";

function signedMoney(n: number, market: ResolvedMarket): string {
  if (Math.abs(n) < 1) return fmtBudgetMoney(0, market);
  const body = fmtBudgetMoney(n, market);
  if (n > 0) return `+${body}`;
  return body;
}

function Delta({
  budget,
  actual,
  higherIsBetter,
  market,
}: {
  budget: number;
  actual: number;
  higherIsBetter: boolean;
  market: ResolvedMarket;
}) {
  const line = varianceLine("revenue", "", budget, actual, higherIsBetter);
  const pct = line.deltaPct != null && Math.abs(line.delta) < 1 ? 0 : line.deltaPct;
  const tone =
    line.signal === "adverse"
      ? "text-red-600"
      : line.signal === "favourable"
        ? "text-emerald-700"
        : "text-slate-500";
  return (
    <span className={`font-semibold tabular-nums ${tone}`}>
      {signedMoney(line.delta, market)}, {formatVariancePct(pct)}
    </span>
  );
}

export function BudgetVerdictStrip({
  periodLabel,
  revenueBudget,
  revenueActual,
  profitBudget,
  profitActual,
  chip,
  market,
  clientId,
  clientName,
  signoff = null,
  isStale = false,
  canSign = false,
  onSignoffChange,
  extraActions = null,
  signoffKnown = true,
}: {
  periodLabel: string;
  revenueBudget: number;
  revenueActual: number | null;
  profitBudget: number;
  profitActual: number | null;
  chip: BudgetActualsChip;
  market: ResolvedMarket;
  clientId?: string;
  clientName?: string;
  signoff?: ClientReviewSignoff | null;
  isStale?: boolean;
  canSign?: boolean;
  onSignoffChange?: (next: ClientReviewSignoff | null) => void;
  /** False until the sign-off row has loaded. */
  signoffKnown?: boolean;
  extraActions?: ReactNode;
}) {
  const money = (n: number) => fmtBudgetMoney(n, market);
  const hasActuals = revenueActual != null && chip !== "None";
  const seeded = budgetSeededFromStatement({
    chip,
    revenue: revenueActual ?? 0,
    budgetRevenue: revenueBudget,
    ebit: profitActual ?? undefined,
    budgetEbit: profitBudget,
  });
  return (
    <section
      className="answer-strip rounded-2xl border border-[#d4a550]/40 bg-[#fffdf8] px-4 py-3.5 dark:border-slate-700 dark:bg-slate-950"
      data-answer-strip
      data-budget-verdict
    >
      <div className="answer-strip__lead">
      <p className="text-[11px] font-semibold leading-snug tracking-wide text-[#b8860b] text-pretty">
        {periodLabel}
      </p>
      <p className="answer-strip__sentence mt-1 text-[#1b1608] dark:text-slate-100">
        {seeded ? (
          "Budget seeded from these figures — variance starts with the first uploaded month"
        ) : (
          <span className="flex flex-col gap-1 sm:block">
            <span>
              <span className="font-semibold">Revenue</span>{" "}
              {hasActuals ? (
                <>
                  {money(revenueActual!)} vs budget {money(revenueBudget)} (
                  <Delta
                    budget={revenueBudget}
                    actual={revenueActual!}
                    higherIsBetter
                    market={market}
                  />
                  )
                </>
              ) : (
                <span className="tabular-nums">{money(revenueBudget)}</span>
              )}
            </span>
            <span className="hidden text-slate-400 sm:inline"> · </span>
            <span>
              <span className="font-semibold">Profit</span>{" "}
              {hasActuals && profitActual != null ? (
                <>
                  {money(profitActual)} vs budget {money(profitBudget)} (
                  <Delta
                    budget={profitBudget}
                    actual={profitActual}
                    higherIsBetter
                    market={market}
                  />
                  )
                </>
              ) : (
                <span className="tabular-nums">{money(profitBudget)}</span>
              )}
            </span>
          </span>
        )}
      </p>
      </div>
      <div className="answer-strip__actions">
        {canSign && clientId && onSignoffChange ? (
          <ReviewSignoffButton
            hideStatus
            clientId={clientId}
            clientName={clientName}
            scope="budget"
            signoff={signoff}
            isStale={isStale}
            onChange={onSignoffChange}
          />
        ) : null}
        {extraActions}
      </div>
      <div className="answer-strip__meta">
        {showBudgetSourceChip(chip) ? (
          <span data-source-chip className="answer-strip__chip">
            {chip}
          </span>
        ) : null}
        <SignoffStatusChip
          clientId={clientId}
          scope="budget"
          signoff={signoff}
          isStale={isStale}
          known={signoffKnown}
        />
      </div>
    </section>
  );
}
