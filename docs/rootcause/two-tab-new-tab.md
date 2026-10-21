# New tab opens on Practice sign-in

AQA, after #694 (`c67558c4`, prod `fbb7a929`): tab 1 is signed in on `/clients/<id>?tab=home`. Ctrl+T in the same window and open `https://www.milonfinance.com/clients`. Tab 2 goes straight to `/auth` (“Practice sign-in”) and stays there after two reloads. Tab 1 stays signed in. Middle-clicking a client does the same thing.

## Cause

The auth token was stored in `sessionStorage`. A new tab does not copy `sessionStorage` (Ctrl+T, middle-click, or a pasted URL). `adoptSharedAuthSession` also moved any `localStorage` copy into the current tab and deleted it, so the new tab had nothing to read.

`getSession()` then returned null. That is not a hung lock: the refresh coordinator only wraps the refresh `fetch`, and each tab has its own `processLock`. The new tab finished loading with no user. The accountant gate treats that as signed out and navigates to `/auth`. The owner shell would leave `/app` for `/`. Reloading cannot help, because the token was never in a store the new tab can see.

#694 stopped a null auth event from clearing a user this tab already had, and it single-flights the refresh so two tabs do not revoke one token. It did not put the token where a new document can read it. A brand-new tab has no user yet, so the “keep the current user” branch never runs, and the anonymous redirect still does.

## Files

- `src/integrations/supabase/tab-auth.ts` — deleted the shared token, and kept GoTrue on `sessionStorage`.
- `src/integrations/supabase/client.ts` — called that adopt step before `createClient`.
- `src/hooks/use-auth.tsx` — applied `getSession` after load. A null result with no prior user cleared the gate.
- `src/lib/auth-session-guard.ts` — `shouldRedirectToAuth` sent `/clients` to `/auth` once loading finished with no user.
- `src/routes/_authenticated.gate.tsx` — accountant redirect.
- `src/routes/app.tsx` — owner redirect to `/` on the same check.

## Why #694's tests missed it

`scripts/session-refresh-bounce-test.mts` builds two in-memory refresh coordinators and hands both the same refresh-token string. It never opens a second document, so it never sees empty `sessionStorage`. The assertions prove one network refresh and that a null event does not clear a user the test already set. They do not prove a new tab can read a session.

## Fix

The auth token is stored in `localStorage` and mirrored into this tab. Opening the app publishes a session that was only in `sessionStorage`. A new tab reads that token synchronously, and the gate does not navigate while it is there. `getSession` can still refresh afterwards. Only the refresh request is single-flight; a tab that does not win that flight keeps the stored access token. The PKCE verifier stays on the tab that started login. GoTrue’s auth `BroadcastChannel` stays off. A stored token that GoTrue has removed still ends on “Couldn't restore your session”, and a visitor with no token still goes to `/auth`.

## Documents banner

“Cannot read properties of undefined (reading 'listSourceDocuments')” is not this race. The only read of that property is `LiveSourceDocuments` in `src/components/source-documents-panel.tsx`: `const api = await import("@/lib/source-documents-browser")` then `api.listSourceDocuments`. That import does not wait on the auth gate. Inside `listSourceDocuments`, a missing session makes `getSession()` return null and the table reads run as the anon user. A failed session read throws on `getSession` or the lock timeout, not on `listSourceDocuments`. Left as a separate failure of the module namespace itself.

## Verification

`pnpm test:new-tab-session` publishes a session-only token into `localStorage`, reads it from an empty session store, and refuses the `/auth` redirect while that user is stored. `pnpm test:new-tab-session-e2e` signs a tab in, opens `/clients` and `/app` in the same browser context, reloads the clients tab twice, and asserts none of them land on Practice sign-in. `pnpm test:session-refresh-bounce` still covers two refreshes more than 10 seconds apart.
