# J3 shared mount

AQA on `468e2bea` had the standby just over 3s on both regions. The same miss on US and ZA is the shared client mount, not a region hop. `warmMs` is `client-warm-line` (`markWarmCardLine` in `ClientAgentStandby`), milliseconds from navigation start until the standby effect runs. No new timings were taken for this note. The ~300ms figure is the comment on the app sheet. The other costs are estimates from the call order.

## What sits in front of the standby

1. **App stylesheet, blocking.** `__root.tsx` puts `appCss` in the document head as a normal stylesheet on every non-landing route. The comment above that link says the sheet is render-blocking, about 300ms on mobile. `/ask-ai.css` is a second blocking sheet on those same routes. The inline head script loads Google fonts with `media=print` on app paths, then returns. It does not do that for the app sheet. Fonts are off this path.

2. **Entry, then chrome, then the gate.** The entry has to evaluate before a route chunk starts. `DeferredAppChrome` (`__root.tsx`) loads `app-chrome` in an effect and leaves `useAppChromeReady` false until that chunk commits. `AuthenticatedShell` (`_authenticated.tsx`) does not import `_authenticated.gate` until `chromeReady` is true. Until then it renders `BootSkeleton`. That is a serial wait: chrome download and eval, then the gate chunk.

3. **Stored session, not `getSession`.** `AuthProvider` (`use-auth.tsx`) copies `readBrowserAuthSession` in a layout effect, before `restoreSession` → `getSession`. `earlyClientFileOpen` (`early-client-file.ts`) is true for a client file when that stored user is present and `sessionStillCurrent` says the session has not expired. `AuthGate` then skips `FirmShellLoading` while `loading` is still true, and it skips the entitlement wall. A missing or expired stored session still waits out `getSession` (8s cap in `restoreSession`).

4. **Client route, then the mark.** The outlet loads `clients.$clientId.tsx`. Budget and cash are `lazy` panels. The module still evaluates its static imports before `ClientView` can commit. `ClientAgentStandby` reads the warm card during render and marks `client-warm-line` in an effect, so `warmMs` includes that commit.

Fonts do not gate the mark. `getSession` and the billing check do not gate it when the stored session is still current. The shared remainder is the blocking app sheet, the entry, the chrome chunk, the gate chunk behind it, and the client route.

## Fixes

Not built here.

1. **Stop the app sheet blocking the entry.** Give `appCss` and `/ask-ai.css` the same `media=print` start the font sheet already uses on app paths, and flip them to `all` on load. One change in the `__root.tsx` head. Expected about 100–300ms when the sheet is not in the memory cache, and less when it is, because the parser still applies it before scripts. Risk: one unstyled frame on the client file. The standby text has to stay readable from the critical CSS already in the head, or the flip has to happen before `ClientAgentStandby` commits.

2. **Start the gate import next to the chrome import.** In `AuthenticatedShell`, call `import("./_authenticated.gate")` on the first effect, and still render `AuthGate` only after `chromeReady`. The outlet keeps waiting for `ChromeProviders` (`AccountantProfileProvider` and the other providers in `app-chrome.tsx`). Expected about 100–300ms when the gate chunk is not already cached, because that download no longer starts after chrome. Risk is low if the outlet does not commit early. Rendering `ClientView` before those providers is a crash, not a savings.

Either one can be enough if the miss is only a few hundred milliseconds. Do the stylesheet first. It is the smaller diff. If `warmMs` is still over 3s, overlap the gate import.

## How AQA checks it

Both regions, hard reload of a client file that already has this user's unexpired session and a warm card. Three reloads each. `[card-timing]` `warmMs` under 3000. The standby shows the cached line (`data-warm-cash="1"`) before the boot select. A missing or expired session still shows the skeleton, not another user's line.

## Next code PR, not this note

Two nits from #975 (`5cfc9d79`), left for the following budget change:

- `budgetActualsNote` (`src/lib/budget-chart-table.ts`) treats any view with an actual as stored. Statement pace therefore does not get the chart's even-split caption. The chart passes `storedMonths={loaded.length > 0}`, so pace with no uploaded rows shows `CHART_ACTUALS_EVEN_SPLIT`. The table note should use that same flag.
- `budgetTableRows` already runs `alignMonthsToYear` through `alignTableRow`. `budgetPeriodTotalCell` runs it again on those cells. The second call is redundant once the cells are aligned. The total should sum the cells it is given.
