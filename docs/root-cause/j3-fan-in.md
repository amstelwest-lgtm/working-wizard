# J3 fan-in: the card waits in a queue, not in SQL

A read-only production log study (SAST, 13 Nov 2026) found Supabase SQL at 2–7ms, and a US client reload (HVAZV4, `353f1dbf-a7ba-4092-878d-792223ba3536`) firing 20–50 parallel REST calls into a PostgREST pool of 10. At 12:57:19 `clients` and `xero_connections` each spent about 1.4s queued. One server-side `client_financial_snapshots` read (the study's Boardman sample) took 3,143ms at the origin and 4ms in SQL. Johannesburg browser traffic to Supabase hairpins through Cloudflare PDX on the way to eu-west-1.

No app code in this note. The times are the study's. The counts below are the calls the current tree (`cc6018ea`) starts on a reload. Nothing in the repo is named Boardman.

## 1. What a reload starts, and what the three cards wait on

### Accountant client view

`ClientView` in `src/routes/_authenticated/clients.$clientId.tsx` mounts with the client id already in the URL. It does not wait for a workspace list. The three cards are `OwnerHome` (`lines={homeLines}`) on the overview pane. `homeLines` is `ownerHomeLines` over `homeBooks`, and `homeBooks` is built from the client row's `financials` and `cashflow`. `homePhase` becomes `ready` when that one `bootSelect` returns. A real Financial Manager line can commit then. The analyst and advisor lines come from the same memo, so all three cards wait on that select and on the session token in front of it. They do not wait on snapshots, ledger status, notes, or the team feed.

`MilonTeamPane` mounts only when the overview has an agent thread open (`showHomeThread`). The default home does not mount it, so its nine-table feed is not on the first paint.

These start in the same turn as the gating select. None of them is an input to the first card line.

Shell, because a practice route does not set `deferSideReads` (`src/contexts/owner-board-gate.tsx`):

| Call | Table |
| --- | --- |
| `readUserFirms` | `firms` (owned) and `firm_memberships`, together |
| `readPersistedNameChain` | `profiles` |
| `listAppRoles` | `user_roles`, only when that firm list comes back empty |

Client view, on mount:

| Call | What it hits | Feeds the cards? |
| --- | --- | --- |
| `bootSelect` on `clients` | the full row, including `financials` and `cashflow` | yes, this is the gate |
| `loadAutoPopulateState` | `clients` again (`financials_updated_at`, forecast, budget, `auto_update_prefs`) | no |
| `getXeroStatus` | server function: `getClaims`, then `clients`, then `xero_connections`. A connection row continues to `xero_sync_data` and `client_financial_snapshots` (`source, created_at`, limit 8) | no |
| `getQboStatus` | same shape: `clients`, `qbo_connections`, then `qbo_sync_data` and the same snapshot select | no |
| `getSageStatus` | `clients`, `sage_connections`, and a second `clients.financials` only when a Sage row exists. No snapshots | no |
| snapshot effect | `client_financial_snapshots` (financials jsonb, ratios, limit 24) and `client_score_history` | no. Prior-period variance only |
| `countOpenQueriesForClient` | `client_notes` | no |
| `listClientReviewSignoffs` | `getClaims`, `auth.getUser`, `has_client_access`, `client_review_signoffs` | no |
| cash sign-off snapshot | `client_deliverable_states` where `scope = cash_forecast` | no |
| open-plan effect | `action_items_v` and `action_plans`. If any item is open: `action_updates` twice and `agent_runs` | no. Titles fill in after the line |

That first wave is about 26 REST or auth calls when the client has no ledger connection and no open actions, and the firm list is already cached. A connected ledger adds the sync-cache and snapshot selects inside the status function. Open actions add three more. The snapshot effect runs a second time when `setClient` sets `financials_updated_at` (the effect depends on `[clientId, client?.financials_updated_at]`). The study's 20–50 is this wave plus that second pass.

After the row returns, and so after the line can paint, still into the same pool:

- `loadClientDisplayNames` reads `clients.owner_user_id` (the boot select does not ask for it), `profiles`, and `xero_connections`, `qbo_connections`, and `sage_connections` together.
- `NoteLayer` registers the surface and loads notes. `listClientNotes` is `getClaims`, `getUser`, `has_client_access`, `client_notes`, and `client_note_replies` when any note exists. `listNoteCollaborators` repeats the auth and access checks, then `list_note_collaborators` and `clients.name`.
- An opened agent thread then runs `useMilonTeamFeed` (nine tables, including another `clients` and another `client_financial_snapshots`, then `firms` and `getAdvisorySignoffState`) and `useAgentActivity` (`agent_runs`, `agent_findings`, `agent_messages`, `clients.market`).

`getXeroStatus` always reads `xero_connections`, including for a QuickBooks client. That is the `xero_connections` call that sat in the pool next to the gating `clients` select at 12:57:19. Both waited about 1.4s because the pool had ten slots and this wave had more than ten callers. The SQL behind them was already in the 2–7ms band.

### Owner home

The owner home does not share this mount. `/app` (`src/routes/app.tsx`) paints the first Financial Manager line on the pending shell as `bootShellCashLine(clientMeta.cashflow)`, before `OwnerDoor` mounts. Analyst and advisor cards live in `OwnerDoor` and wait for `ownerBoardReady`, which still wants `financials` hydrated.

Order:

1. Session restore.
2. Workspace list: `clients` by `owner_user_id` and `client_memberships`. The heading can paint from this. `effectiveClientId` cannot be set before it.
3. `beginOwnerClientReads` then starts two `clients` selects together: the meta row (this includes `cashflow`, and it is what the boot cash line waits on) and `clients.financials` (this is what the full door waits on).
4. In that same turn, and not on the cash line: `client_financial_snapshots` (the history effect), `client_score_history`, and `listClientReviewSignoffs`.

`deferSideReads` holds the firm brand. The role bounce (`user_roles`, `firm_memberships`) waits until `ownerGateSettled`. `OwnerDoor` is behind the `!boardReady` return, so its `xero_connections`, `qbo_connections`, `action_items_v`, and `useAgentActivity` start after the boot cash line. Notes (`NoteLayer`) are on that later tree as well.

`user_roles` on a normal owner reload is the bounce after the gate, or the self-signup branch that has no workspace. It is not in front of the cash line. On the accountant reload it is only the empty-firm branch of the profile hydrate.

## 2. What can wait, and what is read twice

The smallest cut is to start nothing in the accountant table above, except the one boot `clients` select, until that select has settled. The owner home already does this for brand and roles. The card line does not read the deferred rows. Ledger status, the 24-row snapshot, sign-offs, open queries, the plan, and auto-populate prefs all paint after the line.

Reads that are duplicated on one reload:

- `clients`. The boot select, auto-populate, each of the three ledger status functions, and then `loadClientDisplayNames`. Five or six reads of one row. Auto-populate's columns and `owner_user_id` fit on the boot select.
- `client_financial_snapshots`. The browser effect (twice, because `financials_updated_at` arrives a moment later), plus `getXeroStatus` or `getQboStatus` when that connection exists, plus the team feed if a thread is open.
- `xero_connections`. `getXeroStatus` during the burst, then `loadClientDisplayNames` after the row.
- `action_updates`. `loadLatestAssignments` and `loadActionNotes` are started together and both call `loadAssignmentNotes`.
- Notes auth. `listClientNotes` and `listNoteCollaborators` each do `getClaims`, `getUser`, and `has_client_access`.

The owner meta effect is the pair inside `beginOwnerClientReads`: cashflow columns and `financials` are two selects of the same row, on purpose, so the cash line need not wait for the financials payload. That split should stay. The history snapshot beside it should not. It is the same "not needed for the line" read as on the accountant view.

## 3. Why a server function reads snapshots on reload

`getXeroStatus` (`src/lib/xero.functions.ts`) and `getQboStatus` (`src/lib/qbo.functions.ts`) are TanStack server functions. The browser calls them from effects that depend only on `clientId`, so they run on every client reload, from the Vercel Node function (`api/server.js`), not from the page's Supabase client. Each one loads the client row, then the connection. If the connection exists, it loads the sync cache and then `client_financial_snapshots` for `source` and `created_at` (limit 8). That select exists to decide `figuresFromThisSync` for the connect chip. The home cards never read it.

There is no Boardman symbol in the tree. The study's Boardman sample, 3,143ms origin and 4ms SQL, matches this read: the statement is tiny, Postgres finished in 4ms, and the other three seconds are the call sitting in the pool or on the hop into PostgREST. The browser's own snapshot select is a different statement (24 rows, with the financials jsonb) and would not be labelled as the server function.

It can be skipped on the home reload. The connect chip is not on the three cards. A later visit to Connections can load status, and the snapshot select can be dropped from the status handler entirely: the client row the handler already loaded has `financials` and `financials_updated_at`, which is what the attribution compares. Caching the status for the session would also stop a second reload from taking a pool slot. Skipping is the smaller change. `getSageStatus` does not touch snapshots.

The owner history effect is a browser select, not this server function. It can wait until after the boot cash line. It should not be cached as the source of the cards. The cards do not use it.

## 4. Region

Vercel project `working-wizard2` (`prj_xkZrCFxatqF0Rf3Hd8SVB6s6Fqjc`) is already pinned to Dublin, next to the database.

- `vercel.json` sets `"regions": ["dub1"]`. `functions["api/server.js"]` sets `includeFiles` only, so the server function inherits that region. There is no per-function region override.
- Production deployment `dpl_GZov7gxKsEAwz3CqBkzQ9TupePgQ` (commit `cc6018ea`, target production, type `LAMBDAS`, Node 24) reports `regions: ["dub1"]`.
- Supabase project `jxclnsbsqpixxqlbcapl` (Milon real) is `eu-west-1`.

A new region pin is not a fix. The pin that is already there puts the server function in Dublin. A 4ms query from Dublin should be tens of milliseconds when a pool slot is free. The 3,143ms sample is the queue, not a function running in the wrong region.

The Johannesburg hairpin is the browser, not this function. The page's Supabase client calls `*.supabase.co`, which is on Cloudflare. A Johannesburg session that lands on PDX and then goes to eu-west-1 pays that detour on every browser REST call. `vercel.json` does not move that path. A US reload of HVAZV4 pays a US-to-Ireland hop on the browser calls, and a short Dublin hop on the server functions.

Leaving the pin as it is has these limits, which are not a reason to move it:

- It applies to the Node server (`api/server.js`), not to the browser and not to an Edge route. A cold start of that function delays the document and the server functions. It does not delay a browser `clients` select.
- One region means one warm pool. That is the right trade for a function whose database is in Ireland.
- Stripe calls made from these server functions (checkout) pay Dublin to Stripe. The card reload does not call Stripe.
- Ask uses the Supabase edge function `ask-ai` on this same eu-west-1 project. It is not the Vercel function. The card line does not call it.

Moving the project to an American region would shorten a US document load and add a cross-Atlantic hop to every server-function query. It would not pull the browser off Cloudflare PDX.

## Smallest fixes, in order

No code in this note.

1. On the accountant client view, start the boot `clients` select alone. Hold ledger status, snapshots, score history, sign-offs, open queries, the plan, and auto-populate until that select settles. This is the pool. It is the same idea as `deferSideReads` on the owner home. The 1.4s queue on `clients` and `xero_connections` is those calls sharing ten slots.
2. Stop calling `getXeroStatus`, `getQboStatus`, and `getSageStatus` from the home mount. That removes the server-function snapshot read (the 3,143ms / 4ms sample) and the extra `clients` and `xero_connections` selects. Load them when Connections opens. The snapshot select inside the Xero and QuickBooks status handlers can go; the client row is already loaded there.
3. Read `client_financial_snapshots` once, after the line, on both homes. Drop `financials_updated_at` as a reason to run the accountant effect again. The owner history effect waits the same way. Do not cache it for the cards.
4. Fold `auto_update_prefs` and `owner_user_id` into the boot select so auto-populate and the display name do not re-read `clients`. Call `loadAssignmentNotes` once. Leave the owner's two boot selects (cashflow and financials) as they are: the cash line is supposed to beat the financials payload.
5. Do not change the region. It is already `dub1` beside eu-west-1. The PDX hairpin is the browser's Cloudflare path, and a pin does not move it.
