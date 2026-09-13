/**
 * Founder-facing Simple budget — one month at a time, volume × price,
 * visible COGS + overhead, year strip, FY totals. No spreadsheet noise.
 */

import { useMemo, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CollapsibleGoldCard } from "@/components/primitives/collapsible-gold-card";
import type { BudgetActuals, BudgetDocument, BudgetScenarioId } from "@/lib/budget.types";
import { BUDGET_TEMPLATES } from "@/lib/budget.templates";
import {
  budgetWindowLabel,
  fyMonths,
  formatMonthLabel as formatMonthLabelMarket,
} from "@/lib/budget.months";
import { computeBudgetMonths, fmtBudgetMoney, lowestCashTrough } from "@/lib/budget.compute";
import { currencySymbol } from "@/lib/market";
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
  role = "owner",
}: {
  doc: BudgetDocument;
  onChange: (next: BudgetDocument) => void;
  actuals?: BudgetActuals | null;
  onChangeModel?: () => void;
  role?: "owner" | "accountant";
}) {
  const { market } = useMarket();
  const money = (n: number) => fmtBudgetMoney(n, market);
  const symbol = currencySymbol(market);
  const monthLabel = (ym: string) => formatMonthLabelMarket(ym, market);
  const months = useMemo(() => fyMonths(doc.fyStart), [doc.fyStart]);
  const [focusMonth, setFocusMonth] = useState(() => {
    const now = new Date();
    const cur = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    return months.includes(cur) ? cur : months[0];
  });
  const [sameEveryMonth, setSameEveryMonth] = useState(false);

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
                s.warn ? "border-red-500/40 bg-red-500/10" : "border-[#d4a550]/35 bg-[#fffdf8] dark:bg-slate-900"
              }`}
            >
              <div className="text-[10px] font-semibold uppercase tracking-wider text-[#b8860b]">
                {s.l}
              </div>
              <div className="mt-1 text-xl font-semibold tabular-nums text-[#0f172a] dark:text-slate-100">
                {money(s.v)}
              </div>
              <div className="text-[11px] text-slate-500">{s.sub}</div>
            </div>
          ))}
        </div>
      )}

      {/* Month engine — volume × price, then margin and overheads */}
      <section
        id="wizard-budget-month-engine"
        className="budget-month-engine relative overflow-hidden rounded-2xl border border-[#d4a550]/30 bg-gradient-to-b from-[#fffdf8] to-white p-5 shadow-[0_18px_40px_rgba(120,90,10,0.06)] dark:from-slate-950 dark:to-slate-950 dark:border-slate-800 sm:p-6"
      >
        <div className="pointer-events-none absolute inset-y-5 left-0 w-0.5 rounded-full bg-gradient-to-b from-[#ac8400] via-[#d4af37] to-[#fdee79]" />
        <div className="flex flex-wrap items-start justify-between gap-3 pl-3 sm:pl-4">
          <div className="min-w-0 max-w-xl">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#b8860b]">
              {role === "accountant" ? "Month engine" : "This month"}
            </p>
            <h3 className="serif mt-1 text-[22px] font-semibold tracking-tight text-[#1b1608] dark:text-slate-100">
              How {monthLabel(focusMonth)} is built
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-[#6b6354] dark:text-slate-400">
              {role === "accountant"
                ? "How many they sell × the price they charge becomes revenue. Gross profit % takes cost of sales. Overheads are the rest. The graph and tiles above follow these four numbers."
                : "How many you sell × the price you charge becomes this month’s revenue. Set the margin, then overheads — leftover is what the month keeps."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center rounded-full border border-[#d4a550]/35 bg-white/80 p-0.5 dark:border-slate-700 dark:bg-slate-900">
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full text-[#8a6508] disabled:opacity-30 dark:text-[#e1b85e]"
                disabled={focusIdx <= 0}
                onClick={() => setFocusMonth(months[Math.max(0, focusIdx - 1)])}
                aria-label="Previous month"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <div className="min-w-[7.5rem] px-1 text-center text-[13px] font-semibold tabular-nums text-[#1b1608] dark:text-slate-100">
                {monthLabel(focusMonth)}
              </div>
              <button
                type="button"
                className="grid h-8 w-8 place-items-center rounded-full text-[#8a6508] disabled:opacity-30 dark:text-[#e1b85e]"
                disabled={focusIdx >= months.length - 1}
                onClick={() => setFocusMonth(months[Math.min(months.length - 1, focusIdx + 1)])}
                aria-label="Next month"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <button
              type="button"
              onClick={() => {
                const on = !sameEveryMonth;
                setSameEveryMonth(on);
                if (on) onChange(applySameMonths(doc, focusMonth));
              }}
              className={`rounded-full border px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors ${
                sameEveryMonth
                  ? "border-[#d4a550] bg-[#d4a550] text-[#1b1300]"
                  : "border-[#d4a550]/40 bg-transparent text-[#8a6508] hover:border-[#d4a550] dark:text-[#e1b85e]"
              }`}
            >
              {sameEveryMonth ? "Same every month · on" : "Same every month"}
            </button>
          </div>
        </div>

        <div className="mt-5 grid items-stretch gap-3 pl-3 sm:pl-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
          <DriverPad
            kicker="How many"
            label={line?.volumeLabel ?? "Volume"}
            hint={line?.name ? `${line.name}` : "Units they move this month"}
          >
            <Input
              type="number"
              inputMode="decimal"
              aria-label={line?.volumeLabel ?? "Volume"}
              className="budget-driver-input mt-2 h-12 border-0 bg-transparent px-0 text-2xl font-semibold tabular-nums shadow-none focus-visible:ring-0"
              value={cell.volume}
              onChange={(e) => patchFocus({ volume: parseFloat(e.target.value) || 0 })}
            />
          </DriverPad>
          <EquationOp symbol="×" label="times" />
          <DriverPad
            kicker="At what price"
            label={line?.priceLabel ?? "Price"}
            hint={`Per unit, ${symbol}`}
          >
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-lg font-medium text-[#b8860b]">{symbol}</span>
              <Input
                type="number"
                inputMode="decimal"
                aria-label={line?.priceLabel ?? "Price"}
                className="budget-driver-input h-12 border-0 bg-transparent px-0 text-2xl font-semibold tabular-nums shadow-none focus-visible:ring-0"
                value={cell.price}
                onChange={(e) => patchFocus({ price: parseFloat(e.target.value) || 0 })}
              />
            </div>
          </DriverPad>
          <EquationOp symbol="=" label="equals" />
          <DriverPad
            kicker="This month’s revenue"
            label="Computed"
            hint="Volume × price — not typed"
            result
          >
            <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-[#1b1608] dark:text-slate-100">
              {money(focus?.revenue ?? 0)}
            </p>
          </DriverPad>
        </div>

        <div className="mt-4 space-y-0 overflow-hidden rounded-xl border border-[#d4a550]/20 bg-white/70 pl-3 dark:bg-slate-950/40 sm:pl-4">
          <CascadeRow
            kicker="Keep as gross profit"
            label="Gross profit %"
            hint="Share of revenue left after cost of sales"
          >
            <div className="flex items-center gap-3">
              <Input
                type="number"
                inputMode="decimal"
                aria-label="Gross profit percent"
                className="budget-driver-input h-10 w-20 border-0 bg-transparent px-0 text-right text-lg font-semibold tabular-nums shadow-none focus-visible:ring-0"
                value={doc.gpPct}
                onChange={(e) => setGp(parseFloat(e.target.value) || 0)}
              />
              <span className="text-sm font-semibold text-[#b8860b]">%</span>
              <span className="hidden text-[13px] tabular-nums text-[#6b6354] sm:inline dark:text-slate-400">
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
            <span className="text-[15px] font-semibold tabular-nums text-[#6b6354] dark:text-slate-300">
              {money(focus?.cogs ?? 0)}
            </span>
          </CascadeRow>
          <CascadeRow
            kicker="Then pay"
            label="Fixed overheads"
            hint="Rent, salaries, keep-the-lights-on this month"
          >
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-[#b8860b]">{symbol}</span>
              <Input
                type="number"
                inputMode="decimal"
                aria-label="Fixed overheads this month"
                className="budget-driver-input h-10 w-28 border-0 bg-transparent px-0 text-right text-lg font-semibold tabular-nums shadow-none focus-visible:ring-0"
                value={monthOverheadTotal(doc, focusMonth)}
                onChange={(e) => setOverhead(parseFloat(e.target.value) || 0)}
              />
            </div>
          </CascadeRow>
          <CascadeRow
            kicker="Leftover"
            label="What’s left (EBITDA)"
            hint="After cost of sales and overheads — before interest, tax, cash timing"
            emphasis
          >
            <span className="text-lg font-semibold tabular-nums text-[#1b1608] dark:text-slate-100">
              {money(focus?.ebitda ?? 0)}
            </span>
          </CascadeRow>
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
            <div key={t.l} className="bg-[#fffdf8] px-3 py-2.5 dark:bg-slate-950">
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

      <CollapsibleGoldCard
        id="wizard-budget-cash-timing"
        icon={Wallet}
        title="Cash timing"
        subtitle={
          role === "accountant"
            ? "How this profit turns into cash in the bank. Closed until you need it — the month engine above already builds the P&L."
            : "Opening bank balance and how quickly money is collected and paid. Open if month-end cash looks off."
        }
        defaultOpen={false}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              Opening cash
            </Label>
            <Input
              type="number"
              className="mt-1 h-9"
              value={doc.openingCash ?? 0}
              onChange={(e) =>
                onChange({
                  ...doc,
                  openingCash: parseFloat(e.target.value) || 0,
                  updatedAt: new Date().toISOString(),
                })
              }
            />
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
              {role === "accountant"
                ? "Cash in the bank on day one of this financial year. Month-end cash stacks on this number, so closing cash is only as true as this start."
                : "The bank balance at the start of the year. Everything below is added to or taken from this."}
            </p>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              Debtor days
            </Label>
            <Input
              type="number"
              className="mt-1 h-9"
              value={doc.wc.debtorDays}
              onChange={(e) =>
                onChange({
                  ...doc,
                  wc: { ...doc.wc, debtorDays: parseFloat(e.target.value) || 0 },
                  updatedAt: new Date().toISOString(),
                })
              }
            />
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
              {role === "accountant"
                ? "How many days customers typically take to pay. Longer days delay cash even when the month’s profit looks fine — this is what creates a cash trough."
                : "How long customers take to pay you. Longer = cash arrives later than the sale."}
            </p>
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              Creditor days
            </Label>
            <Input
              type="number"
              className="mt-1 h-9"
              value={doc.wc.creditorDays}
              onChange={(e) =>
                onChange({
                  ...doc,
                  wc: { ...doc.wc, creditorDays: parseFloat(e.target.value) || 0 },
                  updatedAt: new Date().toISOString(),
                })
              }
            />
            <p className="mt-1.5 text-[11px] leading-snug text-slate-500">
              {role === "accountant"
                ? "How many days this business typically takes to pay suppliers. Longer days hold cash in; shorter days pull it out sooner."
                : "How long you take to pay suppliers. Longer = cash stays in the business a bit longer."}
            </p>
          </div>
        </div>
        {onChangeModel && (
          <div className="mt-5 border-t border-amber-900/10 pt-4 dark:border-slate-800">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="text-xs"
              onClick={onChangeModel}
            >
              Change business model
            </Button>
            <p className="mt-1.5 max-w-xl text-[11px] leading-snug text-slate-500">
              {role === "accountant"
                ? "Only if volume × price is the wrong shape for this client — multiple products, capex, or a full grid. Leave it if the month engine already fits."
                : "Switch to Complex for full grids, capex, and more than one product line."}
            </p>
          </div>
        )}
      </CollapsibleGoldCard>
    </div>
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
          ? "border-[#d4a550]/45 bg-[linear-gradient(160deg,rgba(212,175,55,0.12),rgba(255,253,248,0.95))] dark:bg-slate-900"
          : "border-[#d4a550]/22 bg-[#fffdf8] dark:border-slate-700 dark:bg-slate-900"
      }`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#b8860b]">{kicker}</p>
      <p className="mt-0.5 text-[13px] font-semibold text-[#1b1608] dark:text-slate-100">{label}</p>
      <p className="text-[11px] text-[#98917f] dark:text-slate-500">{hint}</p>
      {children}
    </div>
  );
}

function EquationOp({ symbol, label }: { symbol: string; label: string }) {
  return (
    <div
      className="flex items-center justify-center self-center text-xl font-semibold text-[#d4a550]"
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
      className={`flex flex-wrap items-center justify-between gap-3 border-b border-[#d4a550]/12 py-3 last:border-b-0 ${
        emphasis ? "bg-[rgba(212,175,55,0.06)] pr-3" : ""
      } ${muted ? "opacity-90" : ""}`}
    >
      <div className="min-w-[12rem] pr-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#b8860b]">{kicker}</p>
        <p
          className={`text-[13.5px] font-semibold ${
            muted ? "text-[#6b6354] dark:text-slate-400" : "text-[#1b1608] dark:text-slate-100"
          }`}
        >
          {label}
        </p>
        <p className="max-w-md text-[11px] leading-snug text-[#98917f] dark:text-slate-500">{hint}</p>
      </div>
      <div className="ml-auto">{children}</div>
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
