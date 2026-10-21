# Analyst narrative still quotes the old pillar scores

Third QA fail of #680 on accountant client AQA Gate Throwaway 1020B (`7b111d2a-2339-4722-9596-13225801ec8f`). Prod main is `299a7d88`. Read-only. No code change in this note.

The Analyst card says: "Profit is the weakest pillar at 58, against an overall health score of 75. Assets scores 83, Financing 81 and Cash 78, so Profit pulls the overall score down." The same page's score card is Health 63 Watch, Cash 34 Critical, Profit 75, Assets 63, Financing 81, and the card line is "Sep figures · checked Oct 20". The client header pill says "Oct 2026".

The `/clients` list shows "—" for health, runway, queries, and op. profit on the rows QA looked at, including 1020B.

## (a) Which row the narrative quotes, and which row the page scores

The narrative is one stored finding. It is not recomputed when the card renders.

| | Narrative | Page score card |
| --- | --- | --- |
| Table | `agent_findings` | `clients.financials` scored by `liveHealthFromBooks`, plus `client_score_history` |
| Id | `0fb3a96d-a921-4563-bcfa-4d37c5465099` | History row `1e32fbaf-7c9d-428d-be81-764c2d0d72f5`. Books are the client row, not a second score table. |
| Run | `bdb0bb8e-0779-4f37-a242-2e4a5927c0e1` | Not a run. The history row is the page's upsert. |
| created_at | `2026-10-20 13:34:11.50198+00` | History `created_at` `2026-10-20 13:23:13.741685+00`. That column is not updated on later upserts. |
| Period | `evidence.period_label` = `Jan 1 – Sep 30, 2026`. `evidence.snapshot_id` = `89ff9abf-db98-4e19-8e72-b8c844d36041` | Same span. `figuresPeriodLabelFrom` on the current books returns `Jan 1 – Sep 30, 2026`. Snapshot period is `Sep 2026` / `period_date` `2026-09-30`, created `2026-10-20 13:23:11.753549+00`, source `pdf_upload`. |
| Numbers | Title plus detail, and `evidence.metrics`: Profit 58, overall 75, Assets 83, Financing 81, Cash 78. `evidence.figures` has `overall` 75, `live_overall` 75, `stored_score` 75, `pillar:profit` 58, `pillar:assets` 83, `pillar:financing` 81, `pillar:cash` 78. | Current `liveHealthFromBooks` on these books: overall 63 Watch, Profit 75, Assets 63, Financing 81, Cash 34 Critical. Weakest is Cash. History `score` is now `63`. |

The money on the client and on snapshot `89ff9abf` is the same (revenue 182000, ebit 52000, cash 46300, and the rest of the statement). The only key differences are `_writeRev`, an empty `productMix`, and empty `weeklyInputs`, written when `clients.financials_updated_at` moved to `2026-10-20 17:25:16.22+00`. That resave did not change a figure the score uses.

`evidence` has `status`, `figures`, `metrics`, `snapshot_id`, `period_label`. It has no `score_snapshot` and no `score_snapshot_hash`.

The card does not prefer an older finding. This is the only Analyst finding on the client. `superseded_by` is null. There is no later Analyst run. Runs on this client: financial manager `08f9aeef` at 13:26, analyst `bdb0bb8e` at 13:34, financial manager `54932e1c` at 13:35, advisor `d6967d5a` at 17:13, financial manager `c8cae4e2` at 17:14. The advisor finding `01e8d598-17bd-409c-b90b-471d645c0236` (created `2026-10-20 17:13:38`) repeats "weakest pillar at 58" and overall 75. Same frozen numbers, still not superseded.

## (b) Which edge wrote it

`agent_runs.trace` for `bdb0bb8e` is a tool list. It has no function version. `get_health` returned `overall` 75, pillars Profit 58, Assets 83, Financing 81, Cash 78, weakest Profit 58, `health_label` Watch. `get_ratios` in the same trace names snapshot `89ff9abf`, period `Jan 1 – Sep 30, 2026`, `period_date` `2026-09-30`. The model then called `record_finding`. The run summary is that sentence. Status `succeeded`, trigger `upload`, queued `2026-10-20 13:34:04.168638+00`, finished `2026-10-20 13:34:14.32+00`.

The edge that is deployed now is `agent-analyst` version 40, `updated_at` `2026-10-20T22:44:19.364Z`. That is nine hours after this run. v40's `recordFinding` calls `loadHealthScoreSnapshot` and stores `score_snapshot` / `score_snapshot_hash`. This row has neither, so it was not written by v40. The version that was live at 13:34 is not on the run row. v40 is not what QA is still displaying. The display reads the old row.

`get_health` did not read `client_score_history` as the sentence. The trace payload is a recomputed tool result. The finding then copied that result into `figures` and `metrics`, including `stored_score` 75 and `live_overall` 75. The history row's `created_at` stays on the first insert (`recordScoreHistory` upserts `score` on `(client_id, period_date)` and does not set `created_at`). The 63 now on `1e32fbaf` was written by a later upsert. At 13:34 the edge's own payload said both live and stored were 75.

## (c) The stored finding is reused

Nothing regenerated it. No later Analyst run, `superseded_by` is null, and the desk renders `row.title` and `row.detail` through `findingSentence`. The sentence on screen is that stored text, including the gross-margin clause the model wrote.

## (d) Why the stale banner and the re-render did not fire

`findingSentence` in `src/lib/milon-team-activity.ts` does this before `presentHealthNarrative`:

```
figuresMovedAfterDraft(writtenAt, figuresUpdatedAt) === false
  ? stored sentence
  : presentHealthNarrative(...)
```

`figuresMovedAfterDraft` compares two clocks. It returns false when the figures clock is not later than the draft clock. It does not compare a score hash.

On the accountant desk the clocks are:

- `writtenAt` = finding `created_at` `2026-10-20T13:34:11.501Z`
- `figuresUpdatedAt` = `latestFiguresStamp` of snapshot and artifact rows (`use-milon-team-feed.ts`). The only snapshot is `pdf_upload` `89ff9abf` at `2026-10-20T13:23:11.753Z`. Autosaves are ignored. `clients.financials_updated_at` (`17:25:16`) is not this clock. `diagnosisFromWorkspace` is also called with `financialsUpdatedAt: null`.

13:23 is not after 13:34, so the function returns false and the stored sentence is returned. `presentHealthNarrative` is not called. `healthSnapshotHash` is not built. `healthSnapshotsDiffer` is not run. The regenerate button in `HealthNarrativeLine` only appears when the text is exactly "Figures changed since this was written, regenerate", which this path never produces.

The key that "matched" is that pair of clocks, not a score hash. The upload is older than the finding, so the code treats the finding as already written against the current books.

What a hash compare would have seen, on the snapshot the page actually renders:

`o:63|w:cash:34|p:assets:63,cash:34,financing:81,profit:75|d:jan 1 – sep 30, 2026`

The finding has no `score_snapshot_hash` to compare. Its metrics hash would be overall 75, weakest Profit 58, pillars 58/83/81/78, same period. Those are not equal.

Calling `presentHealthNarrative` on this paragraph does not substitute the numbers either. `isTemplateHealthSentence` is false. After the known templates are removed, "Gross margin", "net margin", "books", "pricing", and "lever" remain. `healthClaimsDisagree` is true (Profit 58 vs Cash 34, overall 75 vs 63, Assets 83 vs 63, Cash 78 vs 34, and "Profit pulls the score down"). The function would return the regenerate marker, not a rewritten paragraph. QA saw the old paragraph, which is the clock skip, not a hash that happened to match.

`#680` (`13a72c3f`, merged `2026-10-20 20:23:39 +0200`) added `presentHealthNarrative` and taught new writes to store `score_snapshot`. This finding was already saved at 13:34, before that merge and before v40. `ed177ea6` (`2026-10-20 22:24:25 +0000`, "stop false stale drafts") then added the clock skip in `findingSentence` and the same skip in `presentLiveDraft`. A draft newer than the last upload is shown as stored, even when the live score card has moved. Scoring changed after the run (`57f79cb6` at `2026-10-20 14:16 UTC` on `health-score.ts`, then `#692` at `2026-10-20 22:43 UTC`). Current `liveHealthFromBooks` on these unchanged figures is the page's 63 / Cash 34. The skip never looks at that.

## Header pill vs "Sep figures"

Two different readers.

The card line is `figuresCheckedLine` (`src/lib/milon-team-activity.ts`). The period is `feed.healthQuote.periodLabel`, which is `Jan 1 – Sep 30, 2026`. `badgeMonthFromPeriod` keeps the last month, Sep. The "checked" day is the finding `created_at`, 20 Oct 2026. That part is the statement period.

The client header pill is `PeriodPill` in `src/components/chrome-icons.tsx`, rendered from `src/routes/_authenticated/clients.$clientId.tsx`. It is `formatMonthYear(new Date(), market.timezone)`. On 21 Oct 2026 that is "Oct 2026". It does not read `periodEnd`, the snapshot, or the finding. `#680` did not change this pill.

## Issue 2 — the `/clients` dashes

`src/lib/missing-metrics.ts` (`renderedMetricMissing`, added by `#689`, merge `299a7d88`) is not on this table. `#692`'s `healthDayRowPresentation` in `src/lib/health-metric-row.ts` is not on it either. Both dash a null day metric on reports and Health rows. The list does not call them. This is not that shared renderer. Those files stay Eng2's.

The list is `PracticeBoard` in `src/components/practice-board.tsx` (`/clients` → `view="clients"`). It paints a shell, then merges books:

1. The first select omits `financials` and `cashflow`. `lightClientRow` sets `score` null, health unscored, `openQueries` 0, and runway from `cash_runway_weeks`. `setLoading(false)` runs before the merge. `practiceClientsPhase` (`src/lib/bounded-load.ts`) treats a timeout as ready whenever `rowCount > 0`, so a shell with rows looks like a finished table. `rememberPaintedBook` stores that shell.

2. The follow-up select `id, financials, cashflow` is what fills health and op. profit. `toClientRow` then calls `liveHealthFromBooks`.

On a shell, or if that merge does not replace the rows, every cell below is "—":

- Health. `{score ?? "—"}`. `score` is `health.overall ?? latestStoredScore(history)`. The shell never reads history. `latestStoredScore` keeps a value only when `typeof score === "number"`. A PostgREST `numeric` string `"63"` is dropped. 1020B's history score is `63`, and the live engine on the books is also 63, so a merged row shows 63. A dash means the shell is what rendered.
- Op. profit. `opMarginStr` returns "—" when `financials` is null. With 1020B's books (`ebit` 52000, `revenue` 182000, US market) `operatingProfitLabel` is `28.6% · $52.0k`. A dash on this client is the same missing `financials`, not a renamed ebit field. The column is `financials.ebit` / `financials.revenue`. Both are present as strings and `parseFloat` accepts them.
- Runway. `clientListRunwayCell` in `src/lib/cash-forecast-parity.ts` returns "—" unless `weeks` is a finite number. `Number.isFinite("13")` is false, so a numeric string from `cash_runway_weeks` is a dash even on the shell. `toClientRow` then replaces `cash_runway_weeks` with `persistedRunwayWeeks`, which is null unless the forecast kind is `weeks` or `zero`. 1020B's `cash_runway_weeks` is null and the cashflow is an opening of `"46300"` with empty lines, so the cell stays "—" after a good merge too. Yankees (`e9dc0c5a-e5ff-47f0-b425-a6df0f8dd910`) is the one firm row with `cash_runway_weeks` 13. That stored 13 is not what the cell shows once the forecast kind is not `weeks`.
- Queries. `openQueries > 0 ? count : "—"`. Zero is a dash on purpose in this cell. 1020B has 0 unresolved `client_notes`. The firm's one open note is on QA US Test LLC (`3cc31b6a-10a6-4202-bec7-ebb32a4e1f7a`). On the shell every row is 0, so every queries cell is "—".

Firm `e8f7a440-a541-422c-8e4f-82ba33dd0604` has five clients. All five have `ebit`. Latest history scores: 1020C 72, 1020B 63, QA US Test LLC 69, QA Test Co 84, Yankees 71. The dashes are not empty books.

`#688` edits `practice-board.tsx` for the empty-book button and cobalt. It does not change these four expressions. `#695`, `#700`, and `#703` do not touch `practice-board.tsx`, `cash-forecast-parity.ts`, `operating-profit-display.ts`, or `missing-metrics.ts`. `#689` and `#692` change report and Health-row rendering, not this list. The list regression is the shell being shown as the finished table, plus `latestStoredScore` and `clientListRunwayCell` dropping non-numbers, plus the queries cell painting 0 as "—".

## Why `#680` missed it

`#680` re-renders a pure template from the live snapshot, and stamps `score_snapshot` on new writes. This paragraph is not a pure template, this row was written before that stamp existed, and `ed177ea6` skips both the re-render and the regenerate marker when the finding is newer than the last upload. The page score moved. The upload clock did not. The header pill was never part of `#680`.

## Fix

One snapshot, the one `liveHealthFromBooks` just produced for the score card (`feed.healthQuote` on the desk, the same object on the owner door). `findingSentence` is the shared reader for the accountant desk (`src/components/milon-team/milon-team-desk.tsx`) and the owner door (`sentenceFor` in `src/lib/owner-presence.ts`). `presentLiveDraft` has the same clock skip for drafts.

Do not return the stored sentence when `figuresMovedAfterDraft` is false. If the sentence names an overall, a pillar, or a weakest pillar that is not that snapshot, or a stored `score_snapshot_hash` differs from `healthSnapshotHash` of that snapshot, do not show the stored sentence. Render `renderHealthNarrative(snapshot)` so every pillar number is the card's number, or show the regenerate marker and nothing else. Absence of `score_snapshot` on old rows must not count as a match. The upload `created_at` is not the key.

Same change on both sides because both call `findingSentence`. No second path for the accountant.

For the list, in `practice-board.tsx`: do not treat the shell as the finished book. Until the books query has merged, keep health and op. profit out of the "—" that means "no ebit". `latestStoredScore` and `clientListRunwayCell` must accept a numeric string. The queries cell should print 0 when the count is 0. That list change is not in `missing-metrics.ts`.

The header pill should use the statement period's end month (`badgeMonthFromPeriod` / `figuresPeriodLabelFrom`), the same month as "Sep figures", not `formatMonthYear(new Date())`.

## Test

Fixture is this production pair. Live snapshot overall 63, Profit 75, Assets 63, Financing 81, Cash 34, period `Jan 1 – Sep 30, 2026`. Stored finding title and detail as on `0fb3a96d`, `created_at` after the `pdf_upload` snapshot, `figuresUpdatedAt` equal to that snapshot's `created_at`, no `score_snapshot`.

`findingSentence` called the way the accountant desk calls it, and `sentenceFor` called the way the owner door calls it, must not contain 58, 83, or 78, must not say Profit is weakest, and must not say the overall is 75. The text is either the regenerate marker or the snapshot sentence whose numbers equal the score card for that same period: 63, Cash 34, Profit 75, Assets 63, Financing 81. A second assertion feeds `presentLiveDraft` the advisor title on `01e8d598` with the same clocks and the same snapshot.

A list fixture with history score `"63"` (string), `cash_runway_weeks` `"13"` (string), `openQueries` 0, and 1020B's `financials` asserts the health cell is 63, the runway cell is not "—" for the string 13, the queries cell is 0, and op. profit is the `28.6%` label. A shell row that has not merged books must not be asserted as a successful empty score.

The header pill for these books is Sep 2026, not the calendar month of the test run.

## Measured on the books

`liveHealthFromBooks` and `scorecardHealthFromFinancials` were run on these figures after the note. `57f79cb6`, `#692` (`bceba040` and merge `1e80002d`), main at the run (`a1f316c9`, 13:28 UTC), and current main all return overall 63, Profit 75, Assets 63, Financing 81, Cash 34. `#692` does not move Cash here. Debtor Days 59 scores 34, Creditor Days 89 scores 52, Working Capital Days 76 scores 16, and OCF / EBITDA is missing so it is left unscored. The average is 34, not the forecast floor of 25.

The 78 is the deployed `get_health` payload. Its day counts were Debtor 26, Creditor 40, Inventory 47, Working Capital 33. Those are what these stocks produce if the cover is treated as 4 months, and the same `scoreRatio` then returns Cash 78, Profit 58, Assets 83, Financing 81, overall 75. The page uses the stored 9-month cover, and 63 / Cash 34 is the score that cover produces.

## Addendum — AQA retest of #710 at `023c3572` (second fail)

Retest was partial on non-Ben firms. Prod read was read-only on `jxclnsbsqpixxqlbcapl` after `#710` had merged (`f048bfda`, head `ab860b1f`). No code change in this addendum.

### 1. Owner pill first paint

Cause. `/app?tab=health` paints the boot `OwnerShell` in `src/routes/app.tsx` while `ownerBoardReady` is still false. That shell is the only owner header that also renders `PanelSkeleton` ("Loading panel…"). The business name is `ownerWorkspaces` or the fallback "Your business". `#710` passed `booksPeriodPillLabel(v.periodEnd, statementSpan)` into that shell. On the first paint the books are not hydrated, so `v.periodEnd` is empty, the helper returns null, and `PeriodPill` in `src/components/chrome-icons.tsx` substitutes `formatMonthYear(new Date())`. On 21 Oct 2026 that is "Oct 2026". After hydration the ready `OwnerDoor` passes the real period end and the pill becomes "Sep 2026".

There is no second owner header. `isLegacyOwnerBoardTab` does not include `health`, so this URL does take the boot shell. `src/components/owner-door/owner-door.tsx` is the post-ready shell and already passes the books' period. `src/components/accountant-nav.tsx` has no pill. The accountant client header in `src/routes/_authenticated/clients.$clientId.tsx` passes `booksPeriodPillLabel` and AQA saw "Sep 2026" on first load. `settings-shell.tsx` and `practice-board.tsx` use a bare `PeriodPill` for the calendar month. They are not this screen.

Files. `src/routes/app.tsx` (boot `OwnerShell`), `src/components/owner-door/owner-shell.tsx` (`PeriodPill`), `src/components/chrome-icons.tsx` (`PeriodPill` calendar fallback), `src/lib/statement-period.ts` (`booksPeriodPillLabel`).

Why the tests missed it. `booksPeriodPillLabel("2026-09-30", …)` was asserted to be "Sep 2026", and the boot shell was edited to call that helper. Nothing rendered the shell with an empty `periodEnd`, so the calendar fallback never ran in the test.

Verification. With books not yet known, the owner pill must be a neutral skeleton and must not be the calendar month. Once `periodEnd` is `2026-09-30`, the same pill is "Sep 2026" on the first paint that has the books.

### 2. False stale when the cited scores match

Cause. `reconcileStoredHealthNarrative` in `src/lib/health-snapshot.ts` treats any `score_snapshot_hash` as the whole comparison. `healthSnapshotHash` is `e:<SCORE_ENGINE_VERSION>|o:…|w:…|p:…|d:…`. A mismatch, including a missing `e:2|` prefix or a different period string, returns the regenerate line and never looks at the numbers the sentence cites. A row with no hash is compared with `healthSnapshotsDiffer`, which also requires the period strings to match. A legacy row that cites no scores is not what marked these clients stale. These rows have hashes. The hashes disagree with the live hash while the cited scores do not.

Prod rows, all `superseded_by` null, all on their own `client_id`:

| Client | Finding | Hash stored on the row | Cited scores |
| --- | --- | --- | --- |
| AQA J2 US 1020E `353f1dbf-a7ba-4092-878d-792223ba3536` | analyst `9159f87e-62cb-43b6-985e-eb45e6881522`, run `cc9c3492-11e1-42c3-836f-d617a65769a3`, created `2026-10-20 21:53:09` | `o:75\|w:profit:58\|p:assets:83,cash:78,financing:81,profit:58\|d:jan 1 – sep 30, 2026` | Profit 58, overall 75, Assets 83, Financing 81, Cash 78 |
| AQA J2 ZA 1020F `24844299-1aec-449c-ab45-66ca1b97c3ef` | analyst `8fcaf238-92c7-42d5-ac94-37642379f9c0`, run `1cd9be2f-30ca-470c-bb17-f9509a4a2d32`, created `2026-10-20 21:59:12` | `o:75\|w:profit:58\|p:assets:83,cash:78,financing:81,profit:58\|d:1 jan – 30 sep 2026` | same scores, ZA period wording |
| Owner draft AQA called 1020D. The client row is AQA Throwaway ClR `24149d9c-4e27-4fc2-9b98-1a92767e3bc3` | analyst `af6db887-9d44-41aa-a5a8-a540ac40b762`, run not re-copied here, created `2026-10-20 20:54:11` | `o:72\|w:profit:58\|p:financing:86,profit:58\|d:jan 1 – sep 30, 2026` | overall 72, Profit 58 |

The live hash always starts with `e:2|`. The 1020E period token is already `jan 1 – sep 30, 2026`, so the only difference on that row is the engine prefix. 1020F's period token is the ZA wording `1 jan – 30 sep 2026`, which is a second field beyond the scores. The owner hash also omits Assets and Cash, so a four-pillar live hash differs even when 72 and Profit 58 match. `findingSentence` and `presentLiveDraft` both call this function, so the owner draft and the accountant findings take the same path.

Files. `src/lib/health-snapshot.ts` (`healthSnapshotHash`, `reconcileStoredHealthNarrative`, `healthSnapshotsDiffer`). Callers: `src/lib/milon-team-activity.ts` (`findingSentence`), `src/lib/draft-figures.ts` (`presentLiveDraft`), `src/lib/owner-presence.ts`.

Why the tests missed it. The `#710` engine-bump test built the live hash and replaced `e:2|` with `e:1|`, then asserted that the regenerate line appears. That locked in "prefix differs, so stale" for a sentence whose scores still match. The 1020B fixture cites 75 / Profit 58 against a live card of 63 / Cash 34, so it goes stale for the right reason and never asserts the matching case. No fixture used a pre-`#710` hash of the form `o:75|w:profit:58|…` with a sentence that cites those same numbers.

Verification. A stored sentence whose cited overall and pillar scores equal the live snapshot stays, with or without `score_snapshot_hash`, and with or without the `e:` prefix. A sentence that cites a different overall or pillar score becomes the regenerate line. A legacy row that cites no score is not stale just because the hash is missing.

### 3. 1020E / 1020F versus 1020B's old 75 / Cash 78

Not a cross-client read. 1020E and 1020F are different books from 1020B, and each finding's `client_id` is that client's own id.

| | 1020B | 1020E and 1020F |
| --- | --- | --- |
| Revenue / cogs / net | 182000 / 76000 / 37000 | 412000 / 171000 / 38200 |
| Cash, payables, inventory, equity | 46300, 24700, 29400, 100700 | same stocks |
| `periodMonths` / `periodEnd` | 9 / 2026-09-30 | 9 / 2026-09-30 |
| Live score the page should show | 63 / Cash 34 | 75 / Profit 58 / Cash 78 |

1020E's 9-month cover on 412000 of revenue produces Debtor Days about 26 (`38900 / (412000 × 12/9) × 365`). Gross margin `(412000 − 171000) / 412000` is 58.5%, operating margin `52000 / 412000` is 12.6%, net margin `38200 / 412000` is 9.3%. Those are the same ratios the old edge reported for 1020B, where a 4-month cover of 182000 (`182000 × 12/4 = 546000`, against `412000 × 12/9 = 549333`) landed on the same day counts and the same margins. 1020B's page is still the 9-month score, 63 / Cash 34. 1020E and 1020F really do score 75 / Cash 78. The sentences match their own books.

Reads. Accountant feed `src/hooks/use-milon-team-feed.ts` and owner door `src/components/owner-door/owner-door.tsx` both query `agent_findings` with `.eq("client_id", id)`. `ownerPresence` then picks `latestFinding` by `agent` and `created_at` only. It does not look at `client_id` again. A list that already mixed two clients would render the other client's sentence. The production rows above are not mixed. `run_id` is stored on the finding and is not the read key.

Verification. `ownerPresence` for client A, given a finding for A and a newer finding for B, renders A's sentence and does not render B's.

### 4. "Couldn't open your workspace"

That heading is only in `src/routes/app.tsx`. It renders when `ownerBoardReady` has stayed false for `SHELL_GATE_TIMEOUT_MS` (8 seconds, `src/lib/shell-gate.ts`). The body says the books did not finish loading. `#710` did not change this deadline.

It is not the billing gate. `src/routes/_authenticated.gate.tsx` uses the same 8 second constant and records `noteFailure("timeout")`. It does not render this heading. `stripe-entitlement.ts` and `firm-client-cap.server.ts` do not contain this copy. Those three files stay untouched. The flake is the owner boot deadline in Eng1 code: one reload did not hydrate before 8 seconds, the next did. This note does not change that timer.
