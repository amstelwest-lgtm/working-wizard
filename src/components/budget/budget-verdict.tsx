/**
 * The first thing on the Budget tab: this period, on or off the plan.
 */

import type { ReactNode } from "react";
import { OwnerSignoffMark } from "@/components/owner-signoff-mark";
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

/** Keep a currency amount on one line. Grouping spaces must not become wrap points. */
function stickyMoney(n: number, market: ResolvedMarket): string {
  return fmtBudgetMoney(n, market).replace(/ /g, "\u00A0");
}

function signedMoney(n: number, market: ResolvedMarket): string {
  if (Math.abs(n) < 1) return stickyMoney(0, market);
  const body = stickyMoney(n, market);
  if (n > 0) return `+${body}`;
  return body;
}

/** A zero or missing plan is not a variance. The cell says so instead. */
export function budgetFigureMissing(budget: number): boolean {
  return !Number.isFinite(budget) || Math.abs(budget) < 1;
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
  presentation = "strip",
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
  /** Owner Budget is a slim stat row. The accountant strip stays. */
  presentation?: "owner" | "strip";
}) {
  const money = (n: number) => stickyMoney(n, market);
  const hasActuals = revenueActual != null && chip !== "None";
  const seeded = budgetSeededFromStatement({
    chip,
    revenue: revenueActual ?? 0,
    budgetRevenue: revenueBudget,
    ebit: profitActual ?? undefined,
    budgetEbit: profitBudget,
  });
  if (presentation === "owner") {
    return (
      <section
        className="grid w-full grid-cols-2 items-start gap-x-4 gap-y-3 border-b border-[#DBEAFE] pb-3 tabular-nums sm:grid-cols-4"
        data-answer-strip
        data-budget-verdict
        data-owner-budget-summary
      >
        <OwnerBudgetStat label="Period" value={periodLabel} />
        <OwnerBudgetCompare
          label="Revenue vs budget"
          budget={revenueBudget}
          actual={hasActuals ? revenueActual : null}
          higherIsBetter
          market={market}
          money={money}
        />
        <OwnerBudgetCompare
          label="Profit vs budget"
          budget={profitBudget}
          actual={hasActuals && profitActual != null ? profitActual : null}
          higherIsBetter
          market={market}
          money={money}
        />
        <div className="flex min-w-0 items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#3D5270]">
              Status
            </p>
            <OwnerSignoffMark signoff={signoff} isStale={isStale} align="start" className="mt-1" />
            {showBudgetSourceChip(chip) ? (
              <p className="mt-1 text-[12px] leading-snug text-[#3D5270]">{chip}</p>
            ) : null}
          </div>
          {extraActions}
        </div>
      </section>
    );
  }
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
                  <span className="whitespace-nowrap tabular-nums">{money(revenueActual!)}</span>
                  {" vs budget "}
                  <span className="whitespace-nowrap tabular-nums">{money(revenueBudget)}</span>{" "}
                  <span className="whitespace-nowrap">
                    (
                    <Delta
                      budget={revenueBudget}
                      actual={revenueActual!}
                      higherIsBetter
                      market={market}
                    />
                    )
                  </span>
                </>
              ) : (
                <span className="whitespace-nowrap tabular-nums">{money(revenueBudget)}</span>
              )}
            </span>
            <span className="hidden text-slate-400 sm:inline"> · </span>
            <span>
              <span className="font-semibold">Profit</span>{" "}
              {hasActuals && profitActual != null ? (
                <>
                  <span className="whitespace-nowrap tabular-nums">{money(profitActual)}</span>
                  {" vs budget "}
                  <span className="whitespace-nowrap tabular-nums">{money(profitBudget)}</span>{" "}
                  <span className="whitespace-nowrap">
                    (
                    <Delta
                      budget={profitBudget}
                      actual={profitActual}
                      higherIsBetter
                      market={market}
                    />
                    )
                  </span>
                </>
              ) : (
                <span className="whitespace-nowrap tabular-nums">{money(profitBudget)}</span>
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
          hideDraft={Math.abs(revenueBudget) >= 1 || Math.abs(profitBudget) >= 1}
        />
      </div>
    </section>
  );
}

function OwnerBudgetStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#3D5270]">{label}</p>
      <p className="mt-1 text-[13px] font-medium leading-snug text-[#102A43]">{value}</p>
    </div>
  );
}

function OwnerBudgetCompare({
  label,
  budget,
  actual,
  higherIsBetter,
  market,
  money,
}: {
  label: string;
  budget: number;
  actual: number | null;
  higherIsBetter: boolean;
  market: ResolvedMarket;
  money: (n: number) => string;
}) {
  const missing = budgetFigureMissing(budget);
  return (
    <div className="min-w-0" data-budget-missing={missing ? "true" : "false"}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-[#3D5270]">{label}</p>
      {missing ? (
        <p className="mt-1 text-[13px] font-medium text-[#102A43]">No budget yet</p>
      ) : actual == null ? (
        <p className="mt-1 whitespace-nowrap text-[13px] font-semibold tabular-nums text-[#102A43]">
          {money(budget)}
        </p>
      ) : (
        <p className="mt-1 text-[13px] font-semibold leading-snug text-[#102A43]">
          <span className="whitespace-nowrap tabular-nums">{money(actual)}</span>
          {" vs "}
          <span className="whitespace-nowrap tabular-nums">{money(budget)}</span>{" "}
          <span className="whitespace-nowrap">
            (
            <Delta budget={budget} actual={actual} higherIsBetter={higherIsBetter} market={market} />
            )
          </span>
        </p>
      )}
    </div>
  );
}
