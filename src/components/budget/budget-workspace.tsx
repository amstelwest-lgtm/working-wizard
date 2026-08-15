/**
 * Budget workspace — drivers, monthly P&L, cash, scenarios, actuals compare.
 */

import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type {
  BudgetActuals,
  BudgetDocument,
  BudgetScenarioId,
  UnmappedDriver,
} from "@/lib/budget.types";
import { BUDGET_TEMPLATES, newId } from "@/lib/budget.templates";
import { fyMonths, formatMonthLabel } from "@/lib/budget.months";
import { computeBudgetMonths, fmtZar, lowestCashTrough } from "@/lib/budget.compute";
import {
  keepUnmappedAsExtraLine,
  reassignUnmappedDriver,
} from "@/lib/budget.model-change";
import { BudgetSimpleView } from "@/components/budget/budget-simple-view";
import { BudgetVariancePanel } from "@/components/budget/budget-variance-panel";

const SCENARIOS: BudgetScenarioId[] = ["base", "upside", "downside"];

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
}) {
  if (simplified) {
    return (
      <div className="space-y-4">
        {unmappedReview && unmappedReview.length > 0 && (
          <UnmappedReviewBlock
            items={unmappedReview}
            doc={doc}
            onChange={onChange}
            onClear={onClearUnmapped}
          />
        )}
        {/* Plan first — variance is a monthly check, not the hero */}
        <BudgetSimpleView
          doc={doc}
          onChange={onChange}
          actuals={actuals}
          onChangeModel={onChangeModel}
        />
        <BudgetVariancePanel clientId={clientId} doc={doc} />
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
    />
  );
}

function UnmappedReviewBlock({
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
    <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
      <div className="text-sm font-semibold text-amber-900 dark:text-amber-200">
        Review unmapped drivers
      </div>
      <p className="mt-1 text-xs text-amber-800/80 dark:text-amber-200/70">
        These came from your previous model and have no matching key. Reassign or keep as an
        extra line — we never silently discard.
      </p>
      <ul className="mt-3 space-y-2">
        {items.map((u) => (
          <li
            key={u.id}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-500/20 bg-white/60 px-3 py-2 dark:bg-slate-950/40"
          >
            <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
              {u.name} <span className="text-xs text-slate-500">({u.driverKey})</span>
            </span>
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
        Discard remaining unmapped
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
}: {
  doc: BudgetDocument;
  onChange: (next: BudgetDocument) => void;
  actuals?: BudgetActuals | null;
  unmappedReview?: UnmappedDriver[] | null;
  onClearUnmapped?: () => void;
  onChangeModel?: () => void;
  role?: "owner" | "accountant";
  clientId?: string;
}) {
  const months = useMemo(() => fyMonths(doc.fyStart), [doc.fyStart]);
  const focusMonths = months;
  const [focusMonth, setFocusMonth] = useState(months[0] ?? doc.fyStart);
  const results = useMemo(
    () => computeBudgetMonths(doc, doc.activeScenario),
    [doc],
  );
  const baseResults = useMemo(() => computeBudgetMonths(doc, "base"), [doc]);
  const focus = results.find((r) => r.month === focusMonth) ?? results[0];
  const baseFocus = baseResults.find((r) => r.month === focusMonth) ?? baseResults[0];
  const trough = useMemo(() => lowestCashTrough(results), [results]);
  const tpl = BUDGET_TEMPLATES[doc.templateId];
  const fyTotals = useMemo(() => {
    const sum = (fn: (r: (typeof results)[0]) => number) =>
      results.reduce((a, r) => a + fn(r), 0);
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

  const patchLine = (lineId: string, month: string, patch: Partial<{ volume: number; price: number }>) => {
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

  return (
    <div className="space-y-6">
      {/* Header strip */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b8860b]">
            {tpl.label} · FY from {formatMonthLabel(doc.fyStart)}
          </p>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Budget</h2>
          <p className="text-xs text-slate-500">
            Drivers first — volume and price stay separate. Cash uses debtor/creditor timing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
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
          {onChangeModel && (
            <Button type="button" variant="outline" size="sm" className="text-xs" onClick={onChangeModel}>
              Change model
            </Button>
          )}
        </div>
      </div>

      {unmappedReview && unmappedReview.length > 0 && (
        <UnmappedReviewBlock
          items={unmappedReview}
          doc={doc}
          onChange={onChange}
          onClear={onClearUnmapped}
        />
      )}

      <BudgetVariancePanel clientId={clientId} doc={doc} />

      {/* Assumptions */}
      <section className="grid gap-3 rounded-xl border border-slate-200/80 bg-white/70 p-4 dark:border-slate-800 dark:bg-slate-950/50 sm:grid-cols-3 lg:grid-cols-6">
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-slate-500">Opening cash</Label>
          <Input
            type="number"
            value={doc.openingCash ?? 0}
            onChange={(e) =>
              onChange({
                ...doc,
                openingCash: parseFloat(e.target.value) || 0,
                updatedAt: new Date().toISOString(),
              })
            }
            className="mt-1 h-8"
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-slate-500">Gross profit %</Label>
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
          <Label className="text-[10px] uppercase tracking-wider text-slate-500">Debtor days</Label>
          <Input
            type="number"
            value={doc.wc.debtorDays}
            onChange={(e) =>
              onChange({
                ...doc,
                wc: { ...doc.wc, debtorDays: parseFloat(e.target.value) || 0 },
                updatedAt: new Date().toISOString(),
              })
            }
            className="mt-1 h-8"
          />
        </div>
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-slate-500">Creditor days</Label>
          <Input
            type="number"
            value={doc.wc.creditorDays}
            onChange={(e) =>
              onChange({
                ...doc,
                wc: { ...doc.wc, creditorDays: parseFloat(e.target.value) || 0 },
                updatedAt: new Date().toISOString(),
              })
            }
            className="mt-1 h-8"
          />
        </div>
        {doc.showInventoryDays ? (
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">Inventory days</Label>
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
        ) : (
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">VAT rate %</Label>
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
        )}
        <div>
          <Label className="text-[10px] uppercase tracking-wider text-slate-500">VAT mode</Label>
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
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">VAT rate %</Label>
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
      </section>

      {/* Revenue drivers */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Revenue drivers</h3>
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
        {doc.revenueLines.map((line) => (
          <div
            key={line.id}
            className="overflow-x-auto rounded-xl border border-slate-200/80 bg-white/70 dark:border-slate-800 dark:bg-slate-950/40"
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 dark:border-slate-800">
              <Input
                value={line.name}
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
              <span className="text-[10px] uppercase tracking-wider text-slate-400">{line.driverKey}</span>
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
            <table className="w-full min-w-[640px] text-xs">
              <thead>
                <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
                  <th className="px-3 py-2">Driver</th>
                  {focusMonths.map((m) => (
                    <th key={m} className="px-2 py-2 text-right">
                      {formatMonthLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-3 py-1 text-slate-500">{line.volumeLabel}</td>
                  {focusMonths.map((m) => (
                    <td key={m} className="px-1 py-1">
                      <Input
                        type="number"
                        className="h-7 text-right"
                        value={line.months[m]?.volume ?? 0}
                        onChange={(e) =>
                          patchLine(line.id, m, { volume: parseFloat(e.target.value) || 0 })
                        }
                      />
                    </td>
                  ))}
                </tr>
                <tr>
                  <td className="px-3 py-1 text-slate-500">{line.priceLabel}</td>
                  {focusMonths.map((m) => (
                    <td key={m} className="px-1 py-1">
                      <Input
                        type="number"
                        className="h-7 text-right"
                        value={line.months[m]?.price ?? 0}
                        onChange={(e) =>
                          patchLine(line.id, m, { price: parseFloat(e.target.value) || 0 })
                        }
                      />
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
                        {fmtZar(cell.volume * cell.price)}
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
                    {fmtZar(
                      focusMonths.reduce((s, m) => {
                        const cell = line.months[m] ?? { volume: 0, price: 0 };
                        return s + cell.volume * cell.price;
                      }, 0),
                    )}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        ))}
      </section>

      {/* Overheads */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Fixed overheads</h3>
        <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800">
          <table className="w-full min-w-[640px] text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-400 dark:border-slate-800">
                <th className="px-3 py-2">Bucket</th>
                {focusMonths.map((m) => (
                  <th key={m} className="px-2 py-2 text-right">
                    {formatMonthLabel(m)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {doc.overheads.map((oh) => (
                <tr key={oh.id} className="border-b border-slate-50 dark:border-slate-900">
                  <td className="px-3 py-1 font-medium text-slate-700 dark:text-slate-200">{oh.name}</td>
                  {focusMonths.map((m) => (
                    <td key={m} className="px-1 py-1">
                      <Input
                        type="number"
                        className="h-7 text-right"
                        value={oh.months[m] ?? 0}
                        onChange={(e) => patchOverhead(oh.id, m, parseFloat(e.target.value) || 0)}
                      />
                    </td>
                  ))}
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
                    {fmtZar(doc.overheads.reduce((s, oh) => s + (oh.months[m] ?? 0), 0))}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-slate-200 dark:border-slate-700">
                <td className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  FY total
                </td>
                <td
                  colSpan={focusMonths.length}
                  className="px-2 py-1.5 text-right text-xs font-semibold tabular-nums"
                >
                  {fmtZar(
                    focusMonths.reduce(
                      (s, m) =>
                        s + doc.overheads.reduce((a, oh) => a + (oh.months[m] ?? 0), 0),
                      0,
                    ),
                  )}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      {/* Capex — available for every model; collapsed by default */}
      <details className="group rounded-xl border border-slate-200/80 open:bg-white/70 dark:border-slate-800 dark:open:bg-slate-950/40">
        <summary className="cursor-pointer list-none px-4 py-3 marker:content-none">
          <div className="flex items-center justify-between gap-2">
            <div>
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
            <p className="text-xs text-slate-500">No capex lines yet — add up to three planned purchases.</p>
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
                        capex: doc.capex.map((x) => (x.id === c.id ? { ...x, name: e.target.value } : x)),
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
                        capex: doc.capex.map((x) => (x.id === c.id ? { ...x, month: e.target.value } : x)),
                        updatedAt: new Date().toISOString(),
                      })
                    }
                  >
                    {months.map((m) => (
                      <option key={m} value={m}>
                        {formatMonthLabel(m)}
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
                            ? { ...x, usefulLifeMonths: Math.max(1, parseInt(e.target.value, 10) || 36) }
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
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Sensitivity (active scenario)</h3>
        <p className="mb-3 text-xs text-slate-500">
          Tweaks factors on {doc.scenarios[doc.activeScenario].label}. Base stays at 1.0× unless you edit it.
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
              className="mt-2 w-full accent-[#d4a550]"
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
              className="mt-2 w-full accent-[#d4a550]"
            />
          </div>
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-slate-500">
              Debtor days Δ ({(doc.scenarios[doc.activeScenario].debtorDaysDelta ?? 0) >= 0 ? "+" : ""}
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
              className="mt-2 w-full accent-[#d4a550]"
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
                Focus: {formatMonthLabel(m)}
              </option>
            ))}
          </select>
        </div>

        {focus && (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {[
              { l: "Revenue", v: focus.revenue },
              { l: "Gross profit", v: focus.grossProfit },
              { l: "EBITDA", v: focus.ebitda },
              { l: "EBIT", v: focus.ebit },
              { l: "Closing cash", v: focus.closingCash },
            ].map((s) => (
              <div
                key={s.l}
                className="rounded-xl border border-[#d4a550]/25 bg-[#d4a550]/5 px-3 py-3"
              >
                <div className="text-[10px] font-semibold uppercase tracking-wider text-[#b8860b]">
                  {s.l}
                </div>
                <div className="mt-1 text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                  {fmtZar(s.v)}
                </div>
              </div>
            ))}
          </div>
        )}

        {trough && (
          <div
            className={`rounded-lg border px-3 py-2 text-xs ${
              trough.closingCash < 0
                ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
                : "border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
            }`}
          >
            Cash trough: <strong>{formatMonthLabel(trough.month)}</strong> at{" "}
            <strong className="tabular-nums">{fmtZar(trough.closingCash)}</strong>
            {doc.activeScenario !== "base" && baseFocus && focus && (
              <span className="ml-2 text-slate-500">
                · vs base focus month cash {fmtZar(baseFocus.closingCash)} (Δ{" "}
                {fmtZar(focus.closingCash - baseFocus.closingCash)})
              </span>
            )}
          </div>
        )}

        {actuals && (actuals.revenue || actuals.cogs || actuals.fixedCosts) && focus && (
          <div className="rounded-xl border border-slate-200 p-3 text-xs dark:border-slate-800">
            <div className="mb-2 font-semibold text-slate-700 dark:text-slate-200">
              vs {actuals.label}
            </div>
            <div className="grid gap-2 sm:grid-cols-3">
              <CompareRow label="Revenue" budget={focus.revenue} actual={actuals.revenue ?? 0} />
              <CompareRow label="COGS" budget={focus.cogs} actual={actuals.cogs ?? 0} />
              <CompareRow label="Overheads" budget={focus.overheads} actual={actuals.fixedCosts ?? 0} />
            </div>
          </div>
        )}

        <div className="overflow-x-auto rounded-xl border border-slate-200/80 dark:border-slate-800">
          <table className="w-full min-w-[880px] text-xs">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wider text-slate-400 dark:border-slate-800">
                <th className="px-3 py-2">Month</th>
                <th className="px-2 py-2 text-right">Revenue</th>
                <th className="px-2 py-2 text-right">COGS</th>
                <th className="px-2 py-2 text-right">GP%</th>
                <th className="px-2 py-2 text-right">Overheads</th>
                <th className="px-2 py-2 text-right">Deprec.</th>
                <th className="px-2 py-2 text-right">EBIT</th>
                <th className="px-2 py-2 text-right">VAT net</th>
                <th className="px-2 py-2 text-right">Net cash</th>
                <th className="px-2 py-2 text-right">Closing cash</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr
                  key={r.month}
                  className={`border-b border-slate-50 dark:border-slate-900 ${
                    r.month === focusMonth ? "bg-[#d4a550]/10" : ""
                  }`}
                >
                  <td className="px-3 py-1.5 font-medium">{formatMonthLabel(r.month)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtZar(r.revenue)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtZar(r.cogs)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{r.gpPct.toFixed(1)}%</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtZar(r.overheads)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtZar(r.depreciation)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtZar(r.ebit)}</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">{fmtZar(r.vatNet)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${r.netCash < 0 ? "text-red-600" : ""}`}>
                    {fmtZar(r.netCash)}
                  </td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${r.closingCash < 0 ? "text-red-600" : ""}`}>
                    {fmtZar(r.closingCash)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold dark:border-slate-600 dark:bg-slate-900/50">
                <td className="px-3 py-2 text-[10px] uppercase tracking-wider text-slate-500">
                  FY total
                </td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtZar(fyTotals.revenue)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtZar(fyTotals.cogs)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-slate-400">—</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtZar(fyTotals.overheads)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtZar(fyTotals.depreciation)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtZar(fyTotals.ebit)}</td>
                <td className="px-2 py-2 text-right tabular-nums">{fmtZar(fyTotals.vatNet)}</td>
                <td
                  className={`px-2 py-2 text-right tabular-nums ${fyTotals.netCash < 0 ? "text-red-600" : ""}`}
                >
                  {fmtZar(fyTotals.netCash)}
                </td>
                <td
                  className={`px-2 py-2 text-right tabular-nums ${fyTotals.closingEnd < 0 ? "text-red-600" : ""}`}
                  title="FY-end closing cash (not a sum of monthly closings)"
                >
                  {fmtZar(fyTotals.closingEnd)}
                  <span className="ml-1 text-[9px] font-normal text-slate-400">end</span>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {role === "accountant" && (
          <p className="text-[11px] text-slate-500">
            Accountant view: full FY grid in complex mode. Challenge driver assumptions against benchmarks before sign-off.
          </p>
        )}
      </section>
    </div>
  );
}

function CompareRow({
  label,
  budget,
  actual,
}: {
  label: string;
  budget: number;
  actual: number;
}) {
  const delta = budget - actual;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
      <div className="tabular-nums text-slate-800 dark:text-slate-100">
        Budget {fmtZar(budget)} · Actual {fmtZar(actual)}
      </div>
      <div className={`tabular-nums ${delta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
        Δ {fmtZar(delta)}
      </div>
    </div>
  );
}
