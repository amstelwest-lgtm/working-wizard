---
name: Ask AI edge function patterns
description: Design decisions and gotchas from the ask-ai Supabase edge function implementation
---

# Ask AI Edge Function — Durable Lessons

## Service-role authorization for revoked RPCs
**Rule:** When a SECURITY DEFINER function has had EXECUTE revoked from `authenticated` via RLS hardening, call it through the `adminClient` (service-role) from the edge function — not `userClient`. After a PUBLIC REVOKE, `service_role` does NOT inherit execute rights automatically; you must `GRANT EXECUTE ... TO service_role` explicitly in a migration.

**Why:** The RLS-hardening migration (`20260707000000_rls_hardening.sql`) revokes `has_client_access(uuid,uuid)` from anon/authenticated/public. Calling it via user JWT → 500. Calling via service-role + explicit GRANT → works.

**How to apply:** Any edge function that needs a SECURITY DEFINER helper revoked from public roles must (a) use `adminClient`, and (b) include `GRANT EXECUTE ... TO service_role` in its own migration.

## Atomic rate-limit enforcement
**Rule:** Check-then-insert rate-limit patterns under Read Committed isolation are not concurrency-safe. Use `pg_advisory_xact_lock(hashtext(user_id::text))` at the top of the PL/pgSQL function to serialize per-user transactions.

**Why:** Concurrent requests at N-1 can all pass the COUNT check and all insert, blowing past the quota.

## business_type → benchmark category mapping
**Rule:** The app stores `business_type` as values like `service`, `agency`, `project`; `industry_benchmarks` uses different category keys (`services`, `professional`). Mirror the `BUSINESS_TYPE_TO_BENCHMARK` map from `src/lib/ratios.ts` inside the edge function (can't import from src/).

## Stored ratio keys vs benchmark metric_key
**Rule:** `computeRatios()` writes display-name keys to `client_financial_snapshots.ratios` (e.g. `"Gross Margin"`). `industry_benchmarks.metric_key` uses camelCase (`"grossMargin"`). Maintain a `DISPLAY_TO_CAMEL` map in `context-builder.ts`.

## Benchmark pct unit mismatch
**Rule:** `computeRatios()` stores pct ratios as fractions (0.15 = 15%). `industry_benchmarks` stores them as whole percentages (15). Display the ratio value × 100; display the benchmark p50 as-is (no ×100).

## Monetary derived metrics → privacy
**Rule:** Exclude `salesPerEmployee` and `gpToLabor` from AI context. They expose derived currency amounts (revenue/employee, GP/labor), violating the no-raw-amounts privacy contract.

## Filled deliverables, not raw statements
**Rule:** Ask AI context is the owner-board *outputs*: filled profile answers, ratios, profitability waterfall as % of revenue, cash-forecast outlook (runway / shortfall / trajectory — no balances), product-line shares and margins, ranked next moves, and planned/outstanding action-plan tasks. Never dump `clients.financials` statement line items (inventory, receivables, full P&L) into the prompt.

## Vanilla JS widget send-button state
**Rule:** When building a vanilla JS widget where the send button must enable/disable as the user types, declare the button element BEFORE the textarea so the textarea's input handler and chip-click handlers can reference `sendBtn.disabled` directly.
