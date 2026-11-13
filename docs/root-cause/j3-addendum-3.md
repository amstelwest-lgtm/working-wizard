# J3 addendum 3: the cash line does not wait on action points

Base `2ed35d8a` (#949). No app code in this note. The clock below is a local probe of the functions the accountant home already calls. It is not a production reload, and it was not committed.

## What [card-timing] records

`markClientCardText` (`src/lib/card-timing.ts`) runs once, on the first Financial Manager line, when `homePhase` is `ready` (`src/routes/_authenticated/clients.$clientId.tsx`). That phase is the boot `clients` select. `isRealCardLine` accepts `Cash is $46,300.` It rejects only a blank line, `Checking…`, and a line that starts `Couldn't load`.

`ownerHomeLines` (`src/lib/owner-answers.ts`) puts `cashHomeLine` in `financial_manager[0]`. The action sentence is pushed after it. While `openPlanTitles` is still null, `actionsReady` is false and that second sentence is `Checking action points.` `HOME_ANSWER_ON_MANAGER` keeps that sentence on the Financial Manager card. It does not replace the cash line.

`openPlanTitles` starts null. The plan read (`action_items_v`, then notes and runs) is behind `homeBootReady`, so it starts only after the client row has settled. `HomeBotCard` renders the lines it is given. It does not wait for the plan.

A local probe built the same books the owner-boot test uses (`opening` 46300, evidence on file, actions not ready), then called `ownerHomeLines` and `markClientCardText` against a fake clock.

| Clock | Financial Manager lines | `[card-timing]` |
| --- | --- | --- |
| 120ms, actions not ready | `Cash is $46,300.` then `Checking action points.` | one log, `{ ms: 120 }` |
| 900ms, action sentence `Chase the March invoices.` | `Cash is $46,300.` then `Chase the March invoices.` | no second log |

The cash line is a real card line at 120ms. The action sentence changes later and does not move `ms`. Appending action points after the cash line is what this render already does.

The owner home is the same split, one step earlier. `bootShellCashLine(clientMeta.cashflow)` paints on the pending shell from the cashflow select. `action_items_v` is inside `OwnerDoor`, which mounts with the full board, after that shell. The owner cash line does not wait on action points either.

The warm median from the production baseline at `6f8857c1` (about 4.3s `ms`, about 3.6s `warmMs`) is the boot `clients` select, not the plan read.

## Proposed fixes

These are for a later client-only pull request. They are not in this branch.

### Remembered client id

`ownerActiveClientStorageKey` is `milon_owner_active_client:` plus the user id (`src/lib/owner-workspaces.ts`). The firm is not in the key. `pickActiveOwnerWorkspace` uses that stored id whenever it is still in the workspace list. `pickOwnedSettingsClient` returns the stored row before it looks at `firm_id`, and its last resort is `rows[0]`, which need not be the current firm's client.

Store the id under the user and the firm. If that key is empty, or the id is not one of the current firm's clients, open the current firm's first client.

### Both ledgers on the chip and the Connections header

`homeLedgerChip` (`src/lib/connect-books-copy.ts`) returns one name. QuickBooks wins, then Xero, then Sage. A client connected to both Xero and QuickBooks is labelled QuickBooks only. The accountant card uses the same order (`qboLink`, then `xeroLink`). `dataFreshnessLine` (`src/lib/workflow-coach.ts`) keeps the later sync and names that one source. `booksAnswerSentence` turns that into the Connections header (`Connected to Xero` or `Connected to QuickBooks`).

When both Xero and QuickBooks are connected, name both on the home chip and in the Connections header.
