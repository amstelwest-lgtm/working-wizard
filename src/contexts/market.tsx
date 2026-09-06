import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import {
  coerceMarketSelection,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyCompact,
  formatMonthLabel,
  formatNumber,
  readVisitorDraft,
  resolveMarket,
  t,
  visitorCopyPack,
  type CopyKey,
  type MarketSelection,
  type MarketTaxOverrides,
  type ResolvedMarket,
} from "@/lib/market";

type MarketContextValue = {
  selection: MarketSelection;
  market: ResolvedMarket;
  setSelection: (next: MarketSelection) => void;
};

const MarketContext = createContext<MarketContextValue | null>(null);

// Stable fallback for hooks used outside a provider (dashboard, marketing
// pages). A fresh object per call made every effect keyed on `selection`
// re-run each render — PlaybookDrawer looped into "Maximum update depth".
const FALLBACK_SELECTION: MarketSelection = { country: "ZA", regionCode: null };
const FALLBACK_VALUE: MarketContextValue = {
  selection: FALLBACK_SELECTION,
  market: resolveMarket(FALLBACK_SELECTION),
  setSelection: () => {},
};

export function MarketProvider({
  selection,
  overrides,
  onChange,
  children,
}: {
  selection: MarketSelection | null | undefined;
  overrides?: MarketTaxOverrides;
  onChange?: (next: MarketSelection) => void;
  children: ReactNode;
}) {
  // Keyed on the two scalars so consumers see one identity per market, not
  // one per parent render.
  const country = selection?.country;
  const regionCode = selection?.regionCode ?? null;
  const sel = useMemo(
    () => coerceMarketSelection(country ? { country, regionCode } : null),
    [country, regionCode],
  );
  const market = useMemo(() => resolveMarket(sel, overrides), [sel, overrides]);
  const setSelection = useCallback(
    (next: MarketSelection) => {
      onChange?.(next);
    },
    [onChange],
  );
  const value = useMemo(
    () => ({ selection: sel, market, setSelection }),
    [sel, market, setSelection],
  );
  return <MarketContext.Provider value={value}>{children}</MarketContext.Provider>;
}

export function useMarket(): MarketContextValue {
  const ctx = useContext(MarketContext);
  return ctx ?? FALLBACK_VALUE;
}

/** Workspace copy pack when inside MarketProvider; visitor draft on marketing pages. */
export function useResolvedCopyPack(): "za" | "us" {
  const ctx = useContext(MarketContext);
  if (ctx) return ctx.market.copyPack;
  return visitorCopyPack(readVisitorDraft());
}

export function useMarketFormat() {
  const { market, selection, setSelection } = useMarket();
  return useMemo(
    () => ({
      market,
      selection,
      setSelection,
      money: (
        n: number,
        opts?: { maximumFractionDigits?: number; minimumFractionDigits?: number },
      ) => formatMoney(n, market, opts),
      moneyCompact: (n: number) => formatMoneyCompact(n, market),
      number: (
        n: number,
        opts?: { maximumFractionDigits?: number; minimumFractionDigits?: number },
      ) => formatNumber(n, market, opts),
      date: (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) =>
        formatDate(d, market, opts),
      dateTime: (d: Date | string | number, opts?: Intl.DateTimeFormatOptions) =>
        formatDateTime(d, market, opts),
      month: (ym: string) => formatMonthLabel(ym, market),
      t: (key: CopyKey) => t(key, market),
    }),
    [market, selection, setSelection],
  );
}
