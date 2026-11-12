# Budget header tiles do not match the year table

Chill Pepper, Budget, This year (Mar 2026–Feb 2027). Header tiles showed Revenue R1 215 000, Expenses R762 000, Operating profit -R312 450. The This year vs last year table, Health, Analyst, the waterfall, and the PDF showed Revenue 1 215 000, COGS 56 000, Gross profit 1 159 000, Operating profit 56 800, Net 27 010. The header should be Expenses R1 158 200 and Operating profit R56 800. On US 1020E the header Operating profit was $52,020 while the table was $52,000. Header Expenses there should stay $189,000.

## Cause

`budgetStatementDisplayTotals` returned `budgetRangeTotals` whenever the seeded plan had any money. That sum is monthly overheads plus depreciation, and the monthly operating-profit sum. It is not the firm-year statement the year table reads.

Chill Pepper has no stored operating-expenses line. The plan still has overhead months, so the header used those (R762 000) and the plan's operating-profit sum (-R312 450). Revenue happened to match the statement. The year table uses `yearMoneyFromFiscalSlice`: stated EBIT R56 800. Header expenses that meet that profit are revenue minus operating profit, R1 158 200, which includes cost of sales because there is no separate expense line.

US 1020E does store operating expenses of $189,000 and EBIT of $52,000. The plan's monthly operating profit rounds to $52,020. Preferring the plan put $52,020 on the header.

## Files

- `src/lib/budget-chart-table.ts` (`budgetStatementDisplayTotals`)
- `src/lib/budget-period.ts` (`budgetHeaderFromSlice`)
- `src/components/budget/budget-chart-table.tsx` (the three tiles)
- `src/lib/budget-year-compare.ts` (the year table, same slice fields)

## Why the US header fix broke ZA

The expense-tile fix made the header copy the plan so US Expenses would be overheads ($189,000) and not cost of sales plus overheads. That is the right expense line when the statement stores operating expenses. On a ZA file with no operating-expenses field, the plan is a different number from the statement the rest of the page quotes. The tests checked a plan whose overheads were already $189,000. They did not put a statement operating profit next to a plan operating profit that disagreed, and they did not use a statement with cost of sales and no expense line.

## Sign-off

The Budget stamp is not a hash of the header tiles. `budgetPlanSnapshot` stores the plan document (revenue lines, overheads, capex, working-capital days). `budgetSignedFiguresChanged` compares that snapshot. `inputsChangedSinceSignoff` also voids the stamp when `financials_updated_at` is later than the signature. Changing the header formula does not rewrite the plan or the signature. This change does not re-sign.

## Verification

One helper builds the header from the firm-year slice the year table uses. Stated operating expenses win. With none, expenses are revenue minus operating profit. A plan total is used only when that slice is absent. ZA: expenses 1 158 200, operating profit 56 800. US: expenses 189 000, operating profit 52 000 even when the plan says 52 020. Owner and accountant both mount `BudgetPanel`.
