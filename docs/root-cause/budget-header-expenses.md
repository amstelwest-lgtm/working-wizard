# Budget header Expenses includes cost of sales

## Cause

On US 1020E the header tile labelled Expenses is $359,980 and the table's expense section is $189,000. The difference is cost of sales, about $171,000. `budgetRangeTotals` adds `cogs + overheads + depreciation` and stores that sum in `expenses`. `budgetStatementDisplayTotals` then copies `planTotals.expenses` into the header tile named Expenses. The table keeps cost of sales on its own row and totals overheads (the expense section) separately, so the two numbers cannot match.

## Files

- `src/lib/budget-chart-table.ts` (`budgetRangeTotals`, `budgetStatementDisplayTotals`)
- `src/components/budget/budget-chart-table.tsx` (the Expenses tile and the period-total line)

## Why the #927 fix missed it

#927 made the header and the table share `planTotals` so a statement slice could not disagree with the plan. That removed one mismatch and left this one. The shared field was still defined as cost of sales plus overheads. The AQA table was already showing those as two rows. Matching the header to that combined field made Expenses look like COGS plus the table's Expenses.

## How it is verified

`scripts/budget-chart-table-test.mts` builds months whose cost of sales sums to 171,000 and whose overheads sum to 189,000. Header Expenses must be 189,000. Month chart labels are unchanged.
