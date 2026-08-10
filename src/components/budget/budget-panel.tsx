/**
 * BudgetPanel — shared owner + accountant Budget tab.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BudgetFunnel } from "@/components/budget/budget-funnel";
import { BudgetWorkspace } from "@/components/budget/budget-workspace";
import type { BudgetActuals, BudgetDocument, UnmappedDriver } from "@/lib/budget.types";
import { createBudgetDocument, currentFyStart } from "@/lib/budget.months";
import { normalizeBudgetDocument } from "@/lib/budget.compute";
import { applyTemplateChange } from "@/lib/budget.model-change";
import { BUDGET_TEMPLATES } from "@/lib/budget.templates";
import type { BudgetQualification, BudgetTemplateId } from "@/lib/budget.types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

export function BudgetPanel({
  clientId,
  simplified,
  role = "owner",
  financials,
  fyStartMonthDefault = 3,
}: {
  clientId?: string;
  simplified?: boolean;
  role?: "owner" | "accountant";
  financials?: Record<string, string> | null;
  fyStartMonthDefault?: number;
}) {
  const [loaded, setLoaded] = useState(!clientId);
  const [doc, setDoc] = useState<BudgetDocument | null>(null);
  const [showFunnel, setShowFunnel] = useState(false);
  const [unmapped, setUnmapped] = useState<UnmappedDriver[] | null>(null);
  const [pendingChange, setPendingChange] = useState<{
    result: ReturnType<typeof applyTemplateChange>;
    mode: "apply" | "fresh";
  } | null>(null);
  const [lowOverlapOpen, setLowOverlapOpen] = useState(false);
  const [snapshotActuals, setSnapshotActuals] = useState<BudgetActuals | null>(null);
  const skipAutosave = useRef(false);

  useEffect(() => {
    if (!clientId) {
      setLoaded(true);
      return;
    }
    supabase
      .from("clients")
      .select("budget, financial_year_start_month")
      .eq("id", clientId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          // Column may not exist until migration — still allow local draft
          console.warn("budget load:", error.message);
        }
        const budget = (data as { budget?: BudgetDocument | null } | null)?.budget ?? null;
        if (budget && budget.version === 1) {
          skipAutosave.current = true;
          setDoc(normalizeBudgetDocument(budget));
          setShowFunnel(false);
        } else {
          setDoc(null);
          setShowFunnel(true);
        }
        setLoaded(true);
      });
  }, [clientId]);

  // Prefer latest financial snapshot for budget-vs-actuals; fall back to live financials.
  useEffect(() => {
    if (!clientId) {
      setSnapshotActuals(null);
      return;
    }
    supabase
      .from("client_financial_snapshots")
      .select("period_label, financials")
      .eq("client_id", clientId)
      .order("period_date", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const fin = (data as { period_label?: string; financials?: Record<string, string | number> } | null)
          ?.financials;
        if (!fin) {
          setSnapshotActuals(null);
          return;
        }
        const num = (k: string) => parseFloat(String(fin[k] ?? "0")) || 0;
        setSnapshotActuals({
          label: (data as { period_label?: string }).period_label || "Latest snapshot",
          revenue: num("revenue"),
          cogs: num("cogs"),
          fixedCosts: num("fixedCosts"),
        });
      });
  }, [clientId]);

  useEffect(() => {
    if (!clientId || !loaded || !doc) return;
    if (skipAutosave.current) {
      skipAutosave.current = false;
      return;
    }
    const t = setTimeout(async () => {
      const updatedAt = new Date().toISOString();
      const payload = { ...doc, updatedAt };
      const { error } = await supabase
        .from("clients")
        .update({
          budget: payload as never,
          budget_updated_at: updatedAt,
          financial_year_start_month: doc.fyStartMonth,
        } as never)
        .eq("id", clientId);
      if (error) {
        // Retry without fy column if missing
        const retry = await supabase
          .from("clients")
          .update({ budget: payload as never, budget_updated_at: updatedAt } as never)
          .eq("id", clientId);
        if (retry.error) {
          if (!/budget|42703/.test(retry.error.message ?? "")) {
            toast.error(`Budget save failed: ${retry.error.message}`);
          }
        } else {
          setDoc(payload);
        }
      } else {
        setDoc(payload);
      }
    }, 900);
    return () => clearTimeout(t);
  }, [clientId, loaded, doc]);

  const liveActuals: BudgetActuals | null = financials
    ? {
        label: "Current financials",
        revenue: parseFloat(financials.revenue || "0") || 0,
        cogs: parseFloat(financials.cogs || "0") || 0,
        fixedCosts: parseFloat(financials.fixedCosts || "0") || 0,
      }
    : null;
  const actuals =
    snapshotActuals && (snapshotActuals.revenue || snapshotActuals.cogs || snapshotActuals.fixedCosts)
      ? snapshotActuals
      : liveActuals && (liveActuals.revenue || liveActuals.cogs || liveActuals.fixedCosts)
        ? liveActuals
        : null;

  const startFresh = useCallback(
    (args: {
      templateId: BudgetTemplateId;
      qualification: BudgetQualification;
      fyStartMonth: number;
    }) => {
      const next = createBudgetDocument(args);
      skipAutosave.current = false;
      setDoc(next);
      setUnmapped(null);
      setShowFunnel(false);
      toast.success(`Budget ready · ${BUDGET_TEMPLATES[args.templateId].label}`);
    },
    [],
  );

  const beginModelChange = () => {
    setShowFunnel(true);
  };

  const onFunnelComplete = (args: {
    templateId: BudgetTemplateId;
    qualification: BudgetQualification;
    fyStartMonth: number;
  }) => {
    if (!doc) {
      startFresh(args);
      return;
    }
    const result = applyTemplateChange(doc, args.templateId, {
      ...args.qualification,
    });
    result.next.fyStartMonth = args.fyStartMonth;
    if (args.fyStartMonth !== doc.fyStartMonth) {
      result.next.fyStart = currentFyStart(args.fyStartMonth);
    }
    if (result.lowOverlap) {
      setPendingChange({ result, mode: "apply" });
      setLowOverlapOpen(true);
      return;
    }
    setDoc(result.next);
    setUnmapped(result.unmapped.length ? result.unmapped : null);
    setShowFunnel(false);
    toast.success(
      `Model updated · ${result.mappedCount} drivers carried across (${result.overlapPct.toFixed(0)}% overlap)`,
    );
  };

  if (!loaded) {
    return <div className="p-6 text-sm text-slate-400">Loading budget…</div>;
  }

  if (showFunnel || !doc) {
    return (
      <div className="pb-8">
        {doc && (
          <div className="mb-4 flex justify-end">
            <Button type="button" variant="ghost" size="sm" onClick={() => setShowFunnel(false)}>
              Cancel — keep current budget
            </Button>
          </div>
        )}
        <BudgetFunnel
          initialFyStartMonth={doc?.fyStartMonth ?? fyStartMonthDefault}
          onComplete={onFunnelComplete}
        />
      </div>
    );
  }

  return (
    <>
      <BudgetWorkspace
        doc={doc}
        onChange={setDoc}
        simplified={simplified}
        actuals={actuals}
        unmappedReview={unmapped}
        onClearUnmapped={() => setUnmapped(null)}
        onChangeModel={beginModelChange}
        role={role}
      />

      <Dialog open={lowOverlapOpen} onOpenChange={setLowOverlapOpen}>
        <DialogContent className="bg-[#0d1117] border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>Low driver overlap</DialogTitle>
            <DialogDescription className="text-slate-400">
              Less than 30% of your drivers carry across
              {pendingChange
                ? ` (${pendingChange.result.overlapPct.toFixed(0)}% overlap, ${pendingChange.result.mappedCount} matched)`
                : ""}
              . Start fresh or review the mapped result manually? We never wipe silently.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                if (!pendingChange || !doc) return;
                // Start fresh with the pending qualification/template
                const q = pendingChange.result.next.qualification;
                const tid = pendingChange.result.next.templateId;
                startFresh({
                  templateId: tid,
                  qualification: q,
                  fyStartMonth: pendingChange.result.next.fyStartMonth,
                });
                setPendingChange(null);
                setLowOverlapOpen(false);
              }}
            >
              Start fresh
            </Button>
            <Button
              className="bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c49a45]"
              onClick={() => {
                if (!pendingChange) return;
                setDoc(pendingChange.result.next);
                setUnmapped(
                  pendingChange.result.unmapped.length
                    ? pendingChange.result.unmapped
                    : null,
                );
                setShowFunnel(false);
                setPendingChange(null);
                setLowOverlapOpen(false);
                toast.message("Review unmapped drivers before discarding");
              }}
            >
              Review manually
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
