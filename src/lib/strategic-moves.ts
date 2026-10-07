/**
 * Strategic Moves — the ranked list the owner board and the accountant
 * Action Plan both import. Titles are the first playbook step for each ratio.
 * Rank once here so Moves and Plan cannot drift.
 */
import type { ClientOperatingProfile } from "@/lib/client-profile";
import { profilePriorityWeight } from "@/lib/profile-signals";

export type StrategicCynefin = "Clear" | "Complicated" | "Complex" | "Chaotic";
export type StrategicEisenhower = "Do" | "Decide" | "Delegate" | "Delete";

export type StrategicMoveEntry = {
  key: string;
  /** First playbook step. This is the action title Plan stores. */
  title: string;
  ratioName: string;
  icon: string;
  actions: string[];
  impact: number;
  impactLine: string;
  cynefin: StrategicCynefin;
};

export type RankedStrategicMove = StrategicMoveEntry & {
  eisenhower: StrategicEisenhower;
  health: number;
  score: number;
};

export const STRATEGIC_MOVE_CATALOG: readonly StrategicMoveEntry[] = [
  {
    key: "taxBurden",
    title: "Claim every legal deduction & R&D credit you qualify for",
    ratioName: "Tax Survival Rate",
    icon: "🏛️",
    actions: ["Claim every legal deduction & R&D credit you qualify for", "Time big purchases to fall in high-profit years", "Use a tax-efficient business structure (LLC, S-Corp, etc.)"],
    impact: 6,
    impactLine: "Smarter tax structure keeps more profit in the business with no extra sales needed.",
    cynefin: "Complicated",
  },
  {
    key: "interestBurden",
    title: "Refinance high-interest loans at lower rates",
    ratioName: "Debt Drag",
    icon: "⛓️",
    actions: ["Refinance high-interest loans at lower rates", "Pay down the most expensive debt first (avalanche)", "Renegotiate terms with banks once revenue grows"],
    impact: 8,
    impactLine: "Cutting interest expense flows straight to net profit and lowers bankruptcy risk.",
    cynefin: "Complicated",
  },
  {
    key: "operatingMargin",
    title: "Raise prices on your best-selling products",
    ratioName: "Profit Power",
    icon: "⚔️",
    actions: ["Raise prices on your best-selling products", "Cut low-margin SKUs and focus on winners", "Negotiate better rates with suppliers"],
    impact: 10,
    impactLine: "Lifts every dollar of revenue straight into profit — biggest direct hit on net income.",
    cynefin: "Complicated",
  },
  {
    key: "assetTurnover",
    title: "Sell or lease idle equipment and unused property",
    ratioName: "Asset Engine",
    icon: "⚙️",
    actions: ["Sell or lease idle equipment and unused property", "Run more shifts on existing machines", "Speed up inventory turnover with smaller, frequent orders"],
    impact: 6,
    impactLine: "More sales per dollar of assets means higher returns without extra investment.",
    cynefin: "Complicated",
  },
  {
    key: "equityMultiplier",
    title: "Reinvest profits to grow equity organically",
    ratioName: "Leverage Level",
    icon: "🛡️",
    actions: ["Reinvest profits to grow equity organically", "Pay down debt to lower the ratio if it's too high", "Bring in equity partners instead of more loans"],
    impact: 7,
    impactLine: "Right-sizing leverage protects you in a downturn — the #1 driver of survival.",
    cynefin: "Complex",
  },
  {
    key: "netMargin",
    title: "Increase prices where customers are loyal",
    ratioName: "Bottom-Line Strength",
    icon: "💰",
    actions: ["Increase prices where customers are loyal", "Eliminate waste in operations and shipping", "Renegotiate recurring expenses annually"],
    impact: 10,
    impactLine: "The single best gauge of true profitability — fixing it compounds across all sales.",
    cynefin: "Complicated",
  },
  {
    key: "roa",
    title: "Sell underperforming assets",
    ratioName: "Asset Productivity",
    icon: "🏭",
    actions: ["Sell underperforming assets", "Improve product mix toward higher-margin lines", "Reduce inventory sitting on shelves"],
    impact: 7,
    impactLine: "Combines margin and efficiency — moving it proves the operation actually works.",
    cynefin: "Complex",
  },
  {
    key: "roe",
    title: "Raise margins (price, mix, cost control)",
    ratioName: "Shareholder Return",
    icon: "👑",
    actions: ["Raise margins (price, mix, cost control)", "Increase sales velocity from current assets", "Use measured leverage to amplify returns"],
    impact: 9,
    impactLine: "Top-of-funnel score for owners — moves only when profit, efficiency or leverage move.",
    cynefin: "Complex",
  },
  {
    key: "debtorDays",
    title: "Invoice the same day work is done",
    ratioName: "Customer Pay Speed",
    icon: "📨",
    actions: ["Invoice the same day work is done", "Offer 2% discount for paying within 10 days", "Charge late fees and enforce them"],
    impact: 8,
    impactLine: "Faster customer payment kills the #1 cause of small-business cash crunches.",
    cynefin: "Clear",
  },
  {
    key: "inventoryDays",
    title: "Move to just-in-time ordering",
    ratioName: "Stock Sitting Time",
    icon: "📦",
    actions: ["Move to just-in-time ordering", "Run promos to clear slow movers", "Forecast demand with last year's sales data"],
    impact: 7,
    impactLine: "Shrinks dead stock risk and unlocks shelf cash — direct hit on safety & margin.",
    cynefin: "Clear",
  },
  {
    key: "creditorDays",
    title: "Negotiate Net-60 or Net-90 terms with key suppliers",
    ratioName: "Supplier Pay Window",
    icon: "🤝",
    actions: ["Negotiate Net-60 or Net-90 terms with key suppliers", "Use a business credit card for an extra 30-day float", "Consolidate spending with fewer suppliers for leverage"],
    impact: 6,
    impactLine: "Stretching supplier terms is free working capital — zero interest cost.",
    cynefin: "Clear",
  },
  {
    key: "workingCapitalDays",
    title: "Get customers to pay faster (deposits, autopay)",
    ratioName: "Cash Trapped Days",
    icon: "💎",
    actions: ["Get customers to pay faster (deposits, autopay)", "Hold less inventory — order smaller, more often", "Stretch supplier payments to the agreed limit"],
    impact: 9,
    impactLine: "Frees trapped cash you can redeploy without raising debt — pure safety + growth fuel.",
    cynefin: "Complicated",
  },
  {
    key: "fixedCostRatio",
    title: "Move fixed contracts to variable / usage-based pricing",
    ratioName: "Fixed-Cost Burden",
    icon: "🏗️",
    actions: ["Move fixed contracts to variable / usage-based pricing", "Sub-let unused office or warehouse space", "Replace permanent hires with fractional / contract roles"],
    impact: 8,
    impactLine: "Heavy fixed costs trap you in a high break-even — every sale fights uphill.",
    cynefin: "Complicated",
  },
  {
    key: "dol",
    title: "Convert fixed costs into variable where possible",
    ratioName: "Downturn Risk",
    icon: "⚖️",
    actions: ["Convert fixed costs into variable where possible", "Build a recurring-revenue base to smooth swings", "Hold a 6-month operating cash reserve"],
    impact: 9,
    impactLine: "High operating leverage means a small dip in sales can wipe out profit — survival risk.",
    cynefin: "Complex",
  },
  {
    key: "customerConcentration",
    title: "Run a deliberate small-customer acquisition campaign",
    ratioName: "Customer Dependency",
    icon: "🎯",
    actions: ["Run a deliberate small-customer acquisition campaign", "Cap any single customer at 15% of revenue", "Productise services so smaller buyers can self-serve"],
    impact: 9,
    impactLine: "Losing one big customer can cripple the business — concentration is hidden bankruptcy risk.",
    cynefin: "Complex",
  },
  {
    key: "gpToLabor",
    title: "Automate repeat tasks to free people for higher-value work",
    ratioName: "Labor ROI",
    icon: "💪",
    actions: ["Automate repeat tasks to free people for higher-value work", "Tie variable pay to gross-profit contribution", "Cross-train staff so few people cover more functions"],
    impact: 8,
    impactLine: "Labor is the largest controllable cost in most SMEs — productivity here drives margin.",
    cynefin: "Complicated",
  },
  {
    key: "salesPerEmployee",
    title: "Use AI / software to extend the output of every employee",
    ratioName: "Sales per Employee",
    icon: "🧑‍💼",
    actions: ["Use AI / software to extend the output of every employee", "Lift average deal size before adding sales heads", "Standardise processes so 1 person handles more accounts"],
    impact: 7,
    impactLine: "Tells you when to hire, when to tool up, and which teams are over-staffed.",
    cynefin: "Complicated",
  },
  {
    key: "ocfToEbitda",
    title: "Tighten receivables collection to release trapped cash",
    ratioName: "Cash Quality",
    icon: "💧",
    actions: ["Tighten receivables collection to release trapped cash", "Cut inventory to convert stock into bank balance", "Stretch payables to the agreed limit"],
    impact: 9,
    impactLine: "If profit isn't turning into cash, the business is an accounting illusion — fix this first.",
    cynefin: "Complicated",
  },
  {
    key: "revenuePerFounderHour",
    title: "Document every founder-only task into an SOP",
    ratioName: "Founder Reliance",
    icon: "🦸",
    actions: ["Document every founder-only task into an SOP", "Hire or promote a #2 to own daily operations", "Replace founder time with software wherever possible"],
    impact: 8,
    impactLine: "If the business depends on the founder's hours, it can't scale and can't be sold.",
    cynefin: "Complex",
  },
  {
    key: "grossMargin",
    title: "Raise prices by 3–5% on your top-selling product lines",
    ratioName: "Gross Profit Margin",
    icon: "📊",
    actions: ["Raise prices by 3–5% on your top-selling product lines", "Renegotiate your top 3 supplier contracts for volume discounts", "Eliminate low-margin products that dilute the average"],
    impact: 10,
    impactLine: "Gross margin is the foundation of every profitability metric — improving it lifts the entire P&L.",
    cynefin: "Complicated",
  },
  {
    key: "directCostsRatio",
    title: "Audit and renegotiate your top 5 supplier contracts",
    ratioName: "Direct Cost Burden",
    icon: "🏗️",
    actions: ["Audit and renegotiate your top 5 supplier contracts", "Consolidate purchasing across product lines for volume pricing", "Reduce wastage and defect rates in production"],
    impact: 9,
    impactLine: "Every percentage point of COGS reduction falls directly to gross profit with no extra sales needed.",
    cynefin: "Clear",
  },
  {
    key: "fundingStructure",
    title: "Retain more profit instead of drawing dividends until ratio improves",
    ratioName: "Equity Solvency",
    icon: "🏦",
    actions: ["Retain more profit instead of drawing dividends until ratio improves", "Raise equity capital rather than additional debt", "Pay down long-term liabilities from retained earnings"],
    impact: 8,
    impactLine: "Equity buffer determines survival in a downturn — undercapitalised businesses fail first.",
    cynefin: "Complex",
  },
  {
    key: "workingCapitalUtilization",
    title: "Shorten debtor days — invoice same-day and collect earlier",
    ratioName: "WC Efficiency",
    icon: "🔄",
    actions: ["Shorten debtor days — invoice same-day and collect earlier", "Reduce inventory levels using tighter demand forecasting", "Negotiate extended payment terms with key suppliers"],
    impact: 7,
    impactLine: "Inefficient working capital traps cash that could fund growth — a silent drag on returns.",
    cynefin: "Complicated",
  },
  {
    key: "fixedCapitalUtilization",
    title: "Increase utilisation hours or shifts on existing equipment",
    ratioName: "Fixed Asset Productivity",
    icon: "⚙️",
    actions: ["Increase utilisation hours or shifts on existing equipment", "Dispose of or lease out assets with low utilisation rates", "Drive more revenue from current capacity before buying more assets"],
    impact: 7,
    impactLine: "Idle fixed assets reduce ROA and tie up capital that could generate returns elsewhere.",
    cynefin: "Clear",
  },
  {
    key: "workingCapitalFunding",
    title: "Reduce debtor days — invoice faster and collect more aggressively",
    ratioName: "WC Funding Intensity",
    icon: "💧",
    actions: ["Reduce debtor days — invoice faster and collect more aggressively", "Slim inventory to 20–30 days cover maximum", "Extend creditor days within supplier relationship limits"],
    impact: 8,
    impactLine: "High WC intensity means the business funds growth through trapped cash, not profit — fix it.",
    cynefin: "Complicated",
  },
  {
    key: "revenueGrowth",
    title: "Set a quarterly revenue target and track weekly progress",
    ratioName: "Revenue Momentum",
    icon: "📈",
    actions: ["Set a quarterly revenue target and track weekly progress", "Identify your top 3 growth levers (price, volume, mix) and test one per quarter", "Re-activate dormant customers with a targeted winback campaign"],
    impact: 10,
    impactLine: "Revenue growth compounds everything — higher sales lift margins, coverage ratios and valuation multiples simultaneously.",
    cynefin: "Complex",
  },
  {
    key: "capexIntensity",
    title: "Benchmark capex ratio against your sector before every major purchase",
    ratioName: "Growth Investment",
    icon: "🏗️",
    actions: ["Benchmark capex ratio against your sector before every major purchase", "Prioritise revenue-generating capex over maintenance capex", "Use lease/finance arrangements to spread capex over asset life"],
    impact: 6,
    impactLine: "Right-sizing capex frees cash for operations while ensuring the asset base keeps pace with growth.",
    cynefin: "Complicated",
  },
  {
    key: "assetReinvestmentRatio",
    title: "Aim for a ratio >1× in growth phases to outpace asset wear",
    ratioName: "Asset Reinvestment",
    icon: "🔄",
    actions: ["Aim for a ratio >1× in growth phases to outpace asset wear", "In mature phases hold ratio near 1× to sustain capacity", "Prioritise reinvestment in your highest-return asset classes"],
    impact: 7,
    impactLine: "A ratio below 1× signals the business is slowly consuming its asset base — long-run capacity risk.",
    cynefin: "Complicated",
  },
  {
    key: "currentRatio",
    title: "Target a current ratio between 1.5× and 3× for healthy liquidity",
    ratioName: "Cash Stability",
    icon: "💵",
    actions: ["Target a current ratio between 1.5× and 3× for healthy liquidity", "Reduce short-term debt by refinancing into longer-term facilities", "Speed up receivables collection to boost current assets"],
    impact: 9,
    impactLine: "Falling below 1× means current liabilities exceed current assets — insolvency risk is immediate.",
    cynefin: "Clear",
  },
  {
    key: "debtToEquity",
    title: "Target a D/E below 1× for conservative businesses, below 2× for growth",
    ratioName: "Debt-to-Equity",
    icon: "🏦",
    actions: ["Target a D/E below 1× for conservative businesses, below 2× for growth", "Redirect free cash flow to debt repayment before paying dividends", "Refinance short-term debt into longer-term facilities to reduce pressure"],
    impact: 8,
    impactLine: "Excessive debt erodes flexibility and signals distress to lenders — every extra rand of equity de-risks the business.",
    cynefin: "Complicated",
  },
  {
    key: "debtToAssets",
    title: "Keep D/A below 50% to maintain a buffer for lenders and creditors",
    ratioName: "Debt-to-Assets",
    icon: "⚖️",
    actions: ["Keep D/A below 50% to maintain a buffer for lenders and creditors", "Grow equity through retained profits rather than more debt", "Dispose of underperforming assets to right-size the denominator"],
    impact: 7,
    impactLine: "The higher debt funds your assets, the more vulnerable you are to a revenue shock or rate rise.",
    cynefin: "Complicated",
  },
];

function eisenhowerOf(health: number, impact: number): StrategicEisenhower {
  const urgent = Number.isFinite(health) && health < 60;
  const important = impact >= 7;
  if (urgent && important) return "Do";
  if (!urgent && important) return "Decide";
  if (urgent && !important) return "Delegate";
  return "Delete";
}

/**
 * Same ordering the owner Next moves tab uses: urgency from ratio health,
 * times impact, times the operating-profile weight. Top 10.
 */
export function rankStrategicMoves(input: {
  healthByKey?: Record<string, number | null | undefined> | null;
  profile?: ClientOperatingProfile | null;
  entries?: readonly StrategicMoveEntry[];
  limit?: number;
}): RankedStrategicMove[] {
  const entries = input.entries ?? STRATEGIC_MOVE_CATALOG;
  const healthByKey = input.healthByKey ?? {};
  const limit = input.limit ?? 10;
  return entries
    .map((entry) => {
      const raw = healthByKey[entry.key];
      const health = typeof raw === "number" && Number.isFinite(raw) ? raw : Number.NaN;
      const urgency = Number.isFinite(health) ? 100 - health : 50;
      const score = urgency * entry.impact * profilePriorityWeight(input.profile, entry.ratioName);
      return {
        ...entry,
        actions: [...entry.actions],
        health,
        score,
        eisenhower: eisenhowerOf(health, entry.impact),
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
