# Practice setup hang

AQA on `57db2ac9` (#957 merged). `/practice/setup` failed a second time. Lerato (firm `AQA Fresh 1021`, two clients, so the account has a firm) opened `/practice/setup` directly. The document title was Implementation Manager. The body stayed `Loading… Loading dashboard…` for more than 39 seconds, with no error, no Retry, and no no-firm message. A hard reload did the same for more than 25 seconds. The 10 second interview deadline from #957 never fired.

This is the note before any code. No production query was run. The reads below are the ones in the source.

## What paints that body

`Loading…` and `Loading dashboard…` are the two screen-reader strings in `BootSkeleton` (`src/components/primitives/skeleton-blocks.tsx`). `BootSkeleton` renders `DashboardSkeleton`, which is the second string. Nothing in `PracticeSetupPanel` uses those words. While the panel is booting it says `Loading your practice.` That sentence is not what AQA read.

The title is the route head in `src/routes/_authenticated/practice_.setup.tsx`: `Implementation Manager — Milōn`. The head applies as soon as the route matches. The parent can still be painting `BootSkeleton`. `Implementation Manager` is also the panel's accessible name (`IMPLEMENTATION_MANAGER_LABEL` in `src/components/practice-setup-panel.tsx`), but that node is not mounted while the shell is on `BootSkeleton`.

`BootSkeleton` is `FirmShellLoading`. Two parents return it:

1. `AuthenticatedShell` in `src/routes/_authenticated.tsx`. It waits for `useAppChromeReady()`, then dynamically imports `./_authenticated.gate`. Until that import resolves, it returns `FirmShellLoading`. There is no timer on either wait.
2. `AuthGate` in `src/routes/_authenticated.gate.tsx`. It returns `FirmShellLoading` while `useAuth().loading` is true, and again while `holdGatedPage` is true. `/practice/setup` is not a client file, so the early client-file paint does not apply.

`chromeReady` comes from `DeferredAppChrome` in `src/routes/__root.tsx`. The signed-in tree stays `chromeReady === false` until `import("@/components/app-chrome")` resolves. The outlet still renders, so the setup route matches and its title is set, but `AuthenticatedShell` refuses to load `AuthGate`. `AccountantProfileProvider` lives inside `AppChrome` (`src/components/app-chrome.tsx`). Firm state does not exist until that chunk arrives.

## What `/practice/setup` waits on once the gate is mounted

`/practice/setup` is a firm-product path (`isFirmProductPath` in `src/lib/stripe-entitlement.ts`, because it starts with `/practice/`). It is not a practice shell. `isPracticeShellPath` is only `/dashboard`, `/practice`, `/practice/tax`, and `/clients`. `scripts/firm-billing-gate-test.mts` locks the neighbour: `/practice/insights` stays gated until entitlement.

`accessWhileEntitlementUnknown` (`src/lib/firm-gate-access.ts`) therefore returns `"wall"` for `/practice/setup`. `pageWhileEntitlementUnknown` returns `"wall"` while the client count is still null, and still returns `"wall"` after a count of 2. `decideFirmBillingPathGate` with `entitled: false` only allows a practice path that is a shell, a zero-client pre-insight path, or an explicit `insightSeen === false`. The gate calls it without `insightSeen`. Two clients is not zero. The result is `require_billing`, which the page helper treats as `"wall"`.

`holdGatedPage` is `firmEntitled !== true` and that wall. `AuthGate` then returns `BootSkeleton` instead of `<Outlet />`. `PracticeSetupPanel` does not mount. These do not run:

- the 10 second boot timer (`PRACTICE_SETUP_INTERVIEW_MS` in `src/components/practice-setup-panel.tsx`)
- `fetchFirmSetupPlan` / `fetchFirmInterviewDraft` (`src/lib/setup-partner-client.ts`, both `milon_brain_rules` for this firm)
- `firmInterviewTurn`
- the no-firm message

A missing implementation plan or interview draft cannot be this skeleton. Those rows are read only after the outlet mounts. Two clients already say she has a firm. The no-firm branch is the same unmounted panel.

The shell's own deadline is 8 seconds (`SHELL_GATE_TIMEOUT_MS` in `src/lib/shell-gate.ts`). It is armed only in the entitlement effect, and only after `firmsLoaded` and a non-empty `firmId`. On a wall path that timeout is supposed to set `billingDeadlinePassed` and render `FirmBillingGateView` with Retry. `readUserFirms` (`src/lib/firm-brand.ts`) is also bounded: one 8 second `settleWithin`, a 1 second backoff (`FIRM_LOAD_RETRY_BACKOFF_MS`), then one fresh read. A double failure sets `firmsLoadFailed`, and a wall path should then show the same Retry card (`firmLoadHoldsRetry`).

A skeleton that is still up at 25 seconds and at 39 seconds, with no Retry, means that 8 second effect never stayed armed. The render returns `BootSkeleton` for `loading` before it ever reaches the Retry branch. The entitlement effect returns immediately while `loading` is true or the firm id is not loaded. Two ways that lasts with no card:

- `import("@/components/app-chrome")` or the following `import("./_authenticated.gate")` never settles. `AuthenticatedShell` has no deadline. `AuthGate` is not mounted, so neither the 8 second timer nor Retry exists. The route head is already Implementation Manager.
- `useAuth` has set `loading` true and is still waiting on `import("@/integrations/supabase/client")` (`src/hooks/use-auth.tsx`). The 8 second `restoreSession` deadline is inside that import's callback. Until the module arrives, `loading` stays true, `AuthGate` keeps the skeleton, and the Retry branch is not reached.

The firm and client selects are not what holds this screen by themselves. `readUserFirms` reads `firms` by `owner_user_id` and `firm_memberships` by `user_id`. `loadFirmClientGateContext` (`src/lib/firm-client-gate.ts`) reads `clients` with `.eq("firm_id", id)` and `limit(2)`. Both run only after `AuthGate` is mounted. `getFirmBillingEntitlement` (`src/lib/stripe-checkout.functions.ts`) is the Stripe read in the same effect, and it too starts only after the firm id is loaded. None of them is an interview read.

## Why #957 missed it

#957 put the 10 second deadline around `askTurn` and around the panel's boot effect, and it replaced the infinite `Loading your practice.` no-firm branch. Both edits are inside `PracticeSetupPanel`. The tests in `scripts/practice-setup-route-test.mts` assert that source. They do not mount the route under `AuthGate`.

On this URL the shell returns `BootSkeleton` instead of the outlet. The panel's timer is not in the tree, so it cannot fire. The no-firm copy cannot show either. `/practice` would have mounted the outlet, because that path is a practice shell. `/practice/setup` is classified with the gated practice routes, so the deadline #957 added is unreachable here even when the firm row and the two clients are already loaded.

## Proposed fix

One change. Treat `/practice/setup` as a practice shell path, next to `/practice` and `/practice/tax`, in `isPracticeShellPath` (`src/lib/stripe-entitlement.ts`). `accessWhileEntitlementUnknown` then returns `"allow"` before the client-count check, and `pageWhileEntitlementUnknown` returns `"allow"` even when the count is still null. `AuthGate` renders `<Outlet />` while entitlement is unknown. The panel mounts, and the 10 second deadline and the no-firm message from #957 are the ones on screen.

Do not open every `/practice/*` route. `/practice/insights` stays gated. The existing assertion in `scripts/firm-billing-gate-test.mts` keeps that.

Test, in that same file:

- `isPracticeShellPath("/practice/setup")` is true, including a trailing slash.
- `pageWhileEntitlementUnknown({ pathname: "/practice/setup", firmClientCount: null, firstClientId: null })` is `"allow"`.
- The same call with `firmClientCount: 2` is `"allow"`.
- `/practice/insights` is still not a shell path.

That test fails on `57db2ac9`. It does not need a database.

## How to verify

Before the fix, in a browser signed in as a firm with two clients and no need to touch `milon_brain_rules`:

- Open `/practice/setup` directly. The document title becomes `Implementation Manager — Milōn` while the accessible text is `Loading…` then `Loading dashboard…`.
- `data-practice-setup-panel` and `data-practice-setup-retry` are absent for the whole wait.
- The network log has no `firmInterviewTurn` and no `milon_brain_rules` read during the skeleton. A missing interview row is not in this wait.
- If `getFirmBillingEntitlement` never starts, `AuthGate` is not mounted: the hang is the chrome or gate import, or auth `loading` still true. Adding the shell path does not by itself deadline a hung `import()`. After the gate is confirmed mounted, the same URL still stays on `BootSkeleton` until the entitlement effect arms, which is the path bug above.
- A slow `getFirmBillingEntitlement`, once the firm id is loaded, should replace the skeleton with Retry at about 8 seconds. AQA did not get that card at 25 or 39 seconds, which is the unarmed timer, not the interview call.

After the fix, the same account should paint the Implementation Manager panel without waiting on Stripe. With no saved plan and no interview draft, the panel calls the interview once. If that call sits, Retry appears at about 10 seconds. Throttling the interview is enough. No SQL write is required.
