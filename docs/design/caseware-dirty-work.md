# Caseware dirty work — Eng2 thin slice (US)

## Problem

US accountants spend hours in **Caseware** on the same grunt work South African firms handle in Draftworx: importing trial balances, ticking lead schedules, reconciling summary totals, and aligning file sign-off before partner review. Milōn already holds the **same numbers** on the client file (Health / trial-balance import, sign-offs, period metadata). This slice produces **checkable output** from that data without a Caseware Cloud / IDEA API.

## Caseware vs Draftworx (recommendation)

**Caseware-first for US** — mirror the ZA Draftworx Compliance card on **Work → Compliance** with US market gating only. v1 reuses the same **summary trial balance** rows and checklist logic; only labels, CSV banner, and export filename prefix differ.

Pilot firms may later confirm a firm-standard Caseware CSV/XML shape. Until then, v1 uses the same Excel-friendly columns as Draftworx: **Account Number, Account Name, Debit, Credit**, plus an optional **Milōn note** column.

## Thin slice scope (this PR)

### In

- US accountant **Work → Compliance**: collapsible **Caseware working papers** card (when `market.country === "US"` and figures on file).
- Shared **working-paper checklist** (≥8 rows) from `clients.financials`, period meta, equity cross-check, financials sign-off, and `needsTrialBalanceRefresh`.
- **Export summary TB** — CSV with `milon-caseware-summary-tb-…` filename; header `Account Number,Account Name,Debit,Credit,Milōn note`.
- Pure lib + static test (`pnpm test:caseware-dirty-work`).

### Out (follow-up PRs)

- Caseware Cloud / IDEA round-trip, GL detail, auto-ticking.
- Firm-specific XML/CSV templates beyond the Draftworx-shaped v1 columns.
- Send-an-agent missions, Postgres checklist persistence, `.xlsx`, numbers-engine, SQL migrations.
- Changing ZA Draftworx behavior (still ZA-only Draftworx).

## Data hooks

Same as [draftworx-dirty-work.md](./draftworx-dirty-work.md): `clients.financials`, `readStatementMeta`, equity coherence, `client_review_signoffs` scope `financials`, stale sign-off, `needsTrialBalanceRefresh`. No new migrations.

## Acceptance criteria

1. US client with figures: Compliance shows **Caseware working papers** with ≥8 checklist rows and working **Export summary TB**.
2. CSV header is `Account Number,Account Name,Debit,Credit,Milōn note`.
3. ZA client: still **Draftworx** only (not Caseware).
4. Other markets: neither card.
5. `pnpm test:caseware-dirty-work` passes in CI.

## AQA later

- US sandbox client with TB import → Compliance → export CSV → Excel → confirm import mapping at the firm.
- ZA client unchanged (Draftworx labels and `milon-draftworx-summary-tb-…` filename).
