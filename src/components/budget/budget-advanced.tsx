/**
 * Budget advanced drawer — benchmarks, notes, seed/push bridges (Phase 4–5).
 */

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, Sparkles, ArrowRightLeft, MessageSquarePlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { BUSINESS_TYPE_TO_BENCHMARK } from "@/lib/ratios";
import { industryBenchmarkCaption, isUsCopy } from "@/lib/market";
import { useMarket } from "@/contexts/market";
import type { BudgetDocument } from "@/lib/budget.types";
import { newId } from "@/lib/budget.templates";
import { seedBudgetFromFinancials, budgetToCashForecastPayload } from "@/lib/budget.bridges";
import { runwayWeeksFromCashflow } from "@/lib/cash-runway";
import type { CashForecastPublishPayload } from "@/lib/cash-from-banks.types";

type BenchmarkHint = {
  sector: string;
  gpP50: number | null;
  debtorP50: number | null;
};

export function BudgetAdvancedPanel({
  doc,
  onChange,
  financials,
  businessTypeId,
  role,
  clientId,
  onPushedToCash,
}: {
  doc: BudgetDocument;
  onChange: (next: BudgetDocument) => void;
  financials?: Record<string, string | number | null> | null;
  businessTypeId?: string | null;
  role: "owner" | "accountant";
  clientId?: string;
  onPushedToCash?: () => void;
}) {
  const { market } = useMarket();
  const [open, setOpen] = useState(role === "accountant");
  const [bench, setBench] = useState<BenchmarkHint | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteKind, setNoteKind] = useState<"note" | "challenge">("note");
  const [noteBy, setNoteBy] = useState(role === "accountant" ? "Accountant" : "Owner");
  const [pushing, setPushing] = useState(false);

  useEffect(() => {
    const sector = (businessTypeId && BUSINESS_TYPE_TO_BENCHMARK[businessTypeId]) || "other";
    supabase
      .from("industry_benchmarks")
      .select("metric_key, p50")
      .eq("business_type", sector)
      .in("metric_key", ["grossMargin", "debtorDays"])
      .then(({ data }) => {
        const rows = (data ?? []) as Array<{ metric_key: string; p50: number | null }>;
        const gp = rows.find((r) => r.metric_key === "grossMargin")?.p50 ?? null;
        const dd = rows.find((r) => r.metric_key === "debtorDays")?.p50 ?? null;
        setBench({ sector, gpP50: gp, debtorP50: dd });
      });
  }, [businessTypeId]);

  const gpDelta = bench?.gpP50 != null ? Math.round((doc.gpPct - bench.gpP50) * 10) / 10 : null;
  const ddDelta = bench?.debtorP50 != null ? Math.round(doc.wc.debtorDays - bench.debtorP50) : null;

  const addNote = () => {
    const text = noteText.trim();
    if (!text) return;
    onChange({
      ...doc,
      notes: [
        ...(doc.notes ?? []),
        {
          id: newId("note"),
          at: new Date().toISOString(),
          by: noteBy.trim() || "User",
          text,
          kind: noteKind,
        },
      ],
      updatedAt: new Date().toISOString(),
    });
    setNoteText("");
    toast.success(noteKind === "challenge" ? "Challenge logged" : "Note added");
  };

  const seed = () => {
    if (!financials) {
      toast.error("No financials available to seed from.");
      return;
    }
    const { doc: next, changes } = seedBudgetFromFinancials(doc, financials);
    onChange(next);
    if (!changes.length) {
      toast.message("Nothing to seed — financials look empty.");
    } else {
      toast.success(changes[0], { description: changes.slice(1).join(" · ") || undefined });
    }
  };

  const pushCash = async () => {
    if (!clientId) {
      toast.error("Select / save a client before pushing to cash forecast.");
      return;
    }
    setPushing(true);
    try {
      const payload: CashForecastPublishPayload = budgetToCashForecastPayload(doc);
      const forecastUpdatedAt = new Date().toISOString();
      const runway = runwayWeeksFromCashflow(payload);
      const { error } = await supabase
        .from("clients")
        .update({
          cashflow: payload as never,
          last_forecast_at: forecastUpdatedAt,
          ...(runway != null ? { cash_runway_weeks: runway } : {}),
        })
        .eq("id", clientId);
      if (error) throw new Error(error.message);
      toast.success("Near-term budget pushed to 13-week cash forecast.");
      onPushedToCash?.();
    } catch (e) {
      toast.error(`Push failed: ${(e as Error).message}`);
    } finally {
      setPushing(false);
    }
  };

  return (
    <section className="rounded-xl border border-slate-200/80 dark:border-slate-800">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div>
          <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
            Advanced · benchmarks, notes & bridges
          </div>
          <div className="text-[11px] text-slate-500">
            {role === "accountant"
              ? "Pressure-test assumptions, log challenges, seed from financials, push to cash forecast."
              : "Optional tools — usually filled with your accountant."}
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </button>

      {open && (
        <div className="space-y-5 border-t border-slate-100 px-4 py-4 dark:border-slate-800">
          {/* COGS mode */}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-slate-500">
                COGS mode
              </Label>
              <select
                className="mt-1 h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                value={doc.cogsMode}
                onChange={(e) =>
                  onChange({
                    ...doc,
                    cogsMode: e.target.value as BudgetDocument["cogsMode"],
                    updatedAt: new Date().toISOString(),
                  })
                }
              >
                <option value="gp_pct">Target gross profit %</option>
                <option value="per_unit">Cost per unit × volume</option>
              </select>
            </div>
            {doc.cogsMode === "per_unit" && doc.revenueLines[0] && (
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-slate-500">
                  Cost / unit ({doc.revenueLines[0].name})
                </Label>
                <Input
                  type="number"
                  className="mt-1 h-9"
                  value={doc.cogsPerUnit[doc.revenueLines[0].id] ?? 0}
                  onChange={(e) =>
                    onChange({
                      ...doc,
                      cogsPerUnit: {
                        ...doc.cogsPerUnit,
                        [doc.revenueLines[0].id]: parseFloat(e.target.value) || 0,
                      },
                      updatedAt: new Date().toISOString(),
                    })
                  }
                />
              </div>
            )}
          </div>

          {/* Benchmarks */}
          <div className="rounded-lg border border-[#d4a550]/30 bg-[#d4a550]/5 p-3 text-xs">
            <div className="font-semibold text-[#b8860b]">
              {isUsCopy(market) ? "Global SME bands" : "Industry benchmarks"}{" "}
              {bench ? `(${bench.sector})` : ""}
            </div>
            {isUsCopy(market) && (
              <p className="mt-1 text-[11px] text-slate-500">{industryBenchmarkCaption(market)}</p>
            )}
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <div className="text-slate-500">Gross margin p50</div>
                <div className="tabular-nums text-slate-900 dark:text-slate-100">
                  {bench?.gpP50 != null ? `${bench.gpP50}%` : "—"}
                  {gpDelta != null && (
                    <span className={gpDelta < 0 ? " text-red-600" : " text-emerald-600"}>
                      {" "}
                      · budget {doc.gpPct}% ({gpDelta >= 0 ? "+" : ""}
                      {gpDelta}pp)
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-slate-500">Debtor days p50</div>
                <div className="tabular-nums text-slate-900 dark:text-slate-100">
                  {bench?.debtorP50 != null ? `${bench.debtorP50}d` : "—"}
                  {ddDelta != null && (
                    <span className={ddDelta > 0 ? " text-amber-700" : " text-emerald-600"}>
                      {" "}
                      · budget {doc.wc.debtorDays}d ({ddDelta >= 0 ? "+" : ""}
                      {ddDelta}d)
                    </span>
                  )}
                </div>
              </div>
            </div>
            {gpDelta != null && gpDelta > 10 && (
              <p className="mt-2 text-amber-800 dark:text-amber-200">
                GP% is well above sector median — confirm the mix or cost assumptions.
              </p>
            )}
            {ddDelta != null && ddDelta > 20 && (
              <p className="mt-2 text-amber-800 dark:text-amber-200">
                Debtor days look long vs sector — cash trough risk rises quickly.
              </p>
            )}
          </div>

          {/* Bridges */}
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={seed}
            >
              <Sparkles className="h-3.5 w-3.5" />
              Seed from financials
            </Button>
            <Button
              type="button"
              size="sm"
              className="gap-1.5 bg-[#d4a550] text-xs text-[#0a0e1a] hover:bg-[#c49a45]"
              disabled={pushing || !clientId}
              onClick={pushCash}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              {pushing ? "Pushing…" : "Push to cash forecast"}
            </Button>
          </div>
          <p className="text-[11px] text-slate-500">
            Seed fills GP%, monthly revenue equiv., overheads and WC days from period financials.
            Push writes months 1–3 averages into the 13-week cash forecast (replace).
          </p>

          {/* Notes / challenges */}
          <div className="space-y-2">
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Participative notes
            </div>
            <div className="grid gap-2 sm:grid-cols-4">
              <Input
                value={noteBy}
                onChange={(e) => setNoteBy(e.target.value)}
                placeholder="Your name"
                className="h-9 sm:col-span-1"
              />
              <select
                className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-950"
                value={noteKind}
                onChange={(e) => setNoteKind(e.target.value as "note" | "challenge")}
              >
                <option value="note">Note</option>
                <option value="challenge">Challenge</option>
              </select>
              <div className="sm:col-span-2">
                <Textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="e.g. Owner wants 45% GP — industry median is 32%"
                  rows={2}
                  className="min-h-[36px] resize-none text-sm"
                />
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5 text-xs"
              onClick={addNote}
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              Add to log
            </Button>
            <ul className="space-y-2">
              {[...(doc.notes ?? [])].reverse().map((n) => (
                <li
                  key={n.id}
                  className={`rounded-lg border px-3 py-2 text-xs ${
                    n.kind === "challenge"
                      ? "border-amber-500/40 bg-amber-500/10"
                      : "border-slate-200 dark:border-slate-800"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-wider text-slate-500">
                    <span>{n.kind}</span>
                    <span>·</span>
                    <span>{n.by}</span>
                    <span>·</span>
                    <span>
                      {new Date(n.at).toLocaleString("en-GB", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <div className="mt-1 text-slate-800 dark:text-slate-100">{n.text}</div>
                </li>
              ))}
              {!(doc.notes ?? []).length && (
                <li className="text-[11px] text-slate-500">No notes yet.</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
