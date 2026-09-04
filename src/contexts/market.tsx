import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import {
  coerceMarketSelection,
  resolveMarket,
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
  const sel = coerceMarketSelection(selection ?? null);
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
  if (!ctx) {
    return {
      selection: { country: "ZA", regionCode: null },
      market: resolveMarket({ country: "ZA", regionCode: null }),
      setSelection: () => {},
    };
  }
  return ctx;
}
