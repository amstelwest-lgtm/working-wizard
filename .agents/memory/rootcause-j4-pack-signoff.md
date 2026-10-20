# J4 repeat — pack snapshot vs live narrative, and two sign-off readers

QA retested live score on prod @ b4833e3f (third look). `/clients`, Health → Score, and Home already agree. Three failures remained. No migration. No edge-function change: generation already stores one snapshot; the split is at display and at a second sign-off read.

## 1. The pack disagrees with itself

`packContentFromOverview` (and `buildAdvisoryPack`) write the narrative and the OVERVIEW FIGURES block from the same brief. The headline is `Overview health is 84 (Healthy).` The figures section is colon form from `overviewFactLines`: `Health: 84 (Healthy)` and `Financing: 100`.

Display then rewrites only some of that text. `AdvisoryPackPanel` fetches `liveHealthFromBooks` and passes it, plus the live cash floor and live data gaps, into `packSectionsForPdf`. That function runs, in order:

- `alignPackFloorCopy` — replaces a stored `$50,000` / `R50 000` comfort line with the live floor
- `overlayLiveHealthProse` — rewrites `Health is N`, `scores N (band)`, `Weakest: Label (N)`, and `Label (N)`
- `overlayStillNeeds` — appends current gap titles and replaces "Nothing outstanding"

`overlayLiveHealthProse` does not match colon form. So the narrative becomes "Overview Health is 83 (Healthy)" (the replacement even capitalises Health) while the figures block stays "Health: 84 (Healthy) … Financing: 100". The stale banner is a third, correct fact: `advisoryPackFiguresChanged` compares the stored snapshot with live Overview. Stale is fine. Rewriting half the card is not.

Fields that mixed live and stored: headline and section narrative (overall, band, weakest pillar, parenthetical pillar scores), comfort-floor amounts, and the "what MILŌN still needs" bullets. Colon figures, stored ratios, and the forecast block were left on the snapshot, which is why they contradicted the narrative. `packScoreProse` (pillar rename, strip `/100`) and the signed next-step sentence do not change numbers; they stay.

The PDF used the same `packSectionsForPdf` call, so the download could split the same way.

## 2. Health and the scorecard do not read one sign-off

Both surfaces are about `client_review_signoffs` (scope `financials`), not two business rules.

Health → Score loads that row once via `listClientReviewSignoffs`, decides staleness with `healthSignoffIsStale` (`reviewFiguresChanged`: newer books timestamp, live health ≠ score on file at sign-off, or a later statement period), and prints it with `SignoffStatusChip`: "Financials: signed off by {name} · {date}" or "Financials: signed off · figures changed".

The Scorecard is an embedded `ReportsStudio`. On mount it clears `clientData` and runs `loadClientReportData`, which selects `client_review_signoffs` again in the browser. Until that returns, the card's `signoff` is null. `ReviewSignoffButton` prints "Draft" and "Sign off health & ratios" only when the row is missing. `client_deliverable_states` is consulted only in that missing-row branch (`getDeliverableWorkflow`, default draft). A present row that is stale is "Re-sign off", not Draft. QA's Draft button means the studio's row was null, not that staleness was calculated differently.

`isSignoffStale` also returned true for a null row, so "missing" and "figures changed" were the same boolean. The PDF stamp (`signoffStampFor` → `stampFromSignoff`) used only the studio row, so a missed read watermarked DRAFT while Health showed the stamp.

## 3. Preview stays on Loading…

The scorecard Preview label is `dataLoading ? "Loading…" : "Preview"`. The embedded primary button uses the same `dataLoading` flag. `loadClientReportData` awaited, after the client row, a firm lookup, then sector benchmarks, then budget actuals, then budget and cash `client_deliverable_states`. The scorecard PDF uses none of those three. The shell auth gate is 8s, so a scorecard-only embed sat on Loading… past 7s while work for other reports finished. The card also showed Draft for that whole window because the known Health row was ignored.

## Why #660 and the earlier live-score work missed this

`quoteLiveScoreOnly` rewrites Home, notes, drafts, and handoffs so those surfaces quote the live score. That is still correct, and those numbers already agree. `overlayLiveHealthProse` was the pack-body twin, and `scripts/live-health-single-source-test.mts` required the pack narrative to quote the live overall and the live pillar scores. It never asserted that the colon figures block stayed paired with that narrative. The sign-off stamp and the scorecard loader were outside that change.

## Fix

- Render every pack section from the stored snapshot. Stop passing live health, live floor, and live gaps into the panel and the PDF. Keep the stale banner, and put `as generated on <date>` (`formatReviewDateTime` of `generated_at`) on that banner.
- One presenter, `presentPageSignoff`, for the Health chip and the scorecard certificate, including "Financials: signed off · figures changed".
- The client page passes its already loaded `client_review_signoffs` rows and the same stale booleans into the studio card and the PDF stamp. A null row is unsigned, not stale. Budget staleness still comes from the signed figure snapshot once that report's data is loaded.
- `reportFetchPlan`: a scorecard-only embed skips benchmarks, budget actuals, and the cash workflow, and the remaining lookups run together.

## Verification

`scripts/j4-pack-signoff-test.mts` (`pnpm test:j4-pack-signoff`): stored 84 / Financing 100 survive a live 83 quote; floor and gap copy stay stored; the generated-on label; Health and scorecard sentences match for a clean stamp and for figures-changed; a known row wins over a null studio read; `reportFetchPlan(["scorecard"])` skips the extra fetches. `live-health-single-source` now requires the pack body to keep its stored scores. `aqa-followup` now requires "Nothing outstanding" to stay stored.

## Other side

Owner Next moves uses the same `AdvisoryPackPanel`, so the stored snapshot and the generated-on label apply there. Owner Health already uses the same financials row and `healthSignoffIsStale` (`OwnerSignoffMark` keeps its own shorter wording). The owner app has no Scorecard Preview, so there is no second owner scorecard to wire.
