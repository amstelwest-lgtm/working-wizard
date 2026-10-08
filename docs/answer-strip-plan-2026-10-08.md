# Answer-strip plan — 8 Oct 2026

Apply the Cash and Budget pattern to every accountant client tab. One answer sentence, one source chip, one status, one primary action (or Sign off). Configure-inputs accordions, scenario studios, and the Simplified/Complex control move into one closed **Review inputs** drawer. No new maths, no finance changes, no RLS, no migrations. Do not edit Eng1 files listed in `docs/ia-map-2026-10-08.md`.

The strip can land on today’s panes before the rail collapse. The IA PR only moves those panes under Bot / Overview / Deliverables.

## Shared status — reuse, do not build

`cursor/signoff-parity-sweep` (another agent) owns the one status component and the four strings:

- Draft
- Ready for review
- Signed off by X · date
- Signed off by X · figures changed since

As of this read that branch is not on `origin`. Tab PRs import its export. They do not add a second chip and they do not keep a local formatter.

Closest strings already on main, for that PR to absorb, not for tab PRs to copy:

- `budgetReviewLine` in `src/lib/budget-pdf.ts` (Draft, Ready for review, signed line, stale)
- `inAppAccountantSignoffLine` in `src/lib/review-signoff-stamp.ts`
- The paragraph inside `ReviewSignoffButton` in `src/components/review-signoff.tsx` (“Draft”, “Ready for review”, “Not signed off”, “Needs re-review”, “Reviewed & signed off”)

`ReviewSignoffButton` stays the Sign off control. The status line moves to the shared component so the button’s small “Draft / Ready for review” line is not a second status.

Scopes that already exist (`src/lib/review-signoffs.functions.ts`): `financials`, `profitability`, `cash_forecast`, `budget`, `action_plan`, `advisory`. Collections, payables, books, moves, and Bot get no new scope.

Primary rule: one gold control. If the viewer can sign and status is Draft or Ready for review, the primary is Sign off. If they can submit and not sign, the primary is Submit for review (already in the button). Sections with no scope use the existing next action instead.

Cash and Budget are shared with the owner board (`src/routes/app.tsx`). A strip change in those components shows there too. Do not collapse the owner tab strip.

## Pattern to copy

Cash (`src/components/cash-forecast.tsx`, sentence from `forecastStatusSentence` in `src/lib/cash-forecast-parity.ts`): sentence under the tiles, source chip on the stats (`forecastLinesSourceLabel` / `openingSourceLabel`), a Review tile that says “Not signed off” / “Stale” / “Signed off”, Sign off in the tab head (`clients.$clientId.tsx` pane-cash). Inputs and Scenario Studio are `CollapsibleGoldCard`s below the chart.

Budget (`src/components/budget/budget-verdict.tsx` `BudgetVerdictStrip`, fed by `budgetVersusStatement` and `budgetActualsBadge` in `src/lib/budget.bridges.ts`): one sentence (revenue and profit vs plan, or “Budget seeded from these figures…”), one chip, one status string passed in as `reviewStatus` (“Not signed off” / “Sign-off stale” / “Signed off” from `src/components/budget/budget-panel.tsx`). Sign off is in the tab head. Simplified/Complex is a page-level control, not inside the verdict.

## Per tab

### Overview (pane-overview in `clients.$clientId.tsx`)

- **Today.** Sentence is split across `ClientBriefing` (`whatMatters`, `healthHeadline`, `describeBusiness` in `src/lib/client-briefing.ts`) and `NextStepCard` (`src/lib/next-step.ts`). No source chip. No sign-off on the briefing. Primary is the next-step CTA. No Configure-inputs. Extras: data-requests panel, deliverables `<details>`, “Audited” on the crumb.
- **Sentence.** `whatMatters`. If it returns null, `healthHeadline`.
- **Chip.** `figureSourcePhrase` in `src/lib/ledger-link-copy.ts` from the statement source already on the file.
- **Status.** Shared component, scope `financials` (the score’s existing sign-off). Not a new scope.
- **Primary.** The next-step CTA. Hide Sign off here; it lives on Health.
- **Drawer.** Nothing from this pane except the deliverables export `<details>` (Generate report, Export PDF, Email draft, WhatsApp).
- **Rewrite.** Crumb “Audited”. “client management” anywhere it appears on this pane.

### Health & Ratios (pane-ratios)

- **Today.** Lede in `DeliverableTabHead`. Caption from `computeOverviewCaption` (`src/lib/overview-insights.ts`) inside `SphereHero`. Sign off scope `financials`. `DeliverableInputConfig` id `ratios`. Financials collapse (`#finCollapse`) edits the same figures. Period “Figures cover”. Connect cards (QBO, Xero, Sage). No Simplified/Complex (comment in the route: Health is one view).
- **Sentence.** `computeOverviewCaption`. If it returns nothing, `healthHeadline`.
- **Chip.** `figureSourcePhrase`.
- **Status.** Shared component, scope `financials`. Drop the duplicate wording on the certificate once the sweep component is the only status.
- **Primary.** Sign off.
- **Drawer.** `DeliverableInputConfig` ratios; the Financials collapse (period, fields, debt schedule, save snapshot, draft-from-banks, upload). Connect cards stay out of the drawer when there is no source — that is the primary path, not an input.
- **Rewrite.** “every ratio recalculates live”. Title tooltip on “Figures cover” (“scaled to a 12-month equivalent”). “Auto-saved” can stay as a save confirmation, not as the status. “Pillars” / “Where it hurts” as the only heading is fine; do not add “orb”.

### Pillars (`focus=pillars`, same pane)

- **Sentence.** Same caption. No second score.
- **Chip / status.** Same as Health (one `financials` sign-off).
- **Drawer.** Same drawer. Pillar cards stay on the page.

### Profitability (pane-profit)

- **Today.** Lede “Review the waterfall…”. Sign off scope `profitability`. `DeliverableInputConfig` id `profit`. `ProductMixPanel`. `ProfitabilityWaterfall` subtitle in `src/components/profitability-waterfall.tsx` (“How {currency}1 of revenue becomes profit” plus `sourceBit`: QuickBooks, Xero, “the ledger”, “aggregated weekly data”, “period inputs”). Second collapse “Profitability inputs”.
- **Sentence.** That existing subtitle line. Do not add a bridge sentence. `periodProfitBridge` stays the numbers source it already is.
- **Chip.** Map the existing `statementSource` through `figureSourcePhrase`. One chip. The words “aggregated weekly data”, “period inputs”, and “the ledger” leave the subtitle.
- **Status.** Shared component, scope `profitability`.
- **Primary.** Sign off.
- **Drawer.** Configure inputs, Product mix questions, Profitability inputs collapse.
- **Rewrite.** “How revenue converts to profit — step by step.” “client management” in the inputs hint. “Full financials”. “Month to date” can stay if it is the period, not a mode name.

### Cash (pane-cash + `src/components/cash-forecast.tsx`)

- **Today.** `forecastStatusSentence`. Two chips possible (opening via `openingSourceLabel`, lines via `forecastLinesSourceLabel`). Review tile status “Not signed off” / “Stale” / “Signed off”. Sign off in the route head and inside the panel (`hideInlineSignOff` on the accountant pane). Cards: “Inputs”, “Scenario Studio”.
- **Sentence.** `forecastStatusSentence`. Unchanged.
- **Chip.** `forecastLinesSourceLabel` only. Opening source moves into the drawer.
- **Status.** Shared component, scope `cash_forecast`. Remove the Review tile’s status words so there is one status.
- **Primary.** Sign off. “Upload bank statements” stays a secondary control.
- **Drawer.** Inputs card, Scenario Studio (sliders are not saved; copy already says so), `DeliverableInputConfig` if the cash checklist is rendered from `src/lib/deliverable-input-config.ts` id `cash`.
- **Rewrite.** Eyebrow “Signature view”. “Only collection delay and weekly growth change the 13-week maths. Other rows are noted, not applied.” “Scenario Studio” / “Stress-test the forecast”. “Not signed off”, “Stale”, “Inputs changed after sign-off”.

### Collections (`src/components/collections-panel.tsx`, `src/lib/collections.ts`)

- **Today.** Tab lede is a paragraph. Panel lead is `collectionsStatementLead` (a paragraph naming Days AR / Days AP / DSO) or `collectionsNoFiguresLead`. Chip-like source from `sourceLabel` when a snapshot exists. Proof line `agedArProofLine`. No `DeliverableInputConfig`. No sign-off scope. CTAs: upload aged report, connect Xero, connect QuickBooks, open drafts, open actions.
- **Sentence.** `agedArProofLine` when a snapshot exists. Otherwise `collectionsNoFiguresLead` (already one sentence). Do not recompute days.
- **Chip.** `sourceLabel` when the snapshot has a source. When the page is statement totals only, chip is Statement (same word as the cash chip vocabulary, not a new calculator).
- **Status.** Shared component with Draft. No Signed off until a scope exists, and this plan does not add one. Ready for review is not used here.
- **Primary.** Upload aged report when no snapshot; otherwise the existing chase action (open the list). One of those, not both as gold.
- **Drawer.** The long `collectionsStatementLead` paragraph, as the explanation of the statement totals. No scenario studio.
- **Rewrite.** The tab lede. `collectionsStatementLead` (Days AR, Days AP, “Ratios” as a product name, DSO). `COLLECTIONS_UPLOAD_CTA` “Upload aged debtors and creditors” is acceptable if it stays the button, not the sentence.

### Payables (`src/components/payables-panel.tsx`, `src/lib/payables.ts`)

- **Today.** Mirror of collections. `payablesStatementLead`, `payablesNoFiguresLead`, `agedApProofLine`, `payablesSourceLabel`. `runwayParagraph` and `buildPayablesDraft` are the draft body, not the strip. `XERO_AGED_AP_RECONNECT` names OAuth scopes.
- **Sentence.** `agedApProofLine` when a snapshot exists. Otherwise `payablesNoFiguresLead`.
- **Chip.** `payablesSourceLabel`, or Statement when only statement totals are showing.
- **Status.** Draft via the shared component. No new scope.
- **Primary.** Upload aged report, or the existing pay / delay / renegotiate list once names exist.
- **Drawer.** `payablesStatementLead`.
- **Rewrite.** Tab lede. `payablesStatementLead`. `XERO_AGED_AP_RECONNECT` (“accounting.reports.aged.read”, “accounting.contacts.read”) — say reconnect Xero and grant the aged-payables access, without scope ids. `PAYABLES_TITLE` can stay if it is the one sentence; do not show it and the proof line together.

### Budget (pane-budget, `budget-panel.tsx`, `budget-workspace.tsx`, `budget-verdict.tsx`)

- **Today.** `BudgetVerdictStrip` is the strip. Status strings are not the shared four. Chip from `budgetActualsBadge`: “Uploaded month”, “Statement pace, prorated”, “None”. Simplified/Complex toggle in `clients.$clientId.tsx` (`data-view-mode-toggle`, visible only when `activeTab === "budget"`). Labels are the raw words `simplified` and `complex`. Complex mode adds scenario pills and the FY grid. `BudgetAdvancedPanel` (seed and push) sits under sign-off. `DeliverableInputConfig` id `budget`. Dialogs: scale break, implausible plan, “Low driver overlap”.
- **Sentence.** The verdict sentence already in `BudgetVerdictStrip`. Do not recompute variance.
- **Chip.** `budgetActualsBadge`, with the display words rewritten. “None” is not a chip; omit the chip when the badge is None (same rule as cash: unknown source stays blank).
- **Status.** Shared component, scope `budget`. Stop passing “Not signed off” / “Sign-off stale” / “Signed off”.
- **Primary.** Sign off.
- **Drawer.** The view toggle (do not leave it on the page). Scenario pills (base and the other stored scenarios). Configure inputs. `BudgetAdvancedPanel`. Unmapped-driver review. Model-change dialog stays a dialog, opened from the drawer.
- **Rewrite.** Toggle labels “simplified” / “complex”. “Statement pace, prorated”. “Accountant view: full FY grid in complex mode” (`budget-workspace.tsx`). “Review unmapped drivers” / “no matching key” / showing `driverKey`. “Low driver overlap” and the overlap percentage in the dialog. “annualised” in the scale-break copy. “Sign-off stale”.

### Books / Client Brain (pane-summary)

- **Today.** `StatementFigures`, `DataUpToDate` (`dataSectionStatus` in `src/lib/data-requests.ts`; freshness from `dataFreshnessLine` in `src/lib/workflow-coach.ts`), `DeliverableInputConfig` id `summary`, `ClientBrainSummary`. Draft rows use `draftStatusLabel` (“Ready”, “Sent”, “Discarded”, “Draft”) in `src/lib/client-brain.ts`. Sage card is `src/components/sage-connect.tsx` (Eng1 — do not edit that file; the call site may move).
- **Sentence.** `dataFreshnessLine`.
- **Chip.** The ledger name that function already chose (Xero, QuickBooks), or Statement when the line is a snapshot. Do not parse a new source.
- **Status.** `dataSectionStatus.title` is a heading, not one of the four status strings. Leave the four-string component off this section (no review scope). Do not map “Data up to date” onto Signed off.
- **Primary.** The existing connect or upload action from `DataUpToDate` when data is not current. One button.
- **Drawer.** `DeliverableInputConfig` summary. Profile questions inside `ClientBrainSummary` that are inputs, not the draft list.
- **Rewrite.** “Then continue to Health.” `factSourceLabel` “Extract” if it is shown. Draft tags “Ready” should not be confused with “Ready for review”; brain drafts keep `draftStatusLabel` unless the sweep explicitly includes them. Do not invent a sign-off on a brain draft.

### Moves (`src/components/strategic-moves-panel.tsx`, list from `rankStrategicMoves` in `src/lib/strategic-moves.ts`)

- **Today.** Lede in the route plus “Ranked from the ratios already on this file…” No chip, no sign-off, no configure-inputs. Each row has `title` and `impactLine`.
- **Sentence.** The first move’s `title`. Empty state keeps “No moves yet. Add figures on Overview and this list fills from the ratios.”
- **Chip.** None (no source field). Do not invent one.
- **Status.** None. No scope.
- **Primary.** Add to plan (`AddToPlanButton`) for that first move.
- **Drawer.** Nothing.
- **Rewrite.** “From strategic moves”. “health 62%” on the row meta (`toFixed`). Eyebrow “Strategic Moves” can stay as the section name.

### Reports (pane-reports + `src/routes/_authenticated/reports.index.tsx`)

- **Today.** Lede about per-report sign-off. `DeliverableInputConfig` id `reports`. The studio lists many PDFs. Sign-off scopes already used by the studio: financials, profitability, cash_forecast, budget. No single studio score.
- **Sentence.** No helper returns one studio sentence. Use a shortened copy of the existing lede. Do not invent a combined score.
- **Chip.** `figureSourcePhrase` for the statement behind the open report. Omit on the index if no report is open.
- **Status.** Shared component bound to the open report’s existing scope. The index does not average scopes and does not add a status word.
- **Primary.** Sign off for the open report’s scope, or Preview for the report the user already picked (`action=preview`).
- **Drawer.** Configure inputs (`reports`).
- **Rewrite.** “Reports Studio”. “Stamp Business Health & Ratios…”. “Board-ready”.

### Action Plan (pane-plan, `src/components/action-plan.tsx`)

- **Today.** Long lede. Sign off scope `action_plan` with `isStale={false}` (the route never marks this scope stale). `DeliverableInputConfig` id `plan`. `simplified` is passed from `viewMode` and is not read in the panel body (prop only). Item `STATUS_LABEL` is task progress (not the deliverable vocabulary).
- **Sentence.** Shorten the existing lede to one sentence in copy. No new count.
- **Chip.** None, unless a row already shows a source. Do not add one.
- **Status.** Shared component, scope `action_plan`.
- **Primary.** Sign off.
- **Drawer.** Configure inputs (`plan`). Do not add a Simplified/Complex control; the prop is unused.
- **Rewrite.** “client management” in the lede. “that is the point of the tab.” Task status words (not started, blocked, done) stay — they are the work list, not the deliverable status. Do not relabel them Draft / Ready for review.

### Advisory pack (`src/components/advisory-pack-panel.tsx`, `packStatusLabel` / `packDisplayedSignoffLine`)

- **Today.** Pack status uses a different set: “Ready for you”, “With your accountant”, “Changes requested”, “Signed off”, “Accepted”, “Rejected”, “Superseded”. Sign-off line uses `packDisplayedSignoffLine`. Route also mounts `ReviewSignoffButton` scope `advisory` with `isStale={false}` while the pack has its own stale line. Recommendations and Outcomes sit under the pack.
- **Sentence.** The pack’s stored headline if the panel already renders one. If the only line is the status, the sentence is the existing pack lede in the route (“Draft the advisory pack or email…”), shortened, and the status chip is separate. Do not call a model and do not write a new narrative helper.
- **Chip.** Omit, unless the pack header already shows a figure source. Do not add one.
- **Status.** Shared component, scope `advisory`, including the stale form when `packDisplayedSignoffLine` would append `STALE_SIGNOFF_CLAUSE`. Retire `packStatusLabel` on this surface so “Ready for you” and “Superseded” are not a second vocabulary. “Changes requested” is a workflow comment, not a fifth status; keep it as the change note the button already shows (`changeComment`), under Draft.
- **Primary.** Sign off when the viewer can sign. Otherwise the existing submit / request-changes control, one of them.
- **Drawer.** None specific to the pack. Recommendations and Outcomes stay on the page under the strip.
- **Rewrite.** “Ready for you”, “With your accountant”, “Superseded”, “Accepted” on this accountant surface. “P1” is a comment, not copy.

### Advisory drafter (`src/components/advisory-drafter.tsx`, sent history)

- **Today.** Same route lede and the same `advisory` sign-off as the pack.
- **Sentence.** One sentence of the existing lede: draft the note from the figures on file.
- **Chip.** None.
- **Status.** Same shared `advisory` status as the pack. One sign-off, two sections.
- **Primary.** The drafter’s existing generate action when there is no draft; Sign off when a draft is on screen and the viewer can sign. Not both gold.
- **Drawer.** `DeliverableInputConfig` id `advisory` (it sits above the drafter today).
- **Rewrite.** “Advisory Drafter”, “Write the note”, “ready to send” if it implies the product sent it.

### Bot (pane-ask)

Eng1. No strip inside `ask-ai.js` or the edge functions. No PR in this series edits those files. The shell may show `MILON_BOT_SUBTITLE` (“Grounded in this client’s file”) from `src/lib/milon-bot-copy.ts` only if that constant is already imported by the route. Do not rewrite chips or the blurb in this series. Primary action is the chat itself.

## Dev-speak to rewrite (copy only)

| Surface | Strings | Where |
|---|---|---|
| Cash | Signature view; 13-week maths; Scenario Studio; Stress-test; Not signed off; Stale; Inputs changed after sign-off | `cash-forecast.tsx`, pane-cash |
| Budget | simplified; complex; Statement pace, prorated; None; full FY grid in complex mode; unmapped drivers; driverKey; Low driver overlap; annualised; Sign-off stale | `clients.$clientId.tsx`, `budget-verdict.tsx`, `budget.bridges.ts` (label only), `budget-workspace.tsx`, `budget-panel.tsx` |
| Health | recalculates live; 12-month equivalent tooltip | pane-ratios |
| Profit | step by step; aggregated weekly data; period inputs; the ledger; client management; Full financials | pane-profit, `profitability-waterfall.tsx` |
| Collections / Payables | Days AR, Days AP, DSO, “Ratios” as a destination, OAuth scope ids | `collections.ts`, `payables.ts`, tab ledes |
| Overview / Plan | Audited; client management; “point of the tab” | pane-overview, pane-plan |
| Moves | From strategic moves; health NN% | `strategic-moves-panel.tsx`, pane-moves |
| Reports | Reports Studio; Stamp; Board-ready | pane-reports |
| Pack | Ready for you; With your accountant; Superseded; Accepted | `advisory-pack.ts` `packStatusLabel` callers on the accountant pane |
| Books | Then continue to Health | `data-up-to-date.tsx` |
| Sign-off (sweep, not these PRs) | Not signed off; Needs re-review; Reviewed & signed off; Reviewed by X on date — data has changed since | `review-signoff.tsx` |

## PR order

Each chunk is one or two tabs. Rebase onto `cursor/signoff-parity-sweep` once it exports the status component. Do not merge a local copy of the four strings. IA is a separate PR after these, or in parallel only if it does not restyle pane bodies (`clients.$clientId.tsx` will conflict; land the thin IA redirect first if both move).

1. **Cash + Budget.** Swap status onto the shared component. One chip. Review inputs drawer for Inputs, Scenario Studio, the view toggle, scenario pills, advanced seed/push. Rewrite the rows above. Owner board picks this up through the same components.
2. **Health + Profitability.** Caption and waterfall subtitle. Drawer takes both input collapses, product mix, and both `DeliverableInputConfig`s. Scopes `financials` and `profitability`.
3. **Collections + Payables.** Proof line as the sentence. Statement lead moves into the drawer. Status Draft. No new scope.
4. **Overview + Moves.** `whatMatters` / first move title. Financials status only on Overview. No drawer on Moves.
5. **Books.** `dataFreshnessLine`. Drawer is the summary input config. Do not edit `sage-connect.tsx`.
6. **Action Plan + Advisory pack.** Scopes `action_plan` and `advisory`. Pack status labels retire on this surface in favour of the shared component. Recommendations and Outcomes stay under the pack strip.
7. **Reports + Advisory drafter.** Index has no new status. Drafter shares the pack’s `advisory` sign-off. Drawer takes `reports` and `advisory` input configs.

Bot is not a chunk.

## Out of scope

Finance calculations, ratio formulas, cash or budget maths, RLS, migrations, data writes. `supabase/functions/ask-ai`, `supabase/functions/milon-bot`, sage files, billing and checkout files. Owner `/app` tab list. A second status component.
