import { US_STATES, type DraftMarket, type MarketId, type UsStateCode } from "@/lib/market";

const CARD =
  "rounded-xl border px-4 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a550]";

export function MarketPicker({
  value,
  onChange,
  variant = "app",
  disabled,
}: {
  value: DraftMarket;
  onChange: (next: DraftMarket) => void;
  variant?: "app" | "landing";
  disabled?: boolean;
}) {
  const dim = variant === "landing";
  const idle = dim
    ? "border-[rgba(212,175,55,0.25)] bg-[rgba(13,13,20,0.6)] text-[#f2ecdc]"
    : "border-slate-700 bg-slate-950/50 text-slate-200";
  const on = dim
    ? "border-[#d4af37] bg-[rgba(212,175,55,0.12)] text-[#f2ecdc]"
    : "border-[#d4a550] bg-[#d4a550]/10 text-slate-50";
  const labelCls = dim
    ? "text-[10px] uppercase tracking-[0.14em] text-[#9b958a]"
    : "text-[10px] uppercase tracking-[0.14em] text-slate-500";
  const helpCls = dim ? "text-xs text-[#9b958a]" : "text-xs text-slate-500";

  const setCountry = (country: MarketId) => {
    onChange({
      country,
      regionCode: country === "ZA" ? null : value.regionCode,
    });
  };

  return (
    <div className="space-y-3">
      <p className={labelCls}>Where is this business?</p>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={disabled}
          className={`${CARD} ${value.country === "ZA" ? on : idle}`}
          onClick={() => setCountry("ZA")}
        >
          <div className="text-sm font-semibold">South Africa</div>
          <div className={`mt-1 ${helpCls}`}>Rand, VAT, March year-start</div>
        </button>
        <button
          type="button"
          disabled={disabled}
          className={`${CARD} ${value.country === "US" ? on : idle}`}
          onClick={() => setCountry("US")}
        >
          <div className="text-sm font-semibold">United States</div>
          <div className={`mt-1 ${helpCls}`}>Dollars, sales tax by state</div>
        </button>
      </div>
      {value.country === "US" && (
        <div>
          <label className={labelCls} htmlFor="milon-us-state">
            State *
          </label>
          <select
            id="milon-us-state"
            disabled={disabled}
            className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm ${idle}`}
            value={value.regionCode ?? ""}
            onChange={(e) =>
              onChange({
                country: "US",
                regionCode: (e.target.value || null) as UsStateCode | null,
              })
            }
          >
            <option value="">Select a state</option>
            {US_STATES.map((s) => (
              <option key={s.code} value={s.code}>
                {s.name}
              </option>
            ))}
          </select>
          <p className={`mt-2 ${helpCls}`}>
            Required for sales tax. You can set a different state per client later.
          </p>
        </div>
      )}
    </div>
  );
}
