import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketPicker } from "@/components/market-picker";
import { supabase } from "@/integrations/supabase/client";
import {
  coerceMarketSelection,
  draftToSelection,
  isDraftComplete,
  marketToJson,
  parseMarketSelection,
  resolveMarket,
  SALES_TAX_HONESTY,
  formatPercentRate,
  type DraftMarket,
} from "@/lib/market";

export function MarketSettingsCard({
  kind,
  recordId,
  initial,
}: {
  kind: "client" | "firm";
  recordId: string | null;
  initial: unknown;
}) {
  const [draft, setDraft] = useState<DraftMarket>(() => {
    const sel = parseMarketSelection(initial) ?? coerceMarketSelection(initial);
    return { country: sel.country, regionCode: sel.regionCode };
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const sel = parseMarketSelection(initial) ?? coerceMarketSelection(initial);
    setDraft({ country: sel.country, regionCode: sel.regionCode });
  }, [initial]);

  const sel = draftToSelection(draft);
  const resolved = sel ? resolveMarket(sel) : null;

  const save = async () => {
    const next = draftToSelection(draft);
    if (!next || !recordId) {
      toast.error("Pick a country — and a US state if you chose the United States.");
      return;
    }
    setSaving(true);
    try {
      const table = kind === "firm" ? "firms" : "clients";
      const payload =
        kind === "client"
          ? {
              market: marketToJson(next),
              financial_year_start_month: next.country === "US" ? 1 : 3,
            }
          : { market: marketToJson(next) };
      const { error } = await supabase.from(table).update(payload).eq("id", recordId);
      if (error) throw error;
      toast.success("Region saved. New budgets will use this tax setting.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save region");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="mb-6 rounded-2xl border border-slate-800 bg-slate-900/60 p-5 sm:p-6">
      <div className="mb-4 flex items-center gap-2">
        <Globe className="h-4 w-4 text-[#d4a550]" />
        <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#d4a550]">
          Region & tax
        </h2>
      </div>
      <p className="mb-4 text-xs text-slate-500">
        South Africa uses rand and VAT. The United States uses dollars and your state’s sales tax
        for budgets. Changing region does not convert historical figures.
      </p>
      <MarketPicker value={draft} onChange={setDraft} />
      {resolved?.tax.regime === "sales_tax" && (
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          Default combined rate {formatPercentRate(resolved.tax.combinedRate)} (
          {formatPercentRate(resolved.tax.stateRate)} state +{" "}
          {formatPercentRate(resolved.tax.localRate)} avg local). {SALES_TAX_HONESTY}
        </p>
      )}
      {resolved?.tax.regime === "none" && resolved.country === "US" && (
        <p className="mt-3 text-xs text-slate-500">
          This state has no statewide sales tax (or none collected). Budgets will not add a
          sales-tax line unless you change that on the budget itself.
        </p>
      )}
      <Button
        type="button"
        className="mt-4 bg-[#d4a550] text-slate-950 hover:bg-[#e0b45c]"
        disabled={!isDraftComplete(draft) || saving || !recordId}
        onClick={() => void save()}
      >
        {saving ? "Saving…" : "Save region"}
      </Button>
    </section>
  );
}
