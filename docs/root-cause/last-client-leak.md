# Last-client leak

AQA on `78a47471` (J3 warm median 2408/1961, cold 2408). Two failures of the same landing, so this is the note before any code.

As Ben, bare `/clients` still became `/clients/660f2396-c09f-437c-9659-59a3642042aa?tab=home`. That id is a client in Theo's firm `fca0f102`. The client file then said `Client not found`, which is the boot `clients` select returning no row. RLS held. The first attempt also sat on stale `1020E` content until a reload. As Lerato Fresh (test firm `AQA Fresh 1021`), `/practice` also ended on the same `660f2396`. Two accounts, one id. A key that includes only the user id cannot be the whole story.

`660f2396-c09f-437c-9659-59a3642042aa` is not in the source. Nothing in this tree returns that literal.

## What can put a client id on the URL

`/clients` (`src/routes/_authenticated/clients.index.tsx`) renders `PracticeBoard` and does not navigate. `/practice` (`src/routes/_authenticated/practice.tsx`) is the same board with `view="practice"` and does not navigate on mount. `decideSmartLanding` (`src/lib/smart-landing.ts`) returns `/dashboard` or `/dashboard?addClient=1`. It never returns `/clients/:id`. `firstFirmClientId` (`src/lib/smart-landing.server.ts`) is only the boolean "does this firm have a client" for that choice. It filters `.eq("firm_id", id)` and returns null when the firm id is blank. Its result is not a href.

The only rewrite of a client URL is in `src/routes/_authenticated/clients.$clientId.tsx`: when the path is already `/clients/$clientId` and the search has no tab, section, agent, or report, the effect replaces the search with `tab=home`. That effect does not choose the id. The id was already in the path. The `?tab=home` AQA saw is this effect, not a second lookup.

No `profiles` or membership column in `src/integrations/supabase/types.ts` or the migrations stores a last client, an active client, or a landing preference. A search for `last_client`, `active_client`, and `preferred_client` in `supabase/migrations` is empty.

Service-role reads (`supabaseAdmin` in the Xero and QuickBooks handlers, and the email routes) take a client id the caller already has. They do not pick a landing client. No landing path uses a `SECURITY DEFINER` function to choose a client across firms.

## Queries that are not firm-scoped

These use the signed-in browser client, so RLS still applies. They are the reads that can see another firm's row when the role is allowed to.

| Call | Filter |
| --- | --- |
| `PracticeBoard` client list (`src/components/practice-board.tsx`, the `readSlim` select) | Firm `or` plus this user's null-firm rows. If `isMilonItMember(userId)` is true, the `or` is skipped and the select is every client that role can read, ordered by `created_at` descending. |
| `loadCompanies()` with no id list (`src/lib/client-group-client.ts`) | `from("clients").select(...)` and no `firm_id` predicate. Used once a client file is open (`loadClientGroupNav`), not to choose `/clients`. |
| `listFirmClients` (`src/lib/firm-client-list.ts`) | Firm `or` when `firmId` is set. `owner_user_id = user` when it is not. |

`loadFirstFirmClient` and `loadFirmClientGateContext` (`src/lib/firm-client-gate.ts`) both `.eq("firm_id", id)` and return null when the firm id is blank. They are not the redirect.

A row RLS will not return cannot be the result of those selects for that user. Ben's client file said the row was missing. Lerato's file would do the same if she cannot read Theo's client. So the id was not produced by their `clients` select. It was already the path.

## Stores that are not per user

These can hold `660f2396` for whoever uses the browser next. None of them is read by the `/clients` or `/practice` page to navigate.

| Store | Key | Who reads it |
| --- | --- | --- |
| `localStorage` | `pending_invite_client_id` (`src/lib/invite-handoff.ts`) | `/app` only, as the invite workspace. Not user-scoped. |
| `sessionStorage` | `acting_as_client_id` | `/app`, and the server-function header `x-acting-as-client-id` (`src/integrations/supabase/auth-attacher.ts`). Same tab, any later account, until something removes it. |
| Cookie | Email return `next` (`src/lib/auth-url-return.ts`) | The next auth return on this browser. `pathAfterAuthReturn` sends that path to whoever completes the link. The cookie is the site, not the user. |

`milon_owner_active_client:${userId}:${firmId}` and `milon_active_firm_id:${userId}` are per user. `/clients` and `/practice` do not read the owner-client key. A second account does not see the first account's firm id through that key.

The in-memory book (`src/lib/practice-book-cache.ts`) is `${userId}:${firmId}` and dies with the page. It is not a cross-user landing id.

## Why both accounts saw this id

There is no function that loads `660f2396` for an arbitrary user. The matching explanation for two accounts is a value that lives on the browser, not on the user: the email-return `next` cookie, `pending_invite_client_id`, `acting_as_client_id`, or the browser's own history of `/clients/660f2396`. This note cannot see the storage from the AQA box, so it does not pick which of those four held the id. It does rule out a server query that both JWTs ran without a firm or user filter and then redirected. No such redirect exists.

The stale `1020E` paint is a different failure. The first document was an old bundle. A reload fetched the current one. It does not select a client.

## Why #952 and #954 missed it

#952 scoped `milon_owner_active_client` to the user and the firm, and scoped `loadFirstFirmClient` to `firm_id`. The owner home and the billing wall read those. The client list and My practice do not. Stopping that key does not stop a path that is already `/clients/660f2396`.

#954 paints the standby from the stored session and splits home chunks. It does not choose a landing id. `decideSmartLanding` still ignores `firstFirmClientId` as a destination. The unscoped invite key, the acting-as id, and the return cookie were left as they were.

## `/practice/setup` for 25s+

Not the same root. `PracticeSetupPanel` (`src/components/practice-setup-panel.tsx`) shows `Loading your practice.` in two states, and neither waits on a client id.

- `firmId` is null. The panel returns the waiting copy and does not time out. A hard reload starts again with no firm until `AccountantProfileProvider` sets one.
- `firmId` is set and `booting` is true. The effect awaits `loadSaved`, `loadDraft`, and, when there is no saved plan and no draft question, `requestTurn` (the interview server function). There is no deadline. `booting` stays true until that promise settles, so a hung interview is still `data-practice-setup-phase="loading"` after a reload.

The leaked client URL is not an input to this panel.

## Fixes, not built

1. Do not let a client id outlive the account that stored it. Scope `pending_invite_client_id` and `acting_as_client_id` by user id, and clear them on sign-out. Do not honour an email-return `next` of `/clients/:id` unless that id is in the signed-in user's firm. `/clients` and `/practice` should keep rendering the list when the path has no id.

2. Connections header. The home chip uses `homeLedgerChip`: both connection rows become `Xero and QuickBooks`. The Connections sentence is `booksAnswerSentence` of `dataFreshnessLine`. That line only includes a ledger when `syncSucceeded` is true (`lastSyncedAt` present and status not `error`). A connected Xero with no stamp is dropped, and the header stays `Connected to QuickBooks.` Name both when both connection rows exist, the same rule as the chip.

3. Cash forecast. `forecastEmpty` is `loaded && linesBlank`. `applyRow` calls `setLoaded(true)` in the same turn it may set the lines to the kept-entered subset, which is empty. The empty sentence, blank KPIs, and `cashAuditSignoffWarning` (`6 inputs not approved`) then paint, and a later fill replaces them. Keep the busy skeleton until that read and the line seed have both settled. Do not call the file empty on the first loaded commit.

   `ClientGroupChrome` returns null until `loadClientGroupNav` resolves, then inserts the Group status row. `homeSignoffLine` is empty until the sign-off read lands. Reserve a fixed height for both on the home so the cards do not jump by about 32px.

4. Portfolio insights. `buildPortfolioInsights` counts clients whose `trendDelta` is a finite number (`trendDelta30d` needs a current score and at least two stored points). `0 of 1 client with a stored trend` means one client in the loaded book has that history and the delta is not positive. It is not "0 of Ben's 5 clients". Five clients with one stored trend is the sentence the code writes. It is a count bug only if `clientRows` itself contained one client while the firm has five.
