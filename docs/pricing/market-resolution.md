# Market resolution

Pricing uses one function per surface. The implementation is
`src/lib/pricing/market-resolution.ts`. Do not add a second rule beside it.

| Surface | Function | Precedence |
| --- | --- | --- |
| Anonymous visitor (landing, `/auth`, signup, FAQ, terms) | `resolveVisitorMarket` / `resolveVisitorDraft` | Geo country. Exactly `ZA` is ZA. Every other value, including a missing country, is US. A saved dropdown choice overrides geo only when the visitor changed it on this visit, or this request's URL has `?market=`. A stale saved `US` does not override ZA geo. A non-ZA geo never accepts ZA. |
| Firm billing, pricing, and gates | `resolveFirmMarket` | Stored `firms.market.country` only. Null, missing, or any non-ZA country is not ZA for prices and gates. Never geo, never the URL, never a stored currency or locale. Non-price display (dates, timezone) may still fall back to ZA. |
| Firm boot timing | `resolveFirmBootMarket` | Same stored country as `resolveFirmMarket` (trim and uppercase). `ZA` and `US` are known. A missing or other value stays `unknown` so the shell can wait. Not a price. |
| Owner plan | `resolveOwnerMarket` | Stored owner or firm market, otherwise geo (same exact-`ZA` rule). |
| Checkout charge | `resolveCheckoutPriceMarket` | A stored ZA firm starts on rand when the Checkout billing country is ZA or still unknown, and uses USD when that country is known and is not ZA. Any other firm is rand only when the practice list is rand and the billing country is ZA. Geo and the requested URL market are not inputs. |

`resolveFirmPriceCurrency` is the firm resolver as `"USD"` or `"zar"`. A missing firm market is USD.

The South Africa 50% coupon is not a price path. Checkout uses the rand catalog price. Signup prices follow the visitor draft from this module.
