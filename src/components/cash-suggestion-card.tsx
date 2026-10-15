/**
 * Suggested cash inputs. Confirm is the only write, and it stays in the
 * forecast on file. Nothing here is posted to a ledger.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { CashForecastSuggestions } from "@/lib/cash-forecast-suggestions";

export function CashSuggestionCard({
  model,
  confirmed,
  formatAmount,
  canConfirm,
  onConfirm,
}: {
  model: CashForecastSuggestions;
  confirmed: boolean;
  formatAmount: (amount: number) => string;
  canConfirm: boolean;
  onConfirm: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section
      className="mb-3 rounded-xl border border-[#DBEAFE] bg-white p-3 text-[#102A43] dark:border-[#1e3a5f] dark:bg-[#0B1B2B] dark:text-[#F4F7FB]"
      data-cash-suggestions="true"
      aria-label="Suggested cash inputs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-bold uppercase tracking-[0.16em]">Suggested – confirm</h3>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          Fixed costs
        </Button>
      </div>
      {model.empty ? (
        <p className="mt-2 text-sm">{model.empty}</p>
      ) : (
        <ul className="mt-2 space-y-1 text-sm">
          {model.suggestions.map((row) => (
            <li key={row.key}>
              <b>{row.label}</b> {formatAmount(row.amount)} · {row.source}
              {confirmed ? "" : " · suggested – confirm"}
            </li>
          ))}
        </ul>
      )}
      {canConfirm && !model.empty ? (
        <Button type="button" className="mt-3" disabled={confirmed} onClick={onConfirm}>
          {confirmed ? "Confirmed" : "Confirm all"}
        </Button>
      ) : confirmed ? (
        <p className="mt-2 text-sm">Confirmed</p>
      ) : null}
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Fixed costs</SheetTitle>
            <SheetDescription>The statement total, then the monthly amount, then the forecast line.</SheetDescription>
          </SheetHeader>
          <ol className="mt-4 space-y-3">
            {model.steps.map((step) => (
              <li key={step.n} className="text-sm">
                <b>
                  {step.n}. {step.label}
                </b>
                {step.amount == null ? "" : ` · ${formatAmount(step.amount)}`}
                <span className="mt-1 block text-slate-600 dark:text-slate-300">{step.note}</span>
              </li>
            ))}
          </ol>
        </SheetContent>
      </Sheet>
    </section>
  );
}
