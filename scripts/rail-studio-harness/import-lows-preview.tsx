import { useEffect } from "react";
import { toast } from "sonner";
import { AutoPopulateOptions } from "@/components/auto-populate-options";
import { StaleBundleBar } from "@/components/stale-bundle-bar";
import { useMarketFormat } from "@/contexts/market";
import {
  buildAutoPopulateWrites,
  defaultAutoPopulatePrefs,
  statementAutoPopulatePrefs,
  summariseAutoPopulate,
} from "@/lib/auto-populate";
import { formatCalendarDay } from "@/lib/market/format";
import { ZA_MARKET } from "@/lib/market";
import { balanceSheetCashAsOf } from "@/lib/statement-parse";

const WEEK_DAY_LABEL = { day: "2-digit", month: "short" } as const;

const sheetPrefs = statementAutoPopulatePrefs(defaultAutoPopulatePrefs(), "balance_sheet");

const applied = buildAutoPopulateWrites(
  { profitability: false, cash_forecast: true, budget: false },
  {
    fields: { cash: "46300" },
    existingCashflow: {
      openingBalance: "12000",
      startDate: "2026-10-05",
      revenue: [],
      expenses: [],
    },
    market: ZA_MARKET,
    now: "2026-10-08T00:00:00.000Z",
    statementKind: "balance_sheet",
    cashOpeningDate: "2026-09-30",
  },
);

/** Local proof of the opening label, the import toast, and the reload bar. */
export function ImportLowsPreview() {
  const { market, moneyCompact } = useMarketFormat();
  const opening = 46300;
  const asOf = balanceSheetCashAsOf({ cash: "46300", cashAsOf: "2026-09-30" }, opening);
  const openingLabel = asOf ? formatCalendarDay(asOf, market, WEEK_DAY_LABEL) : "";
  const message = summariseAutoPopulate(applied, false);

  useEffect(() => {
    toast.success(message, { duration: Infinity, id: "import-lows-toast" });
  }, [message]);

  return (
    <div data-import-lows-ready="true" className="min-h-screen bg-[#f6f3ec] px-8 py-10 text-slate-900">
      <div className="mx-auto flex max-w-3xl flex-col gap-8">
        <div
          data-shot="opening"
          className="w-56 rounded-xl border border-amber-900/10 bg-white/80 px-4 py-3"
        >
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
            Opening bank
          </div>
          <div className="mt-1 text-xl font-extrabold leading-tight tracking-tight text-slate-950">
            {moneyCompact(opening)}
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500">{openingLabel}</div>
        </div>

        <div data-shot="import-options" className="max-w-xl">
          <AutoPopulateOptions firstUpload={false} value={sheetPrefs} onChange={() => {}} role="accountant" />
        </div>
      </div>
      <StaleBundleBar forceVisible />
    </div>
  );
}
