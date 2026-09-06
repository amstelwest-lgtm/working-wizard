# Build plan: US Milōn from first selection

**Status:** implementation plan (no product code in this PR).
**Companion:** [`us-market-expansion-plan.md`](./us-market-expansion-plan.md) is the inventory of ZA surfaces. This document is **how the app will actually switch** once the user picks a region (and, for the US, a state).
**Constraint:** one codebase. Only ZA and US for now. Existing ZA accounts keep today’s behaviour without a migration wizard.

The spine is a single choice made **before** the rest of onboarding:

1. **Region:** South Africa or United States.
2. **If United States:** **state** (50 + DC) is required. The product will not enter a US workspace without it.
3. Everything else (currency, locale, FY default, tax engine, copy, prompts, playbooks, comms) is **derived** from that pair. Users do not pick currency or VAT rate as a separate first-class choice.

---

## 1. What “initial selection” is

Today the first fork is **persona** (owner vs accountant) on the landing `#persona` section, then a quiz, then register (`adminSignUp` in `src/lib/auth.functions.ts`). Region is implicit ZA everywhere (`en-ZA`, `R`, VAT 15%, FY month 3).

**New first fork: market, then persona.**

```
Visitor
  → Region: ZA | US
  → if US: State (required)
  → Persona: owner | accountant   (existing)
  → Quiz / register               (copy already market-aware)
  → Account created with market written to firm and/or client
```

Why market before persona:

- Landing, quiz, pricing, and legal links must already be ZA or US.
- An accountant’s practice home market is the default for every client they add.
- Tax math cannot start from a 15% VAT default and “fix it later.”

### Selection surfaces (all write the same `MarketSelection`)

| Surface | When | What is stored |
|---|---|---|
| Landing `#market` (new, above `#persona`) | First visit | `localStorage` + URL `?market=us&state=TX` so refresh/share keeps it |
| Register / `adminSignUp` | Account create | Owner → `clients.market`. Accountant → `firms.market` (+ first client inherits) |
| Invite accept | Client claims a workspace | Inherit firm default; **confirm** region+state (a Texas firm can have a California client) |
| Add client (`createFirmClient`) | Practice creates a book | Form fields: region, and state if US. Default = firm market |
| Settings → Market | Later change | Firm (practice default) and/or this client. Warn: tax engine, labels, and playbooks will switch |
| Missing market on an old US-intent user | First authenticated load | Blocking sheet: “Where does this business operate?” — cannot dismiss without ZA or US+state |

**Existing production users:** backfill `country: "ZA"`, `regionCode: null`. No prompt. FY stays March, VAT stays 15%.

**Cannot skip US state.** UI: state `<select>` disabled until US is chosen; Continue disabled until a state is chosen. Server: `adminSignUp` / `createFirmClient` reject `country: "US"` without a valid state code.

---

## 2. Canonical types

New module `src/lib/market/types.ts` — the only place country/state/tax shape is defined.

```ts
export type MarketId = "ZA" | "US";
export type UsStateCode =
  | "AL" | "AK" | "AZ" | "AR" | "CA" | "CO" | "CT" | "DE" | "DC" | "FL"
  | "GA" | "HI" | "ID" | "IL" | "IN" | "IA" | "KS" | "KY" | "LA" | "ME"
  | "MD" | "MA" | "MI" | "MN" | "MS" | "MO" | "MT" | "NE" | "NV" | "NH"
  | "NJ" | "NM" | "NY" | "NC" | "ND" | "OH" | "OK" | "OR" | "PA" | "RI"
  | "SC" | "SD" | "TN" | "TX" | "UT" | "VT" | "VA" | "WA" | "WV" | "WI"
  | "WY";

export type MarketSelection = {
  country: MarketId;
  /** Required when country === "US". Always null for ZA. */
  regionCode: UsStateCode | null;
};

/** Fully resolved. Never store derived fields as the source of truth. */
export type ResolvedMarket = {
  country: MarketId;
  regionCode: UsStateCode | null;
  currency: "ZAR" | "USD";
  locale: "en-ZA" | "en-US";
  timezone: string;
  fyStartMonthDefault: 3 | 1;
  copyPack: "za" | "us";
  tax: IndirectTaxProfile;
};

export type IndirectTaxProfile =
  | {
      regime: "vat";
      vatRate: number;          // 0.15
      vatMode: "exclusive" | "inclusive";
    }
  | {
      regime: "sales_tax";
      stateCode: UsStateCode;
      collects: boolean;        // professional services often false
      stateRate: number;        // from table
      localRate: number;        // default = table avgLocal; owner-editable
      combinedRate: number;     // stateRate + localRate
      remittance: "monthly" | "quarterly" | "none";
    }
  | { regime: "none" };        // DE, MT, NH, OR, and "I don't collect"
```

`resolveMarket(selection, overrides?)` is a pure function. Currency, locale, FY default, and tax rates are **never** independently chosen on first run. Overrides (custom local rate, “I don’t collect”, FY month) live on the client after onboarding.

### Resolution order (runtime)

```
client.market
  ?? firm.market
  ?? { country: "ZA", regionCode: null }
```

A Texas CPA with a California client: the **client** row is `US + CA`. Reports, budget tax, playbooks, and extraction for that workspace use California. The firm row stays `US + TX` for new clients and practice-level marketing/legal.

A ZA accountant with a US client is allowed (selection on add-client). A US accountant with a ZA client is allowed.

`useMarket()` React context reads the resolved market for the current workspace (owner `/app` client, or accountant impersonation / `clients.$clientId`). Formatters, labels, and prompt builders take it as an argument — they do not read `en-ZA` off the browser.

---

## 3. Persistence

New migration (example name `YYYYMMDDHHMMSS_client_firm_market.sql`):

```sql
ALTER TABLE public.firms
  ADD COLUMN IF NOT EXISTS market jsonb;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS market jsonb;

COMMENT ON COLUMN public.firms.market IS
  'Practice home market: {country: ZA|US, regionCode: USPS or null}';
COMMENT ON COLUMN public.clients.market IS
  'Workspace market; overrides firm. Required regionCode when country=US.';

-- Existing rows: ZA, no state. Product stays identical.
UPDATE public.firms SET market = '{"country":"ZA","regionCode":null}'::jsonb
  WHERE market IS NULL;
UPDATE public.clients SET market = '{"country":"ZA","regionCode":null}'::jsonb
  WHERE market IS NULL;
```

Check constraint (trigger or app-level until CHECK on jsonb is painful):

- `country` in (`ZA`,`US`)
- if `ZA` then `regionCode` is null
- if `US` then `regionCode` is a known USPS code

`clients.financial_year_start_month` already exists (default 3). On US insert, write `1`. Do not rewrite existing ZA rows.

`operating_profile` (jsonb) can later hold `collectsSalesTax` / `localRateOverride`; v1 can live entirely on `clients.market` plus budget document tax fields so we don’t block on a profile-funnel version bump.

Signup write paths to change:

- `adminSignUp` — owner insert into `clients` includes `market` + FY month.
- Accountant firm create / `ensurePracticeFirm` — `firms.market`.
- `createFirmClient` RPC — accept `p_market`, default to firm, require state when US.
- Invite accept — confirm or set `clients.market`.

Visitor persistence: `milon.market.v1` in localStorage `{ country, regionCode }` plus URL params so a shared `/us?state=NY` landing stays US.

---

## 4. US state table (tax source of truth)

New module `src/lib/market/us-states.ts` — static snapshot, versioned in comments (Tax Foundation / state DOR combined rates, refreshed when we bump the file). Not a live Avalara call in v1.

Each row:

| Field | Purpose |
|---|---|
| `code` | USPS |
| `name` | “Texas” |
| `timezone` | IANA default for the state (Texas → `America/Chicago`) |
| `hasStateSalesTax` | false for DE, MT, NH, OR; AK is special (no state, some local) |
| `stateRate` | state-level general rate (0 if none) |
| `avgLocalRate` | statewide average local, 0 if none |
| `combinedRate` | `stateRate + avgLocalRate` — **budget default** |
| `remittance` | `monthly` \| `quarterly` \| `none` — cash lag for the remittance outflow |
| `sourcing` | `origin` \| `destination` — shown as a footnote, not computed per invoice in v1 |

**No-tax / near-no-tax handling:**

- **DE, MT, NH, OR:** `regime: "none"`, combined 0. Budget does not add a sales-tax line. Copy: “This state has no statewide sales tax.”
- **AK:** no state rate; locals exist. Default `collects: false`, `localRate` editable, helper text: “Alaska has no state sales tax; enter a local rate if you collect one.”
- **Everyone else:** default `collects: true`, `localRate = avgLocalRate`, owner can uncheck “I collect sales tax” (typical for many professional services) → `regime: "none"` for the budget even though the state has a tax.

**Honesty boundary (must appear in the US budget tax panel):**

> Milōn uses your **home state** combined rate (state + average local, which you can edit) for budgets and cash. It does not file returns, does not model economic nexus in other states, and does not compute destination tax per invoice. If you sell into many states, set the blended rate you actually remitted last year.

That is “state tax correctly accounted for” inside **this** product (P&L + 13-week / FY cash), not a tax engine.

Federal income tax / state franchise tax stay out of this table. They remain the existing P&L **Tax** line the owner/accountant types from statements — same as today. Do not invent a US corporate rate.

---

## 5. How selection fans out (the US build)

Once `ResolvedMarket` exists, each subsystem reads it. No second “are we in the US?” flag.

### 5.1 Formatters (every `R` / `en-ZA` call site)

`src/lib/format.ts`:

- `formatMoney(n, market)` → `R 12 345` vs `$12,345`
- `formatDate(d, market)` / `formatDateTime`
- `formatMonthLabel(ym, market)` replaces `budget.months.ts` `en-ZA`

Delete `formatRand`, `fmtZAR`, `fmtZar` after call sites move. PDF theme uses the same helpers so printed reports match the screen.

### 5.2 Labels / copy pack

`src/lib/market/copy.ts` keyed by `copyPack`:

| Key | ZA | US |
|---|---|---|
| `receivables` | Debtors | Accounts receivable |
| `payables` | Creditors | Accounts payable |
| `dso` | Debtor days | Days sales outstanding |
| `dpo` | Creditor days | Days payable outstanding |
| `revenue` | Turnover / revenue | Revenue |
| `checking` | Cheque account | Checking account |
| `ach` | Debit order | ACH / autopay |
| `indirectTax` | VAT | Sales tax |
| `fy` | Financial year (Mar–Feb default) | Fiscal year (calendar default) |
| `sharePrimary` | WhatsApp | Email |

Ratio technical names in the UI use this map. DB keys (`debtorDays`) stay.

### 5.3 Tax + budget engine (the important US difference)

Today `computeBudgetMonths` treats VAT like South Africa:

- P&L can strip/add 15% (`inclusive` / `exclusive`)
- Cash in/out includes VAT
- **`vatNet = output VAT − input VAT`** (input is reclaimable)

**US sales tax is not input-VAT.** If we only swap 15% for Texas 8.25%, cash and P&L will be wrong.

| | ZA VAT | US sales tax (home state) |
|---|---|---|
| P&L revenue | ex-VAT | **ex-tax** (tax collected is not income) |
| Cash from customers | incl. VAT | revenue + sales tax collected (if `collects`) |
| Purchases | input VAT reclaimable | price paid; **no input credit** (resale certificates are a later override, default off) |
| Net tax cash | monthly VAT due (output − input) | **remittance of tax collected** on `remittance` cadence (monthly or quarterly), not netted against purchase tax |
| Inclusive prices | common in SA retail | less common; still support “prices include sales tax” as a mode that strips tax out of P&L |

Implementation:

1. Keep `BudgetDocument.vatRate` / `vatMode` / `vatNet` for ZA docs so saved ZA budgets byte-match.
2. Add `tax: IndirectTaxProfile` on new/normalized US docs (normalize path in `normalizeBudgetDocument`).
3. Branch inside `computeBudgetMonths`:
   - `regime === "vat"` → existing function (unchanged).
   - `regime === "sales_tax"` → new path: `salesTaxCollected`, `salesTaxRemitted`, `salesTaxNet` (collected minus remitted this month). Map `vatNet` to remitted-minus-for-display **or** add parallel fields and have the UI pick the label from `copy.indirectTax`. Prefer parallel fields + UI alias so ZA snapshots stay honest.
   - `regime === "none"` → no tax on cash or P&L.

UI in `budget-workspace.tsx`:

- ZA: current VAT rate % + exclusive/inclusive (defaults 15% / exclusive).
- US: state name (from selection, not re-typed), combined rate shown as State X% + Local Y% (Y editable), checkbox “This business collects sales tax”, remittance monthly/quarterly. Changing state in Settings rebuilds defaults but keeps a custom local rate if the user set one.

`createBudgetDocument` / `fyStartMonthDefault`: US → January; ZA → March. Profile funnel FY picker still exists as question 10 — pre-filled from market, still editable (US S-corps with a June year-end).

### 5.4 Profile funnel (10 questions)

Do **not** add region as question 11. Region is already chosen.

If `clients.market` is missing (legacy or invite): insert a **gate step 0** before pay-motion: region + state. Then the existing 10.

US copy tweaks inside the same component, driven by `copyPack`: “medical aid, government” → “Medicare, government, Fortune 500”; `day_labour` label → “Day labor / staffing”.

### 5.5 Extraction, banks, Ask AI, Pulse, Lighthouse, invites

Each prompt builder takes `ResolvedMarket`:

- ZA: keep current South African specialist prompts (ZAR, comma-decimals, FNB, VAT, provisional tax).
- US: USD, comma thousands, AR/AP, checking, IRS / state DOR, no VAT. Bank names as examples only (Chase, BofA, Mercury), not exclusive.
- Industry Pulse: `gl=US` vs `gl=ZA`; fallback URLs swap; drop Rand/Power tags for US.
- Lighthouse: CAN-SPAM postal address required when `country === "US"`.
- Invite email: “South African accountant” vs “US accountant”; English pack.

`functional_currency` default follows `market.currency`.

### 5.6 Playbooks

Tag steps `markets: ["ZA"] | ["US"] | ["ZA","US"]`. Filter at read time by `market.country`. US pack authored for bank/tax/employment/law rungs; universal price/mix/collections stay shared. State is **not** used to fork playbooks in v1 (no “Texas franchise tax” special steps) except hiding sales-tax collection steps when `regime === "none"`.

### 5.7 Marketing + legal

Landing reads visitor `MarketSelection` (localStorage/URL) **before** paint so the first screen is not ZA-only.

- ZA: current copy, milon.co.za, POPIA pages, rand prices.
- US: dollar prices, SARS/load-shedding gone, AR language, QBO as hero, privacy/terms US versions (counsel). Footer can still name Eish2oh (Pty) Ltd.

Authenticated app never uses visitor localStorage; it uses DB market.

### 5.8 Comms and examples

US: email primary share; WhatsApp secondary. Phone placeholder `+1 512 555 0100`. Placeholders `Acme LLC`, `you@business.com`. ZA unchanged (`+27`, Pty Ltd, WhatsApp first).

---

## 6. First-run UX (pixel-level flow)

### 6.1 Marketing (logged out)

New section `#market` immediately under the hero (before `#persona`):

1. “Where is the business?” — two cards: **South Africa** / **United States**.
2. If US, a full-width state select appears (searchable list, 50 + DC). Helper: “We use this for dollars, dates, and sales tax. You can set a different state per client later.”
3. Cards stay selected; persona cards enable only after a valid selection.
4. Changing ZA → US mid-page rewrites visible FAQ/pricing snippets via the same CSS/data attributes used for persona (`body.market-us`).

Deep links: `/?market=us&state=CA#register` pre-fills.

### 6.2 Register

Hidden fields (or explicit review): country, state. `adminSignUp` payload grows:

```ts
market: { country: "US", regionCode: "CA" }
```

Server defaults:

- US owner: `clients.market`, `financial_year_start_month = 1`, budget tax from California table.
- US accountant: `firms.market`; first demo client inherits.

### 6.3 Owner `/app` first load

If market is set: skip to existing tour + profile funnel (FY pre-filled).

If not set: **MarketGate** modal, same two-step control, writes `clients.market`, then continues.

### 6.4 Accountant dashboard

Add client dialog today: name (+ optional business type). Add:

- Region (default firm)
- State if US (default firm state)
- Optional: “This client does not collect sales tax”

Cannot create a US client without a state.

Client page header: small `US · Texas` chip; click through to Settings → Market.

### 6.5 Changing state later

Settings copy: “Changing state updates the default sales-tax rate on **new** budget math. It does not rewrite uploaded historical figures.” Recalculate live budget defaults (rate/remittance) but do not convert ZAR history to USD (region change ZA ↔ US is a bigger warning: “currency and advice pack will change”).

---

## 7. Build order (PRs, each mergeable)

Work in this repo, ZA remaining the default for unset rows.

### PR 1 — Market kernel (no UI copy rewrite yet)

- `src/lib/market/types.ts`, `resolveMarket.ts`, `us-states.ts` (full table)
- `src/lib/format.ts` + unit tests (ZAR vs USD, ZA vs US dates, DE zero tax, TX combined)
- Tests: US without state throws; ZA with state throws

### PR 2 — Schema + signup write

- Migration: `firms.market`, `clients.market`, ZA backfill
- `adminSignUp`, `createFirmClient` RPC, `ensurePracticeFirm`
- Types in `src/integrations/supabase/types.ts`

### PR 3 — Selection UI

- Landing `#market` + URL/localStorage
- Register payload
- `MarketGate` for authenticated gaps
- Add-client fields
- Settings → Market
- `useMarket()` context on `/app` and `/clients/:id`

**After PR 3, a US user can exist in the DB.** Product still looks ZA until PR 4–6. Feature flag `market.us.ui` optional; prefer shipping formatters next immediately so we don’t strand US rows on rand.

### PR 4 — Formatters + labels through the app

- Replace `R` / `en-ZA` / `formatRand` / `fmtZar` call sites
- Copy pack for AR/AP, VAT vs sales tax labels
- PDF theme
- Phone/email placeholders

### PR 5 — Budget tax branch (state tax actually accounted)

- `IndirectTaxProfile` on budget docs
- `computeBudgetMonths` sales-tax path (**no input credit**, remittance lag)
- Budget workspace US controls (state, local override, collects checkbox)
- `createBudgetDocument` FY + tax from `resolveMarket`
- Tests: ZA VAT net still output−input; TX cash remits combined rate × receipts on cadence; Oregon zero tax

### PR 6 — Prompts + pulse + invites + playbook filter

- Extraction / bank / Ask AI / pulse / lighthouse / invite take `ResolvedMarket`
- Playbook `markets` tags + US variants for SA-specific rungs
- Filter sales-tax playbook steps when `regime === "none"`

### PR 7 — Marketing + legal US pack

- Landing/FAQ/for-owners/for-accountants/marketing-shell
- USD list prices on US view
- US privacy/terms (counsel) behind the same market flag

### PR 8 — Polish

- QBO as hero on US surfaces
- WhatsApp demoted
- Sales-per-employee US threshold
- Benchmark table `country` when we have numbers; until then US sees days/% only or a “global SME bands” disclaimer

---

## 8. Tests that define “done” for selection + state tax

1. ZA signup with no state → market ZA, FY 3, VAT 15%, `en-ZA`, playbooks include SARS-capable steps.
2. US signup without state → **400**, no row.
3. US + Texas → `$`, `en-US`, FY 1, sales-tax combined rate from table, remittance monthly, budget P&L ex-tax, cash includes collections, **purchase tax not reclaimed**.
4. US + Oregon → regime none, no sales-tax cash line.
5. US + Alaska → default no collect; local rate editable.
6. Uncheck “I collect sales tax” in California → regime none for that client; state remains CA for locale/copy.
7. Firm TX, client CA → client workspace is CA tax + copy; new add-client still defaults TX.
8. Existing production client with null market → treated as ZA, no modal.
9. Change CA → NY in settings → new combined rate; historical uploaded P&L unchanged.
10. PDF for a US client contains `$` and “accounts receivable”, not `R` or “debtors” as the primary label.

---

## 9. What we will not do in this build

- Fork a US codebase or a `us/` route tree for the app itself (marketing URL `/us` is optional later).
- Live tax-API / Avalara / destination tax per SKU.
- Multi-state nexus, marketplace facilitator rules, or use tax.
- Auto-file SARS or state returns.
- Convert historical ZAR figures to USD.
- Infer US vs ZA from IP only (may *pre-select* the landing card; never silent-write a client market from IP).
- Other countries.

---

## 10. Suggested first implementation commit after this plan is accepted

PR 1 in §7 (`src/lib/market/*` + `format.ts` + state table + tests). Selection UI without the kernel would paint a US landing and still save ZA defaults.

State tax work is **PR 5**, but it depends on the state code being real data from PR 1–3. Do not implement budget tax against a free-text “rate %” field with no state: the user’s requirement is that **choosing the state** is what accounts for tax.
