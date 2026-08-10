/**
 * Budget qualifying funnel — pay motion → volume unit → secondary → shape → cash → capex.
 * Copy includes concrete business examples so owners self-classify correctly.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  BudgetCapexMode,
  BudgetCostShape,
  BudgetQualification,
  BudgetSeasonality,
  BudgetTemplateId,
  BudgetVolumeUnit,
  BudgetPayMotion,
} from "@/lib/budget.types";
import { BUDGET_TEMPLATES } from "@/lib/budget.templates";
import {
  PAY_MOTION_OPTIONS,
  SUGGESTED_SECONDARIES,
  volumeOptionsForMotion,
  type VolumeUnitOption,
} from "@/lib/budget.taxonomy";

const COST_SHAPE: Array<{ id: BudgetCostShape; label: string; examples: string }> = [
  {
    id: "variable",
    label: "Mostly variable with sales",
    examples: "COGS, commissions, fuel, materials — costs jump when sales jump",
  },
  {
    id: "fixed",
    label: "Mostly fixed",
    examples: "Rent, salaried team, software — costs stay steady month to month",
  },
  {
    id: "payroll_heavy",
    label: "Payroll-heavy",
    examples: "Guarding, cleaning crews, clinics, professional practices",
  },
  {
    id: "balanced",
    label: "Balanced mix",
    examples: "A real split between fixed overhead and variable cost of sales",
  },
];

const PAY_TIMING: Array<{ days: number; label: string; examples: string }> = [
  { days: 0, label: "Cash / card on sale", examples: "Retail, restaurants, salons, fuel" },
  { days: 30, label: "Around 30 days", examples: "Typical B2B invoices" },
  { days: 45, label: "Milestone / progress billing (~45 days)", examples: "Construction certs, project retainers" },
  { days: 60, label: "60+ days", examples: "Medical aid, government, large corporates, export" },
];

const CAPEX: Array<{ id: BudgetCapexMode; label: string; examples: string }> = [
  { id: "none", label: "No material purchases this year", examples: "Pure services, light SaaS, small retainers" },
  { id: "light", label: "Light (tools, IT, vehicles)", examples: "Laptops, one bakkie, salon chairs" },
  { id: "significant", label: "Significant (plant, fit-out, fleet)", examples: "Hotel refurb, factory kit, truck fleet, fibre rollout" },
];

const SEASONALITY: Array<{ id: BudgetSeasonality; label: string; examples: string }> = [
  { id: "flat", label: "Fairly even through the year", examples: "Many B2B services" },
  { id: "mild", label: "Mild seasonality", examples: "Retail peaks, restaurant weekends/holidays" },
  { id: "strong", label: "Strong peaks and troughs", examples: "Hotels, agri harvest, education terms, events" },
];

const TOTAL_STEPS = 7;

export function BudgetFunnel({
  onComplete,
  initialFyStartMonth = 3,
}: {
  onComplete: (args: {
    templateId: BudgetTemplateId;
    qualification: BudgetQualification;
    fyStartMonth: number;
  }) => void;
  initialFyStartMonth?: number;
}) {
  const [step, setStep] = useState(0);
  const [payMotion, setPayMotion] = useState<BudgetPayMotion | null>(null);
  const [primary, setPrimary] = useState<VolumeUnitOption | null>(null);
  const [secondary, setSecondary] = useState<BudgetVolumeUnit[]>([]);
  const [costShape, setCostShape] = useState<BudgetCostShape | null>(null);
  const [debtorDays, setDebtorDays] = useState<number | null>(null);
  const [capexMode, setCapexMode] = useState<BudgetCapexMode | null>(null);
  const [seasonality, setSeasonality] = useState<BudgetSeasonality>("flat");
  const [fyStartMonth, setFyStartMonth] = useState(initialFyStartMonth);

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
    // Prefer suggested first
    const ordered = [
      ...pool.filter((o) => suggested.includes(o.id)),
      ...pool.filter((o) => !suggested.includes(o.id)),
    ];
    // For non-mix, also allow common cross-motion secondaries from suggestions
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

  const showSeasonality = Boolean(primary?.suggestSeasonality) || seasonality !== "flat";

  const finish = () => {
    if (!payMotion || !primary || !costShape || debtorDays == null || !capexMode) return;
    const templateId = primary.templateId;
    const qualification: BudgetQualification = {
      payMotion,
      volumeUnit: primary.id,
      secondaryVolumeUnits: secondary,
      // legacy mirrors for older readers
      payModel:
        payMotion === "goods"
          ? "products"
          : payMotion === "time_delivery"
            ? "services"
            : payMotion === "recurring_rights"
              ? "subscription"
              : "mix",
      subtype: primary.id,
      driverKind: primary.driverKind,
      costShape,
      debtorDaysDefault: debtorDays,
      capexMode,
      seasonality: primary.suggestSeasonality ? seasonality : seasonality,
      confirmedAt: new Date().toISOString(),
    };
    onComplete({ templateId, qualification, fyStartMonth });
  };

  const card =
    "w-full rounded-xl border border-[#d4a550]/25 bg-white/80 p-3 text-left transition hover:border-[#d4a550]/60 hover:bg-[#d4a550]/5 dark:bg-slate-950/60 dark:hover:bg-slate-900";
  const cardOn = "border-[#d4a550] bg-[#d4a550]/10 dark:bg-[#d4a550]/10";

  const toggleSecondary = (id: BudgetVolumeUnit) => {
    setSecondary((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 2 ? prev : [...prev, id],
    );
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b8860b]">
          Budget setup · step {step + 1} of {TOTAL_STEPS}
        </p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
          {step === 0 && "How do you mostly make money?"}
          {step === 1 && "What do you count as ‘one unit’ of sales?"}
          {step === 2 && "Any important second revenue stream?"}
          {step === 3 && "What does your cost base look like?"}
          {step === 4 && "How quickly do customers typically pay?"}
          {step === 5 && "Any material capex this year?"}
          {step === 6 && "Confirm your model & financial year"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          Pick the closest match — examples under each answer help you land in the right place.
        </p>
      </div>

      {step === 0 && (
        <div className="grid gap-2">
          {PAY_MOTION_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${card} ${payMotion === o.id ? cardOn : ""}`}
              onClick={() => {
                setPayMotion(o.id);
                setPrimary(null);
                setSecondary([]);
                setStep(1);
              }}
            >
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{o.label}</div>
              <div className="text-xs text-slate-500">{o.hint}</div>
              <div className="mt-1 text-[11px] text-slate-400">e.g. {o.examples}</div>
            </button>
          ))}
        </div>
      )}

      {step === 1 && payMotion && (
        <div className="grid gap-2">
          {volumeChoices.map((o) => (
            <button
              key={`${o.templateId}:${o.id}`}
              type="button"
              className={`${card} ${primary?.templateId === o.templateId && primary?.id === o.id ? cardOn : ""}`}
              onClick={() => {
                setPrimary(o);
                setSecondary([]);
                setSeasonality(o.suggestSeasonality ? "mild" : "flat");
                setStep(2);
              }}
            >
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{o.label}</div>
              <div className="text-xs text-slate-500">{o.hint}</div>
              <div className="mt-1 text-[11px] text-slate-400">e.g. {o.examples}</div>
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setStep(0)}>
            Back
          </Button>
        </div>
      )}

      {step === 2 && primary && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Optional — hotels often add F&B, forecourts add a shop, dealerships add workshop labour.
            Select up to two, or skip.
          </p>
          <button
            type="button"
            className={`${card} ${secondary.length === 0 ? cardOn : ""}`}
            onClick={() => {
              setSecondary([]);
              setStep(3);
            }}
          >
            <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              No second stream — just the primary
            </div>
            <div className="text-xs text-slate-500">You can add lines later if needed</div>
          </button>
          <div className="grid gap-2">
            {secondaryChoices.slice(0, 12).map((o) => {
              const on = secondary.includes(o.id);
              return (
                <button
                  key={`sec-${o.templateId}:${o.id}`}
                  type="button"
                  className={`${card} ${on ? cardOn : ""}`}
                  onClick={() => toggleSecondary(o.id)}
                >
                  <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {on ? "✓ " : ""}
                    {o.label}
                  </div>
                  <div className="mt-1 text-[11px] text-slate-400">e.g. {o.examples}</div>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button
              size="sm"
              className="bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c49a45]"
              onClick={() => setStep(3)}
            >
              Continue{secondary.length ? ` (${secondary.length} secondary)` : ""}
            </Button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="grid gap-2">
          {COST_SHAPE.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${card} ${costShape === o.id ? cardOn : ""}`}
              onClick={() => {
                setCostShape(o.id);
                setStep(4);
              }}
            >
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{o.label}</div>
              <div className="mt-1 text-[11px] text-slate-400">e.g. {o.examples}</div>
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
            Back
          </Button>
        </div>
      )}

      {step === 4 && (
        <div className="grid gap-2">
          {PAY_TIMING.map((o) => (
            <button
              key={o.label}
              type="button"
              className={`${card} ${debtorDays === o.days ? cardOn : ""}`}
              onClick={() => {
                setDebtorDays(o.days);
                setStep(5);
              }}
            >
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{o.label}</div>
              <div className="mt-1 text-[11px] text-slate-400">e.g. {o.examples}</div>
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setStep(3)}>
            Back
          </Button>
        </div>
      )}

      {step === 5 && (
        <div className="grid gap-2">
          {CAPEX.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${card} ${capexMode === o.id ? cardOn : ""}`}
              onClick={() => {
                setCapexMode(o.id);
                setStep(6);
              }}
            >
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{o.label}</div>
              <div className="mt-1 text-[11px] text-slate-400">e.g. {o.examples}</div>
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setStep(4)}>
            Back
          </Button>
        </div>
      )}

      {step === 6 && primary && (
        <div className="space-y-4 rounded-xl border border-[#d4a550]/30 bg-[#d4a550]/5 p-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#b8860b]">
              Your budget model
            </div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {BUDGET_TEMPLATES[primary.templateId].label}
            </div>
            <p className="text-sm text-slate-500">
              {BUDGET_TEMPLATES[primary.templateId].description}
            </p>
            <p className="mt-2 text-xs text-slate-500">
              Drivers: <span className="font-medium text-slate-700 dark:text-slate-200">{primary.label}</span>
              {secondary.length > 0 && (
                <>
                  {" "}
                  · plus{" "}
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {secondary.length} secondary stream{secondary.length > 1 ? "s" : ""}
                  </span>
                </>
              )}
            </p>
          </div>

          {(primary.suggestSeasonality || showSeasonality) && (
            <div>
              <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                Seasonality
              </div>
              <div className="grid gap-2">
                {SEASONALITY.map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    className={`${card} ${seasonality === o.id ? cardOn : ""}`}
                    onClick={() => setSeasonality(o.id)}
                  >
                    <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{o.label}</div>
                    <div className="text-[11px] text-slate-400">e.g. {o.examples}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
              Financial year starts in
            </label>
            <select
              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-700 dark:bg-slate-950"
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
              Default March (common SA). Change if your FY differs.
            </p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(5)}>
              Back
            </Button>
            <Button className="bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c49a45]" onClick={finish}>
              Build my budget
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
