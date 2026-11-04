# Analyst method questions still fall through to the line dodge

Second AQA miss, after #705 (merged as `9008195a`). On `/talk` the Analyst is asked "How do you calculate DSO?" and answers:

> I can explain the method without quoting the sample. Say which line you mean, and I will walk the steps in plain words.

An accountant asking that wants the formula the books use: receivables ÷ revenue × days in the period, naming which receivables, which revenue, and which period.

The method branch is keywords only. It is not a list of lines. The sentence above is a deterministic guard in `plainMethodReply`, not a line in the prompt. #705's test never sends DSO, so that fallback stays green.

## Cause

Two checks run, and they do different jobs.

`methodAsked` (`src/lib/prospect-talk.ts`) is three patterns in `METHOD_ASK`:

- "how do you calculate / work out / measure / …"
- "how is … calculated / measured / worked out"
- "how does … work"

A pricing question ("price", "cost", "how much") is excluded, so "how does pricing work?" stays a price answer. "How do you calculate DSO?" matches the first pattern. The letters DSO are not special. Debtor days and days AR are not special either.

`plainMethodReply` then chooses the words. It has two phrases:

- `\brunway\b` returns `PROSPECT_RUNWAY_METHOD`
- `\bgross margin\b` returns `PROSPECT_GROSS_MARGIN_METHOD`

Every other method question returns the sentence AQA saw. That sentence is the last `return` in `plainMethodReply`. A search of `prospectSystem` and `SHARED` in `src/lib/prospect-talk-prompts.ts` does not find it.

Before a name and email, `takeTurn` sets `figures` to `"hold"`. A held method question sets `skipModel`, so the model is not called. `replyFor` returns `plainMethodReply` and does not reach `guardProspectReply`. The prompt cannot replace the dodge on that path, and neither can a model.

After a lead, `figures` is `"allow"`. A method question then does call the model. The miss with this exact sentence is the pre-lead path.

## What that sentence withholds

The days the product quotes as Debtor Days (Days AR) are this calculation, not a request to name a line.

`computedDaysAr` in `src/lib/deliverable-input-config.ts`:

- Receivables are the statement stock figure `financials.receivables`. A blank is unknown. A stored zero stays zero.
- Revenue is `financials.revenue` on that same blob. When the stored figures-cover (`periodMonthsOf` in `src/lib/ratios.ts`) is 1–11 months, revenue is annualised (`revenue × 12 / months`). A missing or invalid cover is treated as 12, so the stored revenue is already a year.
- Days are `round(receivables / annualised revenue × 365)`.

That is receivables ÷ period revenue × the days in a 365-day year, scaled to the stored cover. A quarter of revenue is not left as a quarter and then multiplied by 90. `computeRatios` reaches the same shape: `annualiseFinancials`, then `operatingCycleDays` (`round(receivables / revenue × 365)` on that annualised revenue).

Ratios, Collections, Payables, and the scorecard quote this cover (`withCanonicalDebtorCreditorDays`, and the header of `src/lib/scorecard-rows.ts`). A health-score year span does not replace it, and a year-to-date span must not either. The label on the ratio is "AR / Revenue × 365" (`debtorDays` in `src/routes/app.tsx`).

`budget.bridges.ts` seeds a budget with `round(receivables / revenue × 365)` and does not annualise. That seed is not the quoted DSO. The quoted figure is `computedDaysAr`.

The dodge names none of those inputs and none of that period.

## Files

- `src/lib/prospect-talk.ts` — `METHOD_ASK`, `methodAsked`, `plainMethodReply`, and the two method strings. The dodge is the final return of `plainMethodReply`.
- `src/lib/prospect-talk-handler.ts` — `replyFor` returns `plainMethodReply` when figures are held and `methodAsked` is true. `takeTurn` skips the model in that case.
- `src/lib/prospect-talk-prompts.ts` — the public prompt. It does not contain the dodge.
- `src/lib/deliverable-input-config.ts` — `computedDaysAr`, the Days AR the other surfaces quote.
- `src/lib/ratios.ts` — `periodMonthsOf`, `annualiseFinancials`, `operatingCycleDays`.
- `scripts/prospect-talk-test.mts` — the #705 method assertions.

## Why #705's method test passed

#705 (`c8964824`, merged as `9008195a`) locks two phrases.

For the Financial Manager, the Analyst, and the Advisor, the only method message is "How do you work out cash runway?". The test expects `PROSPECT_RUNWAY_METHOD`, expects the model not to be called when the visitor text matches runway, and expects the reply not to be the figure gate.

The Analyst has one more message: "How is gross margin worked out?". The model stub returns "Say which line you mean." The test expects `PROSPECT_GROSS_MARGIN_METHOD`, and it expects the reply not to contain "say which line".

DSO is never sent. The fallback return in `plainMethodReply` is never what a test requires. The gross-margin case is the one method question whose stub is the dodge, and the assertion is that the dodge is absent for that one phrase. A green run of that test can sit next to "How do you calculate DSO?" returning the fallback.

## Not in this note

No reply text is changed here.
