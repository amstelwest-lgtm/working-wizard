import { useState } from "react";
import { toast } from "sonner";
import { Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarketPicker } from "@/components/market-picker";
import { SectionCard } from "@/components/primitives";
import { supabase } from "@/integrations/supabase/client";
import {
  draftToSelection,
  marketToJson,
  resolveMarket,
  SALES_TAX_HONESTY,
  formatPercentRate,
  ZA_VAT_RATE,
  type DraftMarket,
} from "@/lib/market";
import {
  readZaMarketExtras,
  ZA_PROVINCES,
  zaMarketExtrasJson,
  type ZaMarketExtras,
} from "@/lib/market/za-provinces";
import { saPlanRegionControls } from "@/lib/firm-band-upgrade";
import { RegionSettingsLoading } from "@/components/region-settings-loading";
import { regionFormFromSaved, regionSaveAllowed } from "@/lib/region-settings";

export function MarketSettingsCard({
  kind,
  recordId,
  initial,
  loaded = false,
  zarPlan = false,
}: {
  kind: "client" | "firm";
  recordId: string | null;
  initial: unknown;
  /** False until the saved region for this settings view has come back. */
  loaded?: boolean;
  /** SA practice plan. Hides the US state list and VAT wording. Does not write the market. */
  zarPlan?: boolean;
}) {
  const gate = regionFormFromSaved({ loaded, saved: initial });
  const savedKey = `${loaded ? "ready" : "loading"}:${JSON.stringify(initial ?? null)}`;
  const [appliedKey, setAppliedKey] = useState(savedKey);
  const [draft, setDraft] = useState<DraftMarket>(() =>
    gate.status === "ready" ? gate.draft : { country: null, regionCode: null },
  );
  const [zaExtras, setZaExtras] = useState<ZaMarketExtras>(() =>
    loaded
      ? readZaMarketExtras(initial)
      : { provinceCode: null, vatRegistered: false, vatMode: "exclusive" },
  );
  const [saving, setSaving] = useState(false);
  // Copy the saved region during render so the first paint already has South
  // Africa selected. A useEffect would leave both country buttons unpressed
  // for a frame after the row arrives.
  if (appliedKey !== savedKey) {
    setAppliedKey(savedKey);
    setDraft(gate.status === "ready" ? gate.draft : { country: null, regionCode: null });
    setZaExtras(
      loaded
        ? readZaMarketExtras(initial)
        : { provinceCode: null, vatRegistered: false, vatMode: "exclusive" },
    );
  }

  const sel = draftToSelection(draft);
  const resolved = sel ? resolveMarket(sel) : null;
  const regionControls = saPlanRegionControls(zarPlan);

  const save = async () => {
    if (!regionSaveAllowed({ loaded, recordId, draft })) return;
    const next = draftToSelection(draft);
    if (!next || !recordId) {
      toast.error("Pick a country — and a US state if you chose the United States.");
      return;
    }
    setSaving(true);
    try {
      const table = kind === "firm" ? "firms" : "clients";
      const market =
        next.country === "ZA"
          ? { ...marketToJson(next), ...zaMarketExtrasJson(zaExtras) }
          : marketToJson(next);
      const payload =
        kind === "client"
          ? {
              market,
              financial_year_start_month: next.country === "US" ? 1 : 3,
            }
          : { market };
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
    <SectionCard
      className="mb-6"
      eyebrow={
        <span className="inline-flex items-center gap-2">
          <Globe className="h-4 w-4" />
          Region & tax
        </span>
      }
      description={
        !loaded
          ? "Loading the saved region."
          : regionControls.vatCopy
            ? "South Africa uses rand and VAT. The United States uses dollars and your state’s sales tax for budgets. Changing region does not convert historical figures."
            : "South Africa uses rand."
      }
    >
      {!loaded ? <RegionSettingsLoading /> : null}
      {loaded ? (
        <>
          {regionControls.stateDropdown ? (
            <MarketPicker
              value={draft}
              onChange={setDraft}
              vatCopy={regionControls.vatCopy}
              stateDropdown={regionControls.stateDropdown}
            />
          ) : (
            <p className="text-sm font-semibold" data-sa-plan-region="">
              South Africa
            </p>
          )}
          {gate.status === "ready" && gate.unset ? (
            <p className="mt-3 text-xs text-[var(--ink-dim)]" data-region-default="ZA">
              Not set, defaulting to South Africa
            </p>
          ) : null}
          {draft.country === "ZA" && regionControls.vatCopy ? (
            <div className="mt-3 space-y-3">
              <div>
                <label
                  className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-dim,#9b958a)]"
                  htmlFor="milon-za-province"
                >
                  Province
                </label>
                <select
                  id="milon-za-province"
                  className="mt-1.5 w-full rounded-xl border border-[var(--line,#DBEAFE)] bg-transparent px-3 py-2.5 text-sm text-[var(--ink,#102A43)]"
                  value={zaExtras.provinceCode ?? ""}
                  onChange={(e) =>
                    setZaExtras((current) => ({
                      ...current,
                      provinceCode: e.target.value
                        ? (e.target.value as ZaMarketExtras["provinceCode"])
                        : null,
                    }))
                  }
                >
                  <option value="">Select a province</option>
                  {ZA_PROVINCES.map((province) => (
                    <option key={province.code} value={province.code}>
                      {province.name}
                    </option>
                  ))}
                </select>
              </div>
              <fieldset className="space-y-2">
                <legend className="text-[10px] uppercase tracking-[0.14em] text-[var(--ink-dim,#9b958a)]">
                  VAT
                </legend>
                <label className="flex items-center gap-2 text-sm text-[var(--ink,#102A43)]">
                  <input
                    type="checkbox"
                    checked={zaExtras.vatRegistered}
                    onChange={(e) =>
                      setZaExtras((current) => ({ ...current, vatRegistered: e.target.checked }))
                    }
                  />
                  Registered for VAT ({formatPercentRate(ZA_VAT_RATE)})
                </label>
                {zaExtras.vatRegistered ? (
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        ["exclusive", "Prices exclude VAT"],
                        ["inclusive", "Prices include VAT"],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        type="button"
                        className={`rounded-xl border px-3 py-2 text-left text-sm ${
                          zaExtras.vatMode === mode
                            ? "border-[#0B5FFF] bg-[#DBEAFE] text-[#102A43]"
                            : "border-[var(--line,#DBEAFE)] bg-transparent text-[var(--ink,#102A43)]"
                        }`}
                        onClick={() => setZaExtras((current) => ({ ...current, vatMode: mode }))}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-[var(--ink-dim)]">
                    Budgets will not add a VAT line while the practice is not VAT registered.
                  </p>
                )}
              </fieldset>
            </div>
          ) : null}
          {regionControls.stateDropdown && resolved?.tax.regime === "sales_tax" && (
            <p className="mt-3 text-xs leading-relaxed text-[var(--ink-dim)]">
              Default combined rate {formatPercentRate(resolved.tax.combinedRate)} (
              {formatPercentRate(resolved.tax.stateRate)} state +{" "}
              {formatPercentRate(resolved.tax.localRate)} avg local). {SALES_TAX_HONESTY}
            </p>
          )}
          {regionControls.stateDropdown &&
            resolved?.tax.regime === "none" &&
            resolved.country === "US" && (
              <p className="mt-3 text-xs text-[var(--ink-dim)]">
                This state has no statewide sales tax (or none collected). Budgets will not add a
                sales-tax line unless you change that on the budget itself.
              </p>
            )}
          {regionControls.stateDropdown ? (
            <Button
              type="button"
              className="settings-gold mt-4"
              disabled={!regionSaveAllowed({ loaded, recordId, draft }) || saving}
              onClick={() => void save()}
            >
              {saving ? "Saving…" : "Save region"}
            </Button>
          ) : null}
        </>
      ) : null}
    </SectionCard>
  );
}
