/**
 * Budget workspace — drivers, monthly P&L, cash, scenarios, actuals compare.
 */

import { cloneElement, isValidElement, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  BudgetActuals,
  BudgetDocument,
  BudgetScenarioId,
  BudgetTemplateId,
  UnmappedDriver,
} from "@/lib/budget.types";
import { budgetRentHint, type ForecastRent } from "@/lib/budget-forecast-rent";
import { budgetPriceLabel, budgetVolumeLabel, hotelDriversOnFile, hotelLineDisplayName, hotelTemplateRows } from "@/lib/budget-industry";
import { BUDGET_TEMPLATES, newId } from "@/lib/budget.templates";
import { currentBudgetMonth, fyMonths, formatBudgetMonthYear, plainBudgetWindowHeading } from "@/lib/budget.months";
import { computeBudgetMonths, fmtBudgetMoney, lowestCashTrough } from "@/lib/budget.compute";
import {
  BUDGET_OPENING_MISSING_LINE,
  budgetComparisonNote,
  budgetDaysNeedReview,
  budgetDaysSourceLabel,
  budgetOpeningSourceLabel,
} from "@/lib/budget.bridges";
import { useMarket } from "@/contexts/market";
import { SALES_TAX_HONESTY, formatPercentRate, localizeCopy, resolveMarket, t } from "@/lib/market";
import { keepUnmappedAsExtraLine, reassignUnmappedDriver } from "@/lib/budget.model-change";
import { BudgetChartTable } from "@/components/budget/budget-chart-table";
import { BudgetSimpleView, MoneyField } from "@/components/budget/budget-simple-view";
import { BudgetVariancePanel } from "@/components/budget/budget-variance-panel";
import type { BudgetActualMonth, BudgetLens } from "@/lib/budget-chart-table";
import type { BudgetPagedView } from "@/lib/budget-paged-view";
import type { BudgetYearMoney } from "@/lib/budget-year-compare";
import { BudgetPdfExportButton } from "@/components/budget/budget-pdf-export";
import { ReviewInputsDrawer } from "@/components/review-inputs-drawer";
import { BudgetVerdictStrip } from "@/components/budget/budget-verdict";
import { budgetHeadlineFigures } from "@/lib/budget-period";
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import { ScrollableTable } from "@/components/primitives/scrollable-table";
import {
  COLLAPSIBLE_GOLD_RULE,
  COLLAPSIBLE_GOLD_SHELL,
} from "@/components/primitives/collapsible-gold-card";

const SCENARIOS: BudgetScenarioId[] = ["base", "upside", "downside"];

function nestInDrawer(drawer: ReactNode, hint: string, extras: ReactNode): ReactNode {
  if (!isValidElement(drawer)) return drawer;
  const element = drawer as ReactElement<{ children?: ReactNode; hint?: string }>;
  if (element.type !== ReviewInputsDrawer) return drawer;
  return cloneElement(
    element,
    { hint },
    <>
      {extras}
      {element.props.children}
    </>,
  );
}

export function BudgetWorkspace({
  doc,
  onChange,
  simplified,
  actuals,
  unmappedReview,
  onClearUnmapped,
  onChangeModel,
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
  layout = "stacked",
  pagedView,
  onPagedViewChange,
}: {
  doc: BudgetDocument;
  onChange: (next: BudgetDocument) => void;
  simplified?: boolean;
  actuals?: BudgetActuals | null;
  unmappedReview?: UnmappedDriver[] | null;
  onClearUnmapped?: () => void;
  onChangeModel?: () => void;
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
  /** View the figures. Editing controls stay in the file for the accountant. */
  readOnly?: boolean;
  priorYear?: BudgetYearMoney | null;
  priorYearLabel?: string | null;
  priorYearMonths?: number | null;
  displayTemplateId?: BudgetTemplateId | null;
  /** Untouched template shown from the statement. Rent stays unstated. */
  statementAligned?: boolean;
  /** Rent already in the 13-week forecast. Blank premises follows it. */
  forecastRent?: ForecastRent | null;
  onBuild?: () => void;
  /** Forecast opening is blank and this plan did not type a start balance. */
  openingBalanceMissing?: boolean;
  periodCaption?: string | null;
  uniformNote?: string | null;
  /** Accountant client budget. Owner and try stay stacked. */
  layout?: "stacked" | "paged";
  pagedView?: BudgetPagedView;
  onPagedViewChange?: (view: BudgetPagedView) => void;
}) {
  const variance = (
    <BudgetVariancePanel
      clientId={clientId}
      doc={doc}
      role={role}
      statementPace={Boolean(actuals && (actuals.revenue || actuals.cogs || actuals.fixedCosts))}
      comparisonNote={budgetComparisonNote(actuals)}
    />
  );

  if (simplified || readOnly) {
    return (
      <div className="space-y-4">
        <BudgetSimpleView
          doc={doc}
          onChange={onChange}
          actuals={actuals}
          role={role}
          clientId={clientId}
          clientName={clientName}
          signoff={signoff}
          isStale={isStale}
          canSign={canSign}
          onSignoffChange={onSignoffChange}
          signoffKnown={signoffKnown}
          drawer={readOnly ? null : nestInDrawer(drawer, "Budget vs actuals", variance)}
          lens={lens}
          onLensChange={onLensChange}
          actualMonths={actualMonths}
          readOnly={readOnly}
          priorYear={priorYear}
          priorYearLabel={priorYearLabel}
          priorYearMonths={priorYearMonths}
          displayTemplateId={displayTemplateId}
          statementAligned={statementAligned}
          forecastRent={forecastRent}
          onBuild={onBuild}
          openingBalanceMissing={openingBalanceMissing}
          periodCaption={periodCaption}
          uniformNote={uniformNote}
          layout={layout}
          pagedView={pagedView}
          onPagedViewChange={onPagedViewChange}
        />
      </div>
    );
  }

  return (
    <BudgetComplexWorkspace
      doc={doc}
      onChange={onChange}
      actuals={actuals}
      unmappedReview={unmappedReview}
      onClearUnmapped={onClearUnmapped}
      onChangeModel={onChangeModel}
      role={role}
      clientId={clientId}
      clientName={clientName}
      signoff={signoff}
      isStale={isStale}
      canSign={canSign}
      onSignoffChange={onSignoffChange}
      signoffKnown={signoffKnown}
      drawer={drawer}
      variance={variance}
      lens={lens}
      onLensChange={onLensChange}
      actualMonths={actualMonths}
      displayTemplateId={displayTemplateId}
      statementAligned={statementAligned}
      forecastRent={forecastRent}
      onBuild={onBuild}
      openingBalanceMissing={openingBalanceMissing}
      periodCaption={periodCaption}
      uniformNote={uniformNote}
    />
  );
}

export function BudgetScenarioPills({
  doc,
  onChange,
}: {
  doc: BudgetDocument;
  onChange: (next: BudgetDocument) => void;
}) {
  return (
    <div className="flex flex-wrap rounded-full border border-slate-200 p-0.5 dark:border-slate-700">
      {SCENARIOS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() =>
            onChange({ ...doc, activeScenario: id, updatedAt: new Date().toISOString() })
          }
          className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            doc.activeScenario === id
              ? "bg-[#0B5FFF] text-white"
              : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
          }`}
        >
          {doc.scenarios[id].label}
        </button>
      ))}
    </div>
  );
}

export function UnmappedReviewBlock({
  items,
  doc,
  onChange,
  onClear,
}: {
  items: UnmappedDriver[];
  doc: BudgetDocument;
  onChange: (next: BudgetDocument) => void;
  onClear?: () => void;
}) {
  return (
    <div className="rounded-xl border border-[#B7791F]/40 bg-[#B7791F]/10 p-4">
      <div className="text-sm font-semibold text-[#8A5A12] dark:text-[#F0D59A]">
        Lines from the previous model
      </div>
      <p className="mt-1 text-xs text-[#8A5A12]/80 dark:text-[#F0D59A]/80">
        These lines were on the previous model and do not match a line here. Move each one onto a
        line, or keep it as an extra line. Nothing is removed until you choose.
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((u) => (
          <li
            key={u.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-[#B7791F]/20 bg-white/60 px-3 py-2 dark:bg-slate-950/40"
          >
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">{u.name}</span>
            <select
              className="rounded border border-slate-200 bg-white px-2 py-1 text-xs dark:border-slate-700 dark:bg-slate-900"
              defaultValue=""
              onChange={(e) => {
                const key = e.target.value;
                if (!key) return;
                if (key === "__keep__") {
                  onChange(keepUnmappedAsExtraLine(doc, u));
                } else {
                  onChange(reassignUnmappedDriver(doc, u, key));
                }
                onClear?.();
              }}
            >
              <option value="" disabled>
                Reassign to…
              </option>
              {doc.revenueLines.map((l) => (
                <option key={l.id} value={l.driverKey}>
                  {l.name}
                </option>
              ))}
              <option value="__keep__">Keep as extra line</option>
            </select>
          </li>
        ))}
      </ul>
      <Button type="button" variant="ghost" size="sm" className="mt-2 text-xs" onClick={onClear}>
        Discard the rest
      </Button>
    </div>
  );
}

function BudgetComplexWorkspace({
  doc,
  onChange,
  actuals,
  unmappedReview,
  onClearUnmapped,
  onChangeModel,
  role = "owner",
  clientId,
  clientName,
  signoff = null,
  isStale = false,
  canSign = false,
  onSignoffChange,
  signoffKnown = true,
  drawer = null,
  variance = null,
  lens,
  onLensChange,
  actualMonths,
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
  unmappedReview?: UnmappedDriver[] | null;
  onClearUnmapped?: () => void;
  onChangeModel?: () => void;
  role?: "owner" | "accountant";
  clientId?: string;
  clientName?: string;
  signoff?: ClientReviewSignoff | null;
  isStale?: boolean;
  canSign?: boolean;
  onSignoffChange?: (next: ClientReviewSignoff | null) => void;
  signoffKnown?: boolean;
  drawer?: ReactNode;
  variance?: ReactNode;
  lens?: BudgetLens;
  onLensChange?: (next: BudgetLens) => void;
  actualMonths?: readonly BudgetActualMonth[];
  displayTemplateId?: BudgetTemplateId | null;
  statementAligned?: boolean;
  forecastRent?: ForecastRent | null;
  onBuild?: () => void;
  openingBalanceMissing?: boolean;
  periodCaption?: string | null;
  uniformNote?: string | null;
}) {
  const months = useMemo(() => fyMonths(doc.fyStart), [doc.fyStart]);
  const { market } = useMarket();
  const money = (n: number) => fmtBudgetMoney(n, market);
  const rentHint = budgetRentHint(doc, forecastRent, money, statementAligned);
  const monthLabel = (ym: string) => formatBudgetMonthYear(ym, market);
  const tax = doc.tax;
  const usTax = tax?.regime === "sales_tax" || tax?.regime === "none";
  const taxCol = t("indirectTaxNet", market);
  const focusMonths = months;
  const [focusMonth, setFocusMonth] = useState(() => currentBudgetMonth(months));
  const results = useMemo(() => computeBudgetMonths(doc, doc.activeScenario), [doc]);
  const baseResults = useMemo(() => computeBudgetMonths(doc, "base"), [doc]);
  const focus = results.find((r) => r.month === focusMonth) ?? results[0];
  const baseFocus = baseResults.find((r) => r.month === focusMonth) ?? baseResults[0];
  const trough = useMemo(() => lowestCashTrough(results), [results]);
  const tpl = BUDGET_TEMPLATES[doc.templateId];
  const shownTpl = displayTemplateId ? BUDGET_TEMPLATES[displayTemplateId] : tpl;
  const fyTotals = useMemo(() => {
    const sum = (fn: (r: (typeof results)[0]) => number) => results.reduce((a, r) => a + fn(r), 0);
    return {
      revenue: sum((r) => r.revenue),
      cogs: sum((r) => r.cogs),
      overheads: sum((r) => r.overheads),
      depreciation: sum((r) => r.depreciation),
      ebit: sum((r) => r.ebit),
      vatNet: sum((r) => r.vatNet),
      netCash: sum((r) => r.netCash),
      closingEnd: results.length ? results[results.length - 1].closingCash : 0,
    };
  }, [results]);

  const patchLine = (
    lineId: string,
    month: string,
    patch: Partial<{ volume: number; price: number }>,
  ) => {
    onChange({
      ...doc,
      revenueLines: doc.revenueLines.map((l) => {
        if (l.id !== lineId) return l;
        const cur = l.months[month] ?? { volume: 0, price: 0 };
        return {
          ...l,
          months: { ...l.months, [month]: { ...cur, ...patch } },
        };
      }),
      updatedAt: new Date().toISOString(),
    });
  };

  const patchOverhead = (id: string, month: string, amount: number) => {
    onChange({
      ...doc,
      overheads: doc.overheads.map((o) =>
        o.id === id ? { ...o, months: { ...o.months, [month]: amount } } : o,
      ),
      updatedAt: new Date().toISOString(),
    });
  };

  const compared = actuals && actuals.chip && actuals.chip !== "None" ? actuals : null;
  const headline = budgetHeadlineFigures(compared?.period, {
    revenue: compared?.budgetRevenue,
    operatingProfit: compared?.budgetEbit,
  });
  const assumptionCount = 4 + (doc.showInventoryDays ? 1 : 0) + (usTax ? 1 : 2);
  const sourceCount = new Set(
    [budgetOpeningSourceLabel(doc.openingCashSource), budgetDaysSourceLabel(doc.wcDaysSource)].filter(
      (label): label is string => Boolean(label),
    ),
  ).size;
  const drawerHint = `${sourceCount} source${sourceCount === 1 ? "" : "s"} · ${assumptionCount} assumptions`;
  return (
    <div id="wizard-budget-plan" className="space-y-6">
      <BudgetVerdictStrip
        periodLabel={headline.label ?? (compared ? compared.label : monthLabel(focusMonth))}
        revenueBudget={compared?.period ? headline.revenue : (compared?.budgetRevenue ?? focus?.revenue ?? 0)}
        revenueActual={compared ? compared.revenue : null}
        profitBudget={compared?.period ? headline.operatingProfit : (compared?.budgetEbit ?? focus?.ebit ?? 0)}
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
        statementActuals={actuals}
        windowMonths={actuals?.windowMonths}
        displayTemplateId={displayTemplateId}
        periodCaption={periodCaption}
        uniformNote={uniformNote}
      />
      {nestInDrawer(
        drawer,
        drawerHint,
        <>
          <section
            id="wizard-budget-assumptions"
            className="grid gap-3 rounded-xl border border-slate-200/80 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/50 sm:grid-cols-3 lg:grid-cols-6"
          >
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
          ) : (
          <MoneyField
            value={doc.openingCash ?? 0}
            label="Opening cash"
            market={market}
            className="mt-1 h-8"
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
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-slate-500">
            Gross profit %
          </Label>
          <Input
            type="number"
            value={doc.gpPct}
            onChange={(e) =>
              onChange({
                ...doc,
                gpPct: parseFloat(e.target.value) || 0,
                cogsMode: "gp_pct",
                updatedAt: new Date().toISOString(),
              })
            }
            className="mt-1 h-8"
          />
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
          <Input
            type="number"
            value={doc.wc.debtorDays}
            onChange={(e) =>
              onChange({
                ...doc,
                wc: { ...doc.wc, debtorDays: parseFloat(e.target.value) || 0 },
                wcDaysSource: "manual",
                updatedAt: new Date().toISOString(),
              })
            }
            className="mt-1 h-8"
          />
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
          <Input
            type="number"
            value={doc.wc.creditorDays}
            onChange={(e) =>
              onChange({
                ...doc,
                wc: { ...doc.wc, creditorDays: parseFloat(e.target.value) || 0 },
                wcDaysSource: "manual",
                updatedAt: new Date().toISOString(),
              })
            }
            className="mt-1 h-8"
          />
        </div>
        {doc.showInventoryDays ? (
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              Inventory days
            </Label>
            <Input
              type="number"
              value={doc.wc.inventoryDays}
              onChange={(e) =>
                onChange({
                  ...doc,
                  wc: { ...doc.wc, inventoryDays: parseFloat(e.target.value) || 0 },
                  updatedAt: new Date().toISOString(),
                })
              }
              className="mt-1 h-8"
            />
          </div>
        ) : !usTax ? (
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              VAT rate %
            </Label>
            <Input
              type="number"
              value={Math.round((doc.vatRate || 0.15) * 1000) / 10}
              onChange={(e) =>
                onChange({
                  ...doc,
                  vatRate: (parseFloat(e.target.value) || 0) / 100,
                  updatedAt: new Date().toISOString(),
                })
              }
              className="mt-1 h-8"
            />
          </div>
        ) : (
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              Combined sales tax %
            </Label>
            <Input
              type="number"
              step="0.1"
              value={Math.round((doc.vatRate || 0) * 1000) / 10}
              onChange={(e) => {
                const vatRate = Math.max(0, (parseFloat(e.target.value) || 0) / 100);
                onChange({
                  ...doc,
                  vatRate,
                  tax:
                    tax?.regime === "sales_tax"
                      ? {
                          ...tax,
                          combinedRate: vatRate,
                          localRate: Math.max(0, vatRate - tax.stateRate),
                          collects: vatRate > 0,
                        }
                      : vatRate > 0 && tax?.regime === "none"
                        ? tax
                        : tax,
                  updatedAt: new Date().toISOString(),
                });
              }}
              className="mt-1 h-8"
            />
          </div>
        )}
        {usTax ? (
          <div className="sm:col-span-3 lg:col-span-6 space-y-2">
            <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
              <input
                type="checkbox"
                checked={tax?.regime === "sales_tax"}
                onChange={(e) => {
                  if (!e.target.checked) {
                    onChange({
                      ...doc,
                      vatRate: 0,
                      tax: { regime: "none" },
                      updatedAt: new Date().toISOString(),
                    });
                    return;
                  }
                  onChange({
                    ...doc,
                    tax: (() => {
                      if (tax?.regime === "sales_tax") return tax;
                      const stateCode = market.regionCode;
                      if (!stateCode) return { regime: "none" as const };
                      const restored = resolveMarket(
                        { country: "US", regionCode: stateCode },
                        { collects: true },
                      ).tax;
                      if (restored.regime === "sales_tax") return restored;
                      return { regime: "none" as const };
                    })(),
                    vatRate:
                      market.tax.regime === "sales_tax" ? market.tax.combinedRate : doc.vatRate,
                    updatedAt: new Date().toISOString(),
                  });
                }}
              />
              This business collects sales tax
            </label>
            {tax?.regime === "sales_tax" && (
              <p className="text-[11px] leading-relaxed text-slate-500">
                {market.regionCode} default {formatPercentRate(tax.combinedRate)} (state{" "}
                {formatPercentRate(tax.stateRate)} + local {formatPercentRate(tax.localRate)}).{" "}
                {SALES_TAX_HONESTY}
              </p>
            )}
          </div>
        ) : (
          <>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-slate-500">
                VAT mode
              </Label>
              <select
                className="mt-1 h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                value={doc.vatMode}
                onChange={(e) =>
                  onChange({
                    ...doc,
                    vatMode: e.target.value as BudgetDocument["vatMode"],
                    updatedAt: new Date().toISOString(),
                  })
                }
              >
                <option value="exclusive">Exclusive (P&L ex-VAT)</option>
                <option value="inclusive">Inclusive (strip VAT for P&L)</option>
              </select>
            </div>
            {doc.showInventoryDays && (
              <div className="sm:col-span-3 lg:col-span-6">
                <Label className="text-[10px] uppercase tracking-wider text-slate-500">
                  VAT rate %
                </Label>
                <Input
                  type="number"
                  value={Math.round((doc.vatRate || 0.15) * 1000) / 10}
                  onChange={(e) =>
                    onChange({
                      ...doc,
                      vatRate: (parseFloat(e.target.value) || 0) / 100,
                      updatedAt: new Date().toISOString(),
                    })
                  }
                  className="mt-1 h-8 max-w-[140px]"
                />
              </div>
            )}
          </>
        )}
      </section>
          {variance}
        </>,
      )}
      <p className="text-sm font-semibold text-[#102A43] dark:text-slate-100">
        {plainBudgetWindowHeading(shownTpl.label, doc, market)}
      </p>

      {/* Revenue drivers */}
      <section className={`space-y-3 ${COLLAPSIBLE_GOLD_SHELL} p-4`}>
        <div className={COLLAPSIBLE_GOLD_RULE} />
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#102A43] dark:text-[#F4F7FB]">
              Drivers
            </p>
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Revenue drivers
            </h3>
          </div>
          {doc.revenueLines.length < 5 && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 text-xs"
              onClick={() => {
                const seed = tpl.revenueSeeds[0];
                onChange({
                  ...doc,
                  revenueLines: [
                    ...doc.revenueLines,
                    {
                      id: newId("rev"),
                      driverKey: `custom_${doc.revenueLines.length + 1}`,
                      name: "New line",
                      kind: tpl.driverKind,
                      volumeLabel: seed.volumeLabel,
                      priceLabel: seed.priceLabel,
                      months: Object.fromEntries(months.map((m) => [m, { volume: 0, price: 0 }])),
                    },
                  ],
                  updatedAt: new Date().toISOString(),
                });
              }}
            >
              <Plus className="h-3 w-3" /> Add line
            </Button>
          )}
        </div>
        {hotelTemplateRows(shownTpl.id)?.some((row) => row.section === "revenue") ? (
          <ul data-hotel-template="" data-hotel-section="revenue" className="space-y-1 text-xs text-slate-600">
            {hotelTemplateRows(shownTpl.id)!
              .filter((row) => row.section === "revenue")
              .map((row) => (
              <li key={row.name}>
                {row.name} · {row.detail} · {row.value}
              </li>
            ))}
          </ul>
        ) : null}
        {doc.revenueLines.map((line, index) => {
          const displayName = hotelLineDisplayName(shownTpl.id, line.name, index);
          if (displayName == null) return null;
          const showDriverDash =
            !hotelDriversOnFile(doc.templateId, shownTpl.id, line) &&
            doc.templateId !== "hospitality_rooms";
          return (
          <ScrollableTable
            key={line.id}
            className="rounded-lg border border-[#DBEAFE] bg-white/70 dark:border-slate-800 dark:bg-slate-950/40"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
              <Input
                value={displayName}
                onChange={(e) =>
                  onChange({
                    ...doc,
                    revenueLines: doc.revenueLines.map((l) =>
                      l.id === line.id ? { ...l, name: e.target.value } : l,
                    ),
                    updatedAt: new Date().toISOString(),
                  })
                }
                className="h-7 max-w-xs border-0 bg-transparent px-0 text-sm font-semibold shadow-none"
              />
              {doc.revenueLines.length > 1 && (
                <button
                  type="button"
                  className="text-slate-400 hover:text-red-500"
                  onClick={() =>
                    onChange({
                      ...doc,
                      revenueLines: doc.revenueLines.filter((l) => l.id !== line.id),
                      updatedAt: new Date().toISOString(),
                    })
                  }
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <table className="milon-data-table w-full min-w-[640px] text-xs text-[#0f172a] dark:text-slate-100">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                  <th className="px-3 py-2">Driver</th>
                  {focusMonths.map((m) => (
                    <th key={m} className="px-2 py-2 text-right">
                      {monthLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-3 py-1 text-slate-500">
                    {localizeCopy(budgetVolumeLabel(doc.templateId, shownTpl.id, line.volumeLabel), market)}
                  </td>
                  {focusMonths.map((m) => (
                    <td key={m} className="px-1 py-1 text-right">
                      {showDriverDash ? (
                        <span data-hotel-driver="missing">—</span>
                      ) : (
                      <Input
                        type="number"
                        className="h-7 text-right"
                        value={line.months[m]?.volume ?? 0}
                        onChange={(e) =>
                          patchLine(line.id, m, { volume: parseFloat(e.target.value) || 0 })
                        }
                      />
                      )}
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-3 py-1 text-slate-500">{localizeCopy(budgetPriceLabel(doc.templateId, shownTpl.id, line.priceLabel), market)}</td>
                  {focusMonths.map((m) => (
                    <td key={m} className="px-1 py-1 text-right">
                      {showDriverDash ? (
                        <span data-hotel-driver="missing">—</span>
                      ) : (
                      <Input
                        type="number"
                        className="h-7 text-right"
                        value={line.months[m]?.price ?? 0}
                        onChange={(e) =>
                          patchLine(line.id, m, { price: parseFloat(e.target.value) || 0 })
                        }
                      />
                      )}
                    </td>
                  ))}
                </tr>
                <tr className="border-t border-slate-100 bg-slate-50/60 dark:border-slate-800 dark:bg-slate-900/40">
                  <td className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                    Revenue
                  </td>
                  {focusMonths.map((m) => {
                    const cell = line.months[m] ?? { volume: 0, price: 0 };
                    return (
                      <td
                        key={m}
                        className="px-2 py-1.5 text-right text-[11px] font-semibold tabular-nums text-slate-800 dark:text-slate-100"
                      >
                        {money(cell.volume * cell.price)}
                      </td>
                    );
                  })}
                </tr>
                <tr className="border-t border-slate-200 dark:border-slate-700">
                  <td className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    FY total
                  </td>
                  <td
                    colSpan={focusMonths.length}
                    className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums text-slate-900 dark:text-slate-100"
                  >
                    {money(
                      focusMonths.reduce((s, m) => {
                        const cell = line.months[m] ?? { volume: 0, price: 0 };
                        return s + cell.volume * cell.price;
                      }, 0),
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </ScrollableTable>
          );
        })}
      </section>

      {/* Overheads */}
      <section className={`space-y-2 ${COLLAPSIBLE_GOLD_SHELL} p-4`}>
        <div className={COLLAPSIBLE_GOLD_RULE} />
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#102A43] dark:text-[#F4F7FB]">
            Overheads
          </p>
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Fixed overheads
          </h3>
          {rentHint ? <p className="mt-1 text-[11px] text-slate-500">{rentHint}</p> : null}
          {hotelTemplateRows(shownTpl.id)?.some((row) => row.section === "cost") ? (
            <ul data-hotel-template="" data-hotel-section="cost" className="mt-2 space-y-1 text-xs text-slate-600">
              {hotelTemplateRows(shownTpl.id)!
                .filter((row) => row.section === "cost")
                .map((row) => (
                  <li key={row.name}>
                    {row.name} · {row.detail} · {row.value}
                  </li>
                ))}
            </ul>
          ) : null}
        </div>
        <ScrollableTable className="rounded-lg border border-[#DBEAFE] dark:border-slate-800">
          <table className="milon-data-table w-full min-w-[640px] text-xs text-[#0f172a] dark:text-slate-100">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-400 dark:border-slate-800">
                <th className="px-3 py-2">Bucket</th>
                {focusMonths.map((m) => (
                  <th key={m} className="px-2 py-2 text-right">
                    {monthLabel(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doc.overheads.map((oh) => (
                <tr key={oh.id} className="border-b border-slate-50 dark:border-slate-900">
                  <td className="px-3 py-1 font-medium text-slate-700 dark:text-slate-200">
                    {oh.name}
                  </td>
                  {focusMonths.map((m) => {
                    const amount = oh.months[m] ?? 0;
                    const unstated =
                      statementAligned &&
                      (oh.bucket === "premises" || oh.bucket === "sales" || oh.bucket === "other") &&
                      Math.abs(amount) < 0.5;
                    return (
                    <td key={m} className="px-1 py-1">
                      {unstated ? (
                        <span className="block px-1 text-right text-[11px] text-slate-500">not on the statement</span>
                      ) : (
                      <Input
                        type="number"
                        className="h-7 text-right"
                        value={oh.months[m] ?? 0}
                        onChange={(e) => patchOverhead(oh.id, m, parseFloat(e.target.value) || 0)}
                      />
                      )}
                    </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 bg-slate-50/80 dark:border-slate-700 dark:bg-slate-900/40">
                <td className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Total
                </td>
                {focusMonths.map((m) => (
                  <td
                    key={m}
                    className="px-2 py-2 text-right text-[11px] font-semibold tabular-nums text-slate-800 dark:text-slate-100"
                  >
                    {money(doc.overheads.reduce((s, oh) => s + (oh.months[m] ?? 0), 0))}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-slate-200 dark:border-slate-700">
                <td className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  FY total
                </td>
                <td
                  colSpan={focusMonths.length}
                  className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums text-[#0f172a] dark:text-slate-100"
                >
                  {money(
                    focusMonths.reduce(
                      (s, m) => s + doc.overheads.reduce((a, oh) => a + (oh.months[m] ?? 0), 0),
                      0,
                    ),
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </ScrollableTable>
      </section>

      {/* Capex — available for every model; collapsed by default */}
      <details className={`group ${COLLAPSIBLE_GOLD_SHELL}`}>
        <div className={COLLAPSIBLE_GOLD_RULE} />
        <summary className="cursor-pointer list-none px-4 py-3 marker:content-none">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#102A43] dark:text-[#F4F7FB]">
                Capital
              </p>
              <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                Capex{" "}
                <span className="font-normal text-slate-400">
                  {doc.capex.length ? `(${doc.capex.length})` : "(optional)"}
                </span>
              </h3>
              <p className="text-[11px] text-slate-500">
                Expand if you plan asset purchases — cash-funded hits cash in the purchase month;
                finance-funded does not. Straight-line depreciation flows into EBIT.
              </p>
            </div>
            <span className="text-xs text-slate-400 group-open:hidden">Show</span>
            <span className="hidden text-xs text-slate-400 group-open:inline">Hide</span>
          </div>
        </summary>
        <div className="space-y-2 border-t border-slate-100 px-4 pb-4 pt-3 dark:border-slate-800">
          {doc.capex.length < 3 && (
            <div className="flex justify-end">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() =>
                  onChange({
                    ...doc,
                    qualification: { ...doc.qualification, capexMode: "light" },
                    capex: [
                      ...doc.capex,
                      {
                        id: newId("cx"),
                        name: "Asset purchase",
                        month: months[0],
                        amount: 0,
                        funding: "cash",
                        usefulLifeMonths: 36,
                        residual: 0,
                      },
                    ],
                    updatedAt: new Date().toISOString(),
                  })
                }
              >
                <Plus className="mr-1 h-3 w-3" /> Add
              </Button>
            </div>
          )}
          {doc.capex.length === 0 ? (
            <p className="text-xs text-slate-500">
              No capex lines yet — add up to three planned purchases.
            </p>
          ) : (
            <div className="space-y-2">
              {doc.capex.map((c) => (
                <div
                  key={c.id}
                  className="grid gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-800 sm:grid-cols-3 lg:grid-cols-7"
                >
                  <Input
                    value={c.name}
                    onChange={(e) =>
                      onChange({
                        ...doc,
                        capex: doc.capex.map((x) =>
                          x.id === c.id ? { ...x, name: e.target.value } : x,
                        ),
                        updatedAt: new Date().toISOString(),
                      })
                    }
                    placeholder="Description"
                  />
                  <select
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                    value={c.month}
                    onChange={(e) =>
                      onChange({
                        ...doc,
                        capex: doc.capex.map((x) =>
                          x.id === c.id ? { ...x, month: e.target.value } : x,
                        ),
                        updatedAt: new Date().toISOString(),
                      })
                    }
                  >
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {monthLabel(m)}
                      </option>
                    ))}
                  </select>
                  <Input
                    type="number"
                    value={c.amount}
                    onChange={(e) =>
                      onChange({
                        ...doc,
                        capex: doc.capex.map((x) =>
                          x.id === c.id ? { ...x, amount: parseFloat(e.target.value) || 0 } : x,
                        ),
                        updatedAt: new Date().toISOString(),
                      })
                    }
                    placeholder="Amount"
                  />
                  <select
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                    value={c.funding}
                    onChange={(e) =>
                      onChange({
                        ...doc,
                        capex: doc.capex.map((x) =>
                          x.id === c.id
                            ? { ...x, funding: e.target.value as "cash" | "finance" }
                            : x,
                        ),
                        updatedAt: new Date().toISOString(),
                      })
                    }
                  >
                    <option value="cash">Cash</option>
                    <option value="finance">Finance</option>
                  </select>
                  <Input
                    type="number"
                    value={c.usefulLifeMonths ?? 36}
                    onChange={(e) =>
                      onChange({
                        ...doc,
                        capex: doc.capex.map((x) =>
                          x.id === c.id
                            ? {
                                ...x,
                                usefulLifeMonths: Math.max(1, parseInt(e.target.value, 10) || 36),
                              }
                            : x,
                        ),
                        updatedAt: new Date().toISOString(),
                      })
                    }
                    placeholder="Life (mo)"
                    title="Useful life in months"
                  />
                  <Input
                    type="number"
                    value={c.residual ?? 0}
                    onChange={(e) =>
                      onChange({
                        ...doc,
                        capex: doc.capex.map((x) =>
                          x.id === c.id ? { ...x, residual: parseFloat(e.target.value) || 0 } : x,
                        ),
                        updatedAt: new Date().toISOString(),
                      })
                    }
                    placeholder="Residual"
                    title="Residual value"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      onChange({
                        ...doc,
                        capex: doc.capex.filter((x) => x.id !== c.id),
                        updatedAt: new Date().toISOString(),
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </details>

      {/* Sensitivity */}
      <section className="rounded-xl border border-slate-200/80 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/40">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
          Sensitivity (active scenario)
        </h3>
        <p className="mb-3 text-xs text-slate-500">
          Tweaks factors on {doc.scenarios[doc.activeScenario].label}. Base stays at 1.0× unless you
          edit it.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              Volume factor ({doc.scenarios[doc.activeScenario].volumeFactor.toFixed(2)}×)
            </Label>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.01}
              value={doc.scenarios[doc.activeScenario].volumeFactor}
              onChange={(e) =>
                onChange({
                  ...doc,
                  scenarios: {
                    ...doc.scenarios,
                    [doc.activeScenario]: {
                      ...doc.scenarios[doc.activeScenario],
                      volumeFactor: parseFloat(e.target.value),
                    },
                  },
                  updatedAt: new Date().toISOString(),
                })
              }
              className="mt-2 w-full accent-[#0B5FFF]"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              Price factor ({doc.scenarios[doc.activeScenario].priceFactor.toFixed(2)}×)
            </Label>
            <input
              type="range"
              min={0.5}
              max={1.5}
              step={0.01}
              value={doc.scenarios[doc.activeScenario].priceFactor}
              onChange={(e) =>
                onChange({
                  ...doc,
                  scenarios: {
                    ...doc.scenarios,
                    [doc.activeScenario]: {
                      ...doc.scenarios[doc.activeScenario],
                      priceFactor: parseFloat(e.target.value),
                    },
                  },
                  updatedAt: new Date().toISOString(),
                })
              }
              className="mt-2 w-full accent-[#0B5FFF]"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              Debtor days Δ (
              {(doc.scenarios[doc.activeScenario].debtorDaysDelta ?? 0) >= 0 ? "+" : ""}
              {doc.scenarios[doc.activeScenario].debtorDaysDelta ?? 0} days)
            </Label>
            <input
              type="range"
              min={-30}
              max={60}
              step={1}
              value={doc.scenarios[doc.activeScenario].debtorDaysDelta ?? 0}
              onChange={(e) =>
                onChange({
                  ...doc,
                  scenarios: {
                    ...doc.scenarios,
                    [doc.activeScenario]: {
                      ...doc.scenarios[doc.activeScenario],
                      debtorDaysDelta: parseInt(e.target.value, 10) || 0,
                    },
                  },
                  updatedAt: new Date().toISOString(),
                })
              }
              className="mt-2 w-full accent-[#0B5FFF]"
            />
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Monthly P&amp;L and cash
          </h3>
          <select
            className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-950"
            value={focusMonth}
            onChange={(e) => setFocusMonth(e.target.value)}
          >
            {months.map((m) => (
              <option key={m} value={m}>
                Focus: {monthLabel(m)}
              </option>
            ))}
          </select>
        </div>

        {trough && (
          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              trough.closingCash < 0
                ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
            }`}
          >
            Budget-year cash trough: <strong>{monthLabel(trough.month)}</strong> at{" "}
            <strong className="tabular-nums">{money(trough.closingCash)}</strong>
            <span className="ml-2 text-slate-500">Budget year, not the 13-week forecast.</span>
            {doc.activeScenario !== "base" && baseFocus && focus && (
              <span className="ml-2 text-slate-500">
                · vs base focus month cash {money(baseFocus.closingCash)} (
                {focus.closingCash - baseFocus.closingCash > 0 ? "+" : ""}
                {money(focus.closingCash - baseFocus.closingCash)})
              </span>
            )}
          </div>
        )}

        {/* pr-16 keeps closing cash clear of the floating note button. */}
        <ScrollableTable
          cardRows
          className="rounded-xl border border-slate-200/80 dark:border-slate-800"
          viewportClassName="sm:pr-16"
        >
          <table className="milon-data-table w-full min-w-[880px] text-xs text-[#0f172a] dark:text-slate-100">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-400 dark:border-slate-800">
                <th className="px-3 py-2">Month</th>
                <th className="px-2 py-2 text-right">Revenue</th>
                <th className="px-2 py-2 text-right">COGS</th>
                <th className="px-2 py-2 text-right">GP%</th>
                <th className="px-2 py-2 text-right">Overheads</th>
                <th className="px-2 py-2 text-right">Deprec.</th>
                <th className="px-2 py-2 text-right">EBIT</th>
                <th className="px-2 py-2 text-right">{taxCol}</th>
                <th className="px-2 py-2 text-right">Net cash</th>
                <th className="px-2 py-2 text-right">Closing cash</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr
                  key={r.month}
                  className={`border-b border-slate-50 dark:border-slate-900 ${
                    r.month === focusMonth ? "bg-[#DBEAFE]/70" : ""
                  }`}
                >
                  <td className="px-3 py-1.5 font-medium">{monthLabel(r.month)}</td>
                  <td data-label="Revenue" className="px-2 py-1.5 text-right tabular-nums">
                    {money(r.revenue)}
                  </td>
                  <td data-label="COGS" className="px-2 py-1.5 text-right tabular-nums">
                    {money(r.cogs)}
                  </td>
                  <td data-label="GP%" className="px-2 py-1.5 text-right tabular-nums">
                    {r.gpPct.toFixed(1)}%
                  </td>
                  <td data-label="Overheads" className="px-2 py-1.5 text-right tabular-nums">
                    {money(r.overheads)}
                  </td>
                  <td data-label="Deprec." className="px-2 py-1.5 text-right tabular-nums">
                    {money(r.depreciation)}
                  </td>
                  <td data-label="EBIT" className="px-2 py-1.5 text-right tabular-nums">
                    {money(r.ebit)}
                  </td>
                  <td data-label={taxCol} className="px-2 py-1.5 text-right tabular-nums">
                    {money(r.vatNet)}
                  </td>
                  <td
                    data-label="Net cash"
                    className={`px-2 py-1.5 text-right tabular-nums ${r.netCash < 0 ? "text-red-600" : ""}`}
                  >
                    {money(r.netCash)}
                  </td>
                  <td
                    data-label="Closing cash"
                    className={`px-2 py-1.5 text-right tabular-nums ${r.closingCash < 0 ? "text-red-600" : ""}`}
                  >
                    {money(r.closingCash)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold dark:border-slate-600 dark:bg-slate-900/50">
                <td className="px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500">
                  FY total
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{money(fyTotals.revenue)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(fyTotals.cogs)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-400">—</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(fyTotals.overheads)}</td>
                <td className="px-2 py-2 text-right tabular-nums">
                  {money(fyTotals.depreciation)}
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{money(fyTotals.ebit)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{money(fyTotals.vatNet)}</td>
                <td
                  className={`px-2 py-2 text-right tabular-nums ${fyTotals.netCash < 0 ? "text-red-600" : ""}`}
                >
                  {money(fyTotals.netCash)}
                </td>
                <td
                  className={`px-2 py-2 text-right tabular-nums ${fyTotals.closingEnd < 0 ? "text-red-600" : ""}`}
                  title="FY-end closing cash (not a sum of monthly closings)"
                >
                  {money(fyTotals.closingEnd)}
                  <span className="ml-1 text-[9px] font-normal text-slate-400">end</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </ScrollableTable>
        {role === "accountant" && (
          <p className="text-[11px] text-slate-500">
            Full year, month by month. Check the assumptions before you sign off.
          </p>
        )}
      </section>
    </div>
  );
}
