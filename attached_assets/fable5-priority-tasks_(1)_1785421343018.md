# MILŌN — 5 Priority Tasks for Fable 5

Run these in order. Each is self-contained — paste one at a time into Claude Code (with `/model` set to Fable 5) rather than all at once, so each gets full attention and a clean before/after check. Priority order reflects actual risk, not order of interest.

---

## TASK 1 — Row Level Security audit (highest priority: real cross-tenant data leak risk)

**Context:** This is MILŌN, a financial health platform handling real South African SME financial data, multi-tenant across accountants/firms and their clients. A prior session verified that application-level impersonation scoping works correctly in `intervention.functions.ts` via the `requireSupabaseAuth` middleware — but the underlying Postgres Row Level Security policies themselves have never been directly audited. If RLS has a gap, it's a direct cross-tenant leak of one client's financials to another, independent of any application code correctness.

**Do this:**
1. Read every file in `supabase/migrations/` in full, in chronological order, to reconstruct the current schema and every `CREATE POLICY` statement that applies to it (later migrations may alter or replace earlier policies — track the final state per table, not just each file in isolation).
2. For every table that stores or references client-specific data (financials, snapshots, ratios, intervention signoffs, notes, uploaded documents, QBO/accounting integration tokens, anything with a `client_id` or `firm_id` column), confirm:
   - RLS is actually enabled on the table (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`), not just policies defined without enabling RLS.
   - There is a `SELECT` policy, an `INSERT` policy, an `UPDATE` policy, and a `DELETE` policy (or an explicit, deliberate absence — e.g. no direct client deletes) — flag any table with policies for some operations but not others, since a missing policy on one CRUD operation while RLS is enabled defaults to deny, but a missing policy while RLS is *not* enabled defaults to allow-all.
   - Every policy's `USING`/`WITH CHECK` clause actually ties back to the authenticated user's firm/client relationship (via `auth.uid()` joined through membership tables), not just to `auth.uid()` directly on a table that doesn't have a direct user column — a subtle but common way RLS policies silently no-op.
   - Accountant impersonation is respected: when a firm user is acting as a client, do the policies still correctly scope to that client's data, or could an accountant with access to Client A's session parameters incorrectly read Client B's rows through a table the middleware doesn't cover?
3. Cross-reference every table found against every `createServerFn` handler in `src/lib/*.functions.ts` that queries it directly with the Supabase admin/service-role client (which bypasses RLS entirely) — confirm each such handler has its own explicit authorization check, since RLS won't save it.
4. Output a table: `table name | RLS enabled? | policies present (S/I/U/D) | scoping verified? | risk notes`. Flag anything not fully verified as HIGH/MEDIUM/LOW risk with a one-line reason.

**Do not modify migrations directly** — new policies need a new migration file, not an edit to an already-applied one. If you find a real gap, write the fix as a new migration file and tell me explicitly what it does and why, rather than silently including it.

---

## TASK 2 — First-time user walkthrough: signup through first ratio view

**Context:** Every review so far has been of internals. Nobody has verified the actual new-user experience end to end. This is the literal first five minutes of your first real customer's experience with the product.

**Do this:**
1. Trace the full code path for both signup types (`customer` and `accountant`) starting at `src/lib/auth.functions.ts`'s `adminSignUp`, through whatever the actual UI signup flow calls it from (find the route/component that calls this), through first login, through arriving at `src/routes/app.tsx` or the accountant dashboard, through entering financial data for the first time, to seeing the first computed ratio.
2. At each step, check for: a route that could 404 or redirect incorrectly for a first-time user with no data yet; a required field with no client-side validation message if left blank; a server function call that could throw an unhandled error visible to the user as a raw stack trace or blank screen; a step where the UI assumes data exists (a client record, a firm record, a first snapshot) that genuinely won't exist yet for a brand-new signup.
3. Specifically verify: does a new `customer` signup with no `inviteClientId` correctly get a `clients` row created for them (per the logic in `adminSignUp`), and does the dashboard correctly find and load that new client's (empty) data on first render without erroring?
4. Specifically verify: does a new `accountant` signup with a `firmName` correctly create the firm + membership + role, and can they immediately invite or add a client without hitting a missing-permission error from the RLS policies checked in Task 1?
5. Output a numbered list of every point in this flow that could break for a first-time user, each tagged BLOCKING (would stop a demo cold) or MINOR (rough edge but survivable), with the specific file and line.

---

## TASK 3 — Empty and error states across the dashboard

**Context:** All prior testing used realistic data. A new client with zero financial snapshots, a failed PDF upload/extraction, or a Supabase timeout are all real states your first customers will hit, and nobody has verified what they actually see.

**Do this:**
1. For each major dashboard view/tab (Overview, Ratios, Cash, Moves/Playbook, Tasks — per the existing five-tab structure), identify what renders when the underlying data array is empty (no snapshots yet, no interventions signed off yet, no tasks yet) versus `undefined`/still-loading versus a genuine fetch error.
2. Check `src/lib/extract-financials.functions.ts` and the PDF upload flow (`pdf-upload-zone.tsx`, `extraction-review-modal.tsx`) specifically: what does the user see if the AI extraction fails, times out, or returns partial/malformed data? Does it fail loudly with a clear message, or silently show nothing?
3. Check the industry news feed (`industry-pulse.tsx` / `industry-news.functions.ts`) and QBO integration (`qbo-connect.tsx`, `qbo.functions.ts`) for the same: what happens on API failure, rate limit, or expired token?
4. For every case found with no explicit empty/error/loading state, write the missing UI (a simple, on-brand empty state or error message matching the existing dark/gold aesthetic) rather than just flagging it — this is cheap to fix and expensive to discover live in front of a customer.
5. Output a before/after list: view name → what it showed before → what it shows now.

---

## TASK 4 — Expand the ratio/intervention stress test to ~75 profiles across all business types

**Context:** A prior session ran 6 hand-picked test cases (healthy, zero-COGS, negative equity, zero revenue, blank fields, high leverage) through `computeRatios` and confirmed several real fixes (ROE sign-cancellation, blank-field propagation, tier threshold mismatch — all already applied to `ratios.ts` and the playbook data). This task scales that same method up, not redoing what's already fixed.

**Do this:**
1. Generate realistic synthetic South African SME financial profiles — at least 3–5 per entry in `BUSINESS_TYPE_TO_BENCHMARK` (17 business types), covering a spread of health from clearly-critical to clearly-healthy for each type, plus deliberate edge cases per type (e.g. a `saas` business with negative working capital, a `construction` business with very long WIP/debtor days, a `retail` business with extreme inventory days).
2. Run every profile through `computeRatios`, then through the tier classification (`scoreTier`), then through the playbook lookup (`getPlaybookSteps` / the 595-row `playbook-data.json`), confirming every generated case resolves to a sensible set of interventions with no silent empty results and no result that contradicts the business's actual financial reality (e.g. don't let a genuinely distressed business land on "healthy" interventions due to a benchmark mismatch).
3. Specifically check whether `BUSINESS_TYPE_TO_BENCHMARK`'s many-to-one mapping (e.g. `marketplace`, `asset_heavy`, `distribution`, `logistics`, `hybrid` all map to the same `"other"` benchmark) causes any business type to be judged against a peer group so different from its actual economics that the resulting health tier is misleading.
4. Output a summary table by business type: number of profiles tested, any tier/intervention mismatches found, and a one-line verdict (clean / needs playbook content / needs benchmark remap).

---

## TASK 5 — Finish the NaN-safety sweep in app.tsx

**Context:** A prior session made `computeRatios` correctly return NaN for missing/not-meaningful ratios (rather than a misleading 0), and fixed the two rendering spots verified at the time in `app.tsx` and `accountant-ratios.tsx`. `app.tsx` is 152KB with a duplicated scoring engine (`clamp`/`hHigher`/`hLower`/`hRange`, mirroring `accountant-ratios.tsx`'s `clamp`/`hH`/`hL`/`hR`) and a mixed pattern of existing `isFinite` guards — this task finishes verifying the rest of it rather than repeating the fix already made.

**Do this:**
1. Search `app.tsx` for every place a ratio-derived value (from `computedRatios`, `healthMap`, or the local `clamp`/`hHigher`/`hLower`/`hRange` functions) is rendered, styled, or used in a calculation, and confirm each one either already has an `isFinite`/`!isFinite` guard or gets one added consistent with the existing pattern (neutral gray/dash state for non-finite, not falling through to the critical/red state).
2. While there, extract the duplicated scoring engine (`clamp`, `hHigher`/`hH`, `hLower`/`hL`, `hRange`/`hR`, and the health→label/class mapping) out of both `app.tsx` and `accountant-ratios.tsx` into one shared module in `src/lib/`, so this can't drift or need fixing twice again.
3. Confirm the CSV/export paths (if any exist beyond the one already fixed in `accountant-ratios.tsx`) also show "—" rather than "NaN" for missing values.
4. Output a diff summary: every location changed, old behavior vs new behavior.

---

## Output format for the overall session
For each task, before moving to the next: state what you found, what you changed (with the actual diff or file), and anything flagged for my decision rather than fixed automatically — same format as the original audit. End with a final combined list of anything still open across all five tasks.
