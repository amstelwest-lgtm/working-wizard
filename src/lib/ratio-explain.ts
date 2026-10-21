/**
 * Formula text for each ratio the drawer explains. The scoring registry
 * (metric-directions.ts) is the list of scored metrics. This object is the
 * formula each of those names quotes. Talk imports it; it does not keep a
 * second copy.
 */
export type RatioFormulaPack = {
  formula: string;
  hint: string;
  needed: string[];
  steps: string[];
};

export const RATIO_EXPLAIN: Record<string, RatioFormulaPack> = {
  "Net Margin": {
    formula: "Net income ÷ Revenue",
    hint: "How much of each sale is kept as profit.",
    needed: ["netIncome", "revenue"],
    steps: [
      "Confirm revenue and net income cover the same period.",
      "Walk the P&L from gross profit to net — flag any unusual below-the-line items.",
      "If the margin is thin, start with price and mix before cutting core capacity.",
      "Compare this period to the last signed-off snapshot, not a gut feel.",
      "Agree one owner action that lifts net profit without starving cash.",
    ],
  },
  "Operating Margin": {
    formula: "EBIT ÷ Revenue",
    hint: "Profit after operating costs, before interest and tax.",
    needed: ["ebit", "revenue"],
    steps: [
      "Reconcile EBIT to the waterfall operating-profit step.",
      "Split the gap between gross margin and operating margin into cost buckets.",
      "Test a 3–5% price lift on the strongest line first.",
      "Cut or renegotiate the largest overhead that does not generate sales.",
      "Do not hire into a weak operating margin without a payback date.",
    ],
  },
  "Gross Margin": {
    formula: "(Revenue − COGS) ÷ Revenue",
    hint: "What is left after the direct cost of making the sale.",
    needed: ["revenue", "cogs"],
    steps: [
      "Confirm COGS includes only costs that move with sales.",
      "Check product-line unit cost vs selling price for the biggest line.",
      "Renegotiate the top supplier or drop the weakest SKU.",
      "Reprice anything selling below a healthy unit margin.",
      "Keep fixed overhead out of COGS so this ratio stays comparable.",
    ],
  },
  "Return on Equity": {
    formula: "Net income ÷ Equity (when equity is positive)",
    hint: "Return the owners earn on the capital left in the business.",
    needed: ["netIncome", "equity"],
    steps: [
      "Skip the ratio if equity is negative — it is not meaningful.",
      "Check whether profit or a thin equity base is driving the number.",
      "If leverage is high, pair this with the equity multiplier before celebrating.",
      "Retained earnings vs drawings: confirm owners are not stripping the base.",
      "Set a target ROE the owner can fund without new debt.",
    ],
  },
  "Return on Assets": {
    formula: "Net margin × Asset turnover",
    hint: "How hard the asset base works to produce profit.",
    needed: ["netIncome", "revenue", "totalAssets"],
    steps: [
      "Split ROA into margin vs turnover — fix the weaker leg first.",
      "Idle assets (old stock, unused kit) drag this even when sales look fine.",
      "Write down or sell assets that no longer earn their keep.",
      "Do not add capex until existing assets are utilised.",
      "Re-check after the next period close — this moves slowly.",
    ],
  },
  "Asset Turnover": {
    formula: "Revenue ÷ Total assets",
    hint: "Sales generated per rand of assets on the books.",
    needed: ["revenue", "totalAssets"],
    steps: [
      "Confirm total assets is the latest balance-sheet total, not a stale figure.",
      "If turnover is low, look at stock, debtors and unused fixed assets.",
      "Tighten the cash-conversion cycle before buying more kit.",
      "Seasonal businesses should be judged on the annualised figure.",
      "Agree a utilisation target for the largest asset class.",
    ],
  },
  "Equity Multiplier": {
    formula: "Total assets ÷ Equity",
    hint: "How leveraged the balance sheet is.",
    needed: ["totalAssets", "equity"],
    steps: [
      "A high multiplier means creditors fund most of the assets.",
      "Pair this with interest burden — cheap debt is different from strained debt.",
      "If equity is thin, stop drawings until the buffer is rebuilt.",
      "Map debt facilities and covenants before recommending more borrowing.",
      "A lower multiplier with healthy assets is usually safer than a spectacular ROE.",
    ],
  },
  "Interest Burden": {
    formula: "EBT ÷ EBIT (when EBIT is positive)",
    hint: "How much operating profit survives after lenders.",
    needed: ["ebt", "ebit"],
    steps: [
      "List every facility with rate, balance and instalment.",
      "Refinance the most expensive debt first.",
      "Do not use overdraft as permanent working-capital funding.",
      "If EBIT is negative the ratio is not meaningful — fix operations first.",
      "Direct a slice of monthly profit to the highest-rate balance.",
    ],
  },
  "Tax Burden": {
    formula: "Net income ÷ EBT (when EBT is positive)",
    hint: "How much pre-tax profit is kept after tax.",
    needed: ["netIncome", "ebt"],
    steps: [
      "Confirm the tax figure matches the return, not a plug.",
      "Review timing of deductions before year-end.",
      "Separate personal and business spend so deductions are defensible.",
      "A very high keep-rate can mean deferred tax — do not treat it as cash.",
      "Book a planning call if the rate is far from the statutory band.",
    ],
  },
  "Debtor Days": {
    formula: "(Receivables ÷ Revenue) × 365",
    hint: "How long customers take to pay, annualised.",
    needed: ["receivables", "revenue"],
    steps: [
      "Age the debtor book — the average hides 90-day accounts.",
      "Invoice the same day work is delivered.",
      "Call the oldest 10 invoices this week.",
      "Tighten terms for new work if days sit above the peer band.",
      "Stop supplying chronic late payers without a payment plan.",
    ],
  },
  "Inventory Days": {
    formula: "(Inventory ÷ COGS) × 365",
    hint: "How long stock sits before it is sold.",
    needed: ["inventory", "cogs"],
    steps: [
      "Service businesses with no stock should show near-zero days.",
      "Identify dead stock and write it down or discount it.",
      "Match purchase orders to recent sell-through, not habit.",
      "A spike here usually means cash is trapped on the shelf.",
      "Set a maximum days target per product line.",
    ],
  },
  "Creditor Days": {
    formula: "(Payables ÷ COGS) × 365",
    hint: "How long the business takes to pay suppliers.",
    needed: ["payables", "cogs"],
    steps: [
      "Longer days help cash — until suppliers cut terms or supply.",
      "Check that days are agreed terms, not overdue invoices.",
      "Pay strategic suppliers on time; stretch only where it is contracted.",
      "A sudden drop can signal a cash squeeze already in progress.",
      "Reconcile the AP ledger before using this in an owner conversation.",
    ],
  },
  "Working Capital Days": {
    formula: "Debtor days + Inventory days − Creditor days",
    hint: "Cash tied up in the operating cycle.",
    needed: ["receivables", "inventory", "payables", "revenue", "cogs"],
    steps: [
      "This is the cash conversion cycle — shorter is usually healthier.",
      "Fix the largest of debtor, inventory or creditor days first.",
      "A long cycle with thin cash is the classic SME squeeze.",
      "Do not grow sales into a longer cycle without a funding plan.",
      "Re-forecast the 13-week cash once this number moves.",
    ],
  },
  "Fixed Cost Ratio": {
    formula: "Fixed costs ÷ Revenue",
    hint: "How much of sales is locked into overhead.",
    needed: ["fixedCosts", "revenue"],
    steps: [
      "Confirm fixed costs are truly fixed — not misclassified COGS.",
      "A high ratio makes profit very sensitive to a sales dip.",
      "List the top five overhead lines and challenge each one.",
      "Convert a cost to variable where a supplier will take volume risk.",
      "Do not add rent, software or headcount until the ratio is in band.",
    ],
  },
  "Degree of Operating Leverage": {
    formula: "(Revenue − Variable costs) ÷ EBIT",
    hint: "How sharply profit moves when sales move.",
    needed: ["revenue", "variableCosts", "ebit"],
    steps: [
      "High DOL means a small sales drop wipes out profit.",
      "Moderate leverage is healthier than extreme sensitivity.",
      "If EBIT is near zero the ratio will look wild — fix the base first.",
      "Grow the contribution margin before adding more fixed cost.",
      "Use this when deciding whether a new hire is affordable.",
    ],
  },
  "Top-5 Customer Share": {
    formula: "Top-5 customer revenue ÷ Revenue",
    hint: "How concentrated the order book is.",
    needed: ["top5Revenue", "revenue"],
    steps: [
      "Name the five accounts and their share in writing.",
      "A single dominant payer is a going-concern risk.",
      "Win one new account in a different channel this quarter.",
      "Tighten terms and deposits on the largest account.",
      "Do not build capacity that only one customer can fill.",
    ],
  },
  "Gross Profit / Labor": {
    formula: "(Revenue − COGS) ÷ Labor cost",
    hint: "Gross profit earned per rand of people cost.",
    needed: ["revenue", "cogs", "laborCost"],
    steps: [
      "If this is weak, headcount is ahead of the work it produces.",
      "Map people cost to product lines before hiring again.",
      "Overtime and contractors belong in the labor figure.",
      "Raise price or mix before adding another role.",
      "Set a minimum GP-per-labor hurdle for the next hire.",
    ],
  },
  "Sales-per-Employee Ratio": {
    formula: "Revenue ÷ Employees",
    hint: "Revenue generated per person.",
    needed: ["revenue", "employees"],
    steps: [
      "Count contractors who do production work, not just payroll headcount.",
      "A low figure usually means utilisation or pricing, not 'work harder'.",
      "Compare to the last period after annualising a short P&L.",
      "Do not hire until existing people are at a healthy run-rate.",
      "Pair this with GP / labor — revenue can rise while profit per head falls.",
    ],
  },
  "OCF / EBITDA": {
    formula: "Operating cash flow ÷ EBITDA",
    hint: "How much of earnings actually arrived as cash.",
    needed: ["operatingCashflow", "ebitda"],
    steps: [
      "A ratio well below 1 means profit is not converting to cash.",
      "The usual culprits are debtors, stock and unpaid tax.",
      "Reconcile EBITDA to the bank movement for the same period.",
      "If OCF is negative while EBITDA is positive, treat it as a cash emergency.",
      "Fix working-capital days before paying a dividend from 'profit'.",
    ],
  },
  "Revenue / Founder Hours": {
    formula: "Revenue ÷ Founder operational hours",
    hint: "Revenue produced per hour the founder works.",
    needed: ["revenue", "founderHours"],
    steps: [],
  },
  "COGS Ratio": {
    formula: "COGS ÷ Revenue",
    hint: "What fraction of every sale is consumed by direct costs.",
    needed: ["cogs", "revenue"],
    steps: [],
  },
  "Equity Ratio": {
    formula: "Equity ÷ Total assets",
    hint: "How much of the business is funded by owners vs creditors.",
    needed: ["equity", "totalAssets"],
    steps: [],
  },
  "Working Capital Turnover": {
    formula: "Revenue ÷ Net working capital",
    hint: "Sales generated per rand of working capital.",
    needed: ["revenue", "receivables", "inventory", "payables"],
    steps: [],
  },
  "Fixed Asset Turnover": {
    formula: "Revenue ÷ Fixed assets",
    hint: "How efficiently long-term assets generate revenue.",
    needed: ["revenue", "totalAssets", "receivables", "inventory"],
    steps: [],
  },
  "WC-to-Revenue": {
    formula: "(Debtors + Inventory − Creditors) ÷ Revenue",
    hint: "Working capital tied up per rand of revenue.",
    needed: ["receivables", "inventory", "payables", "revenue"],
    steps: [],
  },
  "Revenue Growth Rate": {
    formula: "(Revenue − Prior revenue) ÷ Prior revenue",
    hint: "Change in sales versus the prior period.",
    needed: ["revenue", "priorRevenue"],
    steps: [],
  },
  "Capex Intensity": {
    formula: "Capital expenditure ÷ Revenue",
    hint: "How much of revenue is ploughed back into assets.",
    needed: ["capex", "revenue"],
    steps: [],
  },
  "Asset Reinvestment Ratio": {
    formula: "Capex ÷ Depreciation",
    hint: "Below 1× you are consuming assets; above 1× you are expanding them.",
    needed: ["capex", "ebitda", "ebit"],
    steps: [],
  },
  "Current Ratio": {
    formula: "Current assets ÷ Current liabilities",
    hint: "How easily short-term obligations can be covered.",
    needed: ["currentAssets", "currentLiabilities"],
    steps: [],
  },
  "Debt-to-Equity": {
    formula: "Total liabilities ÷ Equity",
    hint: "Creditors versus owners. This is extracted total liabilities, not the interest-bearing facility schedule.",
    needed: ["totalLiabilities", "equity"],
    steps: [],
  },
  "Debt-to-Assets": {
    formula: "Total debt ÷ Total assets",
    hint: "Share of the asset base funded by debt.",
    needed: ["totalAssets", "equity"],
    steps: [],
  },
};


/**
 * Flow ÷ flow ratios are the same on the period and on the annualised year.
 * Day-count and stock ÷ flow ratios keep the annualised inputs the score uses.
 */
export const PERIOD_MONEY_RATIOS = new Set([
  "Net Margin",
  "Operating Margin",
  "Gross Margin",
  "Interest Burden",
  "Tax Burden",
  "Fixed Cost Ratio",
  "Degree of Operating Leverage",
  "Top-5 Customer Share",
  "Gross Profit / Labor",
  "OCF / EBITDA",
  "COGS Ratio",
  "Revenue Growth Rate",
  "Capex Intensity",
  "Asset Reinvestment Ratio",
]);

