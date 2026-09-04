# Milōn US-market expansion plan

**Status:** planning only — no product code changed yet.
**Intent:** keep serving South Africa, and make the same product credible for US SMEs and US accounting practices.
**Principle:** do not fork the app. Add a **market profile** (country / currency / locale / tax regime / copy pack) at firm and client level, then swap presentation, defaults, legal, and advice. A US visitor who still sees “rand”, SARS, VAT at 15%, and milon.co.za will not trust the rest of the product.

This plan is an inventory of every ZA-hardcoded surface found in the current codebase, grouped into workstreams, with recommended sequencing.

---

## Recommended product model

Introduce a single `Market` object and thread it through formatters, prompts, playbooks, legal, and marketing.

| Field | ZA today | US target |
|---|---|---|
| `country` | ZA (implicit) | US |
| `currency` | ZAR (`R`) | USD (`$`) |
| `locale` | `en-ZA` | `en-US` |
| `timezone` | Africa/Johannesburg (implicit) | America/New_York default, firm-overridable |
| `taxRegime` | VAT 15% inclusive/exclusive | Sales tax (state + local) + federal income tax |
| `fyStartMonth` | March (month 3) | January (month 1) unless the client sets otherwise |
| `english` | South African / UK (organisation, labour, debtor, creditor) | US (organization, labor, AR, AP) |
| `comms` | WhatsApp-first + email | Email / SMS first; WhatsApp optional |
| `legalHome` | RSA law, POPIA, Pretoria address | Need US-facing notices (see Legal) |
| `domain` | milon.co.za | US site or path (milon.com / us.milon.co.za / `/us`) |

Store it on:

1. **Firm** — practice default (accountant portal, reports, invites).
2. **Client** — can differ from the firm (a US firm with a ZA client, or the reverse).
3. **Visitor** — marketing site: geo or explicit market toggle until they sign up.

Until this object exists, every `R`, `en-ZA`, `0.15` VAT default, and “South African …” prompt will keep leaking.

---

## Workstream 1 — Currency, numbers, dates (presentation layer)

This is the largest *mechanical* change and the one users will notice first. Formatting is copy-pasted, not centralised.

**Today:** almost every screen hardcodes `R` + `toLocaleString("en-ZA")`. ZA grouping uses spaces (`R 1 299`); US expects `$1,299`. Dates are day-month (`4 September`); US expects month-day (`September 4`).

**Files that format money or dates locally (non-exhaustive, all need the shared formatter):**

- `src/lib/product-mix.ts` (`formatRand`)
- `src/lib/pdf/theme.ts`
- `src/lib/owner-ops.guard.ts`
- `src/components/profitability-waterfall.tsx`
- `src/components/cash-forecast.tsx`
- `src/components/cash-classification-workspace.tsx`
- `src/components/bank-statement-drafter.tsx`
- `src/components/extraction-review-modal.tsx` (`fmtZAR`)
- `src/components/debt-schedule-editor.tsx`
- `src/components/period-variance-strip.tsx`
- `src/components/product-mix-panel.tsx` (copy says “rand”)
- `src/components/pdf/dupont.tsx` (“revenue per rand of assets”)
- `src/components/action-plan.tsx`
- `src/components/accountant-ratios.tsx`
- `src/components/note-layer.tsx`, `note-archive.tsx`
- `src/components/lighthouse-usage.tsx`, `lighthouse-it.tsx`
- `src/components/advisory-sent-history.tsx`, `admin-dashboard.tsx`
- `src/lib/profile-signals.ts`

**Schema already has a hook:** `financialSchema.ts` / extraction types already allow `functional_currency: "ZAR" | "USD" | "EUR" | "GBP" | "other"`. Bank drafter already accepts a currency string but falls back to `"R"`. Ops payments default to `ZAR` (`supabase/migrations/20260819190000_milon_owner_ops.sql`).

**Work:**

1. One `formatMoney(amount, market)` and `formatDate(iso, market)` in `src/lib/format.ts`. Ban new `R` / `en-ZA` call sites.
2. Persist `currency` on client financials and firm settings; never infer from the logged-in user’s browser alone.
3. Rename `formatRand` / `fmtZAR` — those names will keep ZA in the US build.
4. PDF theme, watermark, and report footer must use the same formatter (clients print these).
5. Sales-per-employee health line in `accountant-ratios.tsx` is `benchmark: "≥ 200"` with `health: hH(spe, 200)`. That is a **rand-thousands** heuristic. Recalibrate for USD (and say so), or express it as a market-specific threshold.

**Do not** convert historical ZA figures into USD. A client’s books stay in the currency they were entered in. Dual-currency display is a later phase.

---

## Workstream 2 — Tax, VAT, and fiscal calendar

US “sales tax” is not VAT. Treating them as a renamed 15% field will produce wrong budgets and wrong cash forecasts.

| Concept | ZA (current) | US (needed) |
|---|---|---|
| Indirect tax | VAT, default **15%**, inclusive/exclusive modes | Sales tax: **state + local**, often destination-based, many rates; some states have none |
| VAT on cash | Bank extraction **excludes VAT payments/refunds** as non-P&L | Sales tax remittances to state DOR; use-tax; nexus |
| Income tax | “Provisional tax”, SARS | Quarterly estimated federal tax; state franchise / income tax |
| Identifiers | VAT number stripped in AI sanitiser | EIN / SSN must be stripped the same way; also state tax IDs |
| FY default | `fyStartMonthDefault = 3` (1 March, SARS year) | Calendar year (January) as default; S-corps / fiscal filers still override |
| Budget UI | Labels “VAT rate %”, “VAT mode”, “VAT net” | Labels and math for sales tax vs VAT, or a generic “indirect tax” with regime-specific help |

**Key files:**

- `src/lib/budget.types.ts` — `DEFAULT_VAT_RATE = 0.15`
- `src/lib/budget.compute.ts` — VAT strip/add
- `src/components/budget/budget-workspace.tsx` — VAT controls
- `src/lib/budget.months.ts` — FY start
- `src/components/budget/budget-panel.tsx` — `fyStartMonthDefault = 3`
- `src/lib/bankStatements.server.ts` — “provisional tax (NOT VAT)”
- `src/lib/ai.functions.ts` / privacy copy — “VAT numbers”
- `src/components/accountant-ratios.tsx` — “Confirm provisional tax estimates are current”

**Work:**

1. Replace the single `vatRate` with a `taxProfile`: `{ regime: "vat" | "sales_tax" | "none", rate?, inclusive?, jurisdiction? }`.
2. Keep ZA VAT behaviour byte-for-byte for ZA clients.
3. For US: do not pretend a national 15% exists. Either (a) owner-entered blended rate for the budget, or (b) state picker + optional local rate. Full Avalara-grade calculation is out of scope for v1; honest “enter the rate you actually charge / remitted last year” is enough.
4. Default FY to March only when `market.country === "ZA"`.
5. Cash-from-banks classifier: map `vat` bucket → `sales_tax` for US statements (state DOR, CDTFA, etc.).

---

## Workstream 3 — Accounting vocabulary (AR/AP vs debtors/creditors)

The product already bilingual-labels some fields (“Debtors (AR)”, “Creditors (AP)”) but the **canonical names** in schema, playbooks, and ratios are ZA/UK.

| ZA / current | US |
|---|---|
| Debtors / debtor days | Accounts receivable / DSO |
| Creditors / creditor days | Accounts payable / DPO |
| Stock / inventory days | Inventory / DIO (already partly US) |
| Turnover | Revenue / sales |
| Labour cost | Labor cost (UI already mixed) |
| Cheque account | Checking account |
| Overdraft | Line of credit / revolver |
| Debit order | ACH / autopay |
| Director remuneration / shareholder loans | Officer comp / shareholder distributions / related-party notes |
| Pty Ltd | LLC / Inc / Corp / S-Corp / sole prop |
| Annual financial statements for SARS | Year-end package / tax return / compiled statements |

**Canonical keys can stay** (`debtorDays` in the DB) if the **labels, formulas, and advice copy** swap. Changing DB keys is a migration tax with no user benefit.

Places that teach the ZA words to users:

- Extraction review modal, budget WC inputs, profile funnel
- Ratio table technical names (`Debtor Days`, `Creditor Days`)
- Playbook JSON (`src/lib/playbook-data.json`) and seed SQL (`supabase/migrations/20260522000000_create_playbooks.sql`)
- Landing quiz: “annual turnover”, placeholder `Nkosi Engineering (Pty) Ltd`
- Brand settings placeholder `Acme (Pty) Ltd`

---

## Workstream 4 — Playbooks, next moves, and health advice

This is the largest *content* change. The intervention library is written as South African operating advice. A US owner who is told to call ABSA, claim SETA grants, or start Companies Act business rescue will bounce.

**ZA-specific mechanisms that need US equivalents (or to be hidden for US markets):**

| ZA advice | Why it is ZA | US analogue |
|---|---|---|
| ABSA, Standard Bank, Nedbank, FNB distress programmes | Named SA banks | “Your bank / SBA / CDFIs”; do not name Chase as if it were the product |
| SARB / prime rate cycle | SA monetary policy | Fed funds / SOFR / Prime |
| SARS wear-and-tear schedules | SA tax depreciation | MACRS / IRS Pub 946 |
| Section 11(a) bad-debt deduction | Income Tax Act | IRC §166 |
| SBC, ETI credits | SA tax incentives | QBI (199A), R&D credit, WOTC — only if an accountant confirms they apply |
| SETA levy grants | Skills Development Act | WIOA / state workforce grants — weak analogue; often drop |
| SEDA, IDC, dti grants | SA DFIs | SBA 7(a), 504, state economic-development — again, advice not a filing product |
| Section 189 retrenchment | LRA | WARN Act / at-will employment — **do not** copy-paste labour law |
| Companies Act Ch. 6 business rescue | Unique SA process | Chapter 11 / assignment for benefit of creditors / ABC — **legal, high-risk copy** |
| 32-day notice accounts, 6–9% money-market | SA cash products | Treasuries, MMA, sweep accounts; do not quote 6–9% |
| CPI 5–6% | SA inflation | US CPI; do not hardcode |
| Revenue/employee bands in rand (R300k–R1.5m) | Currency + labour market | Recalibrate in USD |
| Load-shedding as a cost line | FAQ + lighthouse | Irrelevant in US; US analogue is insurance / healthcare / wage inflation |
| Commercial landlord vacancy post-2020 SA | Local colour | Keep the *move* (ask for rent relief), drop the SA story |

**Files:**

- `src/lib/playbook-data.json` (canonical copy in the app)
- `supabase/migrations/20260522000000_create_playbooks.sql` (DB seed — must stay in sync)
- `src/routes/app.tsx` next-move strings
- `src/lib/profile-signals.ts`
- `src/components/accountant-ratios.tsx` `nextSteps`

**Work:**

1. Tag every playbook step with `markets: ["ZA"] | ["US"] | ["ZA","US"]`.
2. Author a US pack for the steps that are jurisdiction-specific; keep the universal ones (price, mix, collections cadence, inventory turns).
3. **Do not** give US legal procedure advice (bankruptcy, employment termination) without a lawyer pass. Safer: “speak to counsel / your CPA” for those rungs.
4. Recalibrate any step that embeds a rand amount or a SA rate.

---

## Workstream 5 — AI extraction, Ask AI, Industry Pulse, Lighthouse

Every LLM prompt currently *tells the model it is in South Africa*. US PDFs, US news, and US cold email will be wrong until these change.

### Financial PDF extraction

- `src/lib/extract-financials.functions.ts` — “specialist for South African SME financial statements”, default `functional_currency: "ZAR"`, comma-as-decimal, director remuneration, shareholder loans, R'000.
- `src/lib/extractFinancials.server.ts` — same framing.

US 10-Q / compiled GAAP statements use `$`, commas as thousands, “Accounts receivable”, “Cost of goods sold”, officer compensation, and often comparative years. The extractor should take `market` and swap:

- Default currency
- Number format hints
- Label synonyms (AR/AP, sales vs turnover)
- Notes to look for (related-party, officer loans) instead of only “shareholder loans”

### Bank statements

- `src/lib/bankStatements.server.ts` — “South African context; currency is usually ZAR”, “cheque”, “provisional tax”, “VAT”.
- `src/lib/cash-from-banks.server.ts` — “cash-flow analyst for South African SMEs”.
- `src/lib/bank-files.ts` example: `"Cheque — FNB"`.

US banks: Chase, BofA, Wells, Amex, Mercury, Brex; checking not cheque; IRS / state DOR not SARS; ACH, Zelle, Stripe payouts.

### Ask AI

- `supabase/functions/ask-ai/prompt.ts` — already tries to avoid raw amounts (“your local currency”). Keep that. Add market so it does not volunteer SARS/VAT.
- Revenue buckets (`under 1M` … `over 100M`) are unitless — fine if the currency is known.

### Industry Pulse

- `src/lib/industry-news.functions.ts`
  - Prompt: “Industry Pulse for South African small-business owners”
  - Fallback URLs: businesslive.co.za, moneyweb.co.za, news24, freightnews.co.za
  - Google News: `hl=en-ZA&gl=ZA&ceid=ZA:en` plus `"South Africa"` in the query
  - Tags include `Rand` and `Power` (load-shedding)
  - SaaS fallback: “Dollar-priced cloud costs squeeze local software margins” / “rand subscription revenue”

US pulse must query US sources (WSJ/Bloomberg/industry trades as available, or Google News `gl=US`) and drop rand/power tags.

### Lighthouse (outbound)

- `src/lib/lighthouse.functions.ts` — “South African financial-health platform”, “SARS, VAT, load-shedding, ZAR”
- `src/components/lighthouse-panel.tsx` sample paste: Sipho Dlamini, `@acme.co.za`, “SARS deadlines”
- CAN-SPAM (US) is stricter on physical postal address, identification, and unsubscribe than the current RSA-oriented sequence. The panel already has a postal-address field — make it required for US sends.

### Invite / email copy

- `src/lib/client-invite-email.ts` — “South African accountant”, “South African English (organisation, not organization)”
- From addresses default `noreply@milon.co.za` in practice-access, digest, notes, invites
- Site URL fallback `https://milon.co.za`

US sends should use a US-matching from-domain once it exists, or the ZA domain with clear “Eish2oh (Pty) Ltd” identity (legal, not marketing).

---

## Workstream 6 — Marketing site, SEO, and brand geography

The public site currently *defines* Milōn as South African. That is correct for ZA and fatal for US acquisition.

| Surface | Current |
|---|---|
| `src/components/marketing-shell.tsx` | “financial health for South African businesses” + link `milon.co.za` |
| `src/routes/index.tsx` | “South African SMEs operate with…”, “for South African SMEs”, SAICA-referenced ratios, Pty Ltd placeholders, turnover quiz, `Eish2oh (Pty) Ltd` footer |
| `src/routes/for-owners.tsx` | meta + “annual financial statements written for SARS”, “debit order bounces” |
| `src/routes/for-accountants.tsx` | “South African accounting and advisory practices” |
| `src/routes/faq.tsx` | Pricing in rand; proud “Built for South Africa” answer (SARS, VAT, ZAR, load-shedding, SA benchmarks — *not* a US template with the symbol swapped) |
| `docs/marketing/teaser-60s-script.md` | SA VO, SARS document, SA casting |
| Share copy | market-agnostic (good) |

**Work:**

1. Market-aware marketing shell: ZA copy stays; US copy does not mention SARS/load-shedding/rand.
2. Decide URL strategy: `milon.com` vs path (`/us`) vs subdomain. Legal entity can stay Eish2oh; trading name can be market-neutral.
3. Replace “SAICA-referenced ratios” for US with CPA / AICPA-neutral wording (“standard SME ratios”) unless a US accountant has actually signed the set.
4. Landing quiz: `$` bands, Inc/LLC examples, “annual revenue” not “turnover”.
5. The FAQ line that Milōn is *not* a US template is a positioning asset in ZA. Invert it for US: “not a South African product with a dollar sign glued on.”

---

## Workstream 7 — Legal, privacy, terms, entity

This is not a copy tweak. Serving US persons from a Pretoria Pty Ltd changes the compliance surface.

**Today (`src/lib/legal.ts` + `/privacy` + `/terms`):**

- Entity: Eish2oh (Pty) Ltd, 152 Melville Street, Sunnyside, Pretoria
- Information Officer (POPIA)
- Notices explicitly “South Africa”
- Terms: RSA law and RSA courts
- Privacy: POPIA-shaped; written to avoid “American boilerplate”
- AI notice: strips VAT numbers and “raw rand amounts”
- Metrics docs: POPIA retention language

**US needs (counsel must own the words):**

1. **Privacy:** CCPA/CPRA (if California traffic or thresholds), state privacy patchwork, and a US-readable privacy notice. POPIA Information Officer language does not map 1:1 to a US privacy contact.
2. **Terms:** governing law / venue for US customers (keep RSA for ZA accounts, or a single choice-of-law after legal review). Consumer vs commercial terms.
3. **AI / financial advice:** US copy must not imply CPA, fiduciary, or IRS-filing status. Current “not a substitute for an accountant” is the right direction; add “not tax, legal, or investment advice.”
4. **CAN-SPAM** for Lighthouse; **TCPA** if SMS is added.
5. **Entity:** either foreign-entity registration in a US state, a US subsidiary, or a clear “non-US company” disclosure. Product copy cannot paper over this.
6. **Data residency:** figures are in managed Postgres (Supabase). US customers will ask where. Document region; consider US region if selling to practices with client-confidentiality policies.

Do not ship US marketing until privacy + terms have a US version, even a “early access, RSA company, US law TBD” banner that a lawyer has approved.

---

## Workstream 8 — Pricing, billing, payments

**Today:**

- FAQ: Spark free; Orbit **R699**/mo; Constellation **R1 299**/mo; firm **R4 500** / **R7 200**
- Landing HTML in `attached_assets` still has older rand prices
- `milon_ops_payments.currency` default `ZAR`; comment says “until Stripe (or similar) is live”
- Terms: paid tiers published, not billed

**Work:**

1. Publish **USD list prices** (purchasing-power, not a naive FX convert of R699). US SMB SaaS anchoring is different.
2. Stripe (or equivalent) in USD **and** ZAR, or two Stripe accounts. Do not charge US cards in ZAR.
3. Sales tax on the *subscription itself* (US SaaS tax) is a separate problem from client VAT in the product — budget for it when billing starts.
4. Firm pricing: US CPA firms expect per-client or per-seat language closer to Karbon/Canopy than a flat R4 500.

---

## Workstream 9 — Integrations and document ingestion

**Already US-native (keep, lean into):**

- QuickBooks Online (`src/lib/qbo.ts`, `qbo-connect.tsx`) — this is the default US SME stack. Confirm production Intuit app is US-region, not only AU/ZA sandbox assumptions.

**ZA-weighted / missing for US:**

- Bank PDF/CSV prompts assume FNB-style statements (Workstream 5).
- Landing still advertises Xero + QBO; Xero is secondary in the US. US stack to name: **QuickBooks, then Excel/CSV, then bank PDF**. Xero can stay as “also.”
- Future: Plaid (bank connect) is the US equivalent of “upload FNB PDF”. Not required for v1 if PDF upload works on Chase/BofA statements.
- Sage / Pastel are ZA/UK; do not lead with them in US marketing.
- WhatsApp share on reports (`accountant-ratios.tsx` placeholder `+27821234567`): keep for ZA; US default to email / SMS. iMessage is not an API we have.

**Extraction quality risk:** US compiled statements and QBO P&Ls will fail if the model is instructed to look for “Turnover” and comma-decimals. Market-specific prompts are a launch blocker, not polish.

---

## Workstream 10 — Benchmarks and score interpretation

`industry_benchmarks` is a single table keyed by `business_type` (retail, manufacturing, saas, …) with p25/p50/p75. FAQ claims these are “drawn from South African context rather than from a US template.”

If that is true, showing them to a US contractor in Texas as “industry median” is misleading. If they are actually generic SME bands, the FAQ should stop claiming SA exclusivity.

**Work:**

1. Add `country` (or `market`) to `industry_benchmarks` or a parallel US seed.
2. Recalibrate **money-denominated** metrics (sales per employee). Percentage and days metrics travel better.
3. Sales-per-employee threshold of 200 in the ratio health function — confirm unit (thousands?) and set a US threshold.
4. Ask AI industry medians must come from the same market-scoped table.

---

## Workstream 11 — Communications defaults and UX chrome

- WhatsApp is a first-class share path (advisory drafter, ratios, share modal, sent history). In the US it is optional; email is the practice default.
- Phone placeholder `+27…`
- Email examples `@milon.co.za`, `@acme.co.za`
- Lighthouse IT placeholder `it@milon.co.za`
- Date/time in action plan, notes, sign-off stamps: `en-ZA` (24h + day-month). US accountants live in 12h and MM/DD.
- Spelling: mix of labour/labor, organise/optimize already exists. Pick per market; don’t mix on one PDF.
- Profile funnel `day_labour` industry label.

---

## Workstream 12 — Go-to-market that is not code

Out of the repo but required or US “launch” is just a skin:

1. **Positioning:** US CPA / EA / bookkeeper firms (the accountant portal) vs owner-led SMBs. The dual-audience model is the same; the buyer language is not (“practice” vs “firm”, “advisory retainer” still works).
2. **Proof:** SAICA line must not appear on US pages. Need a US accountant design partner for ratio/playbook review.
3. **Support hours:** Pretoria afternoon is US morning — say so, or staff overlap.
4. **Payments and contracts** in USD.
5. **Insurance:** E&O / cyber if selling into US firms.
6. **Teaser video** (`docs/marketing/teaser-60s-script.md`) is cast and written for SA. A US cut needs different pain (IRS packet / cash surprise, not SARS + load-shedding).

---

## What does *not* need to change

- Health-score arithmetic, DuPont, 13-week cash engine, action-plan workflow, RLS, firm branding, white-label PDFs (theme engine is already brand-agnostic).
- QBO mapping layer — already US chart-of-accounts shaped.
- Core English product voice (plain, non-MBA) — works in both markets if SARS/rand/load-shedding are stripped.
- Dual-audience architecture (owner app + accountant portal).

---

## Sequencing (build order)

Do not start with playbook prose. Start with the market object, or ZA strings will be re-hardcoded while US copy is written.

### Phase A — Market profile (foundation)

- `Market` type + persistence on firm and client
- `formatMoney` / `formatDate` / `formatPhone` adopted everywhere `R` and `en-ZA` live
- FY default and VAT/sales-tax profile branched
- Extraction + bank-statement prompts take `market`
- Feature flag: US market off in production until Phase C legal is signed

### Phase B — Product honesty for a US client

- Playbook market tags + US variants for bank/tax/labour/law steps
- Industry Pulse US prompt + fallback sources
- Ask AI / invite / lighthouse prompts
- Ratio labels (DSO/DPO) and next-step strings
- QBO as the hero integration on US surfaces
- Recalibrate sales-per-employee and any rand-denominated benchmarks

### Phase C — Public US surface

- Marketing pages, FAQ, pricing in USD
- Privacy / terms / AI notice US versions (counsel)
- Email from-domain and CAN-SPAM footer
- Comms defaults (email not WhatsApp)

### Phase D — After first US practices

- US benchmark seed (or clearly labelled “global SME bands”)
- Plaid or equivalent bank connect
- Stripe USD
- Possible US legal entity / data-region decision

---

## Suggested ownership split

| Stream | Owner type |
|---|---|
| Market object, formatters, tax profile, prompts | Engineering |
| Playbook US pack, ratio labels, pulse sources | Product + a US CPA reviewer |
| Privacy, terms, entity, CAN-SPAM | Counsel (cannot be invented in-app) |
| USD pricing, Stripe, domain | Founder |
| Teaser / landing US cut | Brand |

---

## Launch definition (US)

A US accountant can:

1. Sign up without seeing “South African businesses”, SARS, ZAR, or load-shedding on the path they used.
2. Connect QBO or upload a US P&L/bank PDF and get figures in `$` with AR/AP language.
3. Receive next moves that do not name SA banks, SETA, SARS, or business rescue.
4. Send a client a PDF that looks like a US practice document (dates, spelling, currency).
5. Read privacy/terms that do not say “this notice is deliberately not American boilerplate” as the only US story.

ZA paths must keep current behaviour. Regression on milon.co.za is a launch blocker equal to a weak US skin.
