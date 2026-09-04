import { US_STATES, type DraftMarket, type MarketId, type UsStateCode } from "@/lib/market";

const CARD =
  "rounded-xl border px-4 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a550]";

function StateSelect({
  id,
  value,
  onChange,
  disabled,
  className,
}: {
  id: string;
  value: DraftMarket;
  onChange: (next: DraftMarket) => void;
  disabled?: boolean;
  className: string;
}) {
  return (
    <select
      id={id}
      disabled={disabled}
      className={className}
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
  );
}

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
  const setCountry = (country: MarketId) => {
    onChange({
      country,
      regionCode: country === "ZA" ? null : value.regionCode,
    });
  };

  if (variant === "landing") {
    return (
      <div className="milon-market">
        <p className="milon-market-label">Where is this business?</p>
        <div className="milon-market-choices">
          <button
            type="button"
            disabled={disabled}
            className={`milon-market-choice${value.country === "ZA" ? " is-on" : ""}`}
            onClick={() => setCountry("ZA")}
          >
            <strong>South Africa</strong>
            <span>Rand, VAT, March year-start</span>
          </button>
          <button
            type="button"
            disabled={disabled}
            className={`milon-market-choice${value.country === "US" ? " is-on" : ""}`}
            onClick={() => setCountry("US")}
          >
            <strong>United States</strong>
            <span>Dollars, sales tax by state</span>
          </button>
        </div>
        {value.country === "US" && (
          <div className="milon-market-state">
            <label className="milon-market-label" htmlFor="milon-us-state">
              State
            </label>
            <div className="milon-market-select-wrap">
              <StateSelect
                id="milon-us-state"
                value={value}
                onChange={onChange}
                disabled={disabled}
                className="milon-market-select"
              />
            </div>
            <p className="milon-market-help">
              Required for sales tax. You can set a different state per client later.
            </p>
          </div>
        )}
      </div>
    );
  }

  const idle = "border-slate-700 bg-slate-950/50 text-slate-200";
  const on = "border-[#d4a550] bg-[#d4a550]/10 text-slate-50";
  const labelCls = "text-[10px] uppercase tracking-[0.14em] text-slate-500";
  const helpCls = "text-xs text-slate-500";

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
          <label className={labelCls} htmlFor="milon-us-state-app">
            State *
          </label>
          <StateSelect
            id="milon-us-state-app"
            value={value}
            onChange={onChange}
            disabled={disabled}
            className={`mt-1.5 w-full rounded-xl border px-3 py-2.5 text-sm ${idle}`}
          />
          <p className={`mt-2 ${helpCls}`}>
            Required for sales tax. You can set a different state per client later.
          </p>
        </div>
      )}
    </div>
  );
}
