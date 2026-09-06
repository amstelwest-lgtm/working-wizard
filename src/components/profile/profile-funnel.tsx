/**
 * Milōn intro profile funnel — 10 questions for maximum deliverable “wind”.
 * Replaces the old single business-type picker. Retakeable anytime.
 *
 * Modes:
 *  - "first-run": the four core questions (how you make money, unit of sales,
 *    how fast customers pay, what you're trying to achieve + FY). The other
 *    six get inferred defaults and the board nudges the owner to finish.
 *  - "complete": only the six deferred questions, prefilled from the profile.
 *  - "retake": all ten.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import type {
  BudgetCapexMode,
  BudgetCostShape,
  BudgetPayMotion,
  BudgetSeasonality,
  BudgetTemplateId,
  BudgetVolumeUnit,
} from "@/lib/budget.types";
import {
  PAY_MOTION_OPTIONS,
  SUGGESTED_SECONDARIES,
  volumeOptionsForMotion,
  type VolumeUnitOption,
} from "@/lib/budget.taxonomy";
import {
  buildOperatingProfile,
  inferDeferredProfileAnswers,
  type ClientOperatingProfile,
  type CustomerConcentration,
  type DebtPosition,
  type InventoryIntensity,
  type OwnerGoal,
} from "@/lib/client-profile";
import { useMarket } from "@/contexts/market";
import { localizeCopy } from "@/lib/market";

/** Question ids (0–9) in the order each mode asks them. */
const ALL_QUESTIONS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const CORE_QUESTIONS = [0, 1, 3, 9] as const;
const DEFERRED_QUESTIONS = [2, 4, 5, 6, 7, 8] as const;

export type ProfileFunnelMode = "first-run" | "retake" | "complete";

const COST_SHAPE: Array<{ id: BudgetCostShape; label: string; examples: string }> = [
  {
    id: "variable",
    label: "Mostly variable with sales",
    examples: "COGS, commissions, fuel, materials — costs jump when sales jump",
  },
  {
    id: "fixed",
    label: "Mostly fixed",
    examples: "Rent, salaried team, software — steady month to month",
  },
  {
    id: "payroll_heavy",
    label: "Payroll-heavy",
    examples: "Guarding, cleaning crews, clinics, professional practices",
  },
  {
    id: "balanced",
    label: "Balanced mix",
    examples: "Real split between fixed overhead and variable cost of sales",
  },
];

const PAY_TIMING: Array<{ days: number; label: string; examples: string }> = [
  { days: 0, label: "Cash / card on sale", examples: "Retail, restaurants, salons, fuel" },
  { days: 30, label: "Around 30 days", examples: "Typical B2B invoices" },
  {
    days: 45,
    label: "Milestone / progress billing (~45 days)",
    examples: "Construction, project retainers",
  },
  { days: 60, label: "60+ days", examples: "Medical aid, government, large corporates, export" },
];

const SEASONALITY: Array<{ id: BudgetSeasonality; label: string; examples: string }> = [
  { id: "flat", label: "Fairly even through the year", examples: "Many B2B services" },
  { id: "mild", label: "Mild peaks", examples: "Retail holidays, restaurant weekends" },
  {
    id: "strong",
    label: "Strong peaks and troughs",
    examples: "Hotels, agri harvest, education terms, events",
  },
];

const INVENTORY: Array<{ id: InventoryIntensity; label: string; examples: string }> = [
  {
    id: "none",
    label: "Little or no stock",
    examples: "Consultancies, SaaS, agencies, most services",
  },
  {
    id: "light",
    label: "Some stock / short shelf-life",
    examples: "Cafés, salons (retail), light spare parts",
  },
  {
    id: "heavy",
    label: "Material inventory or WIP",
    examples: "Retail, wholesale, manufacturing, agri, pharmacies",
  },
];

const CONCENTRATION: Array<{ id: CustomerConcentration; label: string; examples: string }> = [
  {
    id: "diverse",
    label: "Spread wide — no customer is critical",
    examples: "Retail, restaurants, consumer apps — losing one changes nothing",
  },
  {
    id: "moderate",
    label: "Top few are meaningful (roughly a quarter of sales)",
    examples: "Small B2B book, a few anchor clients",
  },
  {
    id: "concentrated",
    label: "Top 3 are about half of sales",
    examples: "Agencies, contractors, wholesalers with anchor accounts",
  },
  {
    id: "single_dominant",
    label: "One customer dominates (or one payer/funder)",
    examples: "Single corporate contract, one mine/retail group, one grant funder",
  },
];

const DEBT: Array<{ id: DebtPosition; label: string; examples: string }> = [
  {
    id: "none",
    label: "No debt — self-funded",
    examples: "No loans, no overdraft in use",
  },
  {
    id: "light",
    label: "Small facilities only",
    examples: "Overdraft, credit card, one vehicle finance",
  },
  {
    id: "moderate",
    label: "Real repayments each month",
    examples: "Term loan, asset finance, equipment leases",
  },
  {
    id: "heavy",
    label: "Debt is a strain",
    examples: "Repayments squeeze cash, personal surety, arrears risk",
  },
  {
    id: "seeking",
    label: "Looking to raise funding this year",
    examples: "Bank application, investor raise, expansion facility",
  },
];

const GOAL: Array<{ id: OwnerGoal; label: string; examples: string }> = [
  {
    id: "survive_cash",
    label: "Get through a cash squeeze",
    examples: "Payroll pressure, short runway, month-end stress",
  },
  {
    id: "lift_margins",
    label: "Make more from the same revenue",
    examples: "Busy but thin — pricing, cost of sales, overhead drag",
  },
  {
    id: "grow_revenue",
    label: "Grow sales / win more work",
    examples: "Pipeline, occupancy, new outlets or products",
  },
  {
    id: "free_working_capital",
    label: "Free up cash stuck in the business",
    examples: "Debtors slow, stock heavy, supplier terms tight",
  },
  {
    id: "reduce_founder_dependence",
    label: "Get the business to run without me",
    examples: "Founder bottleneck, delegation, systems and hiring",
  },
  {
    id: "build_to_exit",
    label: "Build value for a sale or handover",
    examples: "Grooming for exit, succession, investor-ready numbers",
  },
];

export function ProfileFunnel({
  initial,
  initialFyStartMonth,
  mode = "first-run",
  figuresReady = false,
  onComplete,
  onCancel,
}: {
  initial?: ClientOperatingProfile | null;
  /** Defaults to the workspace market's financial-year start (US → January, ZA → March). */
  initialFyStartMonth?: number;
  mode?: ProfileFunnelMode;
  /** Invited owner whose accountant already loaded figures: the score is behind this, not an upload. */
  figuresReady?: boolean;
  onComplete: (profile: ClientOperatingProfile) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const { market } = useMarket();
  const loc = (s: string) => localizeCopy(s, market);
  const marketFyStart = market.fyStartMonthDefault;
  // "complete" needs the core answers to exist; fall back to the full set if not.
  const order: readonly number[] =
    mode === "first-run"
      ? CORE_QUESTIONS
      : mode === "complete" && initial
        ? DEFERRED_QUESTIONS
        : ALL_QUESTIONS;
  const TOTAL = order.length;
  const MONTH_NAMES = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [payMotion, setPayMotion] = useState<BudgetPayMotion | null>(initial?.payMotion ?? null);
  const [primary, setPrimary] = useState<VolumeUnitOption | null>(() => {
    if (!initial) return null;
    const opts = volumeOptionsForMotion(initial.payMotion);
    return (
      opts.find((o) => o.templateId === initial.templateId || o.id === initial.volumeUnit) ?? null
    );
  });
  const [secondary, setSecondary] = useState<BudgetVolumeUnit[]>(
    initial?.secondaryVolumeUnits ?? [],
  );
  const [debtorDays, setDebtorDays] = useState<number | null>(initial?.debtorDaysDefault ?? null);
  const [costShape, setCostShape] = useState<BudgetCostShape | null>(initial?.costShape ?? null);
  const [seasonality, setSeasonality] = useState<BudgetSeasonality | null>(
    initial?.seasonality ?? null,
  );
  const [inventoryIntensity, setInventoryIntensity] = useState<InventoryIntensity | null>(
    initial?.inventoryIntensity ?? null,
  );
  const [customerConcentration, setCustomerConcentration] = useState<CustomerConcentration | null>(
    initial?.customerConcentration ?? null,
  );
  const [debtPosition, setDebtPosition] = useState<DebtPosition | null>(
    initial?.debtPosition ?? null,
  );
  const [ownerGoal, setOwnerGoal] = useState<OwnerGoal | null>(initial?.ownerGoal ?? null);
  const [fyStartMonth, setFyStartMonth] = useState(
    initial?.fyStartMonth ?? initialFyStartMonth ?? marketFyStart,
  );

  const volumeChoices = useMemo(
    () => (payMotion ? volumeOptionsForMotion(payMotion) : []),
    [payMotion],
  );

  const secondaryChoices = useMemo(() => {
    if (!primary || !payMotion) return [];
    const suggested = SUGGESTED_SECONDARIES[primary.templateId] ?? [];
    const pool = volumeOptionsForMotion(payMotion === "mix" ? "mix" : payMotion).filter(
      (o) => o.templateId !== primary.templateId && o.id !== primary.id,
    );
    const ordered = [
      ...pool.filter((o) => suggested.includes(o.id)),
      ...pool.filter((o) => !suggested.includes(o.id)),
    ];
    if (payMotion !== "mix" && suggested.length) {
      const extra = volumeOptionsForMotion("mix").filter(
        (o) =>
          suggested.includes(o.id) &&
          o.templateId !== primary.templateId &&
          !ordered.some((x) => x.id === o.id),
      );
      return [...ordered, ...extra];
    }
    return ordered;
  }, [primary, payMotion]);

  const titles = [
    "How do you mostly make money?",
    "What counts as one unit of sales?",
    "Any important second revenue stream?",
    "How quickly do customers typically pay?",
    "What does your cost base look like?",
    "How seasonal is demand?",
    "How important is stock / inventory?",
    "How concentrated is your revenue?",
    "Where do you stand on debt and funding?",
    "What are you actually trying to achieve?",
  ];

  const q = order[step];
  const isLast = step === TOTAL - 1;

  const finish = async () => {
    if (!payMotion || !primary || debtorDays == null || !ownerGoal) {
      toast.error("Pick an answer for each question before saving.");
      return;
    }
    const coreOnly = mode === "first-run";
    const inferred = inferDeferredProfileAnswers({
      payMotion,
      templateId: primary.templateId,
      suggestSeasonality: primary.suggestSeasonality,
    });
    if (
      !coreOnly &&
      (!costShape || !seasonality || !inventoryIntensity || !customerConcentration || !debtPosition)
    ) {
      toast.error("Pick an answer for each question before saving.");
      return;
    }
    const profile = buildOperatingProfile({
      payMotion,
      volumeUnit: primary.id,
      templateId: primary.templateId,
      secondaryVolumeUnits: coreOnly ? inferred.secondaryVolumeUnits : secondary,
      debtorDaysDefault: debtorDays,
      costShape: costShape ?? inferred.costShape,
      seasonality: seasonality ?? inferred.seasonality,
      inventoryIntensity: inventoryIntensity ?? inferred.inventoryIntensity,
      customerConcentration: customerConcentration ?? inferred.customerConcentration,
      debtPosition: debtPosition ?? inferred.debtPosition,
      ownerGoal,
      fyStartMonth,
      depth: coreOnly ? "core" : "full",
    });
    setSaving(true);
    try {
      await onComplete(profile);
    } finally {
      setSaving(false);
    }
  };

  const card =
    "w-full rounded-xl border border-[#d4a550]/25 bg-slate-900/80 p-3 text-left transition hover:border-[#d4a550]/60 hover:bg-[#d4a550]/5";
  const cardOn = "border-[#d4a550] bg-[#d4a550]/10";

  const toggleSecondary = (id: BudgetVolumeUnit) => {
    setSecondary((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 2 ? prev : [...prev, id],
    );
  };

  const goNext = () => setStep((s) => Math.min(TOTAL - 1, s + 1));
  const goBack = () => setStep((s) => Math.max(0, s - 1));

  /** Whether the question currently on screen has an answer (enables Save on the last one). */
  const answeredCurrent = (() => {
    switch (q) {
      case 0:
        return !!payMotion;
      case 1:
        return !!primary;
      case 2:
        return true;
      case 3:
        return debtorDays != null;
      case 4:
        return !!costShape;
      case 5:
        return !!seasonality;
      case 6:
        return !!inventoryIntensity;
      case 7:
        return !!customerConcentration;
      case 8:
        return !!debtPosition;
      case 9:
        return !!ownerGoal;
      default:
        return false;
    }
  })();

  const headerLabel =
    mode === "first-run"
      ? figuresReady
        ? "One step · Business profile"
        : "Step 1 of 2 · Business profile"
      : mode === "complete"
        ? "Finish your business profile"
        : "Update business profile";
  const introCopy =
    mode === "first-run" && step === 0
      ? figuresReady
        ? "Four quick questions — tap the closest fit and you move on. Your accountant has already loaded your figures, so your health score is waiting right behind this."
        : "Four quick questions — tap the closest fit and you move on. They tune your health score, cash forecast, budget and advice. Next, you bring in your figures."
      : mode === "complete" && step === 0
        ? "Six more taps. Each one sharpens your score, budget, benchmarks and advice — you can change any of them later."
        : "Examples under each answer help you pick the closest fit — this tunes health scores, cash, budget, benchmarks, and advice.";

  const optionsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    optionsRef.current?.scrollTo({ top: 0 });
  }, [step]);

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d4a550]">
          {headerLabel} · question {step + 1} of {TOTAL}
        </p>
        <h2 className="mt-1 text-xl font-semibold text-slate-100 sm:text-2xl">{titles[q]}</h2>
        <p className="mt-1 text-sm text-slate-400">{introCopy}</p>
      </div>

      <div
        ref={optionsRef}
        className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1 [-webkit-overflow-scrolling:touch]"
      >
        {q === 0 &&
          PAY_MOTION_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${card} ${payMotion === o.id ? cardOn : ""}`}
              onClick={() => {
                setPayMotion(o.id);
                setPrimary(null);
                setSecondary([]);
                goNext();
              }}
            >
              <div className="text-sm font-semibold text-slate-100">{o.label}</div>
              <div className="text-xs text-slate-400">{o.hint}</div>
              <div className="mt-1 text-[11px] text-slate-500">e.g. {loc(o.examples)}</div>
            </button>
          ))}

        {q === 1 &&
          volumeChoices.map((o) => (
            <button
              key={`${o.templateId}:${o.id}`}
              type="button"
              className={`${card} ${primary?.templateId === o.templateId && primary?.id === o.id ? cardOn : ""}`}
              onClick={() => {
                setPrimary(o);
                setSecondary([]);
                if (o.suggestSeasonality) setSeasonality("mild");
                goNext();
              }}
            >
              <div className="text-sm font-semibold text-slate-100">{o.label}</div>
              <div className="text-xs text-slate-400">{o.hint}</div>
              <div className="mt-1 text-[11px] text-slate-500">e.g. {loc(o.examples)}</div>
            </button>
          ))}

        {q === 2 && primary && (
          <>
            <button
              type="button"
              className={`${card} ${secondary.length === 0 ? cardOn : ""}`}
              onClick={() => {
                setSecondary([]);
                goNext();
              }}
            >
              <div className="text-sm font-semibold text-slate-100">No second stream</div>
              <div className="text-xs text-slate-400">
                Just the primary for now — you can refine later
              </div>
            </button>
            {secondaryChoices.slice(0, 10).map((o) => {
              const on = secondary.includes(o.id);
              return (
                <button
                  key={`sec-${o.templateId}:${o.id}`}
                  type="button"
                  className={`${card} ${on ? cardOn : ""}`}
                  onClick={() => toggleSecondary(o.id)}
                >
                  <div className="text-sm font-semibold text-slate-100">
                    {on ? "✓ " : ""}
                    {o.label}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-500">e.g. {loc(o.examples)}</div>
                </button>
              );
            })}
            <Button
              size="sm"
              className="mt-2 bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c49a45]"
              onClick={goNext}
            >
              Continue{secondary.length ? ` · ${secondary.length} selected` : ""}
            </Button>
          </>
        )}

        {q === 3 &&
          PAY_TIMING.map((o) => (
            <button
              key={o.label}
              type="button"
              className={`${card} ${debtorDays === o.days ? cardOn : ""}`}
              onClick={() => {
                setDebtorDays(o.days);
                goNext();
              }}
            >
              <div className="text-sm font-semibold text-slate-100">{o.label}</div>
              <div className="mt-1 text-[11px] text-slate-500">e.g. {loc(o.examples)}</div>
            </button>
          ))}

        {q === 4 &&
          COST_SHAPE.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${card} ${costShape === o.id ? cardOn : ""}`}
              onClick={() => {
                setCostShape(o.id);
                goNext();
              }}
            >
              <div className="text-sm font-semibold text-slate-100">{o.label}</div>
              <div className="mt-1 text-[11px] text-slate-500">e.g. {loc(o.examples)}</div>
            </button>
          ))}

        {q === 5 &&
          SEASONALITY.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${card} ${seasonality === o.id ? cardOn : ""}`}
              onClick={() => {
                setSeasonality(o.id);
                goNext();
              }}
            >
              <div className="text-sm font-semibold text-slate-100">{o.label}</div>
              <div className="mt-1 text-[11px] text-slate-500">e.g. {loc(o.examples)}</div>
            </button>
          ))}

        {q === 6 &&
          INVENTORY.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${card} ${inventoryIntensity === o.id ? cardOn : ""}`}
              onClick={() => {
                setInventoryIntensity(o.id);
                goNext();
              }}
            >
              <div className="text-sm font-semibold text-slate-100">{o.label}</div>
              <div className="mt-1 text-[11px] text-slate-500">e.g. {loc(o.examples)}</div>
            </button>
          ))}

        {q === 7 &&
          CONCENTRATION.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${card} ${customerConcentration === o.id ? cardOn : ""}`}
              onClick={() => {
                setCustomerConcentration(o.id);
                goNext();
              }}
            >
              <div className="text-sm font-semibold text-slate-100">{o.label}</div>
              <div className="mt-1 text-[11px] text-slate-500">e.g. {loc(o.examples)}</div>
            </button>
          ))}

        {q === 8 &&
          DEBT.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${card} ${debtPosition === o.id ? cardOn : ""}`}
              onClick={() => {
                setDebtPosition(o.id);
                goNext();
              }}
            >
              <div className="text-sm font-semibold text-slate-100">{o.label}</div>
              <div className="mt-1 text-[11px] text-slate-500">e.g. {loc(o.examples)}</div>
            </button>
          ))}

        {q === 9 && (
          <>
            {GOAL.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`${card} ${ownerGoal === o.id ? cardOn : ""}`}
                onClick={() => setOwnerGoal(o.id)}
              >
                <div className="text-sm font-semibold text-slate-100">{o.label}</div>
                <div className="mt-1 text-[11px] text-slate-500">e.g. {loc(o.examples)}</div>
              </button>
            ))}
            <div className="mt-2 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Financial year starts in
              </label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                value={fyStartMonth}
                onChange={(e) => setFyStartMonth(Number(e.target.value))}
              >
                {MONTH_NAMES.map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                Default {MONTH_NAMES[marketFyStart - 1]} (
                {marketFyStart === 1 ? "common for US businesses" : "common in South Africa"}). Used
                by Budget and reporting periods.
              </p>
            </div>
          </>
        )}
      </div>

      {/* Sticky footer — Save always visible on last question (was clipped below fold). */}
      <div className="flex shrink-0 items-center gap-2 border-t border-slate-800 pt-3">
        {step > 0 ? (
          <Button variant="ghost" size="sm" className="text-slate-300" onClick={goBack}>
            Back
          </Button>
        ) : mode !== "first-run" && onCancel ? (
          <Button variant="ghost" size="sm" className="text-slate-300" onClick={onCancel}>
            {mode === "complete" ? "Later" : "Cancel"}
          </Button>
        ) : (
          <span />
        )}
        <div className="ml-auto flex items-center gap-3">
          <div className="flex gap-1">
            {Array.from({ length: TOTAL }).map((_, i) => (
              <span
                key={i}
                className={`h-1.5 w-1.5 rounded-full ${i <= step ? "bg-[#d4a550]" : "bg-slate-700"}`}
              />
            ))}
          </div>
          {isLast && (
            <Button
              disabled={!answeredCurrent || saving}
              className="bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c49a45]"
              onClick={finish}
            >
              {saving
                ? "Saving…"
                : mode === "first-run"
                  ? "Save profile & continue"
                  : mode === "complete"
                    ? "Finish profile"
                    : "Update profile"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** @deprecated capex is not asked in profile — kept for typing convenience in callers */
export type ProfileCapexMode = BudgetCapexMode;
