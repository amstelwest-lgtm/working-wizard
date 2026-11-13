# J3 addendum 3: warm after #949, one ledger, and a remembered client

Production after `2ed35d8a` (#949). US client HVAZV4. `[card-timing]` is `{ ms, warmMs }`. No app code in this note.

| Run | After #949 | Before `6f8857c1` |
| --- | --- | --- |
| Warm | 5284/4632, 4593/4081, 3952/3320 | 4418/3791, 4298/3608, 2862/2470 |
| Warm median | 4593/4081 | 4298/3608 |
| Cold new tab | 3231 | 4317 |

Cold is about 1.1s faster. Warm `ms` is about 0.3s slower and `warmMs` about 0.5s slower. On warm reload 3 the Financial Manager card still said `Checking action points.` at about 5s, and Needs attention went from 2 to 6 as more rows arrived. The target is still 3s.

## 1. What `client-card-text` and `warmMs` wait for

`ms` is the `startTime` of the `client-card-text` mark. `warmMs` is the `startTime` of `client-warm-line`, and it is included only when that mark exists (`src/lib/card-timing.ts`). Both are milliseconds from the navigation time origin, not a duration between the two marks.

`client-warm-line` is marked in `ClientAgentStandby` when `readWarmBootCard` returns a line. That read is `sessionStorage` key `milon-warm-boot-card:${clientId}`, then an in-memory map. It runs while `homePhase` is still `loading`. It does not wait for the client row, action points, open queries, or ledger status.

`client-card-text` is marked once, after `homePhase` is `ready`, on the first Financial Manager line (`clients.$clientId.tsx`). `ready` means the boot `clients` select has returned a row. `isRealCardLine` rejects a blank line, the exact string `Checking…`, and anything that starts `Couldn't load`. It accepts `Cash is $46,300.` and it also accepts `Checking action points.`

`ownerHomeLines` puts the cash sentence in `financial_manager[0]` and then pushes the action sentence. `openPlanTitles` starts `null`, so `actionsReady` is false and the second sentence is `Checking action points.` `HOME_ANSWER_ON_MANAGER` keeps that sentence on the Financial Manager card. It does not replace the cash line. The plan effect (`action_items_v`, then notes and runs) is behind `homeBootReady`, so it does not start until the boot select has settled. Open queries, snapshots, sign-offs, and the three ledger status calls are behind that same flag (#949).

A local probe of those functions, with a fake `performance` clock, was not committed:

| Clock | Financial Manager lines | `[card-timing]` |
| --- | --- | --- |
| 120ms, actions not ready | `Cash is $46,300.` then `Checking action points.` | one log, `{ ms: 120 }` |
| 900ms, action sentence present | `Cash is $46,300.` then `Chase the March invoices.` | no second log |

So the logged `ms` is the cash line at boot, not the action-points read. The checking sentence is already on the card at that commit, and it stays until the deferred `action_items_v` read returns. That is why reload 3 could show `Checking action points.` at about 5s even though the log is the cash line. Needs attention going from 2 to 6 is the same deferral: the boot row can fill a couple of rows, and the queries, plan, and ledger status fill the rest after the line.

Chain, from the code. The only production numbers are the ones above. The other steps have no separate mark.

1. Navigation time origin.
2. Session restore. The boot select does not send until it has a token (`noteBootRequestSent`).
3. `ClientView` mounts. `markClientReload`. A cached line paints in the standby and marks `client-warm-line` (`warmMs`). No `action_items_v`.
4. Boot `clients` select. `homePhase` becomes `ready`. This is the cash line.
5. Same commit: line 0 is cash, line 1 is `Checking action points.` The effect calls `markClientCardText` on line 0. One log. `ms` is this step.
6. After that paint, #949 starts `action_items_v`, open queries, snapshots, sign-offs, and Xero, QuickBooks, and Sage status. The second line and the attention count update when those return. They are not in `ms`.

The owner boot shell is earlier still. `bootShellCashLine(clientMeta.cashflow)` paints on the pending shell. `action_items_v` is inside `OwnerDoor`, which mounts with the full board.

## 2. Why cold improved and warm did not

#949 moved step 6 from beside the boot select to after it. The boot select no longer shares the PostgREST pool with that burst. Cold has no cache, so its `ms` is the boot select. 4317ms to 3231ms is that pool getting out of the way.

The warm cache is not gated by the deferral and it is not replaced by it. `rememberWarmBootCard` stores the first Financial Manager line, and it refuses `Checking…` and `Couldn't load`. With cash on the row, that stored line stays the cash sentence. The standby still paints it before the boot select returns. The deferred reads cannot move `warmMs`, because that mark is during the standby.

What did get slower to the eye is step 6. Those reads used to overlap the boot select, so action points could land near the cash line. They now start after it, so `Checking action points.` is still on the card when `[card-timing]` logs, and Needs attention keeps growing. That is serialization of the tail, not of the cash line.

`warmMs` itself moved from a median of 3608ms to 4081ms. That is the time until the standby effect runs, which is auth and the first `ClientView` commit, before the boot select. The six warm samples overlap (before 2470–4418, after 3320–5284). Nothing in #949 inserts the deferred reads in front of that mark. The cold gain is the boot select. The warm clocks did not get the same gain, and the samples are too few to call the 0.5s `warmMs` move a new wait.

## 3. Dual ledger chip

Pre-existing. #949 did not add the one-name choice. It kept it, and it only delayed when the status calls run.

`homeLedgerChip` (`src/lib/connect-books-copy.ts`) returns one label: QuickBooks, else Xero, else Sage. The home title is that string (`HomeBooks`, label `Connected`). The detail under it is `homeNeeds.syncLines[0]`. When the client already has statement dates, `booksSyncCopy` (`src/lib/owner-needs.ts`) returns `Statements on file: …` and does not name a ledger. That is `CONNECTED / QuickBooks / Statements on file` with no Xero.

The Connections header is `booksAnswerSentence` (`src/lib/books-answer.ts`) over `dataFreshnessLine` (`src/lib/workflow-coach.ts`). That function keeps the later of the Xero sync and the QuickBooks sync and names only that source. `Connected to QuickBooks.` is that one row. Both of those functions are older than #949.

## 4. Leaked client id

`/clients` itself does not redirect. `clients.index.tsx` renders the practice board. A URL that is already `/clients/:id` with no tab is rewritten to `?tab=home` by the client route. That matches the observed `/clients/660f2396-…?tab=home`. The id was already in the path. Access denied is the boot select: RLS returns no row, and the page says `Client not found or you don't have access.`

The persisted id is localStorage, not sessionStorage:

`milon_owner_active_client:` plus the user id

`ownerActiveClientStorageKey` in `src/lib/owner-workspaces.ts`. The user id is in the key. The firm id is not. `readStoredOwnerClientId` / `writeStoredOwnerClientId` are what the owner home and Settings use. `pickActiveOwnerWorkspace` reopens that id when it is still in the workspace list. `pickOwnedSettingsClient` returns the stored row before it looks at `firm_id`. The settings query is every client this user owns, with no firm filter. One login can therefore reopen a client from another firm.

There is a second unscoped pick. `loadFirstFirmClient` and `loadFirmClientGateContext` (`src/lib/firm-client-gate.ts`) select the oldest client with any `firm_id`, and they do not filter to the active firm. RLS is the only limit. A client the login can still see in another firm can win that read.

Neither store is "no user". The owner key is per user and not per firm. The oldest-client query is per login, through RLS, and not per active firm.

## 5. Proposed fixes

Not built here. Each is client-only, with a test, and none of them is SQL or an edge function.

1. Keep `Checking action points.` off the Financial Manager card until the plan read returns. The cash line stays line 0 and `[card-timing]` stays a one-line log. Test: `actionsReady: false` does not put `Checking action points.` on the card; a later action sentence is the second line; `markClientCardText` logs the cash line once.
2. Leave the warm cache in front of the boot select. Do not move `rememberWarmBootCard` behind `homeBootReady`. Also refuse to store `Checking action points.` so a warm reload cannot paint that sentence from `sessionStorage`. Test: a stored checking sentence is ignored; a stored `Cash is …` still paints in the standby before the boot select.
3. When both Xero and QuickBooks are connected, name both on the home chip and in the Connections header. One ledger stays one name. Test: both connections produce both names from `homeLedgerChip` and from `dataFreshnessLine` / `booksAnswerSentence`; QuickBooks alone stays QuickBooks. This is not a #949 regression.
4. Scope the remembered client to the firm: `milon_owner_active_client:${userId}:${firmId}`. If that id is missing or not in the current firm's clients, open the current firm's first client (`firm_id` equal to the active firm, oldest `created_at`). Apply the same firm filter in `loadFirstFirmClient`. Test: firm A's stored id is not used for firm B; an id the firm does not own falls back to that firm's oldest client; the other firm's id is not requested.
