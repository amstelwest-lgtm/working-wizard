/**
 * Budget advanced drawer — benchmarks, notes, seed/push bridges (Phase 4–5).
 */

import { useEffect, useState } from "react";
import { Sparkles, ArrowRightLeft, MessageSquarePlus, Gauge } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CollapsibleGoldCard } from "@/components/primitives/collapsible-gold-card";
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
    <CollapsibleGoldCard
      id="wizard-budget-advanced"
      icon={Gauge}
      title={role === "accountant" ? "Industry check, notes & connections" : "Checks, notes & connections"}
      subtitle={
        role === "accountant"
          ? "Optional. Open to pressure-test the plan vs the industry, leave a working note on this file, copy last year’s pack into the budget, or send near-term numbers to the 13-week cash forecast."
          : "Optional tools — usually filled with your accountant. Closed until you need them."
      }
      defaultOpen={false}
    >
      <div className="space-y-6">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#b8860b]">
            Industry check
          </p>
          <h3 className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Is this plan realistic for the sector?
          </h3>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-slate-500">
            {role === "accountant"
              ? "Compares this budget’s gross margin and debtor days to the sector median. Use it to challenge an optimistic GP% or slow collections — not as a second place to type the month."
              : "Shows how your margin and customer payment days sit against a typical business in this sector."}
          </p>
          <div className="mt-3 rounded-lg border border-[#d4a550]/30 bg-[#d4a550]/5 p-3 text-xs">
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
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#b8860b]">
            Cost of goods
          </p>
          <h3 className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
            How should COGS be calculated?
          </h3>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-slate-500">
            {role === "accountant"
              ? "The month engine above uses a target gross-profit %. Keep that unless this client prices from a known unit cost — then switch to cost-per-unit and we multiply by volume instead."
              : "Most businesses set a target margin. Switch to cost per unit only if you know exactly what each sale costs to make."}
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
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
                <option value="gp_pct">Target gross profit % — we back into COGS</option>
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
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#b8860b]">
            Connections
          </p>
          <h3 className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Pull from last year’s pack, or send to the 13-week cash forecast
          </h3>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-slate-500">
            {role === "accountant"
              ? "“Seed from financials” copies the annual pack already on Financials into this budget as a starting point — do it once when the plan is empty. It is not monthly actuals. Monthly P&Ls belong in Budget vs actuals. “Push to cash forecast” writes months 1–3 averages into the 13-week view (replace)."
              : "Seed fills this budget from last year’s figures. Push sends the next few months into the 13-week cash forecast."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
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
        </div>

        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#b8860b]">
            File notes
          </p>
          <h3 className="mt-0.5 text-sm font-semibold text-slate-900 dark:text-slate-100">
            Working papers on this budget
          </h3>
          <p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-slate-500">
            {role === "accountant"
              ? "These stay on this client’s budget file. They are not emailed to client management. Use a note to record why a number was set. Use a challenge when you do not yet believe a figure — so the next person on this file can see the disagreement."
              : "Notes live on this budget so you and your accountant remember why a number was set. They are not sent as a message."}
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
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
              <option value="note">Note — why this number</option>
              <option value="challenge">Challenge — I don’t buy this yet</option>
            </select>
            <div className="sm:col-span-2">
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={
                  role === "accountant"
                    ? "e.g. Owner wants 45% GP — sector median is 32%. Holding as a challenge until mix is evidenced."
                    : "e.g. New contract starts in June — volume steps up then."
                }
                rows={2}
                className="min-h-[36px] resize-none text-sm"
              />
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="mt-2 gap-1.5 text-xs"
            onClick={addNote}
          >
            <MessageSquarePlus className="h-3.5 w-3.5" />
            Add to this file
          </Button>
          <ul className="mt-3 space-y-2">
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
              <li className="text-[11px] text-slate-500">
                No notes on this file yet. Empty is fine — add one only when a number needs a reason.
              </li>
            )}
          </ul>
        </div>
      </div>
    </CollapsibleGoldCard>
  );
}
