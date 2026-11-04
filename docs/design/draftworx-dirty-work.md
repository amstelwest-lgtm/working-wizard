# Draftworx dirty work — Eng2 thin slice

## Problem

South African accountants spend hours in **Draftworx** (and sometimes Caseware) on grunt work: importing trial balances, ticking lead schedules, reconciling summary totals, and aligning file sign-off before the partner review. Milōn already holds the **same numbers** on the client file (Health / trial-balance import, sign-offs, period metadata). Agents should produce **sellable, checkable output** from that data instead of making the accountant re-key.

## Draftworx vs Caseware (recommendation)

**Draftworx-first** — Draftworx is the default ZA audit compilation stack, Milōn has no Caseware hooks in-repo, and Draftworx already documents Excel trial-balance import (Account Number, Name, Debit, Credit) that we can feed from aggregated figures without a vendor SDK.

## Thin slice scope (this PR)

### In

- ZA accountant **Health** tab (`pane-ratios` overview): collapsible **Draftworx working papers** card.
- **Working-paper checklist** derived from live `clients.financials`, `readStatementMeta`, equity cross-check, financials sign-off, and `needsTrialBalanceRefresh`.
- **Export summary TB** — CSV with Draftworx-friendly columns (save as Excel, map on import). Rows are **Milōn summary lead lines** (cash, AR, AP, equity, revenue, opex, profit), not GL detail.
- Pure lib + static test (`pnpm test:draftworx-dirty-work`).

### Out (follow-up PRs)

- Full GL / account-code import from Sage, Xero, or Pastel.
- Draftworx Cloud API or direct Caseware round-trip.
- Auto-ticking Draftworx lead sheets or agent-run file mutations.
- US Caseware path on Work → Compliance (`market.country === "US"`) — see [caseware-dirty-work.md](./caseware-dirty-work.md).
- Send-an-agent mission type for “prepare Draftworx pack” (Eng1 `/a` missions).
- Persisted checklist state in Postgres (v1 is recompute on load).

## Data / hooks into existing Milōn surfaces

| Surface | Use |
|--------|-----|
| `clients.financials` | Summary TB export + checklist inputs |
| `readStatementMeta` / period keys | Period label on checklist and export filename |
| `coherentEquity` / `equityCrossCheck` | Derived-equity and balance-equation warnings |
| `client_review_signoffs` scope `financials` | Sign-off line on checklist |
| `pageSignoffStale` + `financials_updated_at` | Stale sign-off warning |
| `needsTrialBalanceRefresh` | TB re-import nudge before export |
| Health upload / `TrialBalanceRefreshPrompt` | Existing path to refresh figures (no new upload stack) |

No new migrations. No numbers-engine changes.

## Acceptance criteria

1. ZA firm client with figures on file: Health overview shows **Draftworx working papers** with ≥8 checklist rows.
2. **Export summary TB** downloads a CSV whose header is `Account Number,Account Name,Debit,Credit,Milōn note` and includes summary lines when revenue/cash/equity exist.
3. US (or non-ZA) client: card **not** rendered.
4. `pnpm test:draftworx-dirty-work` passes in CI.
5. Checklist marks sign-off **To do** when `financials` scope unsigned; **Review** when sign-off stale or derived equity.

## AQA later (no tip from this agent)

- Open a ZA sandbox client with TB import → expand card → export CSV → open in Excel → confirm Draftworx import mapping works.
- Change a figure after sign-off → confirm **Review** on sign-off freshness.
- Client with `needsTrialBalanceRefresh` → confirm TB refresh row shows **Review**.

## Next PR checklist

- [ ] Account-level TB when sync/extraction stores chart lines (Eng1 numbers read).
- [ ] Agent prompt: “Prepare Draftworx summary TB + checklist narrative” on Bot desk.
- [ ] Optional `.xlsx` export (same rows) for one-click Draftworx upload.
- [ ] Caseware path only if a firm-standard CSV/XML shape is confirmed with pilot firms.
