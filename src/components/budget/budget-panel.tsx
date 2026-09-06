/**
 * BudgetPanel — shared owner + accountant Budget tab.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BudgetWorkspace } from "@/components/budget/budget-workspace";
import { BudgetAdvancedPanel } from "@/components/budget/budget-advanced";
import type { BudgetActuals, BudgetDocument, UnmappedDriver } from "@/lib/budget.types";
import { budgetWindowStart, createBudgetDocument } from "@/lib/budget.months";
import { seedBudgetFromFinancials } from "@/lib/budget.bridges";
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
import { useServerFn } from "@tanstack/react-start";
import { listClientReviewSignoffs } from "@/lib/review-signoffs.functions";
import type { ClientReviewSignoff } from "@/lib/review-signoffs.functions";
import {
  ReviewSignoffButton,
  ReviewSignoffBadge,
  computeIsStale,
} from "@/components/review-signoff";
import {
  parseOperatingProfile,
  profileToBudgetQualification,
  type ClientOperatingProfile,
} from "@/lib/client-profile";
import { useMarket } from "@/contexts/market";

export function BudgetPanel({
  clientId,
  clientName,
  simplified,
  role = "owner",
  financials,
  businessTypeId,
  operatingProfile: operatingProfileProp,
  fyStartMonthDefault,
  onPushedToCash,
  onRetakeProfile,
  canSign,
  hideReadOnlyStamp,
  firstActualsMonth,
}: {
  clientId?: string;
  clientName?: string;
  simplified?: boolean;
  role?: "owner" | "accountant";
  financials?: Record<string, string> | null;
  businessTypeId?: string | null;
  operatingProfile?: ClientOperatingProfile | null;
  fyStartMonthDefault?: number;
  onPushedToCash?: () => void;
  /** Opens the profile-wide 10-question funnel (change model). */
  onRetakeProfile?: () => void;
  /** Show interactive sign-off (accountant portal / acting accountant). */
  canSign?: boolean;
  /** Owner board already stamps this deliverable in the tab header. */
  hideReadOnlyStamp?: boolean;
  /** YYYY-MM of the earliest month with real figures; the budget window starts no earlier. */
  firstActualsMonth?: string | null;
}) {
  const { market } = useMarket();
  const fyDefault = fyStartMonthDefault ?? market.fyStartMonthDefault;
  const [loaded, setLoaded] = useState(!clientId);
  const [doc, setDoc] = useState<BudgetDocument | null>(null);
  const [profile, setProfile] = useState<ClientOperatingProfile | null>(
    operatingProfileProp ?? null,
  );
  const [unmapped, setUnmapped] = useState<UnmappedDriver[] | null>(null);
  const [pendingChange, setPendingChange] = useState<{
    result: ReturnType<typeof applyTemplateChange>;
    mode: "apply" | "fresh";
  } | null>(null);
  const [lowOverlapOpen, setLowOverlapOpen] = useState(false);
  const [snapshotActuals, setSnapshotActuals] = useState<BudgetActuals | null>(null);
  const [budgetUpdatedAt, setBudgetUpdatedAt] = useState<string | null>(null);
  const [budgetSignoff, setBudgetSignoff] = useState<ClientReviewSignoff | null>(null);
  const fetchReviewSignoffs = useServerFn(listClientReviewSignoffs);
  const skipAutosave = useRef(false);
  const seededFromProfile = useRef(false);

  useEffect(() => {
    setProfile(operatingProfileProp ?? null);
  }, [operatingProfileProp]);

  useEffect(() => {
    if (!clientId) {
      setLoaded(true);
      return;
    }
    // Ignore a stale response after cleanup: a superseded load resolving late
    // (StrictMode double-mount, client switch) used to setDoc(null) over a
    // budget just seeded from the profile — "Budget ready" toast, empty panel.
    let cancelled = false;
    supabase
      .from("clients")
      .select("budget, budget_updated_at, financial_year_start_month, operating_profile")
      .eq("id", clientId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn("budget load:", error.message);
        }
        const row = data as {
          budget?: BudgetDocument | null;
          budget_updated_at?: string | null;
          operating_profile?: unknown;
        } | null;
        const budget = row?.budget ?? null;
        setBudgetUpdatedAt(row?.budget_updated_at ?? null);
        const fromDb = parseOperatingProfile(row?.operating_profile);
        if (fromDb) setProfile(fromDb);
        if (budget && budget.version === 1) {
          skipAutosave.current = true;
          setDoc(normalizeBudgetDocument(budget));
        } else {
          setDoc(null);
        }
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  useEffect(() => {
    if (!clientId) return;
    fetchReviewSignoffs({ data: { clientId } })
      .then(({ signoffs }) => {
        setBudgetSignoff(signoffs.find((s) => s.scope === "budget") ?? null);
      })
      .catch(() => {
        /* sign-off is non-blocking */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        const fin = (
          data as { period_label?: string; financials?: Record<string, string | number> } | null
        )?.financials;
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
          setBudgetUpdatedAt(updatedAt);
        }
      } else {
        setDoc(payload);
        setBudgetUpdatedAt(updatedAt);
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
    snapshotActuals &&
    (snapshotActuals.revenue || snapshotActuals.cogs || snapshotActuals.fixedCosts)
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
      let next = createBudgetDocument({ ...args, market, firstActualsMonth });
      if (args.qualification.inventoryProfile === "none") {
        next.showInventoryDays = false;
      } else if (args.qualification.inventoryProfile) {
        next.showInventoryDays = true;
      }
      // Figures already on the board (typed, uploaded, or entered by the
      // accountant) seed the plan; a template at $0 revenue is not a budget.
      const hasFigures = Boolean(
        financials && (parseFloat(financials.revenue ?? "") || parseFloat(financials.cogs ?? "")),
      );
      const seeded = hasFigures ? seedBudgetFromFinancials(next, financials!) : null;
      if (seeded) next = seeded.doc;
      skipAutosave.current = false;
      setDoc(next);
      setUnmapped(null);
      toast.success(`Budget ready · ${BUDGET_TEMPLATES[args.templateId].label}`, {
        description: seeded?.changes[0],
      });
    },
    [market, firstActualsMonth, financials],
  );

  // Seed budget from operating profile when none exists yet
  useEffect(() => {
    if (!loaded || doc || !profile || seededFromProfile.current) return;
    seededFromProfile.current = true;
    startFresh({
      templateId: profile.templateId,
      qualification: profileToBudgetQualification(profile, "none"),
      fyStartMonth: profile.fyStartMonth || fyDefault,
    });
  }, [loaded, doc, profile, fyDefault, startFresh]);

  const beginModelChange = () => {
    if (onRetakeProfile) {
      onRetakeProfile();
      return;
    }
    toast.message("Update your business profile to change the budget model");
  };

  const applyProfileToExisting = useCallback(
    (nextProfile: ClientOperatingProfile) => {
      if (!doc) {
        startFresh({
          templateId: nextProfile.templateId,
          qualification: profileToBudgetQualification(nextProfile, "none"),
          fyStartMonth: nextProfile.fyStartMonth || fyDefault,
        });
        return;
      }
      const qualification = profileToBudgetQualification(
        nextProfile,
        doc.qualification.capexMode ?? "none",
      );
      const result = applyTemplateChange(doc, nextProfile.templateId, qualification);
      result.next.fyStartMonth = nextProfile.fyStartMonth;
      if (nextProfile.fyStartMonth !== doc.fyStartMonth) {
        result.next.fyStart = budgetWindowStart({
          fyStartMonth: nextProfile.fyStartMonth,
          firstActualsMonth,
        });
      }
      result.next.showInventoryDays = nextProfile.inventoryIntensity !== "none";
      if (result.lowOverlap) {
        setPendingChange({ result, mode: "apply" });
        setLowOverlapOpen(true);
        return;
      }
      setDoc(result.next);
      setUnmapped(result.unmapped.length ? result.unmapped : null);
      toast.success(
        `Budget model updated · ${result.mappedCount} drivers carried across (${result.overlapPct.toFixed(0)}% overlap)`,
      );
    },
    [doc, fyDefault, startFresh, firstActualsMonth],
  );

  // When parent profile changes after a retake, remap budget
  const lastProfileAt = useRef<string | null>(null);
  useEffect(() => {
    if (!profile || !loaded) return;
    if (!lastProfileAt.current) {
      lastProfileAt.current = profile.confirmedAt;
      return;
    }
    if (profile.confirmedAt !== lastProfileAt.current) {
      lastProfileAt.current = profile.confirmedAt;
      if (doc) applyProfileToExisting(profile);
    }
  }, [profile, loaded, doc, applyProfileToExisting]);

  if (!loaded) {
    return <div className="p-6 text-sm text-slate-400">Loading budget…</div>;
  }

  if (!doc) {
    return (
      <div className="space-y-3 rounded-xl border border-dashed border-slate-300 p-6 text-sm dark:border-slate-700">
        <p className="font-semibold text-slate-800 dark:text-slate-100">
          Budget needs your business profile
        </p>
        <p className="text-slate-500">
          Answer the intro questions once — we use them to pick the right volume × price drivers
          (and to tune health, cash, and advice across Milōn).
        </p>
        {onRetakeProfile && (
          <Button
            type="button"
            className="bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c49a45]"
            onClick={onRetakeProfile}
          >
            Set up business profile
          </Button>
        )}
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
        clientId={clientId}
      />

      <div className="mt-6 space-y-4">
        {/* Owner Simple: keep Advanced collapsed away — Complex / accountant still get the full panel */}
        {!(simplified && role === "owner") && (
          <BudgetAdvancedPanel
            doc={doc}
            onChange={setDoc}
            financials={financials}
            businessTypeId={businessTypeId}
            role={role}
            clientId={clientId}
            onPushedToCash={onPushedToCash}
          />
        )}

        {clientId && (canSign || role === "accountant") && (
          <div className="flex justify-end">
            <ReviewSignoffButton
              clientId={clientId}
              clientName={clientName}
              scope="budget"
              signoff={budgetSignoff}
              isStale={computeIsStale(budgetSignoff, budgetUpdatedAt ?? doc.updatedAt)}
              onChange={setBudgetSignoff}
            />
          </div>
        )}
        {clientId && !hideReadOnlyStamp && !(canSign || role === "accountant") && (
          <div className="flex justify-end">
            <ReviewSignoffBadge
              signoff={budgetSignoff}
              scope="budget"
              isStale={computeIsStale(budgetSignoff, budgetUpdatedAt ?? doc.updatedAt)}
              placement="corner"
            />
          </div>
        )}
      </div>

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
                  pendingChange.result.unmapped.length ? pendingChange.result.unmapped : null,
                );
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
