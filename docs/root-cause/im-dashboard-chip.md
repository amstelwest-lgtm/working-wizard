# Dashboard Implementation Manager chip ignores the interview

## Cause

`/dashboard` renders `PracticeSetupCard` with a fixed chip "Not started" and the line "Takes ~10 min" inside `strong.owner-money`. The card never reads `milon_brain_rules`. `/practice/setup` reads the draft and shows "In progress". The two pages cannot agree.

`owner-money` is 16px and weight 600. The other home-card lines are `owner-voice` at 13.5px and weight 500. The metric is also inside the same voice span as the description, so it sits inline after that sentence.

The home grid is three columns unless a Tax Specialist card is present. Financial Manager, Analyst, Advisor, and Implementation Manager are four cards, so Implementation Manager wraps onto its own second row.

## Files

- `src/components/practice-setup-card.tsx`
- `src/components/owner-door/owner-door.css` (`.owner-money`, `.owner-agents`)
- `src/components/practice-board.tsx` (the card is `extraCard` on `/dashboard`)

## Why the earlier fix missed it

#927 and #929 set the chip copy and wrapped the metric in `owner-money` so it would look like a figure. That class is the numeric style, which is larger than the other cards' voice lines. The chip stayed a constant because the draft lived only on the setup page. The four-column rule was written for the Tax Specialist card only, so a firm without that card still uses three columns.

## How it is verified

`practiceSetupCardStatus` returns "In progress" when a draft exists, including when a plan also exists, and "Done" when only a plan exists. The card metric is an `owner-voice` line and not `owner-money`. At desktop width the home grid uses four columns when the Implementation Manager card is present.
