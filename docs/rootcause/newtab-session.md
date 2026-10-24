# Magic link on the apex, new tab on www opens Practice sign-in

AQA, second strike after #694, with #702 live at `92789522`. A Chrome profile signs in with the email magic link. That link redirects to the apex `https://milonfinance.com`. Ctrl+T, then `https://www.milonfinance.com/clients`, lands on `/auth` (“Practice sign-in”). Reloads stay on `/auth`. The original tab stays signed in.

No code change in this note.

## Cause

The Supabase session is origin-scoped. `https://milonfinance.com` and `https://www.milonfinance.com` do not share `localStorage`. #702 put the access token and refresh token in `localStorage` so a new tab on the **same** origin can read them. A new tab on the other host still sees an empty store. `getSession()` returns null, loading finishes with no user, and the accountant gate sends `/clients` to `/auth`. Reloading www cannot find a token that was written on the apex. The apex tab still has its own copy, so it stays signed in.

The magic link is aimed at the apex in two places:

- `emailSignInRedirectTo` builds `/auth/callback` on the page’s `window.location.origin`. On the apex that is `https://milonfinance.com/auth/callback?door=accountant`. The same pattern is used for signup, password reset, Google, staff invite, and checkout confirmation: if the page origin is an allowlisted host, the apex is kept. `CANONICAL_APP_ORIGIN` is already `https://www.milonfinance.com`, and these auth links do not use it.
- Supabase falls back to the project **Site URL** when `emailRedirectTo` / `redirect_to` is missing from the redirect allowlist. `docs/AUTH_CUSTOM_DOMAIN.md` sets that Site URL to `https://milonfinance.com`. The repo template `supabase/templates/magic_link.html` only prints `{{ .ConfirmationURL }}`, which is that redirect.

`AuthUrlReturn` then calls `setSession` on whichever origin actually served the HTML. That write uses the GoTrue storage adapter. The adapter mirrors `sb-<project-ref>-auth-token` into `localStorage` and this tab’s `sessionStorage`. It does not set a cookie. A parent-domain cookie (`Domain=milonfinance.com`) exists only for the door/next hint (`milon_email_return`), the short-lived PKCE verifier (`milon_email_cv`), and the Google door (`milon_google_intent`). None of those cookies is the session.

Checked live while writing this note:

- `curl -I https://milonfinance.com/clients`, `/`, `/auth/callback?door=accountant`, and `/.well-known/assetlinks.json` all return **308** with `Location: https://www.milonfinance.com…`, path and query preserved. `server: Vercel`. `vercel.json` does not contain this rule. `mobile/store/theo-checklist.md` calls it a Vercel **domain setting**, and says it stays “until that redirect is turned off” so the apex can return 200 for App Links.
- Chrome, loading `https://milonfinance.com/#access_token=…&refresh_token=…&type=magiclink`, finished on `https://www.milonfinance.com/#access_token=…` with the hash intact (edge `cle1`). The fragment is not in the HTTP request. This browser put it back on the www URL after the 308.

A signed-in **apex** tab, with www signed out, is what happens when the app runs on the apex and writes storage there. The domain 308, when it runs before HTML, moves that hash onto www and the session is stored on www instead. The setting is outside the repo and is documented as temporary. The auth helpers and the documented Site URL still name the apex, so a link whose allowlist check fails, or a visit while that setting is off, stores the session where www cannot see it.

## Where the session lives

| Store | What | Visible to a new tab on the same origin | Visible on the other host |
|---|---|---|---|
| `localStorage` key `sb-<ref>-auth-token` | Access token, refresh token, user | Yes, after #702 | No |
| `sessionStorage` same key | Mirror of that token | No (Ctrl+T starts empty) | No |
| `sessionStorage` `sb-<ref>-auth-token-code-verifier` | PKCE verifier for the tab that requested the link | No | No |
| Cookie `milon_email_cv` on `Domain=milonfinance.com` | Copy of that verifier for 10 minutes | Yes, via `document.cookie` | Yes, same registrable domain |
| Cookie `milon_email_return` | Door and `next` only | Yes | Yes |
| Cookie `milon_google_intent` | Google door only | Yes | Yes |

Implicit is the client default (`flowType` unset, auth-js default `'implicit'`). The magic-link session is the hash tokens passed to `setSession`, not the PKCE cookie. The cookie cannot sign www in.

## Files

- `src/lib/app-origin.ts` — `CANONICAL_APP_ORIGIN` is www. `isAllowedAppHost` also returns true for the apex, so `browserAppOrigin()` / `appRedirectOrigin()` keep `https://milonfinance.com` when that is the page.
- `src/lib/email-sign-in.ts` — `emailSignInRedirectTo(origin, door, next)` uses `origin` as the base. `requestEmailSignInLink` passes that string through to `signInWithOtp`.
- `src/components/email-sign-in-option.tsx` — sends `window.location.origin`.
- `src/lib/pending-checkout.ts` — `checkoutEmailRedirectTo` via `appRedirectOrigin`, so an apex page stays on the apex.
- `src/routes/index.tsx`, `src/components/landing/landing-sign-in-session.tsx` — signup `emailRedirectTo` and `resetPasswordForEmail({ redirectTo: browserAppUrl(...) })`.
- `src/components/password-reset-request.tsx`, `src/components/verify-email-banner.tsx` — reset and verify links through `browserAppUrl`.
- `src/lib/google-auth.ts` — `googleOAuthRedirectTo(browserAppOrigin(), …)`, including owner-invite and accountant-join query (`invite`, `join`).
- `src/lib/staff-invite-landing.ts` — `staffInviteEmailRedirectTo(origin, token)` concatenates `origin` with `/auth/callback?next=/access/…`. Called from `src/routes/access.$token.tsx` with `browserAppOrigin()`.
- `src/lib/client-invite-email.ts` — `inviteSiteUrl()` uses `appRedirectOrigin` (request origin, then `SITE_URL`). Owner handoff (`src/lib/client-invite.functions.ts`, `src/lib/client-owner-invites.functions.ts`) and the accountant join link (`src/lib/accountant-invite.functions.ts`) build absolute URLs from it.
- `src/components/auth-url-return.tsx` — `setSession` / `exchangeCodeForSession` on the origin that served the page.
- `src/lib/stored-auth-session.ts`, `src/integrations/supabase/tab-auth.ts`, `src/integrations/supabase/client.ts` — token storage is `localStorage` plus a same-tab mirror. No auth cookie, no `cookieOptions`, no `Domain` on the token.
- `src/lib/auth-session-guard.ts` — `shouldRedirectToAuth` is false while a stored user exists on **this** origin. An empty www store still redirects. `src/routes/_authenticated.gate.tsx` and `src/routes/app.tsx` only call that helper.
- `vercel.json` — permanent host redirects for `milon.co.za` and `*.milon.co.za` to www. No rule for `milonfinance.com`.
- `docs/AUTH_CUSTOM_DOMAIN.md` — Site URL `https://milonfinance.com` and allowlist entries on the apex.
- `supabase/templates/magic_link.html` — button and paste link are `{{ .ConfirmationURL }}`.
- `scripts/new-tab-session-e2e.mts` — one origin.

## Why #694 and #702 missed it

#694 (`c67558c4`) stopped a null auth event from clearing a user this tab already had, and it single-flights refresh so two tabs do not revoke one token. The token still lived in `sessionStorage`. `scripts/session-refresh-bounce-test.mts` uses two in-memory coordinators and one token string. It never opens a second document and never a second host.

#702 (`92789522`) moved the token to `localStorage` and taught the gate to wait when that key is present. That fixes Ctrl+T on one origin. `localStorage` is still per origin, so www cannot see a session written on the apex.

`scripts/new-tab-session-e2e.mts` does open a real second page: `context.newPage()`, then `goto` `/clients` and `/app`. It is not a second navigation in the same tab. Every page uses `http://127.0.0.1:4191`. The test writes the session into tab 1’s `sessionStorage`, reloads that same tab so the client copies it into `localStorage`, then opens tab 2 on that same origin. It never follows a magic link, never loads `https://milonfinance.com`, and never loads `https://www.milonfinance.com`. Same-origin `context.newPage()` shares `localStorage`. Apex and www do not.

## Proposal

Make www the only host. Prefer the code changes. Do not change Supabase from this repo. Do not edit `stripe-entitlement.ts`, `firm-client-cap.server.ts`, or `_authenticated.gate.tsx`. The gate is doing what an empty www store requires.

**(a) 308 the apex to www, path and query preserved.** Put it in `vercel.json` next to the `milon.co.za` rule. `permanent: true` is a 308. Vercel keeps the query string. A host condition is enough. It does not have to be only a domain setting:

```json
{
  "source": "/:path*",
  "has": [{ "type": "host", "value": "milonfinance.com" }],
  "destination": "https://www.milonfinance.com/:path*",
  "permanent": true
}
```

The domain setting already 308s the whole apex, including `/.well-known/assetlinks.json`, and it is not in git. `mobile/store/theo-checklist.md` expects that setting to be turned off so the apex file can return 200. When it is turned off, the app is served on both hosts again unless this `vercel.json` rule exists. A domain-level redirect cannot spare one path. If App Links still needs a 200 on the apex for that file only, drop the domain setting and exempt `/.well-known/assetlinks.json` in `vercel.json`. Chrome kept the magic-link hash across the current 308 in the check above. The fragment is reapplied by the browser. It is not a query parameter the server must copy.

**(b) Every auth link uses one constant, `CANONICAL_APP_ORIGIN` (`https://www.milonfinance.com`).** Stop passing the page origin through once the apex is allowlisted. That includes:

- magic link / OTP: `emailSignInRedirectTo` and `signInWithOtp` in `email-sign-in.ts` (the `/auth` door and the landing door)
- signup and checkout confirmation: `checkoutEmailRedirectTo`, `paidSignupRedirectTo`
- password reset: `resetPasswordForEmail` in `password-reset-request.tsx`, `index.tsx`, and `landing-sign-in-session.tsx`
- verify: `verify-email-banner.tsx`
- Google, owner invite, and accountant join: `googleOAuthRedirectTo(browserAppOrigin())`
- staff invite: `staffInviteEmailRedirectTo`
- owner handoff and accountant join emails: `inviteSiteUrl()`

`browserAppOrigin()` must not be that constant by accident: today it returns the apex when the document is on the apex. Auth call sites should pass `CANONICAL_APP_ORIGIN` even when the page host is the apex.

**Theo, Supabase Dashboard → Authentication → URL Configuration.** Not changed from here.

- **Site URL:** `https://www.milonfinance.com`. It is documented today as `https://milonfinance.com`. A `redirect_to` that is not on the allowlist is replaced by the Site URL, which is how the email opens the apex.
- **Redirect URLs:** add `https://www.milonfinance.com/auth/callback`, `https://www.milonfinance.com/auth/verified`, and `https://www.milonfinance.com/**`. Keep the existing localhost entries. Apex entries can stay until the 308 is confirmed. If the www callback is missing, a code change that sends `emailRedirectTo` at www is ignored and the message still uses the Site URL.

## Test that fails on current main

On `92789522` these assertions fail, which is the bug:

- `emailSignInRedirectTo("https://milonfinance.com", "accountant")` equals `https://www.milonfinance.com/auth/callback?door=accountant`. Today the result is `https://milonfinance.com/auth/callback?door=accountant`.
- `checkoutEmailRedirectTo("https://milonfinance.com", pending)`, `googleOAuthRedirectTo("https://milonfinance.com")`, `staffInviteEmailRedirectTo("https://milonfinance.com", token)`, and `browserAppUrl` / `resetPasswordForEmail`’s `redirectTo` while the document origin is the apex, all start with `https://www.milonfinance.com`. Today each one keeps the apex.
- `vercel.json` contains a permanent redirect whose host condition is `milonfinance.com` and whose destination is `https://www.milonfinance.com/:path*`. Today the only host redirects are `milon.co.za`.

`scripts/new-tab-session-e2e.mts` stays as the same-origin Ctrl+T check. It does not cover this. Add those assertions beside it. They fail on current main before any production click.

## Verification

After the change, on a US account and a ZA account: request the email sign-in link, open it, and confirm the address bar ends on `https://www.milonfinance.com` (the link may still mention the apex). The original tab is signed in. Ctrl+T to `https://www.milonfinance.com/clients` stays off `/auth`. Reload that tab twice. The original tab stays signed in. Repeat from a network that hits a US edge and one that hits a ZA edge. The 308 checked here was `cle1` only.
