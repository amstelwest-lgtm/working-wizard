/**
 * BudgetPanel — shared owner + accountant Budget tab.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { BudgetScenarioPills, BudgetWorkspace, UnmappedReviewBlock } from "@/components/budget/budget-workspace";
import { ReviewInputsDrawer } from "@/components/review-inputs-drawer";
import { BudgetAdvancedPanel } from "@/components/budget/budget-advanced";
import type { BudgetDocument, UnmappedDriver } from "@/lib/budget.types";
import { budgetWindowStart, createBudgetDocument } from "@/lib/budget.months";
import {
  budgetOpeningReadsMissing,
  budgetIsImplausible,
  statementBudgetRead,
  budgetScaleBreak,
  budgetVersusStatement,
  budgetWasRebuiltFromActuals,
  budgetPlanFiguresChanged,
  budgetPlanSnapshot,
  budgetSignedFiguresChanged,
  publishBudgetDocument,
  reseedBudgetIfScaleBroken,
  seedBudgetFromFinancials,
} from "@/lib/budget.bridges";
import { normalizeBudgetDocument } from "@/lib/budget.compute";
import { applyTemplateChange } from "@/lib/budget.model-change";
import { industryBudgetTemplate } from "@/lib/budget-industry";
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
import { budgetSignoffIsStale, inputsChangedSinceSignoff } from "@/lib/signoff-status";
import { applyForecastRent, forecastRentPayment } from "@/lib/budget-forecast-rent";
import {
  parseOperatingProfile,
  profileToBudgetQualification,
  type ClientOperatingProfile,
} from "@/lib/client-profile";
import { useMarket } from "@/contexts/market";
import { DeliverableInputConfig } from "@/components/deliverable-input-config";
import { budgetSaveErrorMessage } from "@/lib/reach-error";
import type { BudgetActualMonth, BudgetLens } from "@/lib/budget-chart-table";
import type { BudgetYearMoney } from "@/lib/budget-year-compare";

type StoredBudgetRow = {
  budget?: BudgetDocument | null;
  budget_updated_at?: string | null;
  operating_profile?: unknown;
  financials?: Record<string, string | number | null> | null;
  cashflow?: unknown;
  financials_updated_at?: string | null;
};

type BudgetSeedBooks = {
  budget?: unknown;
  cashflow?: unknown;
  financials?: Record<string, string | number | null> | null;
  financialsUpdatedAt?: string | null;
};

function budgetDocFromStoredRow(row: StoredBudgetRow | null): {
  doc: BudgetDocument | null;
  changed: boolean;
} {
  const budget = row?.budget ?? null;
  if (!row || !budget || budget.version !== 1) return { doc: null, changed: false };
  const financials = row.financials ?? null;
  const normalized = normalizeBudgetDocument(budget);
  const next = applyForecastRent(
    publishBudgetDocument(normalized, financials, {
      cashflow: row.cashflow,
      financialsUpdatedAt: row.financials_updated_at ?? null,
    }),
    row.cashflow,
  );
  return { doc: next, changed: budgetPlanFiguresChanged(normalized, next) };
}

function seedToStoredRow(seed: BudgetSeedBooks | null | undefined): StoredBudgetRow | null {
  if (!seed) return null;
  return {
    budget: (seed.budget ?? null) as BudgetDocument | null,
    financials: seed.financials ?? null,
    cashflow: seed.cashflow,
    financials_updated_at: seed.financialsUpdatedAt ?? null,
  };
}

/** Paint from the client row already on the page. A bad blob falls through to the select. */
function seedPaint(
  clientId: string | undefined,
  seed: BudgetSeedBooks | null | undefined,
): { doc: BudgetDocument | null; changed: boolean; skip: boolean } {
  if (!clientId || !seed) return { doc: null, changed: false, skip: false };
  try {
    const applied = budgetDocFromStoredRow(seedToStoredRow(seed));
    return { doc: applied.doc, changed: applied.changed, skip: true };
  } catch (err) {
    console.warn("budget seed:", err);
    return { doc: null, changed: false, skip: false };
  }
}

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
  hideInlineSignOff,
  signoff: signoffProp,
  signoffKnown = true,
  onSignoffChange,
  firstActualsMonth,
  reloadToken,
  onReviewStale,
  lens,
  onLensChange,
  actualMonths,
  readOnly = false,
  onInvite,
  priorYear = null,
  priorYearLabel = null,
  priorYearMonths = null,
  seededBooks = null,
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
  /** Parent already renders Sign off in the tab header. */
  hideInlineSignOff?: boolean;
  signoff?: ClientReviewSignoff | null;
  /** False until the parent sign-off fetch has settled. */
  signoffKnown?: boolean;
  onSignoffChange?: (next: ClientReviewSignoff | null) => void;
  /** YYYY-MM of the earliest month with real figures; the budget window starts no earlier. */
  firstActualsMonth?: string | null;
  /** Bump to re-read clients.budget after an external write (auto-populate). */
  reloadToken?: number;
  /** Header sign-off uses the same stale clock as the PDF. */
  onReviewStale?: (stale: boolean) => void;
  onViewModeChange?: (mode: "simplified" | "complex") => void;
  /** Chart or table under the answer strip. Chart when omitted. */
  lens?: BudgetLens;
  onLensChange?: (next: BudgetLens) => void;
  /** Preview months. Production reads stored month actuals instead. */
  actualMonths?: readonly BudgetActualMonth[];
  /** Owner door: show the plan and sign-off, hide setup and edits. */
  readOnly?: boolean;
  /** Invite control shown when a read-only budget is not configured. */
  onInvite?: () => void;
  priorYear?: BudgetYearMoney | null;
  priorYearLabel?: string | null;
  priorYearMonths?: number | null;
  /**
   * Books the client page already loaded. The tab paints from these and
   * skips a second fat select until reloadToken asks for a fresh read.
   */
  seededBooks?: BudgetSeedBooks | null;
}) {
  const { market } = useMarket();
  const fyDefault = fyStartMonthDefault ?? market.fyStartMonthDefault;
  const seededBooksRef = useRef(seededBooks);
  seededBooksRef.current = seededBooks;
  const initialSeedRef = useRef<ReturnType<typeof seedPaint> | null>(null);
  if (initialSeedRef.current == null) initialSeedRef.current = seedPaint(clientId, seededBooks);
  const initialSeed = initialSeedRef.current;
  const skipFatSelect = useRef(initialSeed.skip);
  const [loaded, setLoaded] = useState(() => !clientId || initialSeed.skip);
  const [doc, setDoc] = useState<BudgetDocument | null>(initialSeed.doc);
  const [profile, setProfile] = useState<ClientOperatingProfile | null>(
    operatingProfileProp ?? null,
  );
  const [unmapped, setUnmapped] = useState<UnmappedDriver[] | null>(null);
  const [pendingChange, setPendingChange] = useState<{
    result: ReturnType<typeof applyTemplateChange>;
    mode: "apply" | "fresh";
  } | null>(null);
  const [lowOverlapOpen, setLowOverlapOpen] = useState(false);
  const [budgetUpdatedAt, setBudgetUpdatedAt] = useState<string | null>(null);
  const [financialsUpdatedAt, setFinancialsUpdatedAt] = useState<string | null>(
    seededBooks?.financialsUpdatedAt ?? null,
  );
  const [budgetSignoff, setBudgetSignoff] = useState<ClientReviewSignoff | null>(
    signoffProp ?? null,
  );
  const [signedBudgetSnapshot, setSignedBudgetSnapshot] = useState<unknown>(null);
  const fetchReviewSignoffs = useServerFn(listClientReviewSignoffs);
  const skipAutosave = useRef(false);
  const budgetDirty = useRef(false);
  const saveGeneration = useRef(0);
  const seededFromProfile = useRef(false);
  /** Client id whose budget is in `doc`. A switch clears this before the next fetch. */
  const loadedFor = useRef<string | null>(null);
  const loadedFinancialsRef = useRef<Record<string, string | number | null> | null>(
    seededBooks?.financials ?? null,
  );
  const loadedCashflowRef = useRef<unknown>(seededBooks?.cashflow ?? null);

  useEffect(() => {
    setProfile(operatingProfileProp ?? null);
  }, [operatingProfileProp]);

  useEffect(() => {
    loadedFinancialsRef.current = null;
    loadedCashflowRef.current = null;
    seededFromProfile.current = false;
    budgetDirty.current = false;
    skipAutosave.current = true;
    saveGeneration.current += 1;
    const painted = seedPaint(clientId, seededBooksRef.current);
    if (painted.skip) {
      const seed = seedToStoredRow(seededBooksRef.current);
      loadedFinancialsRef.current = seed?.financials ?? null;
      loadedCashflowRef.current = seed?.cashflow ?? null;
      setFinancialsUpdatedAt(seed?.financials_updated_at ?? null);
      setBudgetUpdatedAt(null);
      loadedFor.current = clientId ?? null;
      skipAutosave.current = !painted.changed;
      budgetDirty.current = painted.changed;
      setDoc(painted.doc);
      setLoaded(true);
      skipFatSelect.current = true;
      return;
    }
    loadedFor.current = null;
    setDoc(null);
    setBudgetUpdatedAt(null);
    setFinancialsUpdatedAt(null);
    setLoaded(!clientId);
    skipFatSelect.current = false;
  }, [clientId]);

  useEffect(() => {
    if (!clientId) {
      setLoaded(true);
      return;
    }
    // Ignore a stale response after cleanup: a superseded load resolving late
    // (StrictMode double-mount, client switch) used to setDoc(null) over a
    // budget just seeded from the profile — "Budget ready" toast, empty panel.
    let cancelled = false;
    const requestedId = clientId;
    const loadSnapshot = () => {
      void (supabase as unknown as {
      from: (table: string) => {
        select: (cols: string) => {
          eq: (col: string, value: string) => {
            eq: (col: string, value: string) => {
              maybeSingle: () => Promise<{ data: { content_snapshot?: unknown } | null }>;
            };
          };
        };
      };
    })
      .from("client_deliverable_states")
      .select("content_snapshot")
      .eq("client_id", requestedId)
      .eq("scope", "budget")
      .maybeSingle()
      .then((res) => {
        if (cancelled) return;
        setSignedBudgetSnapshot(res.data?.content_snapshot ?? null);
      })
      .catch(() => {
        if (!cancelled) setSignedBudgetSnapshot(null);
      });
    };
    if (skipFatSelect.current) {
      skipFatSelect.current = false;
      loadSnapshot();
      return () => {
        cancelled = true;
      };
    }
    supabase
      .from("clients")
      .select(
        "budget, budget_updated_at, financial_year_start_month, operating_profile, financials, cashflow, financials_updated_at",
      )
      .eq("id", clientId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.warn("budget load:", error.message);
        }
        if (cancelled) return;
        const row = data as StoredBudgetRow | null;
        loadedFinancialsRef.current = row?.financials ?? null;
        loadedCashflowRef.current = row?.cashflow ?? null;
        setBudgetUpdatedAt(row?.budget_updated_at ?? null);
        setFinancialsUpdatedAt(row?.financials_updated_at ?? null);
        const fromDb = parseOperatingProfile(row?.operating_profile);
        if (fromDb) setProfile(fromDb);
        loadedFor.current = requestedId;
        // A 10× plan stays on screen as a suggestion. Opening cash and
        // days still come from this client. Nothing is rebuilt on load.
        const applied = budgetDocFromStoredRow(row);
        skipAutosave.current = !applied.changed;
        budgetDirty.current = applied.changed;
        setDoc(applied.doc);
        setLoaded(true);
      });
    loadSnapshot();
    return () => {
      cancelled = true;
    };
  }, [clientId, reloadToken]);

  useEffect(() => {
    if (signoffProp !== undefined) setBudgetSignoff(signoffProp);
  }, [signoffProp]);

  const patchBudgetSignoff = (next: ClientReviewSignoff | null) => {
    setBudgetSignoff(next);
    if (next && doc) setSignedBudgetSnapshot({ budgetFigures: budgetPlanSnapshot(doc) });
    if (!next) setSignedBudgetSnapshot(null);
    onSignoffChange?.(next);
  };
  const budgetFiguresChanged =
    budgetSignedFiguresChanged(signedBudgetSnapshot, doc) ||
    inputsChangedSinceSignoff(budgetSignoff?.signed_off_at, financialsUpdatedAt);

  useEffect(() => {
    onReviewStale?.(budgetSignoffIsStale(budgetSignoff, budgetUpdatedAt, budgetFiguresChanged));
  }, [onReviewStale, budgetSignoff, budgetUpdatedAt, budgetFiguresChanged]);

  useEffect(() => {
    if (!clientId) return;
    fetchReviewSignoffs({ data: { clientId } })
      .then(({ signoffs }) => {
        const row = signoffs.find((s) => s.scope === "budget") ?? null;
        setBudgetSignoff(row);
        onSignoffChange?.(row);
      })
      .catch(() => {
        /* sign-off is non-blocking */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Snapshots are not a second actuals source. The statement on this client is.

  useEffect(() => {
    if (!clientId || !loaded || !doc || !budgetDirty.current) return;
    if (skipAutosave.current) {
      skipAutosave.current = false;
      return;
    }
    const gen = ++saveGeneration.current;
    const snapshot = doc;
    const savedFor = clientId;
    const t = setTimeout(async () => {
      if (loadedFor.current !== savedFor) return;
      const updatedAt = new Date().toISOString();
      const payload = { ...snapshot, updatedAt };
      const { error } = await supabase
        .from("clients")
        .update({
          budget: payload as never,
          budget_updated_at: updatedAt,
          financial_year_start_month: snapshot.fyStartMonth,
        } as never)
        .eq("id", clientId);
      const saved = () => {
        if (saveGeneration.current !== gen) return;
        budgetDirty.current = false;
        setDoc(payload);
        setBudgetUpdatedAt(updatedAt);
      };
      if (error) {
        // Retry without fy column if missing
        const retry = await supabase
          .from("clients")
          .update({ budget: payload as never, budget_updated_at: updatedAt } as never)
          .eq("id", clientId);
        if (retry.error) {
          if (saveGeneration.current !== gen) return;
          if (!/budget|42703/.test(retry.error.message ?? "")) {
            toast.error(budgetSaveErrorMessage(retry.error.message));
          }
        } else {
          saved();
        }
      } else {
        saved();
      }
    }, 900);
    return () => clearTimeout(t);
  }, [clientId, loaded, doc]);

  const figureSource = loadedFinancialsRef.current ?? financials ?? null;
  const actuals =
    doc && loadedFor.current === (clientId ?? null)
      ? budgetVersusStatement(statementBudgetRead(doc, figureSource).doc, figureSource, market)
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
      const seedFrom =
        (loadedFinancialsRef.current as Record<string, string> | null) ?? financials ?? null;
      const hasFigures = Boolean(
        seedFrom && (parseFloat(seedFrom.revenue ?? "") || parseFloat(seedFrom.cogs ?? "")),
      );
      const seeded = hasFigures ? seedBudgetFromFinancials(next, seedFrom!) : null;
      if (seeded) next = seeded.doc;
      if (seedFrom) {
        next = applyForecastRent(
          publishBudgetDocument(next, seedFrom, { cashflow: loadedCashflowRef.current }),
          loadedCashflowRef.current,
        );
      }
      skipAutosave.current = false;
      budgetDirty.current = true;
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
    if (clientId && loadedFor.current !== clientId) return;
    seededFromProfile.current = true;
    startFresh({
      templateId: industryBudgetTemplate(clientName, profile, businessTypeId) ?? profile.templateId,
      qualification: profileToBudgetQualification(profile, "none"),
      fyStartMonth: profile.fyStartMonth || fyDefault,
    });
  }, [loaded, doc, profile, fyDefault, startFresh, clientId, clientName, businessTypeId]);

  const rebuildFromActuals = () => {
    const seedFrom =
      (loadedFinancialsRef.current as Record<string, string> | null) ?? financials ?? null;
    if (!doc || !seedFrom) return;
    // Accepting the suggestion is the only rebuild. Load does not call this.
    const broken = budgetScaleBreak(doc, seedFrom) != null;
    const seeded = broken
      ? { doc: reseedBudgetIfScaleBroken(doc, seedFrom), changes: [] as string[] }
      : seedBudgetFromFinancials(doc, seedFrom);
    budgetDirty.current = true;
    setDoc(
      applyForecastRent(
        publishBudgetDocument(seeded.doc, seedFrom, {
          cashflow: loadedCashflowRef.current,
        }),
        loadedCashflowRef.current,
      ),
    );
    toast.success("Budget rebuilt from the saved statement", {
      description: seeded.changes[0],
    });
  };

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
      budgetDirty.current = true;
      setDoc(result.next);
      setUnmapped(result.unmapped.length ? result.unmapped : null);
      toast.success(
        `Budget model updated · ${result.mappedCount} lines carried across`,
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

  const budgetInputConfig = (
    <DeliverableInputConfig
      className="mb-5"
      clientId={clientId}
      deliverableId="budget"
      context={{
        financials,
        operatingProfile: profile,
        budgetWc: doc?.wc ?? null,
        budgetSeasonality: doc?.qualification.seasonality ?? profile?.seasonality ?? null,
      }}
      onEngineBoundChange={(patch) => {
        budgetDirty.current = true;
        setDoc((d) => {
          if (!d) return d;
          const wc = { ...d.wc };
          if (typeof patch.daysAr === "number") wc.debtorDays = patch.daysAr;
          if (typeof patch.daysAp === "number") wc.creditorDays = patch.daysAp;
          if (typeof patch.inventoryDays === "number") wc.inventoryDays = patch.inventoryDays;
          const daysTouched = typeof patch.daysAr === "number" || typeof patch.daysAp === "number";
          return {
            ...d,
            wc,
            wcDaysSource: daysTouched ? "manual" : d.wcDaysSource,
            updatedAt: new Date().toISOString(),
          };
        });
      }}
    />
  );

  if (!doc) {
    if (readOnly) {
      return (
        <div className="space-y-3 rounded-xl border border-[var(--line)] bg-[var(--card)] p-6 text-[15px] text-[var(--ink)]">
          <p>Your accountant sets this up</p>
          {onInvite ? (
            <button type="button" className="btn gold" onClick={onInvite}>
              Invite your accountant
            </button>
          ) : null}
        </div>
      );
    }
    return (
      <>
        <ReviewInputsDrawer>{budgetInputConfig}</ReviewInputsDrawer>
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
              className="bg-[#0B5FFF] text-white hover:bg-[#2563EB]"
              onClick={onRetakeProfile}
            >
              Set up business profile
            </Button>
          )}
        </div>
      </>
    );
  }

  const statementView = statementBudgetRead(
    doc,
    (loadedFinancialsRef.current ?? null) as Record<string, unknown> | null,
  );
  const shownDoc = statementView.doc;
  const implausible = budgetIsImplausible(shownDoc, figureSource);
  const scaleBroken = budgetScaleBreak(shownDoc, figureSource) != null;
  const rebuilt = budgetWasRebuiltFromActuals(doc);

  const reviewDrawer = (
    <ReviewInputsDrawer>
      <BudgetScenarioPills
        doc={doc}
        onChange={(next) => {
          budgetDirty.current = true;
          setDoc(next);
        }}
      />
      {budgetInputConfig}
      {!(simplified && role === "owner") ? (
        <BudgetAdvancedPanel
          doc={doc}
          onChange={(next) => {
            budgetDirty.current = true;
            setDoc(next);
          }}
          financials={financials}
          businessTypeId={businessTypeId}
          role={role}
          clientId={clientId}
          onPushedToCash={onPushedToCash}
        />
      ) : null}
      {unmapped && unmapped.length > 0 ? (
        <UnmappedReviewBlock
          items={unmapped}
          doc={doc}
          onChange={(next) => {
            budgetDirty.current = true;
            setDoc(next);
          }}
          onClear={() => setUnmapped(null)}
        />
      ) : null}
      <Button type="button" variant="outline" size="sm" onClick={beginModelChange}>
        Change model
      </Button>
    </ReviewInputsDrawer>
  );

  return (
    <>
      {scaleBroken && !readOnly && (
        <div className="mb-4 rounded-xl border border-[#B7791F]/50 bg-[#B7791F]/10 px-4 py-3 text-sm text-[#8A5A12] dark:border-[#8A5A12] dark:bg-[#8A5A12]/30 dark:text-[#F0D59A]">
          <p className="font-semibold">Rebuild is a suggestion — nothing has been replaced</p>
          <p className="mt-1 text-[13px] leading-relaxed text-[#8A5A12]/90 dark:text-[#F0D59A]/90">
            The stored plan is more than ten times a full year of the saved revenue or cost of sales.
            It is still the plan on file. Rebuild only if you want it to follow the saved statement.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            onClick={rebuildFromActuals}
          >
            Rebuild from the saved statement
          </Button>
        </div>
      )}
      {rebuilt && (
        <div className="mb-4 rounded-xl border border-sky-300/80 bg-sky-50 px-4 py-3 text-sm text-sky-950 dark:border-sky-800/70 dark:bg-sky-950/30 dark:text-sky-50">
          <p className="font-semibold">This budget was rebuilt from the saved statement</p>
          <p className="mt-1 text-[13px] leading-relaxed text-sky-900/90 dark:text-sky-100/80">
            The stored plan was more than ten times a full year of the saved revenue or cost of sales.
            The file note records the rebuild.
          </p>
        </div>
      )}
      {implausible && !readOnly && (
        <div className="budget-lineup mb-4 rounded-xl border border-[#DBEAFE] bg-[#F4F8FF] px-4 py-3 text-sm text-[#102A43] dark:border-[#1e3a5f] dark:bg-[#102A43] dark:text-[#F4F7FB]">
          <p className="font-semibold">This budget does not line up with the saved statement</p>
          <p className="mt-1 text-[13px] leading-relaxed text-[#3D5270] dark:text-[#C5D4E4]">
            Cost of sales is zero while the period has a cost of sales, or a full year of revenue or
            cost of sales is more than three times a full year of the saved figures. Nothing is
            overwritten until you rebuild.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3 border-[#0B5FFF] text-[#0B5FFF] hover:bg-[#DBEAFE]"
            onClick={rebuildFromActuals}
          >
            Rebuild from the saved statement
          </Button>
        </div>
      )}
      <BudgetWorkspace
        onBuild={readOnly ? undefined : rebuildFromActuals}
        doc={shownDoc}
        onChange={(next) => {
          budgetDirty.current = true;
          setDoc(next);
        }}
        simplified={simplified}
        statementAligned={statementView.fromStatement}
        actuals={actuals}
        unmappedReview={unmapped}
        onClearUnmapped={() => setUnmapped(null)}
        onChangeModel={beginModelChange}
        role={role}
        clientId={clientId}
        clientName={clientName}
        signoff={budgetSignoff}
        isStale={budgetSignoffIsStale(budgetSignoff, budgetUpdatedAt, budgetFiguresChanged)}
        canSign={Boolean(canSign && clientId)}
        onSignoffChange={patchBudgetSignoff}
        signoffKnown={signoffKnown}
        drawer={readOnly ? null : reviewDrawer}
        readOnly={readOnly}
        lens={lens}
        onLensChange={onLensChange}
        actualMonths={actualMonths}
        priorYear={priorYear}
        priorYearLabel={priorYearLabel}
        priorYearMonths={priorYearMonths}
        displayTemplateId={industryBudgetTemplate(clientName, profile, businessTypeId)}
        forecastRent={forecastRentPayment(loadedCashflowRef.current)}
        openingBalanceMissing={budgetOpeningReadsMissing({
          cashflow: loadedCashflowRef.current,
          openingCash: shownDoc.openingCash,
          openingCashSource: shownDoc.openingCashSource,
        })}
      />

      <Dialog open={lowOverlapOpen} onOpenChange={setLowOverlapOpen}>
        <DialogContent className="bg-[#0d1117] border-slate-800 text-slate-100">
          <DialogHeader>
            <DialogTitle>Most lines do not match</DialogTitle>
            <DialogDescription className="text-slate-400">
              {pendingChange
                ? `${pendingChange.result.mappedCount} lines match the new model. The rest do not.`
                : "Most lines do not match the new model."}{" "}
              Start fresh, or look at the matches yourself. Nothing is removed until you choose.
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
              variant="outline"
              onClick={() => {
                if (!pendingChange) return;
                budgetDirty.current = true;
                setDoc(pendingChange.result.next);
                setUnmapped(
                  pendingChange.result.unmapped.length ? pendingChange.result.unmapped : null,
                );
                setPendingChange(null);
                setLowOverlapOpen(false);
                toast.message("Check the lines that did not match before you discard them");
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
