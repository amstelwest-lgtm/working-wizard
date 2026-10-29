# Financial Manager client reports on Opus 5.5

Scope only. No product change in this note. Investigated on `main` at `948959ae` (includes #831 figure proposals and #832 Tax under Work).

#833 (Advisory Management Report, parts 1–3) stays skipped. Part 4 stays parked until Theo supplies samples. This note does not revive that redesign.

## Recommendation

**First slice:** when the accountant asks the Financial Manager, in an imperative sentence, for one of the five branded PDFs that already have their own Reports page, the Financial Manager run on Opus 5.5 calls one new tool, `prepare_client_report`. That tool names the existing report key and does not write books. The PDF bytes come from the Reports studio builders that already exist. A person downloads. Nothing is emailed, signed off, or applied to cash, budget, or the waterfall.

Analyst and Advisor stay on Sonnet 5.5. `CLAUDE_MODEL` stays the Sonnet default. `CLAUDE_MODEL_FM` stays unset. Unset already resolves the Financial Manager to `claude-opus-5-5` through `modelForAgent`.

## How reports are produced today

Four different things are called a report. They do not share a model, a table, or a publish step.

### 1. Branded PDF catalogue (the client reports)

Accountant client → Reports. The rail (`src/components/client-studio-chrome.tsx`) lists Health scorecard, Budget & variance, Benchmark, 13-week cash forecast, Profitability waterfall, Advisory pack, Draft tool, Sent, and All reports.

The catalogue is `REPORTS` in `src/routes/_authenticated/reports-studio.tsx`. Eleven keys:

| Key | Name | Own rail page |
| --- | --- | --- |
| `scorecard` | Financial Health Scorecard | Yes (`section=scorecard`) |
| `budget` | Budget & Variance | Yes (`section=budget-pdf`) |
| `benchmark` | Industry Benchmark Report | Yes |
| `forecast` | 13-Week Cash Flow Forecast | Yes |
| `waterfall` | Profitability Waterfall | Yes |
| `intervention` | Priority Intervention Plan | Only inside All reports |
| `cycle` | Cash Flow Cycle Report | Only inside All reports |
| `leverage` | Leverage & Solvency | Only inside All reports |
| `assets` | Asset Productivity | Only inside All reports |
| `labor` | Labour Productivity | Only inside All reports |
| `movement` | Ratio Movement | Only inside All reports |

Bytes are client-side React-PDF components under `src/reports/`. `handleGenerate` in the studio builds the blob. A deep link `action=download` on a single-report page calls that same generator (`reportDeepLinkAction`). No Claude call. Firm logo and colours come from the accountant profile. A sign-off stamp is whatever review row already exists for that scope (`financials`, `cash_forecast`, `profitability`, `budget`). Download does not create the stamp.

The owner board (`src/routes/app.tsx`) does not mount this studio. Owners do not get these eleven PDFs from their own door.

### 2. Advisory pack

`buildAdvisoryPack` (`src/lib/advisory-pack.ts`) is deterministic. Health, ratios, forecast closings, recommendations, and open data requests become named sections. No model call.

`generateAdvisoryPack` (`src/lib/advisory-pack.functions.ts`) loads those inputs under the caller’s RLS and writes through `advisory_pack_create`. The RPC versions the pack and supersedes the previous open one.

The panel (`src/components/advisory-pack-panel.tsx`) is on the accountant Reports → Advisory pack page (`section=drafts`) and on the owner Next moves tab. With a firm attached, the accountant signs off and the owner reads. Without a firm, the owner can generate. PDF export is `src/lib/advisory-pack-pdf.ts` → `src/reports/advisory-pack.tsx`, with the draft line “Draft for accountant review. Not sent.” Export is a person clicking download.

Chat can also create a pack. See the create path below. That path uses the rules generator (`p_generator: "rules"`), not Opus.

### 3. Draft tool and Client Brain drafts

**Draft tool** (`section=draft-tool`, `src/components/advisory-drafter.tsx`) calls the Node server function `draftAdvisory` (`src/lib/advisory.functions.ts`). Model is Node `CLAUDE_MODEL` (`src/lib/claude-config.ts`), Sonnet 5.5 unless that env is set. Kinds: client email, meeting agenda, exec summary. The person copies or logs a delivery. It does not build a catalogue PDF.

**Client Brain drafts** (`src/components/client-brain-drafts.tsx`) list `deliverable_drafts`. Creation is the edge function `brain-deliverable-draft`. It calls Claude with `CLAUDE_MODEL` (Sonnet path), writes `status=draft` only, and never sends. Kinds: `advisory`, `client_email`, `meeting_agenda`, `exec_summary`. Caps: 3 open drafts, 8 per window. The smoke README warns that a smoke stub of this function breaks Draft advisory. This slice does not redeploy it.

**Client library** (`section=documents`) is uploaded files and the Sonnet read of those files. It is not a report generator.

### 4. What the chat does when someone asks

Accountant chat is `src/lib/ask-ai.js`, mounted on the client page and on the practice thread (`#ask-financial-manager`). Owner chat is `askOwnerAgent` (`src/lib/owner-ask.ts`) from the owner door. Both send the agent key. Neither selects Opus.

Routing in `src/lib/milon-bot-copy.ts`:

- A question stays a question. `isQuestionPrompt` refuses a trailing `?` and the usual question openers.
- `persistedCreateIntent` fires only on an imperative with `create|draft|generate|build|write|make|prepare|produce`, plus either `pdf` or `advisory|deliverable|pack`, or an action-plan phrase. The word `report` alone does not match. “Produce a client report” does not write anything today.
- A match on the accountant widget calls `milon-bot` `mode: "create"` (`persistAdvisoryCreate`). That invokes `brain-deliverable-draft` (Sonnet), then `advisory_pack_create` with the rules pack, and optionally action-plan rows. If the sentence contained `pdf`, the client downloads the **Action Plan** PDF (`downloadActionPlanPdf` in `clients.$clientId.tsx`), not a scorecard or cash forecast.
- `Objective:` runs the milon-bot agent loop (`supabase/functions/_shared/agent-core/loop.ts`) on `CLAUDE_MODEL`. Its `draft_deliverable` tool calls `brain-deliverable-draft`. It is not the Financial Manager allow-list.
- Anything else on a numbers question goes to `ask-ai`, which hard-codes `CLAUDE_MODEL` (`supabase/functions/ask-ai/anthropic.ts`). The Financial Manager persona there is a prompt paragraph only (`askAiAgentPersona`). It tells the model not to claim figures were updated. It has no tools.

`callClaudeRound` in `milon-bot/claude.ts` can take a per-call `model`. Chat and the milon-bot objective loop omit it, so they stay on Sonnet. `scripts/claude-model-default-test.mts` locks that: `modelForAgent("milon-bot")` and `modelForAgent("ask-ai")` are Sonnet 5.5.

Owner `askOwnerAgent` never sends `mode: "create"`. An owner sentence that matches `routeMilonIntent` (the words “advisory pack”, “draft an advisory…”) hits milon-bot chat tools. A bare “produce the health scorecard” hits ask-ai and returns prose.

### 5. What the Opus Financial Manager does today

`agent-financial-manager` is a queue runner. `agent-dispatch` reads `agent_fm` only when `agent_settings.financial_manager_enabled` is true. The migration seeds that flag **false**. The HTTP entry accepts `service_role` only (`serveQueueRunner`). A signed-in accountant cannot call it from the browser.

The model is already Opus 5.5:

- `modelForAgent("financial_manager")` returns `claude-opus-5-5` (`src/lib/claude-request.ts`).
- The edge reads `CLAUDE_MODEL_FM` only for that agent (`supabase/functions/_shared/claude-model.ts`). Unset falls through to Opus. `.env.example` documents the override as optional and says not to point `CLAUDE_MODEL` at Opus.
- `runFinancialManagerJob` passes that id into `callClaudeRound`. Analyst and Advisor pass `modelForAgent` with the Sonnet standard and do not read `CLAUDE_MODEL_FM`.

The job objective is fixed: check books quality, saved cashflow, and budget; draft action points, data requests, or an accountant hand-off; proposals stay pending. It is not “write the report the person just asked for.” Triggers are `sync`, `upload`, `schedule`, `on_demand`, `message`, `retry`. Hand to / owner hand-off is the product path that enqueues it.

Allow-list (`src/lib/agent-financial-manager.ts`):

- Reads: `get_financial_snapshot`, `get_ratios`, `get_books_quality`, `get_cash_13_week`, `get_budget_status`, `get_inbox`, `get_team_findings`, `get_own_memory`.
- Writes: `record_draft`, `send_agent_message`, `propose_figure_adjustment`.

`record_draft` kinds are only `action_point_draft`, `data_request_draft`, `accountant_handoff_draft`. Rows go to `agent_findings` with `evidence.draft` and `requires_human_approval` (`src/lib/agent-draft.ts`). They do not become `deliverable_drafts`, advisory packs, or PDFs. Approval later (`liveRecordForDraft`) opens a data request, an action item, or an accountant request. It does not publish a report.

`propose_figure_adjustment` (#831) inserts `figure_proposals` with `status=pending` and `applied: false`. Confirm on the Cash, Budget, or waterfall page (`src/components/figure-proposals.tsx`) is the only apply path (`applyFigureProposal` requires `confirm: true`). The prompt forbids saying the figures were updated. There is no apply tool.

Caps: 6 iterations, **$0.06** ceiling (`FM_COST_CEILING_USD`). Opus list rates in `analystRunCostUsd` are double Sonnet 5.5 ($4 / $20 per million, cache write $5, cache read $0.20). The runner comment already says the unchanged ceiling can stop a run sooner. Adaptive thinking is billed as output. Opus tool turns must echo thinking blocks (`assistantContentForModel`).

User-facing prompts must not name the model vendor (`FINANCIAL_MANAGER_SYSTEM`).

## What “produce a client report when asked” means

It does not mean any of the paths above.

| Ask | What happens now | Model |
| --- | --- | --- |
| “What’s our gross margin?” in the FM thread | ask-ai prose | Sonnet (`CLAUDE_MODEL`) |
| “Draft the advisory pack now” (accountant widget) | Brain draft + rules advisory pack. Not a catalogue PDF | Sonnet, then no model |
| “Generate a PDF” / “create an action plan PDF” | Action Plan PDF download, plus the create writes above | Sonnet |
| “Produce a client report” | No write. The word report is not a create intent | Sonnet prose if it is a question; otherwise still not a PDF |
| Hand to Financial Manager | Queue job, three draft kinds, optional figure proposal | Opus 5.5 |
| Reports → Health scorecard → download | Existing React-PDF builder | None |

The slice is the gap between the last two rows: an imperative ask to the Financial Manager for a catalogue PDF, answered by the Opus runner, with bytes from the builder the person already has.

## First slice

Ship this and stop.

1. **Who.** Accountant, on a client, in the Financial Manager thread (client page `agent=financial_manager`, or the practice `#ask-financial-manager` thread once a client is chosen). Owner is not in this slice. See open questions.
2. **Which reports.** The five rail PDFs only: `scorecard`, `forecast`, `waterfall`, `budget`, `benchmark`. They already deep-link with `action=download`.
3. **Trigger.** An imperative sentence that names one of those five. Questions stay on ask-ai. “Produce a client report” with no named report does not guess. “Generate a PDF” with no catalogue name must not fall through to the Action Plan PDF.
4. **Model.** The decision runs inside `agent-financial-manager` on the existing `modelForAgent("financial_manager", …)` call. Do not pass Opus into `ask-ai`, `milon-bot`, `brain-deliverable-draft`, or `draftAdvisory`. Do not set `CLAUDE_MODEL` or `CLAUDE_MODEL_FM`.
5. **Tool.** Add `prepare_client_report` to the FM allow-list only. Argument is one of the five keys. Result is `{ prepared: true, report_key, applied: false }`. It does not insert `deliverable_drafts`, does not call `advisory_pack_create`, does not call `applyFigureProposal`, and does not write `clients.cashflow`, `clients.budget`, or `clients.financials`.
6. **Bytes.** The reply links to the existing page, for example `/clients/<id>?tab=reports&section=scorecard&action=download`. `ReportsStudio` already generates that PDF. No new layout, no server-side React-PDF port.
7. **Figure changes in the same breath.** If the sentence also asks to change cash, budget, or waterfall numbers, the only write is `propose_figure_adjustment`. The PDF is built from the saved books. The pending patch is not in the file. Confirm stays on that page.
8. **Publish.** Download is not send and not sign-off. Sent history and the review stamp stay human actions.
9. **Queue flag.** `financial_manager_enabled` defaults to false, and the runner HTTP entry is service-role only. A chat ask cannot POST the function from the browser. The implementation has to enqueue an `on_demand` job (trigger already allowed) or add a user-authenticated wrapper that still uses this runner. Either way the Opus call stays in this function. Confirm the flag is on in the target project before calling the slice done. If the flag is off, dispatch will not run the job.
10. **Cost.** Do not raise the $0.06 ceiling in this slice. One extra tool round on the current prompt should fit. If a measured run stops at `cost_ceiling` before the tool, that is a follow-up with a number, not a silent bump.

Eng2 owns copy, nav, billing, settings, and layout. This slice uses routes and the download action that already exist. The only Eng2 hook, if the reply cannot be a plain link, is a button on the Financial Manager thread that navigates to that same `action=download` URL. No new report chrome, no tab rename, no billing change.

## Later slices

- The other six catalogue keys, and “All reports” as a zip. They have builders and no dedicated rail section.
- Owner parity: the owner door has no Reports studio. A later slice needs an Eng2 download hook on the owner Financial Manager thread that calls the same builders, or an explicit decision that owners only receive a pack the accountant has already sent.
- Advisory pack and Draft tool on Opus. They are separate products (rules pack, Brain draft, Node drafter). Moving them is not required for “a client report.”
- A report narrative written by the model inside the PDF. That is a new template. It waits on Theo samples and is the #833 shape. Do not start it here.
- Auto-send, auto sign-off, or writing the PDF into Client library.
- Raising the FM cost ceiling after a measured Opus run.

## Gaps

- **Permissions.** FM cannot call `draft_deliverable`, `advisory_pack_create`, or any PDF tool. milon-bot can draft a Brain row and a rules pack, and it is not FM and not Opus.
- **Routing.** The agent key on the chat request changes the persona and the history scope. It does not change the model. Create-intent steals some “generate … pdf” sentences into the Action Plan PDF.
- **Storage.** Catalogue PDFs are not stored. A download is a blob in the browser. `advisory_deliveries` records a send when a person logs one. `deliverable_drafts` are prose. `agent_findings` are the three FM draft kinds. A slice-1 tool result can live on the run trace. A new table is not required.
- **UI names in flight.** Rail labels are already Advisory pack, Draft tool, and Client library. Do not rename them in this work. `section=drafts` is the pack, not the agent-findings shelf (`AgentDraftShelf` is a different list).
- **Owner.** No catalogue, no create mode, no Opus. Asking the owner Financial Manager for a scorecard returns Sonnet prose.
- **Ops.** Runner flag defaults off. Service-role gate. $0.06 versus Opus rates.
- **Sign-off copy.** The FM prompt forbids the words “signed off.” A report that already has a stamp can still show it, because the builder reads the review row. The model must not claim it signed the file.

## Files a later implementation would touch

Not this PR.

| File | Why |
| --- | --- |
| `src/lib/agent-financial-manager.ts` | Allow-list, labels, run outcome |
| `supabase/functions/_shared/agent-prompts/financial-manager.ts` | Tool schema and the “do not say it was sent” rules |
| `supabase/functions/agent-financial-manager/execute.ts` | `prepare_client_report` |
| `supabase/functions/_shared/agent-core/loop.ts` | Trace line for the new tool, same shape as `propose_figure_adjustment` |
| `src/lib/milon-bot-copy.ts` and `src/lib/ask-ai.js` | FM-thread imperative for a named catalogue report must not take the Action Plan create path. Other agents unchanged |
| `src/lib/owner-ask.ts` | Leave owner on the current router in slice 1 |
| `scripts/claude-model-default-test.mts` | Keep the Sonnet locks. Extend only if a new call site appears |

Do not edit `src/reports/*`, `reports-studio.tsx` layout, Draft tool, Advisory pack panel, Client library, billing, or settings for slice 1.

**Migration:** none. `figure_proposals` already exists.

**Edge redeploy, when the slice is built:** `agent-financial-manager` only. Do not redeploy `ask-ai`, `milon-bot`, `brain-deliverable-draft`, `brain-propose`, `agent-analyst`, or `agent-advisor`. Do not change Supabase secrets. Leave `CLAUDE_MODEL_FM` unset.

## Test plan

- Existing `scripts/claude-model-default-test.mts`: Financial Manager is Opus; Analyst, Advisor, ask-ai, and milon-bot are Sonnet; Node `CLAUDE_MODEL` is not Opus; `.env.example` still says not to point `CLAUDE_MODEL` at Opus.
- New unit: `prepare_client_report` accepts only the five keys, returns `applied: false`, and has no path into `applyFigureProposal`, `deliverable_drafts`, or `advisory_pack_create`.
- New unit: “Produce the health scorecard” on the FM thread is the report tool, not `persistedCreateIntent`’s Action Plan PDF. “What’s the health score?” stays a question. “Generate a PDF” with no catalogue name does not download the Action Plan.
- Existing figure-proposal tests: Confirm is still required. A report tool result does not change stored cash, budget, or financials.
- Runner cost test: a one-tool report turn on Opus rates stays under $0.06, or the test records the overrun instead of raising the ceiling inside the same change.

## AQA smoke sketch

Accountant, one client that already has statements. Financial Manager thread. Flag `financial_manager_enabled` on in that project, or the Opus job will not start.

1. “What’s our gross margin?” Answer is prose. No PDF, no new `figure_proposals` row, cash / budget / financials unchanged. Analyst thread still answers on the next try (model unchanged).
2. “Produce the health scorecard.” Opus run records `prepare_client_report` / `scorecard`. The reply opens Reports → Health scorecard and the existing PDF downloads. It is not the Action Plan PDF. Sent history does not grow. The review stamp does not flip to signed off by itself.
3. “Generate a PDF.” No Action Plan download. The reply asks which of the five, or does nothing, matching the open question below.
4. “Set opening cash to 50000 and produce the 13-week cash forecast.” A pending cash proposal appears on the Cash page. The PDF uses the previous saved forecast. Confirm applies the patch. Reject leaves the books as they were. The model reply does not say the forecast was updated.
5. Same sentence in the Analyst thread and the Advisor thread: no `prepare_client_report`, and the model id on those runs is still Sonnet.
6. Owner Financial Manager thread, same “produce the health scorecard”: no catalogue PDF in this slice. Record that the reply did not pretend a file was sent.

## Non-goals

- Reviving #833, including any new Advisory Management Report layout, narrative, or sample pack. Part 4 waits on Theo’s samples.
- Setting `CLAUDE_MODEL` to Opus, or setting `CLAUDE_MODEL_FM` in the environment. Wiring stays `modelForAgent` plus the optional FM override.
- Moving Analyst, Advisor, ask-ai, milon-bot, Brain draft, or the Draft tool onto Opus.
- Silent writes to the ledger, cash forecast, budget, or waterfall. Figure changes stay propose → Confirm.
- Email, sign-off, or “Sent” as a side effect of producing the file.
- New PDF templates, a Deno port of React-PDF, or storing PDF bytes.
- Renaming Advisory pack, Draft tool, or Client library.
- Owner-side catalogue parity in the first slice.
- Eng2 work on copy, nav, billing, settings, or layout beyond the download URL that already exists.

## Open questions for Theo / CoS

1. **Which file is “a client report”?** This note uses the five rail PDFs. If Theo means the advisory pack, the exec summary, or the eleven-PDF zip, slice 1 is the wrong cut.
2. **Unnamed ask.** “Produce a client report” and “Generate a PDF” name no key. Should the reply list the five, or is that sentence out of scope until the person names one?
3. **Who may publish?** Download is local. Is the accountant the only person who may mark it sent? Does the owner ever receive the file before sign-off?
4. **Owner ask.** Is the owner Financial Manager supposed to produce the same PDF in a later slice, or only read what the accountant sent?
5. **Runner flag.** Is `financial_manager_enabled` on in the project where this should be tried? If it is off, the Opus job will not run until someone turns that setting on.
6. **Templates.** Any sentence that needs a layout other than the current eleven builders waits on samples. Do not start that work from this note.
