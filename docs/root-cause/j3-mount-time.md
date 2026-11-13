# J3 mount time

Warm reloads still miss the 3s gate. After #949 the warm `warmMs` median is about 3.6–4.1s. `warmMs` is the `client-warm-line` mark inside `ClientAgentStandby`, which runs in an effect on the first commit that paints the cached cash line. It is time-to-standby, measured from navigation start. The deferred boot reads cannot move it.

This note is the path from navigation start to that commit for `/clients/$clientId`, and the matching path to the owner pending shell on `/app`. No app code changes.

Chunk sizes are from a production client build (`DEPLOY_TARGET=vercel`, Vite). Bytes are raw, with gzip beside them. The route modules match `main` at `2ed35d8a`.

## What has to finish before the standby commits

`/clients/$clientId` has no `loader` and no `beforeLoad`. The route component is `ClientView` in `src/routes/_authenticated/clients.$clientId.tsx`. The standby is the first client render while auth or the boot select is still open. It does not mount until every gate below has rendered the outlet.

1. The document. Server render of an app route starts with `useAuth` still loading, so the HTML is the shell skeleton, not the standby. The root head then loads three parser-blocking stylesheets on every app route: the Google Fonts sheet (Cormorant Garamond, Instrument Serif, Inter, Noto Sans), `/ask-ai.css`, and the app sheet `styles-*.css` (300,391 bytes, gzip 48,226). The landing page loads the app sheet as `media=print`. App routes do not. A stylesheet in the head delays the deferred entry module.

2. The entry chunk, `index-*.js` (1,018,599 bytes, gzip 296,092). Its static closure is only itself. React, the TanStack router, auth, and the route table live here. Route components are dynamic imports. This chunk must evaluate before a route chunk starts.

3. Chrome. `DeferredAppChrome` loads `app-chrome` in an effect after the first client render. `useAppChromeReady` stays false until that chunk commits, and `AuthenticatedShell` renders `BootSkeleton` until then. It then dynamic-imports `_authenticated.gate.tsx`. The authenticated layout sets `codeSplitGroupings: []` so the shell file itself is not a second suspense boundary. The gate is.

4. `getSession`. `AuthProvider` reads a stored session in a layout effect, before `getSession`, and sets the user from it. `loading` stays true until `restoreSession(() => supabase.auth.getSession(), 8_000)` settles. `getSession` takes `tabAuthLock` (`src/integrations/supabase/tab-auth.ts`), capped at 8s so a stuck holder cannot pin the tab. A live access token resolves locally. An expired token refreshes through the browser path to Supabase (`eu-west-1`). `AuthGate` returns `FirmShellLoading` while `loading` is true, even when the layout effect already has a user. The outlet, and therefore the standby, waits out `getSession`.

5. `getClaims` and `getUser` are not on the client restore. `requireSupabaseAuth` calls `getClaims` with a 3s timeout, and only on a server function. `getUser` runs inside a server function when the claims have no email (`checkoutActor`). The entitlement check below is that server function, so those awaits sit on this path only because the gate waits for it.

6. Firm, then the billing gate. Practice routes do not set `deferSideReads`, so `AccountantProfileProvider` loads brand as soon as auth loading is false: `firms` by owner, `firm_memberships`, and `profiles.full_name`. `AuthGate` does not render the outlet for a client file while entitlement is unknown. `pageWhileEntitlementUnknown` returns `wall` until `firmClientCount` is known, and `lastKnownEntitlementForFirm` is an in-memory slot that a reload clears. The gate effect then `Promise.all`s `loadFirmClientGateContext` and `getFirmBillingEntitlement`. The server function goes through `getClaims`, then reads the stored plan. A stored plan skips the live Stripe list (`firmBillingStripeRefreshDue` is false when that isolate has no stamp). The outlet still waits for both promises. A first client and a later client wait the same, because the count is null until the pair resolves.

7. The route chunk, then the standby. The router loads `clients._clientId-*.js` (284,865 bytes, gzip 87,376) as a dynamic import from the entry. Evaluating it pulls the static closure below. `ClientAgentStandby` reads `sessionStorage` key `milon-warm-boot-card:${clientId}` and, on a hit, marks `client-warm-line`. That key is client id only. The mark is an effect, so it runs after the commit, and fonts do not gate it (`font-display: swap` on the fallbacks). Plus Jakarta Sans is in the app CSS (latin woff2 27,347 bytes). Owner-door also ships Arial and Georgia fallbacks.

Nothing in the boot select, the plan read, or the ledger status is on this path. Those start after `ClientView` commits.

## Owner home

`/app` is not under `AuthGate`. `beforeLoad` only redirects a deliverables URL. The route is `ClientOnly`, so the server paints `AppBootSpinner` and the pending shell is client-only.

The owner chunk is `app-*.js` (337,187 bytes, gzip 101,829). After it evaluates, a layout effect may already hold the stored user. The pending shell (`data-owner-boot="pending"` or `"provisional"`) renders while `authLoading` is still true when that user has a stored client id and the link has not resolved. `getSession` does not block that paint. Firms and `firm_memberships` are held by `deferSideReads` until the owner board is ready. There is no Stripe hold and no `client-warm-line` mark on this page. The owner cost before the pending shell is the entry, the blocking stylesheets, and the owner static closure.

## Largest chunks

Static closure of the accountant route, including the entry: 93 files, 3,424,101 bytes. Owner route: 79 files, 2,721,588 bytes. These are the largest, and whether the standby waits on them.

| Chunk | Raw | Gzip | On the standby path | What it is |
| --- | ---: | ---: | --- | --- |
| `index-*.js` | 1,018,599 | 296,092 | Both, first | Entry. Router, auth, route table. Routes are dynamic. |
| `react-pdf.browser-*.js` | 1,459,132 | 487,700 | No | Dynamic import. Reports, not the home commit. |
| `xlsx-*.js` | 429,191 | 141,544 | No | Not in either route's static closure. |
| `playbook-data-*.js` | 393,632 | 80,707 | No | Not in either static closure. |
| `generateCategoricalChart-*.js` | 382,066 | 104,996 | Accountant | Recharts. Static via the cash forecast import. |
| `overview-insights-*.js` | 368,021 | 111,053 | Both | Overview insight panels. |
| `app-*.js` | 337,187 | 101,829 | Owner | `/app` route module. |
| `clients._clientId-*.js` | 284,865 | 87,376 | Accountant | `ClientView`. |
| `stripe-checkout.functions-*.js` | 231,383 | 32,881 | Both | Client half of the billing server functions. Static from `CheckoutAfterInsight` and the gate. |
| `review-inputs-drawer-*.js` | 189,469 | 62,670 | Both | Review-inputs drawer. |
| `budget-panel-*.js` | 146,378 | 41,850 | Accountant | Budget panel. Static on the client route. Dynamic on `/app`. |
| `cash-forecast-*.js` | 115,382 | 37,121 | Accountant | Cash forecast. Static on the client route. Dynamic on `/app`. |
| `enabled-*.js` | 113,184 | 36,637 | Both | `src/lib/tax-specialist/enabled.ts` and the tax graph it pulls. |
| `styles-*.css` | 300,391 | 48,226 | Both | App sheet. Parser-blocking off the landing page. |
| `accountant-portal-*.css` | 104,353 | 17,105 | Accountant | Portal sheet, with the route. |
| `owner-door-*.css` | 50,786 | 8,907 | Both | Owner door, including the standby's `OwnerHome`. |

`reports-studio` (93,887 bytes) and `action-plan` (85,649 bytes) are dynamic from the client route. They are not in the static closure.

## Ranked fixes

Savings are expected, not measured in a browser. A warm reload already has the bytes in HTTP cache, and V8 may have a code cache, so download size is the cold and first-navigation lever. The warm median moves when a serial await or a main-thread eval comes off the path.

1. Render the accountant standby from the stored session before `getSession` resolves, and do not hold the client file on `getFirmBillingEntitlement`, when a stored session for this user id exists. `AuthGate` already has that user from the layout effect and still paints the skeleton. Open the outlet for this user only. The warm card must be stored and read under the same user id (today the key is the client id alone), and a missing or mismatched id paints the checking line, never another user's cash line. Expected about 0.8–2s off `warmMs` when the token refresh or the entitlement round trip is the slow step. The entitlement function is one Vercel hop plus `getClaims` (3s cap) plus the stored-plan read, and it is serial after `getSession` and the firm list. Risk: a revoked session can paint one cached line until `getSession` fails and the shell replaces it. An unpaid firm can see the standby until the check returns and the wall replaces it. Both are one frame of this user's own cached line, not another account's books.

2. Code-split the client route. `ClientView` statically imports the cash forecast, the budget panel, the review drawer, overview insights, the walkthrough, and `CheckoutAfterInsight` (which pulls the 231 kB billing module). Recharts comes in with the forecast. Those chunks plus Recharts are 1,512,771 bytes raw and 418,375 bytes gzip. The standby only needs `OwnerHome`. Load them when the tab opens. Expected 100–400ms of eval on a reload that misses the code cache, and that gzip on a cold cache. Risk is low. The home commit does not read those panels.

3. Preload the route chunk at match, overlapping `getSession`. The router already dynamic-imports the matched route from the entry, so a second preload only helps if the match is delayed. Expected under 200ms. Risk is low.

4. Stop the Google Fonts sheet blocking the entry. It is a parser-blocking stylesheet on `/clients/$clientId` and `/app`. The app CSS is the other blocking sheet. Expected 100–300ms before the entry runs when `fonts.googleapis.com` misses cache, and little when it hits. The warm mark itself does not wait on font bytes. Risk is low if the sheet loads with `media=print` the way the landing page loads the app CSS.

The owner pending shell already paints during `authLoading` when the stored client id is present. Its remaining mount cost is the owner closure (overview insights, the review drawer, the billing module, the tax graph). The same split as fix 2 applies, without a `getSession` or Stripe wait in front of it.
