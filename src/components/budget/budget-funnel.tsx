/**
 * Budget qualifying funnel — wide → narrow → template.
 */

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type {
  BudgetCostShape,
  BudgetCapexMode,
  BudgetDriverKind,
  BudgetQualification,
  BudgetTemplateId,
} from "@/lib/budget.types";
import { BUDGET_TEMPLATES, resolveTemplateId } from "@/lib/budget.templates";

type PayModel = BudgetQualification["payModel"];

const PAY_OPTIONS: Array<{ id: PayModel; label: string; hint: string }> = [
  { id: "products", label: "Sell products / goods", hint: "Retail, wholesale, manufacturing, DTC" },
  { id: "services", label: "Sell services / time / projects", hint: "Hours, projects, day-rate" },
  { id: "subscription", label: "Recurring subscriptions or retainers", hint: "SaaS, memberships, retainers" },
  { id: "mix", label: "Mix of the above", hint: "We'll set a primary stream you can extend later" },
];

const SUBTYPE: Record<PayModel, Array<{ id: string; label: string }>> = {
  products: [
    { id: "retail", label: "Retail / shopfront" },
    { id: "wholesale", label: "Wholesale / distribution" },
    { id: "manufacturing", label: "Manufacturing / make-to-order" },
    { id: "online", label: "Online / DTC" },
  ],
  services: [
    { id: "hours", label: "Time & materials / billable hours" },
    { id: "projects", label: "Fixed-price projects" },
    { id: "retainers", label: "Retainers / recurring contracts" },
    { id: "day_rate", label: "Day-rate / shift labour" },
  ],
  subscription: [
    { id: "saas", label: "SaaS / software seats" },
    { id: "membership", label: "Membership / club" },
    { id: "professional_retainer", label: "Professional retainer" },
    { id: "managed", label: "Managed service (outcome SLA)" },
  ],
  mix: [
    { id: "retail", label: "Primary: products" },
    { id: "hours", label: "Primary: billable services" },
    { id: "retainers", label: "Primary: retainers" },
    { id: "saas", label: "Primary: subscriptions" },
  ],
};

const COST_SHAPE: Array<{ id: BudgetCostShape; label: string }> = [
  { id: "variable", label: "Mostly variable with sales (COGS, commissions)" },
  { id: "fixed", label: "Mostly fixed (people + rent)" },
  { id: "balanced", label: "Balanced" },
];

const PAY_TIMING: Array<{ days: number; label: string }> = [
  { days: 0, label: "Cash / card on sale" },
  { days: 30, label: "Around 30 days" },
  { days: 60, label: "60+ days" },
  { days: 45, label: "Milestone / progress billing" },
];

const CAPEX: Array<{ id: BudgetCapexMode; label: string }> = [
  { id: "none", label: "No material purchases" },
  { id: "light", label: "Light (tools, IT, vehicles)" },
  { id: "significant", label: "Significant (plant, fit-out, fleet)" },
];

function driverKindFor(payModel: PayModel, subtype: string): BudgetDriverKind {
  const tpl = resolveTemplateId({ payModel, subtype });
  return BUDGET_TEMPLATES[tpl].driverKind;
}

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
  const [payModel, setPayModel] = useState<PayModel | null>(null);
  const [subtype, setSubtype] = useState<string | null>(null);
  const [costShape, setCostShape] = useState<BudgetCostShape | null>(null);
  const [debtorDays, setDebtorDays] = useState<number | null>(null);
  const [capexMode, setCapexMode] = useState<BudgetCapexMode | null>(null);
  const [fyStartMonth, setFyStartMonth] = useState(initialFyStartMonth);

  const templateId = useMemo(() => {
    if (!payModel || !subtype) return null;
    return resolveTemplateId({ payModel, subtype });
  }, [payModel, subtype]);

  const finish = () => {
    if (!payModel || !subtype || !costShape || debtorDays == null || !capexMode || !templateId) return;
    const qualification: BudgetQualification = {
      payModel,
      subtype,
      driverKind: driverKindFor(payModel, subtype),
      costShape,
      debtorDaysDefault: debtorDays,
      capexMode,
      confirmedAt: new Date().toISOString(),
    };
    onComplete({ templateId, qualification, fyStartMonth });
  };

  const card =
    "w-full rounded-xl border border-[#d4a550]/25 bg-white/80 p-3 text-left transition hover:border-[#d4a550]/60 hover:bg-[#d4a550]/5 dark:bg-slate-950/60 dark:hover:bg-slate-900";
  const cardOn = "border-[#d4a550] bg-[#d4a550]/10 dark:bg-[#d4a550]/10";

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#b8860b]">
          Budget setup · step {step + 1} of 6
        </p>
        <h2 className="mt-1 text-xl font-semibold text-slate-900 dark:text-slate-100">
          {step === 0 && "How do you mostly get paid?"}
          {step === 1 && "Narrow it down"}
          {step === 2 && "What does your cost base look like?"}
          {step === 3 && "How quickly do customers typically pay?"}
          {step === 4 && "Any material capex this year?"}
          {step === 5 && "Confirm your financial year & model"}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          A few questions so we give you the right volume × price drivers — not a blank spreadsheet.
        </p>
      </div>

      {step === 0 && (
        <div className="grid gap-2">
          {PAY_OPTIONS.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${card} ${payModel === o.id ? cardOn : ""}`}
              onClick={() => {
                setPayModel(o.id);
                setSubtype(null);
                setStep(1);
              }}
            >
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{o.label}</div>
              <div className="text-xs text-slate-500">{o.hint}</div>
            </button>
          ))}
        </div>
      )}

      {step === 1 && payModel && (
        <div className="grid gap-2">
          {SUBTYPE[payModel].map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${card} ${subtype === o.id ? cardOn : ""}`}
              onClick={() => {
                setSubtype(o.id);
                setStep(2);
              }}
            >
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{o.label}</div>
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setStep(0)}>
            Back
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="grid gap-2">
          {COST_SHAPE.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${card} ${costShape === o.id ? cardOn : ""}`}
              onClick={() => {
                setCostShape(o.id);
                setStep(3);
              }}
            >
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{o.label}</div>
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
            Back
          </Button>
        </div>
      )}

      {step === 3 && (
        <div className="grid gap-2">
          {PAY_TIMING.map((o) => (
            <button
              key={o.label}
              type="button"
              className={`${card} ${debtorDays === o.days ? cardOn : ""}`}
              onClick={() => {
                setDebtorDays(o.days);
                setStep(4);
              }}
            >
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{o.label}</div>
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
            Back
          </Button>
        </div>
      )}

      {step === 4 && (
        <div className="grid gap-2">
          {CAPEX.map((o) => (
            <button
              key={o.id}
              type="button"
              className={`${card} ${capexMode === o.id ? cardOn : ""}`}
              onClick={() => {
                setCapexMode(o.id);
                setStep(5);
              }}
            >
              <div className="text-sm font-semibold text-slate-900 dark:text-slate-100">{o.label}</div>
            </button>
          ))}
          <Button variant="ghost" size="sm" onClick={() => setStep(3)}>
            Back
          </Button>
        </div>
      )}

      {step === 5 && templateId && (
        <div className="space-y-4 rounded-xl border border-[#d4a550]/30 bg-[#d4a550]/5 p-4">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-[#b8860b]">Template</div>
            <div className="text-lg font-semibold text-slate-900 dark:text-slate-100">
              {BUDGET_TEMPLATES[templateId].label}
            </div>
            <p className="text-sm text-slate-500">{BUDGET_TEMPLATES[templateId].description}</p>
          </div>
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
                "January", "February", "March", "April", "May", "June",
                "July", "August", "September", "October", "November", "December",
              ].map((name, i) => (
                <option key={name} value={i + 1}>
                  {name}
                </option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-slate-500">Default March (common SA). Change if your FY differs.</p>
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(4)}>
              Back
            </Button>
            <Button
              className="bg-[#d4a550] text-[#0a0e1a] hover:bg-[#c49a45]"
              onClick={finish}
            >
              Build my budget
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
