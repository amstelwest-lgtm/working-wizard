/**
 * Founder-facing Simple budget — one month at a time, volume × price,
 * visible COGS + overhead, year strip, FY totals. No spreadsheet noise.
 */

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BudgetActuals, BudgetDocument, BudgetScenarioId } from "@/lib/budget.types";
import { BUDGET_TEMPLATES } from "@/lib/budget.templates";
import {
  budgetWindowLabel,
  fyMonths,
  formatMonthLabel as formatMonthLabelMarket,
} from "@/lib/budget.months";
import { computeBudgetMonths, fmtBudgetMoney, lowestCashTrough } from "@/lib/budget.compute";
import { useMarket } from "@/contexts/market";

const SCENARIOS: BudgetScenarioId[] = ["base", "upside", "downside"];

function monthOverheadTotal(doc: BudgetDocument, month: string): number {
  return doc.overheads.reduce((s, oh) => s + (oh.months[month] || 0), 0);
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
  onChangeModel,
}: {
  doc: BudgetDocument;
  onChange: (next: BudgetDocument) => void;
  actuals?: BudgetActuals | null;
  onChangeModel?: () => void;
}) {
  const { market } = useMarket();
  const money = (n: number) => fmtBudgetMoney(n, market);
  const monthLabel = (ym: string) => formatMonthLabelMarket(ym, market);
  const months = useMemo(() => fyMonths(doc.fyStart), [doc.fyStart]);
  const [focusMonth, setFocusMonth] = useState(() => {
    const now = new Date();
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return months.includes(cur) ? cur : months[0];
  });
  const [sameEveryMonth, setSameEveryMonth] = useState(false);
  const [showMore, setShowMore] = useState(false);

  const results = useMemo(() => computeBudgetMonths(doc, doc.activeScenario), [doc]);
  const focus = results.find((r) => r.month === focusMonth) ?? results[0];
  const trough = useMemo(() => lowestCashTrough(results), [results]);
  const tpl = BUDGET_TEMPLATES[doc.templateId];
  const line = doc.revenueLines[0];
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

  return (
    <div id="wizard-budget-plan" className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b8860b]">
            {tpl.label} · {budgetWindowLabel(doc, market)}
          </p>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Your budget</h2>
          <p className="text-xs text-slate-500">
            What you sell → what’s left after costs → whether cash holds.
          </p>
        </div>
        <div className="flex rounded-full border border-slate-200 p-0.5 dark:border-slate-700">
          {SCENARIOS.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() =>
                onChange({ ...doc, activeScenario: id, updatedAt: new Date().toISOString() })
              }
              className={`rounded-full px-3 py-1 text-[10px] font-semibold uppercase tracking-wide ${
                doc.activeScenario === id
                  ? "bg-[#d4a550] text-[#0a0e1a]"
                  : "text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
              }`}
            >
              {doc.scenarios[id].label}
            </button>
          ))}
        </div>
      </div>

      {/* Hero */}
      {focus && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { l: "Revenue", v: focus.revenue, sub: monthLabel(focusMonth) },
            {
              l: "Gross profit",
              v: focus.grossProfit,
              sub: `${focus.gpPct.toFixed(0)}% margin`,
            },
            { l: "Cash at month-end", v: focus.closingCash, sub: monthLabel(focusMonth) },
            {
              l: "Cash trough",
              v: trough?.closingCash ?? 0,
              sub: trough ? monthLabel(trough.month) : "—",
              warn: (trough?.closingCash ?? 0) < 0,
            },
          ].map((s) => (
            <div
              key={s.l}
              className={`rounded-xl border px-3 py-3 ${
                s.warn ? "border-red-500/40 bg-red-500/10" : "border-[#d4a550]/25 bg-[#d4a550]/5"
              }`}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#b8860b]">
                {s.l}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                {money(s.v)}
              </div>
              <div className="text-[11px] text-slate-500">{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Month picker + editor */}
      <section className="rounded-xl border border-slate-200/80 bg-white/80 p-4 dark:border-slate-800 dark:bg-slate-950/50">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              disabled={focusIdx <= 0}
              onClick={() => setFocusMonth(months[Math.max(0, focusIdx - 1)])}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[7rem] text-center text-sm font-semibold text-slate-900 dark:text-slate-100">
              {monthLabel(focusMonth)}
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              disabled={focusIdx >= months.length - 1}
              onClick={() => setFocusMonth(months[Math.min(months.length - 1, focusIdx + 1)])}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <input
              type="checkbox"
              checked={sameEveryMonth}
              onChange={(e) => {
                const on = e.target.checked;
                setSameEveryMonth(on);
                if (on) {
                  onChange(applySameMonths(doc, focusMonth));
                }
              }}
              className="accent-[#d4a550]"
            />
            Same every month
          </label>
        </div>

        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          What you’re selling
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              {line?.volumeLabel ?? "Volume"}
            </Label>
            <Input
              type="number"
              className="mt-1 h-10 text-base"
              value={cell.volume}
              onChange={(e) => patchFocus({ volume: parseFloat(e.target.value) || 0 })}
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              {line?.priceLabel ?? "Price"}
            </Label>
            <Input
              type="number"
              className="mt-1 h-10 text-base"
              value={cell.price}
              onChange={(e) => patchFocus({ price: parseFloat(e.target.value) || 0 })}
            />
          </div>
        </div>

        <div className="mt-4 space-y-2 rounded-lg border border-slate-100 bg-slate-50/80 px-3 py-3 text-sm dark:border-slate-800 dark:bg-slate-900/40">
          <Row label="Revenue" value={money(focus?.revenue ?? 0)} strong />
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <Label className="text-xs text-slate-600 dark:text-slate-300">Gross profit %</Label>
            <Input
              type="number"
              className="h-8 w-24 text-right"
              value={doc.gpPct}
              onChange={(e) => setGp(parseFloat(e.target.value) || 0)}
            />
          </div>
          <Row label="COGS" value={money(focus?.cogs ?? 0)} muted />
          <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-center">
            <Label className="text-xs text-slate-600 dark:text-slate-300">
              Fixed overheads (this month)
            </Label>
            <Input
              type="number"
              className="h-8 w-28 text-right"
              value={monthOverheadTotal(doc, focusMonth)}
              onChange={(e) => setOverhead(parseFloat(e.target.value) || 0)}
            />
          </div>
          <Row label="What’s left (EBITDA)" value={money(focus?.ebitda ?? 0)} strong />
        </div>
      </section>

      {/* Year strip */}
      <section>
        <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Year at a glance
          </h3>
          <div className="text-[11px] text-slate-500">
            FY revenue{" "}
            <span className="font-semibold tabular-nums text-slate-800 dark:text-slate-200">
              {money(fyTotals.revenue)}
            </span>
            {" · "}
            FY-end cash{" "}
            <span
              className={`font-semibold tabular-nums ${fyTotals.closingEnd < 0 ? "text-red-600" : "text-slate-800 dark:text-slate-200"}`}
            >
              {money(fyTotals.closingEnd)}
            </span>
          </div>
        </div>
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
                    ? "bg-[#d4a550]/20 ring-1 ring-[#d4a550]"
                    : "hover:bg-slate-100 dark:hover:bg-slate-900"
                }`}
                title={`${monthLabel(r.month)} · ${money(r.revenue)}`}
              >
                <div className="flex h-14 w-full items-end justify-center">
                  <div
                    className={`w-2/3 max-w-[10px] rounded-sm ${
                      r.closingCash < 0 ? "bg-red-400/80" : "bg-[#d4a550]/80"
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
      </section>

      {/* FY totals */}
      <section className="overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800">
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
              <div className="text-[10px] uppercase tracking-wider text-slate-400">{t.l}</div>
              <div
                className={`mt-0.5 text-sm font-semibold tabular-nums ${
                  t.v < 0 ? "text-red-600" : "text-slate-900 dark:text-slate-100"
                }`}
              >
                {money(t.v)}
              </div>
            </div>
          ))}
        </div>
      </section>

      {actuals && (actuals.revenue || actuals.cogs || actuals.fixedCosts) && focus && (
        <div className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800">
          <div className="mb-2 font-semibold text-slate-700 dark:text-slate-200">
            vs {actuals.label}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <CompareMini label="Revenue" budget={focus.revenue} actual={actuals.revenue} />
            <CompareMini label="COGS" budget={focus.cogs} actual={actuals.cogs} />
            <CompareMini label="Overheads" budget={focus.overheads} actual={actuals.fixedCosts} />
          </div>
        </div>
      )}

      <div>
        <button
          type="button"
          className="text-xs font-semibold text-[#b8860b] hover:underline"
          onClick={() => setShowMore((v) => !v)}
        >
          {showMore ? "Hide more detail" : "More detail"}
        </button>
        {showMore && (
          <div className="mt-3 grid gap-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800 sm:grid-cols-3">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-slate-500">
                Opening cash
              </Label>
              <Input
                type="number"
                className="mt-1 h-8"
                value={doc.openingCash ?? 0}
                onChange={(e) =>
                  onChange({
                    ...doc,
                    openingCash: parseFloat(e.target.value) || 0,
                    updatedAt: new Date().toISOString(),
                  })
                }
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-slate-500">
                Debtor days
              </Label>
              <Input
                type="number"
                className="mt-1 h-8"
                value={doc.wc.debtorDays}
                onChange={(e) =>
                  onChange({
                    ...doc,
                    wc: { ...doc.wc, debtorDays: parseFloat(e.target.value) || 0 },
                    updatedAt: new Date().toISOString(),
                  })
                }
              />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-slate-500">
                Creditor days
              </Label>
              <Input
                type="number"
                className="mt-1 h-8"
                value={doc.wc.creditorDays}
                onChange={(e) =>
                  onChange({
                    ...doc,
                    wc: { ...doc.wc, creditorDays: parseFloat(e.target.value) || 0 },
                    updatedAt: new Date().toISOString(),
                  })
                }
              />
            </div>
            {onChangeModel && (
              <div className="sm:col-span-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-xs"
                  onClick={onChangeModel}
                >
                  Change business model
                </Button>
                <p className="mt-1 text-[11px] text-slate-500">
                  Switch to Complex for full grids, capex, sensitivity, and multi-line revenue.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  strong,
  muted,
}: {
  label: string;
  value: string;
  strong?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span
        className={`text-xs ${muted ? "text-slate-500" : "text-slate-600 dark:text-slate-300"}`}
      >
        {label}
      </span>
      <span
        className={`tabular-nums ${
          strong
            ? "text-sm font-semibold text-slate-900 dark:text-slate-100"
            : "text-xs text-slate-700 dark:text-slate-200"
        }`}
      >
        {value}
      </span>
    </div>
  );
}

function CompareMini({ label, budget, actual }: { label: string; budget: number; actual: number }) {
  const { market } = useMarket();
  const money = (n: number) => fmtBudgetMoney(n, market);
  const delta = budget - actual;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="tabular-nums text-slate-800 dark:text-slate-100">
        Budget {money(budget)} · Actual {money(actual)}
      </div>
      <div className={`tabular-nums ${delta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
        Δ {money(delta)}
      </div>
    </div>
  );
}
