/**
 * Milōn intro profile funnel — 10 questions for maximum deliverable “wind”.
 * Replaces the old single business-type picker. Retakeable anytime.
 */

import { useMemo, useState } from "react";
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
  type ClientOperatingProfile,
  type InventoryIntensity,
  type PrimaryPressure,
  type RevenueBand,
  type TeamSizeBand,
} from "@/lib/client-profile";

const TOTAL = 10;

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
  { days: 45, label: "Milestone / progress billing (~45 days)", examples: "Construction, project retainers" },
  { days: 60, label: "60+ days", examples: "Medical aid, government, large corporates, export" },
];

const SEASONALITY: Array<{ id: BudgetSeasonality; label: string; examples: string }> = [
  { id: "flat", label: "Fairly even through the year", examples: "Many B2B services" },
  { id: "mild", label: "Mild peaks", examples: "Retail holidays, restaurant weekends" },
  { id: "strong", label: "Strong peaks and troughs", examples: "Hotels, agri harvest, education terms, events" },
];

const INVENTORY: Array<{ id: InventoryIntensity; label: string; examples: string }> = [
  { id: "none", label: "Little or no stock", examples: "Consultancies, SaaS, agencies, most services" },
  { id: "light", label: "Some stock / short shelf-life", examples: "Cafés, salons (retail), light spare parts" },
  { id: "heavy", label: "Material inventory or WIP", examples: "Retail, wholesale, manufacturing, agri, pharmacies" },
];

const TEAM: Array<{ id: TeamSizeBand; label: string; examples: string }> = [
  { id: "solo", label: "Just me (or me + contractors)", examples: "Solo founder, freelancer" },
  { id: "small", label: "2–10 people", examples: "Small team / early SME" },
  { id: "medium", label: "11–50 people", examples: "Growing regional business" },
  { id: "large", label: "50+ people", examples: "Multi-site or labour-heavy ops" },
];

const REVENUE: Array<{ id: RevenueBand; label: string; examples: string }> = [
  { id: "pre_revenue", label: "Pre-revenue / just starting", examples: "Building toward first sales" },
  { id: "under_100k", label: "Under ~R100k / month", examples: "Early traction" },
  { id: "100k_500k", label: "About R100k–R500k / month", examples: "Established SME band" },
  { id: "500k_2m", label: "About R500k–R2m / month", examples: "Scaling operation" },
  { id: "over_2m", label: "Over ~R2m / month", examples: "Larger or multi-site" },
];

const PRESSURE: Array<{ id: PrimaryPressure; label: string; examples: string }> = [
  {
    id: "cash",
    label: "Cash / runway",
    examples: "Will we make payroll? How many weeks of cash left?",
  },
  {
    id: "profit",
    label: "Profitability / margins",
    examples: "Busy but not enough left after costs",
  },
  {
    id: "growth",
    label: "Growth / winning work",
    examples: "Need more sales, occupancy, or pipeline",
  },
  {
    id: "working_capital",
    label: "Working capital (debtors, stock, creditors)",
    examples: "Money stuck in invoices or inventory",
  },
  {
    id: "people",
    label: "People / capacity",
    examples: "Hiring, utilisation, founder bottleneck",
  },
];

export function ProfileFunnel({
  initial,
  initialFyStartMonth = 3,
  mode = "first-run",
  onComplete,
  onCancel,
}: {
  initial?: ClientOperatingProfile | null;
  initialFyStartMonth?: number;
  mode?: "first-run" | "retake";
  onComplete: (profile: ClientOperatingProfile) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [payMotion, setPayMotion] = useState<BudgetPayMotion | null>(initial?.payMotion ?? null);
  const [primary, setPrimary] = useState<VolumeUnitOption | null>(() => {
    if (!initial) return null;
    const opts = volumeOptionsForMotion(initial.payMotion);
    return opts.find((o) => o.templateId === initial.templateId || o.id === initial.volumeUnit) ?? null;
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
  const [teamSize, setTeamSize] = useState<TeamSizeBand | null>(initial?.teamSize ?? null);
  const [revenueBand, setRevenueBand] = useState<RevenueBand | null>(initial?.revenueBand ?? null);
  const [primaryPressure, setPrimaryPressure] = useState<PrimaryPressure | null>(
    initial?.primaryPressure ?? null,
  );
  const [fyStartMonth, setFyStartMonth] = useState(
    initial?.fyStartMonth ?? initialFyStartMonth,
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
    "How big is the team?",
    "Roughly, what’s monthly revenue?",
    "What’s the #1 pressure right now?",
  ];

  const finish = async () => {
    if (
      !payMotion ||
      !primary ||
      debtorDays == null ||
      !costShape ||
      !seasonality ||
      !inventoryIntensity ||
      !teamSize ||
      !revenueBand ||
      !primaryPressure
    ) {
      return;
    }
    const profile = buildOperatingProfile({
      payMotion,
      volumeUnit: primary.id,
      templateId: primary.templateId,
      secondaryVolumeUnits: secondary,
      debtorDaysDefault: debtorDays,
      costShape,
      seasonality,
      inventoryIntensity,
      teamSize,
      revenueBand,
      primaryPressure,
      fyStartMonth,
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

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="shrink-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#d4a550]">
          {mode === "first-run" ? "Welcome to Milōn" : "Update business profile"} · question{" "}
          {step + 1} of {TOTAL}
        </p>
        <h2 className="mt-1 text-xl font-semibold text-slate-100 sm:text-2xl">{titles[step]}</h2>
        <p className="mt-1 text-sm text-slate-400">
          Examples under each answer help you pick the closest fit — this tunes health scores,
          cash, budget, benchmarks, and advice.
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain pr-1">
        {step === 0 &&
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
              <div className="mt-1 text-[11px] text-slate-500">e.g. {o.examples}</div>
            </button>
          ))}

        {step === 1 &&
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
              <div className="mt-1 text-[11px] text-slate-500">e.g. {o.examples}</div>
            </button>
          ))}

        {step === 2 && primary && (
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
              <div className="text-xs text-slate-400">Just the primary for now — you can refine later</div>
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
                  <div className="mt-1 text-[11px] text-slate-500">e.g. {o.examples}</div>
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

        {step === 3 &&
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
              <div className="mt-1 text-[11px] text-slate-500">e.g. {o.examples}</div>
            </button>
          ))}

        {step === 4 &&
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
              <div className="mt-1 text-[11px] text-slate-500">e.g. {o.examples}</div>
            </button>
          ))}

        {step === 5 &&
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
              <div className="mt-1 text-[11px] text-slate-500">e.g. {o.examples}</div>
            </button>
          ))}

        {step === 6 &&
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
              <div className="mt-1 text-[11px] text-slate-500">e.g. {o.examples}</div>
            </button>
          ))}

        {step === 7 &&
          TEAM.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${card} ${teamSize === o.id ? cardOn : ""}`}
              onClick={() => {
                setTeamSize(o.id);
                goNext();
              }}
            >
              <div className="text-sm font-semibold text-slate-100">{o.label}</div>
              <div className="mt-1 text-[11px] text-slate-500">e.g. {o.examples}</div>
            </button>
          ))}

        {step === 8 &&
          REVENUE.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${card} ${revenueBand === o.id ? cardOn : ""}`}
              onClick={() => {
                setRevenueBand(o.id);
                goNext();
              }}
            >
              <div className="text-sm font-semibold text-slate-100">{o.label}</div>
              <div className="mt-1 text-[11px] text-slate-500">e.g. {o.examples}</div>
            </button>
          ))}

        {step === 9 && (
          <>
            {PRESSURE.map((o) => (
              <button
                key={o.id}
                type="button"
                className={`${card} ${primaryPressure === o.id ? cardOn : ""}`}
                onClick={() => setPrimaryPressure(o.id)}
              >
                <div className="text-sm font-semibold text-slate-100">{o.label}</div>
                <div className="mt-1 text-[11px] text-slate-500">e.g. {o.examples}</div>
              </button>
            ))}
            <div className="mt-4 rounded-xl border border-slate-700 bg-slate-900/60 p-3">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Financial year starts in
              </label>
              <select
                className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-950 px-3 py-2 text-sm text-slate-100"
                value={fyStartMonth}
                onChange={(e) => setFyStartMonth(Number(e.target.value))}
              >
                {[
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
                ].map((name, i) => (
                  <option key={name} value={i + 1}>
                    {name}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-slate-500">
                Default March (common SA). Used by Budget and reporting periods.
              </p>
            </div>
            <Button
              disabled={!primaryPressure || saving}
              className="mt-2 w-full bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c49a45]"
              onClick={finish}
            >
              {saving ? "Saving…" : mode === "first-run" ? "Save profile & continue" : "Update profile"}
            </Button>
          </>
        )}
      </div>

      <div className="flex shrink-0 gap-2 border-t border-slate-800 pt-3">
        {step > 0 ? (
          <Button variant="ghost" size="sm" className="text-slate-300" onClick={goBack}>
            Back
          </Button>
        ) : mode === "retake" && onCancel ? (
          <Button variant="ghost" size="sm" className="text-slate-300" onClick={onCancel}>
            Cancel
          </Button>
        ) : (
          <span />
        )}
        <div className="ml-auto flex gap-1">
          {Array.from({ length: TOTAL }).map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-1.5 rounded-full ${i <= step ? "bg-[#d4a550]" : "bg-slate-700"}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** @deprecated capex is not asked in profile — kept for typing convenience in callers */
export type ProfileCapexMode = BudgetCapexMode;
