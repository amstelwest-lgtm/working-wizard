# Parent multi-company — full consolidation (P2 prep)

Theo product decisions this plan respects:

- Bill group includes up to **3 companies** (extras consume a client slot); see `INCLUDED_COMPANIES` in `src/lib/client-groups.ts`.
- **One owner login** for all companies in a group; per-company restrictions stay P1.
- **No dual-group membership** — each `clients.group_id` points at exactly one `client_groups` row.
- Target is **full consolidation** (combined P&L / BS / cash), not a side-by-side compare dashboard.
- Pilot on **test PDF datasets** and the simplest **single-org Xero** connect per company (no live multi-org Xero client yet).
- Prefer **no new SQL** unless unavoidable; wire existing schema and UI first.

Eng1 collision avoid: do **not** touch Budget, forecast, COS, Analyst persist, or DEMO tracks in consolidation work.

## SHIPPED today (parent plan P0)

| Area | What exists |
|------|-------------|
| Schema | `supabase/migrations/20261103150000_client_groups.sql` — `client_groups`, `client_group_members`, `client_group_grants`, `client_group_audit`, `ownership_edges`; `clients.group_id`, entity metadata, placeholder / books-connected stamps |
| Access | `can_access_company` / `has_client_access` — group **owners** inherit access to non-Individual companies in the group |
| RPCs | `move_company_to_group`, `split_company_from_group`, `add_company_to_group`, `update_company_entity`, `upsert_ownership_edge`, `delete_ownership_edge` |
| UI | `ClientGroupChrome`, `CompanyGroupRail`, `ClientGroupPanel` — **status only** (connection, sync, year-end, open work, ownership edges, moves). Copy explicitly says **no consolidated figures** |
| Billing note | Soft banner when billable count &gt; 3; Stripe unchanged |
| Tests | `pnpm test:client-groups`, `scripts/client-groups-sql-tests.sql` |
| Financial data (per company) | `clients.financials`, `client_financial_snapshots` — unchanged; **no group rollup** |

Comments on `client_groups` and `ownership_edges` state they are **not consolidation entities** and carry **no consolidation math**.

## Gap — full consolidation still missing

| Capability | Status | Notes |
|------------|--------|-------|
| Combined P&L / BS / cash | Missing | No route, component, or RPC totals money at group level |
| Period rollup | Missing | Companies can differ on `year_end_month` and snapshot `period_date`; no group reporting period picker |
| Intercompany eliminations | UI stub | Combined preview shows **planned** eliminations card only — no IC journals (`data-group-eliminations-stub`) |
| Currency | UI stub + blocker | Mixed currency still blocks combined totals; preview shows **planned** FX card only — no rates or translation (`data-group-fx-stub`) |
| Ownership / NCI | UI stub | **Planned** NCI card from `ownership_edges` metadata — `ownership_pct` not applied to line items (`data-group-nci-stub`) |
| Group Health / ratios / Analyst | UI stub | **Planned** group Health card only — ratios and Analyst narrative stay **per `client_id`**; no group compute (`data-group-health-stub`; keep off Budget/Analyst persist) |
| Side-by-side compare | Missing | Not requested as the end state; also not built |
| Agents | By design | `client-groups.ts` — agents stay on **one company** |
| SQL consolidation store | Missing | No `group_financial_snapshots` or materialized group books (prefer client-side rollup from existing snapshots first) |

## This PR (thin prep)

- **`src/lib/group-consolidation.ts`** — pure **additive** rollup of the same scalar keys the ratio grid uses (`RatioInputs` + common BS fields), with explicit **blockers** (currency mismatch, period mismatch, missing figures). **No eliminations, no FX, no pro-rata** — documented as out of scope.
- **`scripts/group-consolidation-test.mts`** — locks behaviour for pilot PDF-style blobs.
- This document.

Does **not** change Group status UI, Budget, migrations, or deploy.

## Proposed next PR (smallest wiring slice)

1. Read-only **“Combined figures (preview)”** section on `ClientGroupPanel` (or a dedicated group tab) when `groupChromeVisible` and blockers are clear.
2. For each company in the group, load **`pickCurrentSnapshot`** from `client_financial_snapshots` (or live `clients.financials` when no snapshot) via existing RLS — owner already has access.
3. Call `buildGroupConsolidation()` from this lib; show blocker list when not consolidatable.
4. Label as **preview — no intercompany eliminations**; link each line to the underlying company file.
5. Optional: seed **multi-company PDF fixtures** in a script (no production tip).

Still out of scope for that PR: eliminations table, FX, group-level Analyst, Budget roll-up, new SQL.

## Verify (this PR)

```bash
pnpm test:group-consolidation
pnpm test:client-groups
```

Manual (after next PR): owner with 2+ companies in one group, same currency, aligned PDF period ends → preview shows summed revenue / assets; mixed currency → blocker message, no totals.
