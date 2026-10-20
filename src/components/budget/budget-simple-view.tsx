/**
 * Founder-facing Simple budget — one month at a time, volume × price,
 * visible COGS + overhead, year strip, FY totals. No spreadsheet noise.
 */

import { useMemo, useState, type ReactNode } from "react";
import { BarChart3, ChevronLeft, ChevronRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CollapsibleGoldCard } from "@/components/primitives/collapsible-gold-card";
import type { BudgetActuals, BudgetDocument, BudgetTemplateId } from "@/lib/budget.types";
import { budgetPriceLabel, budgetVolumeLabel, hotelDriversOnFile, hotelTemplateRows } from "@/lib/budget-industry";
import { BUDGET_TEMPLATES } from "@/lib/budget.templates";
import {
  plainBudgetWindowHeading,
  currentBudgetMonth,
  fyMonths,
  formatBudgetMonthYear,
} from "@/lib/budget.months";
import { BudgetPdfExportButton } from "@/components/budget/budget-pdf-export";
import { BudgetChartTable } from "@/components/budget/budget-chart-table";
import { BudgetVerdictStrip } from "@/components/budget/budget-verdict";
import { BudgetYearStrip } from "@/components/budget/budget-year-strip";
import {
  hasPriorYearFigures,
  ownerBudgetHowBuilt,
  ownerYearFromStatement,
  type BudgetYearMoney,
} from "@/lib/budget-year-compare";
import type { BudgetActualMonth, BudgetLens } from "@/lib/budget-chart-table";
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import { computeBudgetMonths, fmtBudgetMoney, lowestCashTrough } from "@/lib/budget.compute";
import { budgetRentHint, type ForecastRent } from "@/lib/budget-forecast-rent";
import { ownerMinus } from "@/lib/owner-money";
import {
  BUDGET_OPENING_MISSING_LINE,
  budgetComparisonNote,
  budgetDaysNeedReview,
  budgetDaysSourceLabel,
  budgetOpeningSourceLabel,
} from "@/lib/budget.bridges";
import { currencySymbol, formatMoney, localizeCopy, type ResolvedMarket } from "@/lib/market";
import { useMarket } from "@/contexts/market";

function monthOverheadTotal(doc: BudgetDocument, month: string): number {
  const sum = doc.overheads.reduce((s, oh) => s + (oh.months[month] || 0), 0);
  return Math.round(sum * 100) / 100;
}

export function MoneyField({
  value,
  onChange,
  label,
  market,
  className,
}: {
  value: number;
  onChange: (next: number) => void;
  label: string;
  market: ResolvedMarket;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown =
    draft ?? formatMoney(value, market);
  return (
    <Input
      type="text"
      inputMode="decimal"
      aria-label={label}
      className={className}
      value={shown}
      onFocus={() => setDraft((Math.round(value * 100) / 100).toFixed(2))}
      onBlur={() => setDraft(null)}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parseFloat(e.target.value.replace(/[^0-9.-]/g, ""));
        if (Number.isFinite(n)) onChange(Math.round(n * 100) / 100);
      }}
    />
  );
}

/** Put a single overhead lump into the first bucket; clear others for that month. */
function setMonthOverheadLump(
  doc: BudgetDocument,
  month: string,
  amount: number,
  allMonths?: string[],
): BudgetDocument {
  const targets = allMonths ?? [month];
  return {
    ...doc,
    overheads: doc.overheads.map((oh, idx) => ({
      ...oh,
      months: {
        ...oh.months,
        ...Object.fromEntries(targets.map((m) => [m, idx === 0 ? amount : 0])),
      },
    })),
    updatedAt: new Date().toISOString(),
  };
}

export function BudgetSimpleView({
  doc,
  onChange,
  actuals,
  role = "owner",
  clientId,
  clientName,
  signoff = null,
  isStale = false,
  canSign = false,
  onSignoffChange,
  signoffKnown = true,
  drawer = null,
  lens,
  onLensChange,
  actualMonths,
  readOnly = false,
  priorYear = null,
  priorYearLabel = null,
  priorYearMonths = null,
  displayTemplateId = null,
  statementAligned = false,
  forecastRent = null,
  onBuild,
  openingBalanceMissing = false,
  periodCaption = null,
  uniformNote = null,
}: {
  doc: BudgetDocument;
  onChange: (next: BudgetDocument) => void;
  actuals?: BudgetActuals | null;
  role?: "owner" | "accountant";
  clientId?: string;
  clientName?: string;
  signoff?: ClientReviewSignoff | null;
  isStale?: boolean;
  canSign?: boolean;
  onSignoffChange?: (next: ClientReviewSignoff | null) => void;
  signoffKnown?: boolean;
  drawer?: ReactNode;
  lens?: BudgetLens;
  onLensChange?: (next: BudgetLens) => void;
  actualMonths?: readonly BudgetActualMonth[];
  readOnly?: boolean;
  /** Prior-period books. The owner strip stays empty when this is missing. */
  priorYear?: BudgetYearMoney | null;
  priorYearLabel?: string | null;
  /** Months the prior books cover. A different length is not a percent change. */
  priorYearMonths?: number | null;
  /** Industry template when it disagrees with the stored labour kit. */
  displayTemplateId?: BudgetTemplateId | null;
  /** Statement has operating expenses and no rent line. */
  statementAligned?: boolean;
  forecastRent?: ForecastRent | null;
  onBuild?: () => void;
  /** Forecast opening is blank and this plan did not type a start balance. */
  openingBalanceMissing?: boolean;
  periodCaption?: string | null;
  uniformNote?: string | null;
}) {
  const { market } = useMarket();
  const money = (n: number) => {
    const text = fmtBudgetMoney(n, market);
    return role === "owner" ? ownerMinus(text) : text;
  };
  const symbol = currencySymbol(market);
  const monthLabel = (ym: string) => formatBudgetMonthYear(ym, market);
  const months = useMemo(() => fyMonths(doc.fyStart), [doc.fyStart]);
  const [focusMonth, setFocusMonth] = useState(() => currentBudgetMonth(months));
  const [sameEveryMonth, setSameEveryMonth] = useState(false);

  const results = useMemo(() => computeBudgetMonths(doc, doc.activeScenario), [doc]);
  const focus = results.find((r) => r.month === focusMonth) ?? results[0];
  const trough = useMemo(() => lowestCashTrough(results), [results]);
  const tpl = BUDGET_TEMPLATES[doc.templateId];
  const shownTpl = displayTemplateId ? BUDGET_TEMPLATES[displayTemplateId] : tpl;
  const line = doc.revenueLines[0];
  const volumeLabel = budgetVolumeLabel(doc.templateId, shownTpl.id, line?.volumeLabel);
  const priceLabel = budgetPriceLabel(doc.templateId, shownTpl.id, line?.priceLabel);
  const hotelRows = hotelTemplateRows(shownTpl.id);
  const hotelRevenueRows = hotelRows?.filter((row) => row.section === "revenue") ?? null;
  const hotelCostRows = hotelRows?.filter((row) => row.section === "cost") ?? null;
  const driversOnFile = hotelDriversOnFile(doc.templateId, shownTpl.id, line);
  const showDriverDash = !driversOnFile && (readOnly || doc.templateId !== "hospitality_rooms");
  const cell = line?.months[focusMonth] ?? { volume: 0, price: 0 };
  const focusIdx = months.indexOf(focusMonth);

  const fyTotals = useMemo(() => {
    const revenue = results.reduce((s, r) => s + r.revenue, 0);
    const cogs = results.reduce((s, r) => s + r.cogs, 0);
    const overheads = results.reduce((s, r) => s + r.overheads, 0);
    const grossProfit = revenue - cogs;
    const netCash = results.reduce((s, r) => s + r.netCash, 0);
    const closingEnd = results.length ? results[results.length - 1].closingCash : 0;
    return { revenue, cogs, overheads, grossProfit, netCash, closingEnd };
  }, [results]);

  const applySameMonths = (nextDoc: BudgetDocument, month: string) => {
    if (!sameEveryMonth || !nextDoc.revenueLines[0]) return nextDoc;
    const src = nextDoc.revenueLines[0].months[month] ?? { volume: 0, price: 0 };
    const oh = monthOverheadTotal(nextDoc, month);
    let d: BudgetDocument = {
      ...nextDoc,
      revenueLines: nextDoc.revenueLines.map((l, i) =>
        i !== 0
          ? l
          : {
              ...l,
              months: Object.fromEntries(months.map((m) => [m, { ...src }])),
            },
      ),
    };
    d = setMonthOverheadLump(d, month, oh, months);
    return d;
  };

  const patchFocus = (patch: Partial<{ volume: number; price: number }>) => {
    if (!line) return;
    const nextCell = { ...cell, ...patch };
    let next: BudgetDocument = {
      ...doc,
      revenueLines: doc.revenueLines.map((l, i) =>
        i !== 0
          ? l
          : {
              ...l,
              months: { ...l.months, [focusMonth]: nextCell },
            },
      ),
      updatedAt: new Date().toISOString(),
    };
    next = applySameMonths(next, focusMonth);
    onChange(next);
  };

  const setGp = (gpPct: number) => {
    let next: BudgetDocument = {
      ...doc,
      gpPct,
      cogsMode: "gp_pct",
      updatedAt: new Date().toISOString(),
    };
    next = applySameMonths(next, focusMonth);
    onChange(next);
  };

  const setOverhead = (amount: number) => {
    let next = setMonthOverheadLump(doc, focusMonth, amount);
    next = applySameMonths(next, focusMonth);
    onChange(next);
  };

  const maxRev = Math.max(1, ...results.map((r) => r.revenue));

  const compared = actuals && actuals.chip && actuals.chip !== "None" ? actuals : null;
  const thisYear = useMemo(() => ownerYearFromStatement(compared), [compared]);
  const priorOnFile = hasPriorYearFigures(priorYear);
  return (
    <div id="wizard-budget-plan" className="space-y-5">
      <BudgetVerdictStrip
        periodLabel={compared ? compared.label : monthLabel(focusMonth)}
        revenueBudget={compared?.budgetRevenue ?? focus?.revenue ?? 0}
        revenueActual={compared ? compared.revenue : null}
        profitBudget={compared?.budgetEbit ?? focus?.ebit ?? 0}
        profitActual={compared ? (compared.ebit ?? null) : null}
        chip={compared?.chip ?? "None"}
        market={market}
        clientId={clientId}
        clientName={clientName}
        signoff={signoff}
        isStale={isStale}
        canSign={canSign}
        onSignoffChange={onSignoffChange}
        signoffKnown={signoffKnown}
        onBuild={onBuild}
        presentation={role === "owner" ? "owner" : "strip"}
        comparisonNote={budgetComparisonNote(compared)}
        extraActions={
          <BudgetPdfExportButton
            quiet
            doc={doc}
            clientId={clientId}
            clientName={clientName}
            signoff={signoff}
            isStale={isStale}
            displayTemplateId={displayTemplateId}
          />
        }
      />
      <BudgetChartTable
        doc={doc}
        clientId={clientId}
        lens={lens}
        onLensChange={onLensChange}
        actualMonths={actualMonths}
        statementActuals={compared}
        windowMonths={compared?.windowMonths}
        readOnly={readOnly}
        signed={role === "owner"}
        displayTemplateId={displayTemplateId}
        periodCaption={periodCaption}
        uniformNote={uniformNote}
      />
      {readOnly ? null : <>{drawer}</>}
      <BudgetYearStrip
        thisYear={thisYear}
        thisMonths={compared?.periodMonths ?? null}
        lastYear={priorYear}
        lastMonths={priorYearMonths}
        lastYearLabel={priorYearLabel}
        market={market}
        signed={role === "owner"}
      />
      {readOnly ? null : (
      <p className="text-sm font-semibold text-[#102A43] dark:text-slate-100">
        {plainBudgetWindowHeading(shownTpl.label, doc, market)}
      </p>
      )}

      <OwnerHowBuilt
        readOnly={readOnly}
        priorOnFile={priorOnFile}
        summary={
          hotelRevenueRows ? (
            <ul data-hotel-template="" data-hotel-section="revenue" className="mt-3 space-y-1 text-[13px] text-[#3D5270]">
              {hotelRevenueRows.map((row) => (
                <li key={row.name}>
                  <span className="font-semibold text-[#102A43] dark:text-slate-100">{row.name}</span>
                  {" · "}
                  {row.detail}
                  {" · "}
                  {row.value}
                </li>
              ))}
            </ul>
          ) : null
        }
      >
      {/* Month engine — volume × price, then margin and overheads */}
      <section
        id="wizard-budget-month-engine"
        className="budget-month-engine relative overflow-hidden rounded-2xl border border-[#DBEAFE] bg-gradient-to-b from-white to-white p-5 shadow-[0_18px_40px_rgba(16,42,67,0.06)] dark:from-slate-950 dark:to-slate-950 dark:border-slate-800 sm:p-6"
      >
        <div className="pointer-events-none absolute inset-y-5 left-0 w-0.5 rounded-full bg-gradient-to-b from-[#2563EB] via-[#0B5FFF] to-[#38BDF8]" />
        <div className="flex flex-wrap items-start justify-between gap-3 pl-3 sm:pl-4">
          <div className="min-w-0 max-w-xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#102A43] dark:text-[#F4F7FB]">
              {role === "accountant" ? "Month engine" : "This month"}
            </p>
            <h3 className="serif mt-1 text-[22px] font-semibold tracking-tight text-[#102A43] dark:text-slate-100">
              How {monthLabel(focusMonth)} is built
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#3D5270] dark:text-slate-400">
              {role === "accountant"
                ? "How many they sell × the price they charge becomes revenue. Gross profit % takes cost of sales. Overheads are the rest. The strip above scores those four numbers."
                : "How many you sell × the price you charge becomes this month’s revenue. Set the margin, then overheads — leftover is what the month keeps."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-full border border-[#DBEAFE] bg-white/80 p-0.5 dark:border-slate-700 dark:bg-slate-900">
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full text-[#102A43] disabled:opacity-30 dark:text-[#F4F7FB]"
                disabled={focusIdx <= 0}
                onClick={() => setFocusMonth(months[Math.max(0, focusIdx - 1)])}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="min-w-[7.5rem] px-1 text-center text-[13px] font-semibold tabular-nums text-[#102A43] dark:text-slate-100">
                {monthLabel(focusMonth)}
              </div>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full text-[#102A43] disabled:opacity-30 dark:text-[#F4F7FB]"
                disabled={focusIdx >= months.length - 1}
                onClick={() => setFocusMonth(months[Math.min(months.length - 1, focusIdx + 1)])}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            {readOnly ? null : (
            <button
              type="button"
              onClick={() => {
                const on = !sameEveryMonth;
                setSameEveryMonth(on);
                if (on) onChange(applySameMonths(doc, focusMonth));
              }}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                sameEveryMonth
                  ? "border-[#0B5FFF] bg-[#0B5FFF] text-white"
                  : "border-[#DBEAFE] bg-transparent text-[#102A43] hover:border-[#0B5FFF] dark:text-[#F4F7FB]"
              }`}
            >
              {sameEveryMonth ? "Same every month · on" : "Same every month"}
            </button>
            )}
          </div>
        </div>

        <div className="mt-5 grid items-stretch gap-3 pl-3 sm:pl-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <DriverPad
            kicker="How many"
            label={localizeCopy(volumeLabel, market)}
            hint={hotelRevenueRows ? "Rooms" : line?.name ? `${line.name}` : "Units they move this month"}
          >
            {showDriverDash ? (
              <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--ink)]" data-hotel-driver="missing">—</p>
            ) : readOnly ? (
              <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--ink)]">{cell.volume}</p>
            ) : (
            <Input
              type="number"
              inputMode="decimal"
              aria-label={localizeCopy(volumeLabel, market)}
              className="budget-driver-input mt-2 h-12 border-0 bg-transparent px-0 text-2xl font-semibold tabular-nums shadow-none focus-visible:ring-0"
              value={cell.volume}
              onChange={(e) => patchFocus({ volume: parseFloat(e.target.value) || 0 })}
            />
            )}
          </DriverPad>
          <EquationOp symbol="×" label="times" />
          <DriverPad
            kicker="At what price"
            label={localizeCopy(priceLabel, market)}
            hint={`Per unit, ${symbol}`}
          >
            {showDriverDash ? (
              <p className="mt-2 text-2xl font-semibold tabular-nums text-[var(--ink)]" data-hotel-driver="missing">—</p>
            ) : (
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-lg font-medium text-[#102A43] dark:text-[#F4F7FB]">{symbol}</span>
              {readOnly ? (
                <span className="text-2xl font-semibold tabular-nums text-[var(--ink)]">{cell.price}</span>
              ) : (
              <Input
                type="number"
                inputMode="decimal"
                aria-label={localizeCopy(priceLabel, market)}
                className="budget-driver-input h-12 border-0 bg-transparent px-0 text-2xl font-semibold tabular-nums shadow-none focus-visible:ring-0"
                value={cell.price}
                onChange={(e) => patchFocus({ price: parseFloat(e.target.value) || 0 })}
              />
              )}
            </div>
            )}
          </DriverPad>
          <EquationOp symbol="=" label="equals" />
          <DriverPad
            kicker="This month’s revenue"
            label="Computed"
            hint={showDriverDash ? "From the statement" : "Volume × price — not typed"}
            result
          >
            <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-[#102A43] dark:text-slate-100">
              {money(focus?.revenue ?? 0)}
            </p>
          </DriverPad>
        </div>
        {!readOnly && hotelRevenueRows ? (
          <ul data-hotel-template="" data-hotel-section="revenue" className="mt-4 space-y-1 pl-3 text-[13px] text-[#3D5270] sm:pl-4">
            {hotelRevenueRows.map((row) => (
              <li key={row.name}>
                <span className="font-semibold text-[#102A43] dark:text-slate-100">{row.name}</span>
                {" · "}
                {row.detail}
                {" · "}
                {row.value}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-4 space-y-0 overflow-hidden rounded-xl border border-[#DBEAFE] bg-white/70 pl-3 dark:bg-slate-950/40 sm:pl-4">
          <CascadeRow
            kicker="Keep as gross profit"
            label="Gross profit %"
            hint="Share of revenue left after cost of sales"
          >
            <div className="flex items-center gap-3">
              {readOnly ? (
                <span className="text-lg font-semibold tabular-nums text-[var(--ink)]">{doc.gpPct}</span>
              ) : (
              <Input
                type="number"
                inputMode="decimal"
                aria-label="Gross profit percent"
                className="budget-driver-input h-10 w-20 border-0 bg-transparent px-0 text-right text-lg font-semibold tabular-nums shadow-none focus-visible:ring-0"
                value={doc.gpPct}
                onChange={(e) => setGp(parseFloat(e.target.value) || 0)}
              />
              )}
              <span className="text-sm font-semibold text-[#102A43] dark:text-[#F4F7FB]">%</span>
              <span className="hidden text-[13px] tabular-nums text-[#3D5270] sm:inline dark:text-slate-400">
                → {money(focus?.grossProfit ?? 0)}
              </span>
            </div>
          </CascadeRow>
          <CascadeRow
            kicker="Implied"
            label="Cost of sales"
            hint="The rest of revenue after that margin"
            muted
          >
            <span className="text-[15px] font-semibold tabular-nums text-[#3D5270] dark:text-slate-300">
              {money(focus?.cogs ?? 0)}
            </span>
          </CascadeRow>
          {hotelCostRows && hotelCostRows.length > 0 ? (
            <ul data-hotel-template="" data-hotel-section="cost" className="mb-3 space-y-1 text-[13px] text-[#3D5270]">
              {hotelCostRows.map((row) => (
                <li key={row.name}>
                  <span className="font-semibold text-[#102A43] dark:text-slate-100">{row.name}</span>
                  {" · "}
                  {row.detail}
                  {" · "}
                  {row.value}
                </li>
              ))}
            </ul>
          ) : null}
          <CascadeRow
            kicker="Then pay"
            label="Fixed overheads"
            hint={
              budgetRentHint(doc, forecastRent, money, statementAligned) ??
              "Rent, salaries, keep-the-lights-on this month"
            }
          >
            {readOnly ? (
              <span className="text-lg font-semibold tabular-nums text-[var(--ink)]">
                {money(monthOverheadTotal(doc, focusMonth))}
              </span>
            ) : (
            <MoneyField
              value={monthOverheadTotal(doc, focusMonth)}
              onChange={setOverhead}
              label="Fixed overheads this month"
              market={market}
              className="budget-driver-input h-10 w-36 border-0 bg-transparent px-0 text-right text-lg font-semibold tabular-nums shadow-none focus-visible:ring-0"
            />
            )}
          </CascadeRow>
          <CascadeRow
            kicker="Leftover"
            label="What’s left (EBITDA)"
            hint="After cost of sales and overheads — before interest, tax, cash timing"
            emphasis
          >
            <span className="text-lg font-semibold tabular-nums text-[#102A43] dark:text-slate-100">
              {money(focus?.ebitda ?? 0)}
            </span>
          </CascadeRow>
        </div>
      </section>
      </OwnerHowBuilt>

      {readOnly ? null : (
      <CollapsibleGoldCard
        icon={BarChart3}
        title="Year detail"
        subtitle={
          trough
            ? `Budget-year cash trough ${monthLabel(trough.month)} ${money(trough.closingCash)} · budget year, not the 13-week forecast`
            : "Twelve months, closed until you need the grid"
        }
        defaultOpen={false}
      >
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
          {results.map((r) => {
            const h = Math.max(8, Math.round((r.revenue / maxRev) * 56));
            const active = r.month === focusMonth;
            return (
              <button
                key={r.month}
                type="button"
                onClick={() => setFocusMonth(r.month)}
                className={`flex flex-col items-center gap-1 rounded-lg px-0.5 py-1.5 ${
                  active
                    ? "bg-[#DBEAFE] ring-1 ring-[#0B5FFF]"
                    : "hover:bg-slate-100 dark:hover:bg-slate-900"
                }`}
                title={`${monthLabel(r.month)} · ${money(r.revenue)}`}
              >
                <div className="flex h-14 w-full items-end justify-center">
                  <div
                    className={`w-2/3 max-w-[10px] rounded-sm ${
                      r.closingCash < 0 ? "bg-red-400/80" : "bg-[#38BDF8]"
                    }`}
                    style={{ height: h }}
                  />
                </div>
                <span className="text-[9px] font-medium text-slate-500">
                  {monthLabel(r.month).split(" ")[0]}
                </span>
              </button>
            );
          })}
        </div>

      <section className="mt-4 overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800">
        <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-900/50">
          Full-year totals
        </div>
        <div className="grid grid-cols-2 gap-px bg-slate-100 dark:bg-slate-800 sm:grid-cols-3 lg:grid-cols-6">
          {[
            { l: "Revenue", v: fyTotals.revenue },
            { l: "COGS", v: fyTotals.cogs },
            { l: "Gross profit", v: fyTotals.grossProfit },
            { l: "Overheads", v: fyTotals.overheads },
            { l: "Net cash movement", v: fyTotals.netCash },
            { l: "Closing cash (FY end)", v: fyTotals.closingEnd },
          ].map((t) => (
            <div key={t.l} className="bg-white px-3 py-2.5 dark:bg-slate-950">
              <div className="text-[10px] uppercase tracking-wider text-slate-500">{t.l}</div>
              <div
                className={`mt-0.5 text-sm font-semibold tabular-nums ${
                  t.v < 0 ? "text-red-600" : "text-[#0f172a] dark:text-slate-100"
                }`}
              >
                {money(t.v)}
              </div>
            </div>
          ))}
        </div>
      </section>
      </CollapsibleGoldCard>
      )}

      {readOnly ? null : (
      <section
        id="wizard-budget-cash-timing"
        className="rounded-xl border border-slate-200/80 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/50"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              Opening cash
              {budgetOpeningSourceLabel(doc.openingCashSource) ? (
                <span className="ml-1 font-medium normal-case tracking-normal text-slate-400">
                  · {budgetOpeningSourceLabel(doc.openingCashSource)}
                </span>
              ) : null}
            </Label>
            {openingBalanceMissing ? (
              <p className="mt-1 text-sm font-semibold text-[#102A43] dark:text-slate-100" data-budget-opening-missing="">
                {BUDGET_OPENING_MISSING_LINE}
              </p>
            ) : readOnly ? (
              <p className="mt-1 text-[15px] font-semibold tabular-nums text-[var(--ink)]">
                {money(doc.openingCash ?? 0)}
              </p>
            ) : (
            <MoneyField
              value={doc.openingCash ?? 0}
              label="Opening cash"
              market={market}
              className="mt-1 h-9"
              onChange={(openingCash) =>
                onChange({
                  ...doc,
                  openingCash,
                  openingCashSource: "manual",
                  updatedAt: new Date().toISOString(),
                })
              }
            />
            )}
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
              {role === "accountant"
                ? "Cash in the bank on day one of this financial year. Month-end cash stacks on this number, so closing cash is only as true as this start."
                : "The bank balance at the start of the year. Everything below is added to or taken from this."}
            </p>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              Debtor days
              <span className="ml-1 font-medium normal-case tracking-normal text-slate-400">
                · {budgetDaysSourceLabel(doc.wcDaysSource)}
              </span>
              {budgetDaysNeedReview(doc.wc.debtorDays) ? (
                <span className="ml-1 rounded-full border border-[#B7791F]/40 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-[#8A5A12]">
                  Review
                </span>
              ) : null}
            </Label>
            {readOnly ? (
              <p className="mt-1 text-[15px] font-semibold tabular-nums text-[var(--ink)]">{doc.wc.debtorDays}</p>
            ) : (
            <Input
              type="number"
              className="mt-1 h-9"
              value={doc.wc.debtorDays}
              onChange={(e) =>
                onChange({
                  ...doc,
                  wc: { ...doc.wc, debtorDays: parseFloat(e.target.value) || 0 },
                  wcDaysSource: "manual",
                  updatedAt: new Date().toISOString(),
                })
              }
            />
            )}
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
              {role === "accountant"
                ? "How many days customers typically take to pay. Longer days delay cash even when the month’s profit looks fine — this is what creates a cash trough."
                : "How long customers take to pay you. Longer = cash arrives later than the sale."}
            </p>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              Creditor days
              <span className="ml-1 font-medium normal-case tracking-normal text-slate-400">
                · {budgetDaysSourceLabel(doc.wcDaysSource)}
              </span>
              {budgetDaysNeedReview(doc.wc.creditorDays) ? (
                <span className="ml-1 rounded-full border border-[#B7791F]/40 px-1.5 py-0.5 text-[9px] font-semibold tracking-wider text-[#8A5A12]">
                  Review
                </span>
              ) : null}
            </Label>
            {readOnly ? (
              <p className="mt-1 text-[15px] font-semibold tabular-nums text-[var(--ink)]">{doc.wc.creditorDays}</p>
            ) : (
            <Input
              type="number"
              className="mt-1 h-9"
              value={doc.wc.creditorDays}
              onChange={(e) =>
                onChange({
                  ...doc,
                  wc: { ...doc.wc, creditorDays: parseFloat(e.target.value) || 0 },
                  wcDaysSource: "manual",
                  updatedAt: new Date().toISOString(),
                })
              }
            />
            )}
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
              {role === "accountant"
                ? "How many days this business typically takes to pay suppliers. Longer days hold cash in; shorter days pull it out sooner."
                : "How long you take to pay suppliers. Longer = cash stays in the business a bit longer."}
            </p>
          </div>
        </div>
      </section>
      )}
    </div>
  );
}

function OwnerHowBuilt({
  readOnly,
  priorOnFile,
  children,
  summary = null,
}: {
  readOnly: boolean;
  priorOnFile: boolean;
  children: ReactNode;
  summary?: ReactNode;
}) {
  if (!readOnly) return children;
  return (
    <section data-budget-how="short" className="space-y-2">
      <h3 className="text-base font-semibold text-[#102A43] dark:text-slate-100">How the budget is built</h3>
      <p className="max-w-xl text-sm leading-relaxed text-[#3D5270] dark:text-slate-300" data-budget-how-built>
        {ownerBudgetHowBuilt(priorOnFile)}
      </p>
      {summary}
      <details>
        <summary className="w-fit cursor-pointer text-sm font-semibold text-[#0B5FFF]">
          More
        </summary>
        <div className="mt-3">{children}</div>
      </details>
    </section>
  );
}

function DriverPad({
  kicker,
  label,
  hint,
  result,
  children,
}: {
  kicker: string;
  label: string;
  hint: string;
  result?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`rounded-xl border px-4 py-3.5 ${
        result
          ? "border-[#DBEAFE] bg-[linear-gradient(160deg,rgba(219,234,254,0.9),rgba(255,255,255,0.95))] dark:bg-slate-900"
          : "border-[#DBEAFE] bg-white dark:border-slate-700 dark:bg-slate-900"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#102A43] dark:text-[#F4F7FB]">{kicker}</p>
      <p className="mt-0.5 text-[13px] font-semibold text-[#102A43] dark:text-slate-100">{label}</p>
      <p className="text-[11px] text-[#3D5270] dark:text-slate-500">{hint}</p>
      {children}
    </div>
  );
}

function EquationOp({ symbol, label }: { symbol: string; label: string }) {
  return (
    <div
      className="flex items-center justify-center self-center text-xl font-semibold text-[#102A43] dark:text-[#F4F7FB]"
      aria-label={label}
    >
      {symbol}
    </div>
  );
}

function CascadeRow({
  kicker,
  label,
  hint,
  muted,
  emphasis,
  children,
}: {
  kicker: string;
  label: string;
  hint: string;
  muted?: boolean;
  emphasis?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 border-b border-[#DBEAFE] py-3 last:border-b-0 ${
        emphasis ? "bg-[rgba(219,234,254,0.65)] pr-3" : ""
      } ${muted ? "opacity-90" : ""}`}
    >
      <div className="min-w-[12rem] pr-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#102A43] dark:text-[#F4F7FB]">{kicker}</p>
        <p
          className={`text-[13.5px] font-semibold ${
            muted ? "text-[#3D5270] dark:text-slate-400" : "text-[#102A43] dark:text-slate-100"
          }`}
        >
          {label}
        </p>
        <p className="max-w-md text-[11px] leading-snug text-[#3D5270] dark:text-slate-500">{hint}</p>
      </div>
      <div className="ml-auto">{children}</div>
    </div>
  );
}
