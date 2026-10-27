# Accountant client view and cash forecast redesign: implementation plan

Owner: Theo. Written 27 Oct 2026 against `main` @ `dca97f4f`.
Audience: Grok / Chief of Staff, to split into eng-agent tasks. No code ships with this document.

Scope: the accountant client file (`/clients/$clientId`), mainly the cash forecast page
(`?tab=cash&section=forecast`). Theo's 15 review notes are numbered **R1–R15** below so each slice
can cite them.

---

## 0. Where things live today

| Area | File(s) | Notes |
| --- | --- | --- |
| Accountant client route | `src/routes/_authenticated/clients.$clientId.tsx` (6.3k lines) | Cash tab at ~L5221–5302. Mounts `CashForecastPanel` inside `ClientSubpageFrame` (title "13-week forecast" plus a subtitle) and a `.card.cf-wrap` wrapper. |
| Cash forecast panel | `src/components/cash-forecast.tsx` (3.3k lines), `CashForecastPanel` | One component for the owner (`src/routes/app.tsx` L4743 / L6559, `simplified`), the try demo (`src/components/try-sample-boards.tsx`, `simplified readOnly`) and the accountant (complex mode, no `simplified`). |
| Stacked cards on the accountant page, top to bottom (complex return, ~L3137–3293) | `answerStrip` → `cashSuggestionCard` → `onceOffSaveBar` → `reviewInputs` → `forecastCard` → "Forecast Setup" card → "Money In & Out" card | This is the stack Theo is reacting to (R4, R7). |
| Answer strip | `answerStrip` in `cash-forecast.tsx` ~L2366; CSS `.answer-strip*` in `src/styles/accountant-portal.css` ~L1415 | H2 "13-week cash forecast" plus a status sentence, an "Updated …" line, a source chip, a sign-off chip, Upload bank statements, and Export PDF. It repeats the `ClientSubpageFrame` title. |
| Suggested inputs | `src/components/cash-suggestion-card.tsx` ("Suggested – confirm", "Fixed costs", "Confirm all"); logic in `src/lib/cash-forecast-suggestions.ts`; persisted in `clients.cashflow.suggestionConfirm` | Becomes part of Audit inputs (R5). |
| Once-off suggestions | `src/components/once-off-suggest-bar.tsx` ("Suggest once-offs", "Save once-off rows") | Fold into the Forecast setup table (R9, R12). |
| P&L vs bank notice (Chill Pepper) | `src/components/pl-bank-disagree-notice.tsx` ("Invoiced sales and cash collected are different figures"); data from `plBankDisagreement()` in `src/lib/client-metrics.ts` L1092 | Rendered in `cash-forecast.tsx` (`disagreeNotice`, ~L2276, shown in complex mode) and on the client briefing in `clients.$clientId.tsx` L4730. R6. |
| Review inputs drawer | `src/components/review-inputs-drawer.tsx` (`<details>`, hint "Inputs, what-ifs") wrapping two `CollapsibleGoldCard`s: "Inputs" (contains `DeliverableInputConfig`) and "Try a what-if" (sliders, ~L2473–2665) | R5, R7, R10. |
| Input checklist (checkboxes) | `src/components/deliverable-input-config.tsx` (Radix `Checkbox` from `src/components/ui/checkbox.tsx`); defs in `src/lib/deliverable-input-config.ts`; **state stored only in localStorage** (`src/lib/deliverable-input-config.store.ts`) | R13. Used on every accountant deliverable (summary, cash, budget…). |
| Forecast card | `forecastCard` ~L2887: period line, `<details class="cash-details">` bullets, `scenarioLabel`, `disagreeNotice`, `emptyNotice`, **two `EnlargeButton`s** (graph and table, L2956–2958), a `ViewToggle` (Chart / 13-week), KPI tiles, chart, `CashThirteenWeekGrid` | R8: both buttons read "Enlarge". |
| Enlarge | `src/components/enlarge-sheet.tsx` (`EnlargeButton`, `EnlargeSheet`), `enlarge-sheet.css` | |
| 13-week grid | `src/components/cash-thirteen-week.tsx` (`CashThirteenWeekGrid`; `TIGHT_BG` red tint for weeks under the floor) | Keep it. |
| Line editor | `LineEditor` in `cash-forecast.tsx` L445: one bordered card per line (name, amount, frequency, start week, split count, Remove) | R12. |
| Card chrome | `src/components/primitives/collapsible-gold-card.tsx` (`COLLAPSIBLE_GOLD_SHELL` / `_RULE`); portal overrides at `accountant-portal.css` L665 | Warm `border-amber-900/10` / `bg-white/60` tints on tiles, inputs and line cards in `cash-forecast.tsx` and `deliverable-input-config.tsx`. Probably where the "pink" comes from (R11, see Q3). |
| Chart colours | `heroChart` in `cash-forecast.tsx` ~L2060–2170: `GOLD="#0B5FFF"`, fill `cfGoldFill`, red floor/negative | R14. |
| Waterfall palette (reference) | `src/components/profitability-waterfall.tsx` `COLORS` L98–110, legend L1366 | Navy `#2c5580→#1a3a5c`, green `#5cc492→#3f9c72`, red `#e05c5c→#c94b4b`, cobalt `#2563eb→#0b5fff`. |
| Segmented control | `src/components/ui/view-toggle.tsx` (`ViewToggle`, `role="tablist"`, `rounded-full` pills) | The "circles" Theo doesn't want for the new menu (R7). |
| Route search | `src/lib/client-route-search.ts` (`accountantClientRouteSearch`, `view=13week` already honoured, `hashIsCashDetailAnchor`) | New `view` values go here. |
| Agents desk (accountant) | `src/components/milon-team/milon-team-pane.tsx`, `milon-team-desk.tsx`, `milon-team-desk.css`; `agent-stage.tsx/.css`; `practice-agent-thread.tsx/.css`; mounted at `clients.$clientId.tsx` ~L4601 | R1. |
| Hand-off | UI: `src/components/hand-to-menu.tsx`, `handoff-run-status.tsx`, `action-handoff-buttons.tsx`, `financial-manager-brief.tsx`, `action-plan.tsx`; client lib: `src/lib/owner-handoff-client.ts` (`loadActionHandoffRuns`), `src/lib/owner-handoff.ts`, `src/lib/action-handoff.ts`; server: `supabase/functions/owner-handoff`, `agent-dispatch`, `agent-financial-manager` / `agent-analyst` / `agent-advisor`, `_shared/agent-core/{job,loop}.ts` | R3. |
| Ledger connect | `src/components/brand-connect-button.tsx` (`quickbooks`/`xero`/`sage`), `connect-books-card.tsx/.css` (`ConnectBooksHomeCard`), `xero-connect.tsx`, `qbo-connect.tsx`, `sage-connect.tsx`, `data-up-to-date.tsx`, `client-briefing.tsx` L331–350, `statement-arap-fallback.tsx`; dialogs in `clients.$clientId.tsx` L6045–6110; Sage doc `docs/SAGE_SA.md` | R2. |

Test convention: `scripts/*-test.mts` run with `vite-node` through `pnpm test:<name>` (325 scripts
in `package.json`). The ones touched here: `test:cash-forecast-detail`, `test:cash-explainer`,
`test:cash-forecast-suggestions`, `test:cash-once-off-save`, `test:cash-once-off-suggest`,
`test:cash-forecast-parity`, `test:deliverable-input-config`, `test:sage-connect`,
`test:handoff-reload`, `test:accountant-studio-clarity`, `test:accountant-qa-*`, and
`scripts/aqa-retest-573-test.mts`, which asserts the P&L notice text at L280 and has to change.

---

## 1. Target design for the cash forecast page (R4–R12, R14)

### 1.1 Information architecture

The accountant cash forecast page is one page with a **top horizontal menu**. Each menu item is a
pane, not a stacked card. It opens on **Forecast**.

```
Firm dashboard / Client / Cash flow / 13-week forecast          [Sign off] [Upload bank] [⤓]
┌──────────┬──────────┬───────────────┬────────────────┬──────────────────┐
│ Forecast │ 13-week  │ Forecast setup│ Audit inputs ③ │ Scenario planning│   ← block segmented menu
└──────────┴──────────┴───────────────┴────────────────┴──────────────────┘
One optional sentence for this pane.
<pane body>
```

| Menu item | `view` param | Content | Replaces |
| --- | --- | --- | --- |
| **Forecast** (default) | `graph` (or none) | 3 KPI tiles (opening bank, lowest point, weeks below floor) and the closing-balance chart with the floor line. | `graphPane` in `forecastCard` |
| **13-week** | `13week` (already supported) | `CashThirteenWeekGrid`, editable. | the `cashLens === "table"` section |
| **Forecast setup** | `setup` | Start date, opening bank balance, then **one** line-item table (R12) for revenue, main expenses and other expenses, with "Suggest once-offs" as a table action. | "Forecast Setup" and "Money In & Out" cards, `OnceOffSuggestBar` |
| **Audit inputs** | `audit` | Approve each input (R5). The badge shows the count still unapproved. | `CashSuggestionCard`, the "Inputs" card / `DeliverableInputConfig` for cash |
| **Scenario planning** | `scenario` | The current what-if sliders, renamed (R10), with "Reset to base" and the active-scenario label. | "Try a what-if" card and the `ReviewInputsDrawer` |

Removed from the accountant page: the `ReviewInputsDrawer` wrapper, `<details class="cash-details">`
bullets, the `disagreeNotice` (R6), the duplicate H2 in the answer strip, the subpage subtitle, the
"Updated …" / runway aside lines (move to a tooltip on the source chip), and the
`weekTableHint` paragraph (becomes the 13-week pane's single sentence).

Kept: sign-off button and status chip, Upload bank statements, Export PDF, the empty-state banner
(`emptyNotice`), export error, "Opening cash unknown / missing" states. Those are needed to act.

### 1.2 Copy budget (R4, R7)

At most **one** full sentence under the menu per pane. Proposed:

- Forecast: *"Closing bank balance for each of the next 13 weeks against the R 112k floor."* (floor interpolated; omit if empty)
- 13-week: *"Double-click a figure to edit it; red weeks are below the floor."*
- Forecast setup: *"Set the start date, opening balance and every line that moves cash."*
- Audit inputs: *"Approve each input before you sign off the forecast."*
- Scenario planning: *"Test changes without touching the base forecast."*

Everything else goes: chip-heavy sub-lines, the `cashExplainerCopy` bullets, and "Choices are saved
for this analysis…" warnings.

### 1.3 Visual rules (R7, R11, R12, R14)

- **Menu**: block segmented control. `border-radius: 8px` (not `rounded-full`), 36–40px tall,
  1px `#DBEAFE` border, white inactive fill, active fill cobalt `#0B5FFF` with white text,
  hover `#F4F8FF`. Horizontal scroll with snap under 640px, no wrap. `role="tablist"` with arrow-key
  support, same as `ViewToggle`.
- **Page background** (R11): very light Milōn blue `#F4F8FF` (`--bg-3` already exists in
  `accountant-portal.css` L13) on the cash page container. Cards stay white with `#DBEAFE`
  borders. Remove the warm tints `border-amber-900/10`, `border-amber-900/15` and `bg-white/60` from
  `Stat`, `LineEditor`, `INPUT_CLS`, the `deliverable-input-config.tsx` list items and
  `weekly-input-table.tsx`. Replace with `border-[#DBEAFE] bg-white`.
- **Colour like the waterfall** (R14): share one palette (`src/lib/brand-palette.ts` or similar)
  between `profitability-waterfall.tsx` and the cash chart:
  - Closing-balance line: cobalt `#0B5FFF`, area gradient `#2563EB` at 0.28 fading to 0.02.
  - Weekly net cash bars (new, optional, behind the line): green gradient `#5cc492→#3f9c72` for
    positive weeks, red `#e05c5c→#c94b4b` for negative weeks.
  - Floor: dashed amber or navy `#1a3a5c` (not gold-on-gold). Shortfall area stays red at 0.28.
  - KPI tiles: a 3px left accent in the tone colour (navy neutral, green good, red bad) and a
    soft tint (`#e8f1fe`, green/red at 6%), like the waterfall stat chips (Healthy/Watch/Critical).
  - 13-week grid: "Total receipts" row with a green tint, "Total payments" row with a red tint,
    "Closing" row in navy. The owner-door CSS already does this in `owner-premium.css` L461–477;
    port it to the accountant scope.
- **Block shapes, not ovals** (R12): line-item table chips, frequency select, Add-row buttons and
  Remove all use `rounded-md` (6–8px). No `rounded-full` inside the cash page except status dots.

---

## 2. Work slices (in order)

Every slice is a separate PR off `main`. Slices 1–3 don't touch cash and can run in parallel with
4+. Slices 4–10 share `cash-forecast.tsx`, so they go sequentially, or slice 4 lands first and
4b–10 branch from it.

### Slice 1: Agents cut off in the accountant view (R1)

**Files**: `src/components/milon-team/milon-team-desk.css` (L17–24, L67–94, L751–800, L860–880),
`milon-team-desk.tsx`, `milon-team-pane.tsx`, `agent-stage.css`, `practice-agent-thread.css`,
`src/styles/accountant-portal.css` (`.shell`, `.client-workspace`, `.deliverable-main`).

**Cause (from code)**: while a desk is mounted the portal pins `.shell` to `height:100vh;
overflow:hidden` and sets `overflow:hidden` on `.client-workspace` and `.deliverable-main`
(`milon-team-desk.css` L67–94). Only `.milon-desk-scroll` scrolls. The composer
(`#ask-ai-accountant`) sits outside that scroller with a `0 -8px 18px rgba(0,0,0,.45)` shadow, and
`.ask-ai-thread` is capped at `max-height:220px`. On short or mobile viewports, and whenever the
topbar or breadcrumb wraps (mobile screenshot c01: breadcrumb takes 3 lines), the desk gets
squeezed. The activity card is clipped under the composer shadow and the agent cards lose their
bottom edge.

**Plan**:
1. Reproduce at 390×844, 768×1024, 1280×800 and 1440×900 in light and dark, on Home → Financial
   Manager / Analyst / Advisor, with and without a long thread.
2. Use `100dvh` (fallback `100vh`) for the shell, and subtract the real topbar height with a CSS
   var set from `ResizeObserver` instead of assuming it.
3. Under 860px, drop the fixed-height desk: let the page scroll normally (`height:auto;
   overflow:visible` on shell/workspace/main) and make the composer `position:sticky; bottom:0`
   with `env(safe-area-inset-bottom)` padding.
4. Swap the composer's dark drop shadow for a 1px `--desk-line` top border, so it stops looking
   like a fade-out over content.
5. Agent tiles (`.milon-desk-agent`, `agent-stage.css`): `min-width:0`, `overflow-wrap:anywhere`
   on names and status, no fixed heights. Allow two-line status text.
6. Add `scripts/accountant-desk-clip-test.mts` (DOM/CSS assertion in the style of
   `accountant-studio-clarity`) to check that `.milon-desk-scroll` is the only `overflow:hidden`
   ancestor chain under 860px, and that the composer is sticky.

**Acceptance**:
- At all 4 viewports, every agent card, the activity list and the last thread message can be
  fully scrolled into view. `scrollHeight - clientHeight` of the scroller reaches 0 at the
  bottom, and no element's bounding box extends past a clipped ancestor (Playwright check).
- No horizontal scrollbar at 390px.
- The composer never covers the last message.

### Slice 2: Connect Sage matches Connect Xero / QuickBooks (R2)

**Files**: `src/components/connect-books-card.tsx/.css`, `src/components/brand-connect-button.tsx`,
`src/styles/primitives.css` L1383–1410 (`.brand-connect--sage`), `src/components/sage-connect.tsx`,
`src/components/statement-arap-fallback.tsx`, `src/components/collections-panel.tsx`,
`src/components/payables-panel.tsx`, `src/components/data-up-to-date.tsx`, `clients.$clientId.tsx`
(L4349–4356, L4777–4781, L5322–5350).

**Gap today**: on accountant Home, `ConnectBooksHomeCard` renders Xero and QuickBooks as cobalt
pills, and Sage as a text link underneath (`.connect-books-card__sage`). Collections and Payables
(`StatementArApFallback`) offer Xero and QuickBooks only. On Connections (`DataUpToDate`), Xero and
QuickBooks show a branded button, while Sage shows an inline email/password/Company ID form.

**Plan**:
1. `ConnectBooksHomeCard`: Sage becomes a third `connect-books-card__primary` button in the same
   row (`data-connect-books="sage"`, label "Sage", busy "Checking Sage…"). Delete the
   `__sage` link style. Still hidden for US (`showSage={!isUsCopy(...)}`).
2. `BrandConnectButton`: add a Sage mark the same way `XeroMark` is done (a wordmark in a
   badge, not a redrawn logo), so all three branded buttons have a mark.
3. `SageConnectCard`: when not connected, show `<BrandConnectButton brand="sage">` first. The
   credential form only appears after the click, in the same Sage dialog, mirroring the
   button-then-OAuth flow of the other two.
4. `StatementArApFallback`, `CollectionsPanel` and `PayablesPanel`: add an `onConnectSage` prop
   and wire it from the route with `() => setShowSageDialog(true)` (non-US only).
5. Extend `test:sage-connect` with: the Home card renders 3 equal buttons (non-US) / 2 (US), and
   the Collections fallback renders Sage.

**Acceptance**: on a ZA client, Home, Connections, Collections and Payables each show Connect
Sage with the same size, shape and placement as Xero and QuickBooks. Clicking it opens the Sage
dialog. US clients see no Sage.
**Caveat**: `docs/SAGE_SA.md` says Sage sync is a stub. It does not pull P&L or balance sheet, and
the dialog says "Sync does not change this client's figures yet". The equal button promises
parity the data doesn't have yet (Q1).

### Slice 3: Show what a bot actually does after a hand-off (R3)

**What happens today (from code)**:
1. The UI (`hand-to-menu.tsx` → `owner-handoff-client.ts`) calls the edge function
   `supabase/functions/owner-handoff`. It checks the caller may hand off, writes an
   `action_updates` note "Handed to <agent>", and inserts an `agent_runs` row (`status=queued`,
   `trigger`, `action_item_id`) unless the runner flag in `agent_settings` is off. In that case
   the assignment is recorded and **nothing runs**.
2. `agent-dispatch` picks the run, and the runner (`agent-financial-manager` / `agent-analyst`
   / `agent-advisor`) executes the `_shared/agent-core/loop.ts` tool loop. It writes
   `agent_runs.trace` (`[{tool, status, args?}]`), `summary`, `stop_reason`, `error`,
   `started_at` / `finished_at`, and on success one or more `agent_findings` rows
   (`run_id`, `title`, `detail`, `severity`, `evidence`). Then it writes a finish note
   "<Role> finished: <summary>" (`handoffResultNote` in `owner-handoff.ts`).
3. The UI loads only `id, action_item_id, agent, status, queued_at`
   (`loadActionHandoffRuns`, `owner-handoff-client.ts` L488), so `HandoffRunStatus` can only say
   Working / Taking longer than usual / finished + "Open draft". It never shows the steps or the
   output, and a disabled runner looks the same as a queued one.

**Plan**:
1. Extend the select in `loadActionHandoffRuns` to `trace, summary, stop_reason, error,
   started_at, finished_at`, and fetch `agent_findings` by `run_id`. Check that RLS on
   `agent_runs` / `agent_findings` (`supabase/migrations/20261010160000_agent_foundation.sql`
   L148+) lets the accountant read them. If not, add a narrow select policy or an RPC.
2. New `src/lib/handoff-timeline.ts` (pure, tested): maps a run to steps:
   *Handed to X (who, when)* → *Queued* → *Started* → one human line per trace tool
   (e.g. `read_financials` → "Read the P&L and balance sheet", `record_finding` →
   "Wrote a finding"; map tool names in one table, unknown tools say "Checked <tool>") →
   *Finished: <summary>* / *Stopped: <stop_reason>* / *Not started: runner off*.
3. New `src/components/handoff-run-card.tsx`: a compact expandable card under the action row
   (replaces the one-line `HandoffRunStatus` caption, which stays as the collapsed state). Shows
   the status pill, the step list with ticks, the output (finding title, detail and evidence
   figures) and actions (**Open draft**, **Retry**, **Reassign**). Live updates through the
   existing realtime publication on `agent_runs`.
4. Use it in `action-plan.tsx`, `financial-manager-brief.tsx`, `owner-door.tsx` and the desk
   activity list.
5. Tests: `scripts/handoff-timeline-test.mts` (queued, running, finished with a finding,
   finished with none, stopped, runner disabled, slow).

**Acceptance**: after handing an action to the Analyst, the card goes from Queued to Started,
shows each step as it happens, and ends with the finding text and an Open draft button. With the
runner disabled it says so plainly and offers Reassign. There is no "handed off" dead end.
Product questions: Q4–Q6.

### Slice 4: Paged cash page shell and top menu (R7, R8, R4)

**Files**: `src/components/cash-forecast.tsx`, new `src/components/cash/cash-forecast-menu.tsx`
(or a generalised `src/components/ui/segmented-tabs.tsx`), `src/lib/client-route-search.ts`,
`clients.$clientId.tsx` L5251–5302, `src/styles/accountant-portal.css`.

1. Add prop `layout?: "stacked" | "paged"` to `CashForecastPanel`, default `"stacked"`.
   The accountant route passes `layout="paged"`. The owner (`app.tsx`) and try demo don't change
   in this pass (Q2).
2. Add `type CashView = "graph" | "13week" | "setup" | "audit" | "scenario"`. Read and write
   `?view=` with `accountantClientTabSearch`. Default `graph`. Keep the `hashIsCashDetailAnchor`
   / `view=13week` deep links working. Old `#wizard-cash-setup` / `#wizard-cash-scenario` anchors
   map to `setup` / `scenario`.
3. Build `CashForecastMenu` (block segmented tabs, see 1.3). The Audit tab shows a count badge.
4. In paged mode, render the answer-strip actions (sign-off, upload, export, chips) in one header
   row next to the subpage title, with no H2 and no sentence lines. Set `ClientSubpageFrame`
   `subtitle` to null for the forecast page.
5. Each pane renders inside one white card. Remove `ReviewInputsDrawer` from the paged layout.
6. **One Enlarge (R8)**: remove the two `EnlargeButton`s and the inner `ViewToggle` (the menu
   replaces Chart/13-week). Put one `EnlargeButton` in the pane header on Forecast and 13-week
   only. It enlarges the current pane (`setCashEnlarge(view === "13week" ? "table" : "chart")`).
   Remove any second enlarge on the subpage frame. The prod screenshot shows a lone "Enlarge" next
   to the period line, so check `ClientSubpageFrame` and the route for another instance.

**Acceptance**:
- `/clients/<id>?tab=cash&section=forecast` opens on Forecast with the chart visible above the
  fold at 1280×800.
- The menu is keyboard-navigable, the URL updates per tab, and back/forward works.
- Each pane has exactly 0 or 1 descriptive sentence.
- Exactly one Enlarge control is visible per pane: Forecast and 13-week have one, the others
  have none.
- The owner and try views render pixel-identical to before (existing owner tests pass).

### Slice 5: Remove the noise (R4, R6)

1. Delete `disagreeNotice` from `cash-forecast.tsx` (all modes, since it doesn't help the
   forecast) and from the client briefing (`clients.$clientId.tsx` L4730). Keep
   `plBankDisagreement()` in `client-metrics.ts` only if something else consumes it. Otherwise
   delete it, `pl-bank-disagree-notice.tsx` and its CSS (`.pl-disagree*`). Update
   `scripts/aqa-retest-573-test.mts` L280 to assert the notice is **absent**.
2. In paged mode, drop `cash-details` bullets, `scenarioLabel` (moves to the Scenario pane),
   `runwayAside`, `forecastUpdatedLabel` / `xeroBankNote` lines (source tooltip instead), the
   "Choices are saved…" warning, and the `weekTableHint` duplicate.
3. Count rendered text nodes in the paged Forecast pane with a test, as a guard against copy
   creeping back.

**Acceptance**: on Chill Pepper Boutique Hotel (`/clients/79c4c485-…`), the forecast page has no
"Invoiced sales and cash collected are different figures" block anywhere, and the Forecast pane
shows only the header, menu, one sentence, 3 tiles and the chart.

### Slice 6: Forecast setup = setup + Money in & out in one table (R9, R12)

**Files**: `cash-forecast.tsx` (`LineEditor`, the "Forecast Setup" and "Money In & Out" blocks
L3146–3257), new `src/components/cash/forecast-line-table.tsx`, `once-off-suggest-bar.tsx`.

1. The Forecast setup pane has a top row with Forecast start date and Opening bank balance
   (`Input`s, with the `xeroBankNote` as helper text). Below it sits **one** table.
2. Table columns: **Description · Amount · Frequency · Start week · Remove**. Rows are grouped by
   section header rows: *Money in* (green left accent), *Main expenses*, *Other expenses* (red
   accent). Split frequencies show a compact "# weeks/months" input inline in the Frequency cell.
   The `forecastRuleLabel` hint becomes a cell `title`/tooltip, not a paragraph.
3. Add-row buttons (`+ Add money-in line`, `+ Add expense line`) are block buttons in each group
   footer. "Suggest once-offs" becomes a table toolbar action. Staged rows are highlighted and
   saved with the existing `onceOffSaveBar` logic.
4. Keep the state model (`revenue`, `expenses`, `other` arrays, `updateAt`, `makeLine`) and the
   persistence path unchanged. This is a view change only. Main-expense rows keep "no remove" per
   the current rule unless Theo says otherwise (Q7).
5. Mobile under 640px: the table becomes stacked rows (description on top, then a 2×2 grid),
   still with no card per line. Reuse `src/components/primitives/scrollable-table.tsx` /
   `src/styles/responsive-table.css`.

**Acceptance**: no `CollapsibleGoldCard` titled "Forecast Setup" or "Money In & Out" remains. One
`<table>` holds every line. Editing amount, frequency or start week updates the 13-week grid and
chart live, same as today (`test:cash-forecast-detail` / `test:cash-forecast-parity` still pass).
Remove works. No `rounded-full` elements in the pane.

### Slice 7: Audit inputs pane (R5) and the checkbox fix (R13)

**Files**: new `src/components/cash/cash-input-audit.tsx`, new `src/lib/cash-input-audit.ts`
(pure), `cash-suggestion-card.tsx` (retired on the paged layout), `deliverable-input-config.tsx`,
`src/components/ui/checkbox.tsx`, `src/lib/deliverable-input-config.store.ts`.

**Audit inputs model**: one row per input that drives the forecast:
- Opening bank balance (value, source chip: Bank / Xero / Statement / Manual, as-of date)
- Forecast start date
- Cash floor (value, rule: "about 4 weeks of outflows" or manual)
- Each forecast line (description, amount, frequency, source)
- Data sources used (from `def.sources` in `deliverable-input-config.ts`: statement, bank
  pack, Xero/QBO sync, budget WC…)
- Engine-bound assumptions (collection delay, revenue growth)

Each row: **Input · Value · Source · Status (Suggested / Approved / Changed since approval) ·
[Approve] / [Edit]**. A header "Approve all remaining" replaces "Confirm all". Approving
stores `{ approvedAt, approvedBy, valueHash }` per input key in `clients.cashflow.inputAudit`
(jsonb, no migration needed; same blob as `suggestionConfirm`, which becomes a subset). If an
approved value changes, the row flips to "Changed since approval". The menu badge shows the
unapproved count. Sign-off (`ReviewSignoffButton`) shows a soft warning, not a block, when items
are unapproved (Q8).

**Checkbox fix (R13), across the accountant page**:
1. Root cause to confirm in the browser. Two candidates from code:
   (a) **Function**: `DeliverableInputConfig` checkboxes only write localStorage
   (`deliverable-input-config.store.ts`) and never change the figures (the component says so
   itself: "they do not update on their own when you uncheck a source"). So they look broken and
   don't follow the user across devices or colleagues.
   (b) **Visibility**: the Radix `Checkbox` (`ui/checkbox.tsx`) is an `h-4 w-4` button with an
   `h-4 w-4` `Check` icon inside a 1px border. It inherits `.accountant-portal` and
   `.collapsible-gold-card` overrides, and in dark/glass themes the border and check end up
   low-contrast or the icon gets clipped. Native checkboxes elsewhere (`send-agent-panel.tsx`
   L559, `bank-statement-drafter.tsx` L477, `cash-classification-workspace.tsx`,
   `budget-workspace.tsx` L648, `accountant-inbox.tsx`) use browser defaults that portal styles
   can wash out.
2. Fix: one `Checkbox` primitive for the accountant portal. 18px box, 2px `#3D5270` border,
   checked = `#0B5FFF` fill with a white 12px check (`strokeWidth 3`), visible focus ring, and
   light/dark tokens. Replace native `type="checkbox"` in the accountant surfaces listed above.
   Add `.accountant-portal button[role="checkbox"]` reset rules so portal button styles can't
   override it.
3. For cash, the source checkboxes become Approve actions in Audit inputs, persisted server-side.
   For other deliverables, persist `checkedSources` to the client row too (or label the checkbox
   "Noted, not used in figures" until the engine reads it) (Q9).
4. Tests: `scripts/cash-input-audit-test.mts` (approve, change-invalidates, approve-all, counts),
   extend `test:deliverable-input-config`, and a Playwright check that every
   `[role=checkbox][data-state=checked]` on accountant pages has a visible `svg` with a computed
   size ≥ 10px and contrast ≥ 3:1.

**Acceptance**: each input can be approved one by one, and approvals survive reload and another
browser. Editing an approved input marks it changed. Checkmarks are clearly visible in light and
dark on Home, Health, Cash, Budget and Reports. Clicking a checkbox or its label toggles it.

### Slice 8: Scenario planning pane (R10)

1. Move the "Try a what-if" contents (`cash-forecast.tsx` ~L2473–2665) into the Scenario pane
   unchanged, except: title/tab "Scenario planning"; sentence per 1.2; sliders in a 2-column grid;
   a small live mini-chart (base vs scenario lines, reusing `heroChart` with a second series) so
   the effect is visible without switching tabs; "Reset to base" as a block button.
2. Rename all user-facing "what-if" strings: `review-inputs-drawer` hint, `forecastScenarioLabel`
   output in `src/lib/…` (grep `what-if|What-if|what if`), PDF/report copy in
   `src/reports/cash-forecast.tsx`, `src/lib/feature-finder.ts`, `marketing-faq.ts` if it
   describes this tab.
3. Scenarios stay session-only as today (L1124 comment), unless Q10 says to save them.

**Acceptance**: no "what-if" text left in the accountant UI. Moving a slider updates the
Scenario mini-chart and the Forecast pane. Reset returns to base.

### Slice 9: Colour and background pass (R11, R14)

Do it after slices 4–8 so it styles the final DOM. Apply section 1.3. Files:
`cash-forecast.tsx` (`Stat`, `heroChart`, colour constants L260–262), `cash-thirteen-week.tsx`,
`accountant-portal.css` (scope `.accountant-portal [data-cash-layout="paged"]`), the new shared
palette module imported by `profitability-waterfall.tsx`.

**Acceptance**: the cash page background reads as very light blue (`#F4F8FF`) in light mode,
with no warm/pink tint anywhere on the page (sample pixels in a screenshot test: no pixel in the
page chrome with R > B). Chart and tiles use the waterfall palette. Dark mode is unchanged in
structure and keeps 4.5:1 text contrast.

### Slice 10: QA walk and screenshots

Re-run the existing walks (`test:accountant-qa-medium`, `test:accountant-qa-deliverables`,
`test:accountant-qa-retest`, `test:accountant-studio-clarity`) and capture new screenshots at
390 / 1280 / 1440 for each cash tab, the Home desk, Connections, and a hand-off run card. Compare
against the attached "before" images (`before-cash-1280`, `cash-graph-1280`, `cash-13week-1280`,
`e4-01-chill-cash`, `fw-08-cash-13wk-banner`, `c01`, `c07`).

---

## 3. Global acceptance checklist (for Theo's sign-off)

- [ ] R1: No clipped agent cards, activity or thread at 390/768/1280/1440.
- [ ] R2: Connect Sage looks and sits like Connect Xero / QuickBooks on every accountant surface (non-US).
- [ ] R3: A hand-off shows queued → steps → output (finding + Open draft) or a clear stop reason.
- [ ] R4: Cash page copy cut to ≤1 sentence per pane; no notifications except empty and error states.
- [ ] R5: Audit inputs lists every input with per-row Approve; approvals persist server-side.
- [ ] R6: The P&L vs bank notice is gone from the forecast and the briefing.
- [ ] R7: Opens on the graph; the block menu toggles Forecast / 13-week / Forecast setup / Audit inputs / Scenario planning; no stacked cards.
- [ ] R8: One Enlarge per pane, only where it makes sense.
- [ ] R9: "Forecast setup" contains start date, opening balance and all money in/out lines.
- [ ] R10: "Scenario planning" everywhere; no "what-if".
- [ ] R11: Light-blue background, no pink.
- [ ] R12: One line-item table, block shapes, columns Description / Amount / Frequency / Start week / Remove.
- [ ] R13: Checkboxes toggle, show a visible check, and persist, across the accountant page.
- [ ] R14: Waterfall-style colour on the chart, tiles and grid totals.
- [ ] `pnpm lint`, typecheck, and the cash, handoff, sage and deliverable-input test scripts pass.

---

## 4. Risks

- `cash-forecast.tsx` is 3.3k lines and shared with the owner and the try demo. The `layout`
  prop keeps the blast radius small. Extracting the panes into `src/components/cash/*` while
  doing slice 4 is recommended but must not change the calc path (`computeScenario`, `baseCalc`).
- The PDF export (`src/reports/cash-forecast.tsx`) reads the same copy helpers. Removing UI copy
  must not remove PDF content unless intended. Run `test:cash-pdf-empty` and `test:reports`.
- Deep links from emails and agents (`src/lib/workflow-emails.ts`, `next-step.ts`,
  `feature-finder.ts`) point at `section=forecast`, `#detailed-forecast` and
  `#wizard-cash-setup`. Slice 4 must map them.
- The RLS change for reading run traces (slice 3) needs a security look: traces include tool
  `args`, which may hold figures. Strip `args` in the client select.

---

## 5. Open questions for Theo (R15)

1. **Sage parity**: Sage sync is a stub today (`docs/SAGE_SA.md`: no P&L or balance sheet pull).
   Should the equal-weight Connect Sage button ship now with "figures not synced yet" copy, or
   wait until real sync lands?
2. **Owner view**: should the owner's cash tab (`src/routes/app.tsx`, complex mode) get the same
   top menu, or is this accountant-only for now? The plan defaults to accountant-only.
3. **"Pink" background**: which surface looked pink to you? The code has no pink token. The likely
   culprits are the warm `amber-900` borders and `white/60` tiles over the page gradient, or the
   red "below floor" column tint in the 13-week grid. The plan removes the warm tints and keeps
   the red tint only on below-floor weeks. Confirm that's right.
4. **Hand-off detail level**: show every tool step ("Read the P&L", "Checked debtors") or just 3
   stages (Started, Working, Finished + output)?
5. **Hand-off output**: is the output always a draft finding to approve, or should some bots act
   directly (e.g. send the chase email)? The current runners never post to a ledger and only
   write findings and drafts.
6. **Runner switched off**: when an agent's runner flag is off, should Hand to be hidden for that
   agent, or allowed and shown as "Not started: <agent> is paused"?
7. **Main expense rows**: today they can't be removed (only "Other" and revenue rows can). Should
   every row in the new table have Remove?
8. **Audit gate**: should sign-off be blocked until every input is approved, or only warn?
9. **Non-cash deliverables**: for Budget, Health and Summary, should the source checkboxes become
   real filters on the figures (engine work), or stay as notes that persist server-side?
10. **Scenarios**: keep them session-only, or let the accountant save a named scenario and include
    it in the PDF?
11. **Menu order and naming**: "Forecast" vs "Graph" for the first tab, and should "Audit inputs"
    come before "Forecast setup"?
12. **Weekly net bars**: add green/red weekly net-cash bars behind the balance line for colour,
    or keep the single line plus area?
