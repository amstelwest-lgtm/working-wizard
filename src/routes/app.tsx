import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState, useMemo, useEffect, lazy, Suspense, useRef, useCallback } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { ArrowLeft, Upload, Loader2, Sparkles, Send, Building2, Shield, Plug2 } from "lucide-react";
import { HeaderShareButton } from "@/components/share";
import { extractFinancials } from "@/lib/extract-financials.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { askYourNumbers } from "@/lib/ai.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { KpiTrendline, pctDelta } from "@/components/kpi-trendline";
import { BenchmarkBar } from "@/components/benchmark-bar";
import { AssignButton } from "@/components/assign-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { computeRatios, BUSINESS_TYPE_TO_BENCHMARK } from "@/lib/ratios";
import { FinancialInputsContext, type WeeklyInputs, type WeeklyRow, DEFAULT_WEEKLY_ROW } from "@/contexts/financial-inputs";
import { WeeklyInputTable } from "@/components/weekly-input-table";
import { ProfitabilityWaterfall } from "@/components/profitability-waterfall";
import { useTrack } from "@/hooks/use-track";
import { IndustryPulse } from "@/components/industry-pulse";
import { NoteLayer } from "@/components/note-layer";
import { AdminDashboard } from "@/components/admin-dashboard";

type Benchmark = { p25: number; p50: number; p75: number; unit: string; higher_is_better: boolean };

const RATIO_KEY_TO_SNAPSHOT: Record<string, string> = {
  taxBurden: "Tax Burden",
  interestBurden: "Interest Burden",
  operatingMargin: "Operating Margin",
  assetTurnover: "Asset Turnover",
  equityMultiplier: "Equity Multiplier",
  netMargin: "Net Margin",
  roa: "Return on Assets",
  roe: "Return on Equity",
  debtorDays: "Debtor Days",
  inventoryDays: "Inventory Days",
  creditorDays: "Creditor Days",
  workingCapitalDays: "Working Capital Days",
  fixedCostRatio: "Fixed Cost Ratio",
  dol: "Degree of Operating Leverage",
  customerConcentration: "Top-5 Customer Share",
  gpToLabor: "Gross Profit / Labor",
  salesPerEmployee: "Sales-per-Employee Ratio",
  ocfToEbitda: "OCF / EBITDA",
  revenuePerFounderHour: "Revenue per Founder Hour",
  grossMargin: "Gross Profit Margin",
  directCostsRatio: "Direct Cost Ratio",
  fundingStructure: "Equity Solvency",
  workingCapitalUtilization: "WC Efficiency",
  fixedCapitalUtilization: "Fixed Asset Productivity",
  workingCapitalFunding: "WC Funding Intensity",
  revenueGrowth: "Revenue Growth",
  capexIntensity: "Capex Intensity",
  assetReinvestmentRatio: "Asset Reinvestment Ratio",
  currentRatio: "Current Ratio",
  debtToEquity: "Debt-to-Equity",
  debtToAssets: "Debt-to-Assets",
};
const CashForecastPanel = lazy(() =>
  import("@/components/cash-forecast").then((m) => ({ default: m.CashForecastPanel })),
);
const TasksPanel = lazy(() =>
  import("@/components/tasks-panel").then((m) => ({ default: m.TasksPanel })),
);
import { TodayPanel, type TodayTask } from "@/components/today-panel";
import { SplashScreen } from "@/components/splash-screen";
import { WalkthroughWizard } from "@/components/walkthrough-wizard";
import { QboConnectCard } from "@/components/qbo-connect";
import { Button } from "@/components/ui/button";
import { type RatioInfo } from "@/components/holo-globe";
import { SphereHero } from "@/components/sphere-hero";
import { buildSpherePillars } from "@/components/sphere-hero-adapter";
import { SimplifiedRatios } from "@/components/simplified-ratios";
import { useViewMode } from "@/contexts/view-mode";

export const Route = createFileRoute("/app")({
  component: Index,
  head: () => ({
    meta: [
      { title: "Milōn · Operating Finance" },
      {
        name: "description",
        content:
          "Operating finance for owner-led businesses. Live ratios, cash runway and the next move that matters.",
      },
    ],
  }),
});

type Inputs = {
  netIncome: string;
  ebt: string;
  ebit: string;
  revenue: string;
  totalAssets: string;
  equity: string;
  cogs: string;
  receivables: string;
  inventory: string;
  payables: string;
  fixedCosts: string;
  variableCosts: string;
  top5Revenue: string;
  laborCost: string;
  employees: string;
  operatingCashflow: string;
  ebitda: string;
  founderHours: string;
  priorRevenue: string;
  currentAssets: string;
  currentLiabilities: string;
  capex: string;
  ppeGross: string;
  accumulatedDepreciation: string;
  priorPpeGross: string;
  priorAccumDep: string;
};

const defaults: Inputs = {
  netIncome: "120",
  ebt: "160",
  ebit: "200",
  revenue: "1000",
  totalAssets: "800",
  equity: "400",
  cogs: "600",
  receivables: "150",
  inventory: "120",
  payables: "90",
  fixedCosts: "300",
  variableCosts: "500",
  top5Revenue: "400",
  laborCost: "250",
  employees: "10",
  operatingCashflow: "180",
  ebitda: "240",
  founderHours: "2400",
  priorRevenue: "",
  currentAssets: "",
  currentLiabilities: "",
  capex: "",
  ppeGross: "",
  accumulatedDepreciation: "",
  priorPpeGross: "",
  priorAccumDep: "",
};

type RatioKey =
  | "taxBurden"
  | "interestBurden"
  | "operatingMargin"
  | "assetTurnover"
  | "equityMultiplier"
  | "netMargin"
  | "roa"
  | "roe"
  | "debtorDays"
  | "inventoryDays"
  | "creditorDays"
  | "workingCapitalDays"
  | "fixedCostRatio"
  | "dol"
  | "customerConcentration"
  | "gpToLabor"
  | "salesPerEmployee"
  | "ocfToEbitda"
  | "revenuePerFounderHour"
  | "grossMargin"
  | "directCostsRatio"
  | "fundingStructure"
  | "workingCapitalUtilization"
  | "fixedCapitalUtilization"
  | "workingCapitalFunding"
  | "revenueGrowth"
  | "capexIntensity"
  | "assetReinvestmentRatio"
  | "currentRatio"
  | "debtToEquity"
  | "debtToAssets";

type RatioMeta = {
  friendly: string;
  techName: string;
  formula: string;
  hint: string;
  icon: string;
  steps: string[]; // 5 strategic moves
  sop: string[]; // up to 5 practical SOP best-practice points
  videoSummary: string; // 5-min video synopsis (placeholder)
};

const RATIO_META: Record<RatioKey, RatioMeta> = {
  taxBurden: {
    friendly: "Tax Survival Rate",
    techName: "Tax Burden",
    formula: "Net Income / EBT",
    hint: "How much profit you keep after the taxman.",
    icon: "🏛️",
    steps: [
      "Claim every legal deduction & R&D credit you qualify for",
      "Time big purchases to fall in high-profit years",
      "Use a tax-efficient business structure (LLC, S-Corp, etc.)",
      "Contribute to retirement / pension plans pre-tax",
      "Hire a proactive tax advisor — not just a filer",
    ],
    sop: [
      "Book a tax-planning call every quarter — not just at year-end",
      "Keep a running 'deductions log' in one spreadsheet",
      "Pre-pay deductible expenses before fiscal year-end",
      "Separate personal and business cards 100%",
      "Run a year-end tax forecast in November every year",
    ],
    videoSummary: "Tax Burden 101 — how much of your pre-tax profit you actually keep, why it matters, and 5 legal levers to lower it.",
  },
  interestBurden: {
    friendly: "Debt Drag",
    techName: "Interest Burden",
    formula: "EBT / EBIT",
    hint: "How much profit survives after paying lenders.",
    icon: "⛓️",
    steps: [
      "Refinance high-interest loans at lower rates",
      "Pay down the most expensive debt first (avalanche)",
      "Renegotiate terms with banks once revenue grows",
      "Replace short-term debt with longer fixed-rate loans",
      "Use retained earnings instead of new borrowing",
    ],
    sop: [
      "List every loan with rate, balance, and maturity in one sheet",
      "Auto-direct 10% of monthly profit to highest-rate debt",
      "Re-quote loans annually with 3 banks for competitive offers",
      "Lock fixed rates when central bank rates dip",
      "Never use overdrafts for >30 days — refinance into a term loan",
    ],
    videoSummary: "Interest Burden — what % of operating profit lenders eat, and how to claw it back through refinancing and discipline.",
  },
  operatingMargin: {
    friendly: "Profit Power",
    techName: "Operating Margin",
    formula: "EBIT / Revenue",
    hint: "How much each R1 of sales becomes operating profit.",
    icon: "⚔️",
    steps: [
      "Raise prices on your best-selling products",
      "Cut low-margin SKUs and focus on winners",
      "Negotiate better rates with suppliers",
      "Automate manual tasks to lower payroll cost",
      "Reduce overhead: rent, software, subscriptions",
    ],
    sop: [
      "Review price list every 6 months — small 3–5% lifts compound",
      "Run a monthly margin-by-product report; cut bottom 20%",
      "Re-tender top 5 supplier contracts every 12 months",
      "Audit all SaaS subscriptions quarterly — kill unused tools",
      "Tie any new hire to a measurable revenue or savings target",
    ],
    videoSummary: "Operating Margin masterclass — the single biggest profitability lever and 5 practical ways to widen it.",
  },
  assetTurnover: {
    friendly: "Asset Engine",
    techName: "Asset Turnover",
    formula: "Revenue / Total Assets",
    hint: "How hard your assets are working to make sales.",
    icon: "⚙️",
    steps: [
      "Sell or lease idle equipment and unused property",
      "Run more shifts on existing machines",
      "Speed up inventory turnover with smaller, frequent orders",
      "Outsource non-core work instead of buying assets",
      "Push marketing to lift sales without adding capacity",
    ],
    sop: [
      "Tag every asset > R1k and record monthly utilisation %",
      "Sell or lease anything under 40% utilisation for 90 days",
      "Schedule equipment for a 2nd shift before buying more",
      "Adopt a 'rent before buy' policy on new capex",
      "Track sales-per-square-foot or per-machine monthly",
    ],
    videoSummary: "Asset Turnover — turn dormant assets into cash-generating muscle without raising more capital.",
  },
  equityMultiplier: {
    friendly: "Leverage Level",
    techName: "Equity Multiplier",
    formula: "Total Assets / Equity",
    hint: "How much you rely on debt vs. your own money.",
    icon: "🛡️",
    steps: [
      "Reinvest profits to grow equity organically",
      "Pay down debt to lower the ratio if it's too high",
      "Bring in equity partners instead of more loans",
      "Avoid dividend payouts until leverage is healthy",
      "Match debt maturity to asset life (no short loans on long assets)",
    ],
    sop: [
      "Set a maximum leverage ceiling and write it in the policy doc",
      "Re-test leverage every quarter against that ceiling",
      "Build a 6-month cash buffer before taking new debt",
      "Stress-test debt service at +3% interest rates",
      "Cap dividend payouts at 30% of net profit until ratio is healthy",
    ],
    videoSummary: "Equity Multiplier — leverage is rocket fuel, but too much of it explodes in a downturn.",
  },
  netMargin: {
    friendly: "Bottom-Line Strength",
    techName: "Net Margin",
    formula: "Net Income / Revenue",
    hint: "How much of every sale you actually keep.",
    icon: "💰",
    steps: [
      "Increase prices where customers are loyal",
      "Eliminate waste in operations and shipping",
      "Renegotiate recurring expenses annually",
      "Drop unprofitable customers and channels",
      "Track gross margin per product weekly",
    ],
    sop: [
      "Produce a 1-page monthly P&L with prior-month comparison",
      "Set a minimum acceptable net margin per channel",
      "Drop or re-price any customer below that floor",
      "Bonus managers on net margin, not revenue",
      "Review the top 5 cost lines every month for creep",
    ],
    videoSummary: "Net Margin — the truest single number of business health, and how to drag it upward.",
  },
  roa: {
    friendly: "Asset Productivity",
    techName: "Return on Assets",
    formula: "Net Margin × Asset Engine",
    hint: "Profit produced per R1 of assets owned.",
    icon: "🏭",
    steps: [
      "Sell underperforming assets",
      "Improve product mix toward higher-margin lines",
      "Reduce inventory sitting on shelves",
      "Use asset-light models (drop-shipping, leasing)",
      "Train staff to get more output per machine-hour",
    ],
    sop: [
      "Quarterly asset audit: keep, fix, sell, redeploy",
      "Maintain a target ROA in your annual plan",
      "Reward operations for output-per-asset improvement",
      "Lease, don't buy, equipment used <60% of the time",
      "Cut SKUs that drag down asset turns",
    ],
    videoSummary: "ROA — the operator's scorecard, blending margin and efficiency into one number.",
  },
  roe: {
    friendly: "Shareholder Return",
    techName: "Return on Equity",
    formula: "Asset Productivity × Leverage Level",
    hint: "What every R1 of your money earns each year.",
    icon: "👑",
    steps: [
      "Raise margins (price, mix, cost control)",
      "Increase sales velocity from current assets",
      "Use measured leverage to amplify returns",
      "Buy back equity when stock/shares are cheap",
      "Reinvest in your highest-ROIC projects only",
    ],
    sop: [
      "Decompose ROE monthly into the 5 DuPont levers",
      "Set a target ROE above your cost of equity",
      "Rank every project by ROIC before funding it",
      "Buy back equity when trading below book value",
      "Never let leverage alone drive ROE — operations must lead",
    ],
    videoSummary: "Return on Equity & the 5-step DuPont decomposition — see exactly which lever drives owner returns.",
  },
  debtorDays: {
    friendly: "Customer Pay Speed",
    techName: "Debtor / Receivable Days",
    formula: "AR / Revenue × 365",
    hint: "How long customers take to pay you.",
    icon: "📨",
    steps: [
      "Invoice the same day work is done",
      "Offer 2% discount for paying within 10 days",
      "Charge late fees and enforce them",
      "Require deposits on large orders",
      "Use automated reminders & online payment links",
    ],
    sop: [
      "Send the invoice within 24 hours of delivery — no exceptions",
      "Auto-reminder at days 7, 14, 21 past due",
      "Run a credit check on any customer over R5k order",
      "Phone-call follow-up at day 30 — humans pay humans",
      "Stop further work for any account over 60 days due",
    ],
    videoSummary: "Debtor Days — why the #1 cash crunch in SMEs is slow customer payment, and the playbook to fix it.",
  },
  inventoryDays: {
    friendly: "Stock Sitting Time",
    techName: "Inventory Days",
    formula: "Inventory / COGS × 365",
    hint: "How long stock sits before it sells.",
    icon: "📦",
    steps: [
      "Move to just-in-time ordering",
      "Run promos to clear slow movers",
      "Forecast demand with last year's sales data",
      "Drop SKUs that turn over less than 4× a year",
      "Negotiate consignment stock with suppliers",
    ],
    sop: [
      "Categorise inventory ABC by turn rate every month",
      "Set max stock-on-hand by SKU and enforce it",
      "Hold a 90-day clearance event on slow C-grade stock",
      "Reorder only when below the safety-stock threshold",
      "Match supplier MOQs to actual sell-through, not gut feel",
    ],
    videoSummary: "Inventory Days — find dead stock fast, free trapped cash, and run a leaner warehouse.",
  },
  creditorDays: {
    friendly: "Supplier Pay Window",
    techName: "Creditor / Payable Days",
    formula: "AP / COGS × 365",
    hint: "How long you take to pay suppliers.",
    icon: "🤝",
    steps: [
      "Negotiate Net-60 or Net-90 terms with key suppliers",
      "Use a business credit card for an extra 30-day float",
      "Consolidate spending with fewer suppliers for leverage",
      "Pay on the last day terms allow — not earlier",
      "Avoid early-pay if no real discount is offered",
    ],
    sop: [
      "Maintain a supplier-terms register with every contract date",
      "Default payment date = the last day of agreed terms",
      "Bundle small suppliers into one bigger contract for leverage",
      "Always benchmark new vendor terms vs. existing ones",
      "Never miss agreed terms — protect your trade reference",
    ],
    videoSummary: "Creditor Days — supplier credit is the cheapest financing on earth; here's how to use it without burning trust.",
  },
  workingCapitalDays: {
    friendly: "Cash Trapped Days",
    techName: "Working Capital Days",
    formula: "Customer Pay + Stock Time − Supplier Pay",
    hint: "Days your cash is locked in the business cycle.",
    icon: "💎",
    steps: [
      "Get customers to pay faster (deposits, autopay)",
      "Hold less inventory — order smaller, more often",
      "Stretch supplier payments to the agreed limit",
      "Use invoice financing for short cash gaps",
      "Review your cash conversion cycle every month",
    ],
    sop: [
      "Run the cash-conversion cycle report monthly",
      "Set a target WC-days number in the annual plan",
      "Tie team bonuses partly to WC-days improvement",
      "Always demand 30–50% deposits on big custom orders",
      "Use a credit line only for genuine seasonal swings",
    ],
    videoSummary: "Working Capital Days — the #1 silent killer of profitable companies, and the playbook to free your cash.",
  },
  fixedCostRatio: {
    friendly: "Fixed-Cost Burden",
    techName: "Fixed Costs / Revenue",
    formula: "Fixed Costs / Revenue",
    hint: "Share of revenue chewed up before you sell anything.",
    icon: "🏗️",
    steps: [
      "Move fixed contracts to variable / usage-based pricing",
      "Sub-let unused office or warehouse space",
      "Replace permanent hires with fractional / contract roles",
      "Renegotiate lease and insurance every renewal",
      "Lift revenue without adding overhead — scale into the base",
    ],
    sop: [
      "List every fixed cost > R500/month in one register",
      "Mark each as 'truly fixed' or 'fixable' in the next 12 months",
      "Renegotiate or kill 1 fixed line per month",
      "Never sign multi-year leases without an exit clause",
      "Set a fixed-cost-to-revenue ceiling in the annual plan",
    ],
    videoSummary: "Fixed Cost Ratio — when overhead becomes anchor, and how to either cut it or out-grow it.",
  },
  dol: {
    friendly: "Downturn Risk",
    techName: "Degree of Operating Leverage",
    formula: "Contribution Margin / EBIT",
    hint: "How much a small sales drop crushes profit. Lower = safer.",
    icon: "⚖️",
    steps: [
      "Convert fixed costs into variable where possible",
      "Build a recurring-revenue base to smooth swings",
      "Hold a 6-month operating cash reserve",
      "Diversify revenue across customer segments",
      "Stress-test profit at −20% revenue every quarter",
    ],
    sop: [
      "Calculate DOL every month — track the trend",
      "Run a downturn drill: model −20% and −40% revenue",
      "Pre-agree which costs cut first and how fast",
      "Convert at least 30% of cost base to variable",
      "Maintain 6 months of fixed-cost cash reserve",
    ],
    videoSummary: "Operating Leverage — why fixed costs amplify both wins and losses, and the survival playbook for downturns.",
  },
  customerConcentration: {
    friendly: "Customer Dependency",
    techName: "Top-5 Customer Share",
    formula: "Top 5 Cust. Revenue / Total Revenue",
    hint: "How exposed you are to losing a few key accounts.",
    icon: "🎯",
    steps: [
      "Run a deliberate small-customer acquisition campaign",
      "Cap any single customer at 15% of revenue",
      "Productise services so smaller buyers can self-serve",
      "Diversify into a second industry or geography",
      "Lock big customers into multi-year contracts to reduce loss risk",
    ],
    sop: [
      "Track customer-share monthly in a 1-page report",
      "Set a max-share rule (e.g. no client > 15%)",
      "Run quarterly outreach to add 5+ smaller logos",
      "Sign multi-year contracts with the top 3 accounts",
      "Build a churn-risk early-warning checklist for big accounts",
    ],
    videoSummary: "Customer Concentration — the silent killer when one big logo walks; how to measure and reduce dependency.",
  },
  gpToLabor: {
    friendly: "Labor ROI",
    techName: "Gross Profit / Labor Cost",
    formula: "(Revenue − COGS) / Labor Cost",
    hint: "Gross profit produced per R1 of payroll. Higher = leaner team.",
    icon: "💪",
    steps: [
      "Automate repeat tasks to free people for higher-value work",
      "Tie variable pay to gross-profit contribution",
      "Cross-train staff so few people cover more functions",
      "Cut roles that don't directly drive GP",
      "Outsource non-core support functions (admin, IT)",
    ],
    sop: [
      "Calculate GP-per-employee monthly and post it openly",
      "Set a minimum GP-per-employee target by team",
      "Replace low-output roles with automation tools",
      "Bonus 20% of pay tied to team GP improvement",
      "Annual workforce review: keep, train, redeploy, exit",
    ],
    videoSummary: "Gross Profit / Labor — the ratio that tells you if your team is paying for itself.",
  },
  salesPerEmployee: {
    friendly: "Sales per Employee",
    techName: "Sales-per-Employee Ratio (SER)",
    formula: "Revenue / Headcount",
    hint: "Top-line revenue every employee carries. Higher = leaner.",
    icon: "🧑‍💼",
    steps: [
      "Use AI / software to extend the output of every employee",
      "Lift average deal size before adding sales heads",
      "Standardise processes so 1 person handles more accounts",
      "Cut departments with low revenue contribution",
      "Hire only when current team is at 90%+ utilisation",
    ],
    sop: [
      "Track revenue-per-employee monthly vs. industry benchmark",
      "Freeze hiring until SER hits the target",
      "Map every role to a measurable revenue or savings line",
      "Invest in tooling before adding the next hire",
      "Run a 90-day onboarding plan with revenue milestones",
    ],
    videoSummary: "Sales per Employee — the productivity benchmark that tells you when to hire and when to tool up.",
  },
  ocfToEbitda: {
    friendly: "Cash Quality",
    techName: "Operating Cash Flow / EBITDA",
    formula: "OCF / EBITDA",
    hint: "How much accounting profit actually becomes cash. ~1.0 ideal.",
    icon: "💧",
    steps: [
      "Tighten receivables collection to release trapped cash",
      "Cut inventory to convert stock into bank balance",
      "Stretch payables to the agreed limit",
      "Re-time capex outside peak seasons",
      "Audit revenue recognition — avoid booking 'profit on paper'",
    ],
    sop: [
      "Reconcile cash to EBITDA every month and explain the gap",
      "Set an OCF/EBITDA target of ≥0.85 in the annual plan",
      "Investigate any month where the ratio drops <0.6",
      "Build a 13-week cash-flow forecast and update weekly",
      "Hold a monthly cash huddle with the owner + finance",
    ],
    videoSummary: "Operating Cash Flow vs EBITDA — separates real businesses from accounting illusions.",
  },
  revenuePerFounderHour: {
    friendly: "Founder Reliance",
    techName: "Revenue / Founder Hours",
    formula: "Revenue / Founder Operational Hours",
    hint: "Revenue produced per hour the founder works. Higher = less dependent.",
    icon: "🦸",
    steps: [
      "Document every founder-only task into an SOP",
      "Hire or promote a #2 to own daily operations",
      "Replace founder time with software wherever possible",
      "Move founder hours to growth, capital, M&A — not delivery",
      "Set a target founder workweek and enforce it",
    ],
    sop: [
      "Track founder hours weekly in a single timesheet",
      "Identify the top 5 tasks consuming founder time",
      "Build an SOP for each, then delegate or automate",
      "Cap founder operational hours per week (e.g. 25h)",
      "Re-measure revenue-per-founder-hour monthly",
    ],
    videoSummary: "Founder Reliance — why the business can't be sold (or scaled) until the founder isn't the engine.",
  },
  grossMargin: {
    friendly: "Gross Profit Margin",
    techName: "Gross Margin",
    formula: "(Revenue − COGS) / Revenue",
    hint: "How much revenue remains after direct production costs.",
    icon: "📊",
    steps: [
      "Raise prices by 3–5% on your top-selling product lines",
      "Renegotiate your top 3 supplier contracts for volume discounts",
      "Eliminate low-margin products that dilute the average",
      "Shift mix toward higher-value, higher-margin offerings",
      "Reduce production waste and material spoilage",
    ],
    sop: [
      "Track gross margin per product line and channel every month",
      "Flag any SKU below your minimum GM floor immediately",
      "Re-cost every product annually against current supplier pricing",
      "Review pricing every 6 months — cost inflation erodes margin silently",
      "Kill or re-price any SKU below the floor for 3 consecutive months",
    ],
    videoSummary: "Gross Margin — the foundation of all profitability and the first lever to pull when bottom-line results disappoint.",
  },
  directCostsRatio: {
    friendly: "Direct Cost Burden",
    techName: "COGS Ratio",
    formula: "COGS / Revenue",
    hint: "What fraction of every sale is consumed by direct production costs.",
    icon: "🏗️",
    steps: [
      "Audit and renegotiate your top 5 supplier contracts",
      "Consolidate purchasing across product lines for volume pricing",
      "Reduce wastage and defect rates in production",
      "Substitute materials with cost-equivalent alternatives",
      "Move to direct-manufacturer sourcing and cut intermediaries",
    ],
    sop: [
      "Pull a COGS line-item breakdown every month against budget",
      "Benchmark your COGS ratio against industry peers quarterly",
      "Put every major supplier contract out to re-tender every 18 months",
      "Track production waste as a % of COGS monthly",
      "Set a COGS ceiling as % of revenue and escalate any breach immediately",
    ],
    videoSummary: "COGS Ratio — controlling direct costs is the fastest path to widening gross margin without raising prices.",
  },
  fundingStructure: {
    friendly: "Equity Solvency",
    techName: "Equity Ratio",
    formula: "Equity / Total Assets",
    hint: "How much of the business is funded by owners vs creditors.",
    icon: "🏦",
    steps: [
      "Retain more profit instead of drawing dividends until ratio improves",
      "Raise equity capital rather than additional debt",
      "Pay down long-term liabilities from retained earnings",
      "Convert shareholder loans to permanent equity",
      "Avoid new borrowing until equity ratio is above 30%",
    ],
    sop: [
      "Track equity ratio on the balance sheet every month",
      "Set a minimum equity floor (e.g. 30%) and never let it breach",
      "Stress-test the balance sheet at −20% revenue every quarter",
      "Require board approval for any borrowing above a set threshold",
      "Present funding structure to all directors at every board meeting",
    ],
    videoSummary: "Funding Structure — the balance between debt and equity determines your resilience and long-term cost of capital.",
  },
  workingCapitalUtilization: {
    friendly: "WC Efficiency",
    techName: "Working Capital Turnover",
    formula: "Revenue / Net Working Capital",
    hint: "How many rands of sales each rand of working capital generates.",
    icon: "🔄",
    steps: [
      "Shorten debtor days — invoice same-day and collect earlier",
      "Reduce inventory levels using tighter demand forecasting",
      "Negotiate extended payment terms with key suppliers",
      "Use invoice financing to unlock receivables immediately",
      "Drop slow-moving stock lines that inflate working capital",
    ],
    sop: [
      "Calculate WC turnover ratio in the monthly management pack",
      "Flag any month-on-month deterioration at the weekly ops meeting",
      "Review the full debtors list every week for accounts over 30 days",
      "Run a monthly WC optimisation meeting with ops and finance leads",
      "Set WC turnover targets in the annual budget by quarter",
    ],
    videoSummary: "Working Capital Efficiency — how hard your short-term capital is working, and the daily disciplines that improve it.",
  },
  fixedCapitalUtilization: {
    friendly: "Fixed Asset Productivity",
    techName: "Fixed Asset Turnover",
    formula: "Revenue / Fixed Assets",
    hint: "How efficiently your long-term assets generate revenue.",
    icon: "⚙️",
    steps: [
      "Increase utilisation hours or shifts on existing equipment",
      "Dispose of or lease out assets with low utilisation rates",
      "Drive more revenue from current capacity before buying more assets",
      "Switch from ownership to operating leases for underused assets",
      "Outsource non-core work rather than carrying idle capital",
    ],
    sop: [
      "Track utilisation % for every major fixed asset monthly",
      "Flag any asset below 50% utilisation for 90 consecutive days",
      "Run a fixed asset review at every quarterly board meeting",
      "Enforce a 'rent before buy' policy for all capital expenditure decisions",
      "Calculate revenue per R1 of fixed assets in the monthly management pack",
    ],
    videoSummary: "Fixed Asset Productivity — making your plant, equipment and property earn their keep every single month.",
  },
  workingCapitalFunding: {
    friendly: "WC Funding Intensity",
    techName: "WC-to-Revenue",
    formula: "(Debtors + Inventory − Creditors) / Revenue",
    hint: "How much working capital is tied up per rand of revenue earned.",
    icon: "💧",
    steps: [
      "Reduce debtor days — invoice faster and collect more aggressively",
      "Slim inventory to 20–30 days cover maximum",
      "Extend creditor days within supplier relationship limits",
      "Use supply-chain financing to defer payables without relationship risk",
      "Factor debtors to release trapped cash quickly during tight periods",
    ],
    sop: [
      "Calculate WC/Revenue monthly and compare to prior month and budget",
      "Hold weekly debtor collection calls during any period of cash pressure",
      "Set maximum inventory cover targets by product category",
      "Negotiate 45–60 day terms with all strategic suppliers",
      "Alert the CFO if WC funding intensity exceeds 25% of monthly revenue",
    ],
    videoSummary: "WC Funding Intensity — the hidden cash drain inside your balance sheet that grows as revenue grows.",
  },
  revenueGrowth: {
    friendly: "Revenue Momentum",
    techName: "Revenue Growth Rate",
    formula: "(Revenue − Prior Revenue) / Prior Revenue",
    hint: "Are sales growing faster than costs and peers?",
    icon: "📈",
    steps: [
      "Set a quarterly revenue target and track weekly progress",
      "Identify your top 3 growth levers (price, volume, mix) and test one per quarter",
      "Re-activate dormant customers with a targeted winback campaign",
      "Upsell existing clients to higher-margin product tiers",
      "Open one adjacent market or geography per 12 months",
    ],
    sop: [
      "Track revenue weekly vs. same week last year in a visible dashboard",
      "Hold a monthly 30-min revenue review with the full commercial team",
      "Maintain a pipeline CRM — flag deals stalling beyond 45 days",
      "Survey churned customers quarterly to uncover fixable reasons",
      "Price-test a 5% increase on one SKU each quarter",
    ],
    videoSummary: "Revenue Growth Rate — why momentum matters more than absolute size, and the five moves that compound growth fastest.",
  },
  capexIntensity: {
    friendly: "Growth Investment",
    techName: "Capex Intensity",
    formula: "Capital Expenditure / Revenue",
    hint: "How much of each rand of revenue is ploughed back into assets?",
    icon: "🏗️",
    steps: [
      "Benchmark capex ratio against your sector before every major purchase",
      "Prioritise revenue-generating capex over maintenance capex",
      "Use lease/finance arrangements to spread capex over asset life",
      "Sell or dispose of idle assets to free capital",
      "Review every purchase >R50k in a formal capex approval process",
    ],
    sop: [
      "Maintain a 12-month capex forecast updated quarterly",
      "Require a payback-period calculation for every capex > R25k",
      "Separate maintenance capex from growth capex in the ledger",
      "Compare capex/revenue monthly to prior year and budget",
      "Conduct a post-implementation review 12 months after each major capex",
    ],
    videoSummary: "Capex Intensity — how to tell when you're under-investing in growth vs. over-spending on assets.",
  },
  assetReinvestmentRatio: {
    friendly: "Asset Reinvestment",
    techName: "Asset Reinvestment Ratio",
    formula: "Capex / Depreciation",
    hint: "Below 1× you're consuming assets; above 1× you're expanding them.",
    icon: "🔄",
    steps: [
      "Aim for a ratio >1× in growth phases to outpace asset wear",
      "In mature phases hold ratio near 1× to sustain capacity",
      "Prioritise reinvestment in your highest-return asset classes",
      "Use depreciation charges as a minimum reinvestment trigger",
      "Review the ratio before any dividend or owner-draw decision",
    ],
    sop: [
      "Calculate capex/depreciation each quarter alongside the income statement",
      "Flag to the board if ratio falls below 0.7× for two consecutive quarters",
      "Tie capex budgets to depreciation charges as a floor",
      "Segment ratio by asset class (plant, vehicles, IT) for better insight",
      "Include ratio in annual bank covenant reporting pack",
    ],
    videoSummary: "Asset Reinvestment Ratio — the ratio that tells you whether the business is growing, maintaining, or slowly running down its asset base.",
  },
  currentRatio: {
    friendly: "Cash Stability",
    techName: "Current Ratio",
    formula: "Current Assets / Current Liabilities",
    hint: "How easily can the business cover short-term obligations?",
    icon: "💵",
    steps: [
      "Target a current ratio between 1.5× and 3× for healthy liquidity",
      "Reduce short-term debt by refinancing into longer-term facilities",
      "Speed up receivables collection to boost current assets",
      "Negotiate extended supplier terms to reduce current liabilities",
      "Hold a minimum cash reserve equal to 30 days of operating costs",
    ],
    sop: [
      "Calculate current ratio monthly from the balance sheet",
      "Alert the CFO if ratio drops below 1.2× at any month-end",
      "Review aged debtors weekly — remove bad debt from current assets",
      "Keep a 13-week cash flow forecast updated every Friday",
      "Never pay non-urgent creditors early when ratio is below 1.5×",
    ],
    videoSummary: "Current Ratio — the single fastest snapshot of short-term financial health, and why anything below 1 is a danger signal.",
  },
  debtToEquity: {
    friendly: "Debt-to-Equity",
    techName: "D/E Ratio",
    formula: "Total Debt / Equity",
    hint: "How much of the business is funded by creditors vs. owners?",
    icon: "🏦",
    steps: [
      "Target a D/E below 1× for conservative businesses, below 2× for growth",
      "Redirect free cash flow to debt repayment before paying dividends",
      "Refinance short-term debt into longer-term facilities to reduce pressure",
      "Raise equity via retained earnings or investor capital to rebalance",
      "Avoid new debt while D/E exceeds your sector average",
    ],
    sop: [
      "Calculate D/E from the balance sheet every month-end",
      "Include D/E in bank covenant monitoring — flag breaches immediately",
      "Present D/E trend to the board at every quarterly meeting",
      "Model the impact of each new loan on D/E before signing",
      "Set a target D/E range and make it part of the annual budget",
    ],
    videoSummary: "Debt-to-Equity — understanding how leveraged your business is and the 5 levers to bring it back to a safer level.",
  },
  debtToAssets: {
    friendly: "Debt-to-Assets",
    techName: "D/A Ratio",
    formula: "Total Debt / Total Assets",
    hint: "What share of your asset base is financed by borrowed money?",
    icon: "⚖️",
    steps: [
      "Keep D/A below 50% to maintain a buffer for lenders and creditors",
      "Grow equity through retained profits rather than more debt",
      "Dispose of underperforming assets to right-size the denominator",
      "Match asset financing to asset life — long assets with long debt",
      "Use off-balance-sheet leasing only where it improves the ratio meaningfully",
    ],
    sop: [
      "Calculate D/A monthly alongside the balance sheet review",
      "Trigger a debt-reduction plan if D/A exceeds 60% for two quarters",
      "Include D/A in any lender, investor, or M&A due-diligence pack",
      "Segment debt by secured vs. unsecured for a cleaner picture",
      "Review D/A when considering any asset acquisition or disposal",
    ],
    videoSummary: "Debt-to-Assets — how creditors view the safety of your balance sheet and what moves shift the needle fastest.",
  },
};

type RiskProfile = "conservative" | "balanced" | "aggressive";

// Each profile retunes the targets used in the health calculations.
// Conservative = stricter on safety (debt, days, margins must be higher).
// Aggressive   = tolerant of leverage and longer cycles in pursuit of growth.
const RISK_TUNING: Record<
  RiskProfile,
  {
    label: string;
    blurb: string;
    chip: string;
    opMarginTarget: number;
    netMarginTarget: number;
    assetTurnoverTarget: number;
    roaTarget: number;
    roeTarget: number;
    leverageMax: number; // equity multiplier ceiling that still scores well
    debtorDaysMax: number;
    inventoryDaysMax: number;
    creditorRange: [number, number];
    wcDaysMax: number;
    taxBurdenFloor: number; // (val-floor)/range
    taxBurdenRange: number;
    interestBurdenFloor: number;
    interestBurdenRange: number;
  }
> = {
  conservative: {
    label: "Conservative",
    blurb: "Low risk · protect cash, minimise debt, prize safety",
    chip: "🛡️",
    opMarginTarget: 0.25,
    netMarginTarget: 0.18,
    assetTurnoverTarget: 1.3,
    roaTarget: 0.12,
    roeTarget: 0.18,
    leverageMax: 2.5,
    debtorDaysMax: 60,
    inventoryDaysMax: 60,
    creditorRange: [30, 50],
    wcDaysMax: 60,
    taxBurdenFloor: 0.35,
    taxBurdenRange: 0.45,
    interestBurdenFloor: 0.5,
    interestBurdenRange: 0.5,
  },
  balanced: {
    label: "Balanced",
    blurb: "Medium risk · steady growth with measured leverage",
    chip: "⚖️",
    opMarginTarget: 0.2,
    netMarginTarget: 0.15,
    assetTurnoverTarget: 1.5,
    roaTarget: 0.1,
    roeTarget: 0.2,
    leverageMax: 4,
    debtorDaysMax: 90,
    inventoryDaysMax: 90,
    creditorRange: [30, 60],
    wcDaysMax: 90,
    taxBurdenFloor: 0.3,
    taxBurdenRange: 0.5,
    interestBurdenFloor: 0.3,
    interestBurdenRange: 0.6,
  },
  aggressive: {
    label: "Aggressive",
    blurb: "High risk · maximum expansion, leverage tolerated",
    chip: "🔥",
    opMarginTarget: 0.15,
    netMarginTarget: 0.1,
    assetTurnoverTarget: 1.8,
    roaTarget: 0.08,
    roeTarget: 0.25,
    leverageMax: 6,
    debtorDaysMax: 120,
    inventoryDaysMax: 120,
    creditorRange: [40, 80],
    wcDaysMax: 120,
    taxBurdenFloor: 0.25,
    taxBurdenRange: 0.55,
    interestBurdenFloor: 0.2,
    interestBurdenRange: 0.7,
  },
};

const NEXT_STEP_META: Record<
  RatioKey,
  { impact: number; impactLine: string; cynefin: "Clear" | "Complicated" | "Complex" | "Chaotic" }
> = {
  operatingMargin: {
    impact: 10,
    impactLine: "Lifts every dollar of revenue straight into profit — biggest direct hit on net income.",
    cynefin: "Complicated",
  },
  netMargin: {
    impact: 10,
    impactLine: "The single best gauge of true profitability — fixing it compounds across all sales.",
    cynefin: "Complicated",
  },
  roe: {
    impact: 9,
    impactLine: "Top-of-funnel score for owners — moves only when profit, efficiency or leverage move.",
    cynefin: "Complex",
  },
  workingCapitalDays: {
    impact: 9,
    impactLine: "Frees trapped cash you can redeploy without raising debt — pure safety + growth fuel.",
    cynefin: "Complicated",
  },
  debtorDays: {
    impact: 8,
    impactLine: "Faster customer payment kills the #1 cause of small-business cash crunches.",
    cynefin: "Clear",
  },
  inventoryDays: {
    impact: 7,
    impactLine: "Shrinks dead stock risk and unlocks shelf cash — direct hit on safety & margin.",
    cynefin: "Clear",
  },
  creditorDays: {
    impact: 6,
    impactLine: "Stretching supplier terms is free working capital — zero interest cost.",
    cynefin: "Clear",
  },
  interestBurden: {
    impact: 8,
    impactLine: "Cutting interest expense flows straight to net profit and lowers bankruptcy risk.",
    cynefin: "Complicated",
  },
  taxBurden: {
    impact: 6,
    impactLine: "Smarter tax structure keeps more profit in the business with no extra sales needed.",
    cynefin: "Complicated",
  },
  equityMultiplier: {
    impact: 7,
    impactLine: "Right-sizing leverage protects you in a downturn — the #1 driver of survival.",
    cynefin: "Complex",
  },
  assetTurnover: {
    impact: 6,
    impactLine: "More sales per dollar of assets means higher returns without extra investment.",
    cynefin: "Complicated",
  },
  roa: {
    impact: 7,
    impactLine: "Combines margin and efficiency — moving it proves the operation actually works.",
    cynefin: "Complex",
  },
  fixedCostRatio: {
    impact: 8,
    impactLine: "Heavy fixed costs trap you in a high break-even — every sale fights uphill.",
    cynefin: "Complicated",
  },
  dol: {
    impact: 9,
    impactLine: "High operating leverage means a small dip in sales can wipe out profit — survival risk.",
    cynefin: "Complex",
  },
  customerConcentration: {
    impact: 9,
    impactLine: "Losing one big customer can cripple the business — concentration is hidden bankruptcy risk.",
    cynefin: "Complex",
  },
  gpToLabor: {
    impact: 8,
    impactLine: "Labor is the largest controllable cost in most SMEs — productivity here drives margin.",
    cynefin: "Complicated",
  },
  salesPerEmployee: {
    impact: 7,
    impactLine: "Tells you when to hire, when to tool up, and which teams are over-staffed.",
    cynefin: "Complicated",
  },
  ocfToEbitda: {
    impact: 9,
    impactLine: "If profit isn't turning into cash, the business is an accounting illusion — fix this first.",
    cynefin: "Complicated",
  },
  revenuePerFounderHour: {
    impact: 8,
    impactLine: "If the business depends on the founder's hours, it can't scale and can't be sold.",
    cynefin: "Complex",
  },
  grossMargin: {
    impact: 10,
    impactLine: "Gross margin is the foundation of every profitability metric — improving it lifts the entire P&L.",
    cynefin: "Complicated",
  },
  directCostsRatio: {
    impact: 9,
    impactLine: "Every percentage point of COGS reduction falls directly to gross profit with no extra sales needed.",
    cynefin: "Clear",
  },
  fundingStructure: {
    impact: 8,
    impactLine: "Equity buffer determines survival in a downturn — undercapitalised businesses fail first.",
    cynefin: "Complex",
  },
  workingCapitalUtilization: {
    impact: 7,
    impactLine: "Inefficient working capital traps cash that could fund growth — a silent drag on returns.",
    cynefin: "Complicated",
  },
  fixedCapitalUtilization: {
    impact: 7,
    impactLine: "Idle fixed assets reduce ROA and tie up capital that could generate returns elsewhere.",
    cynefin: "Clear",
  },
  workingCapitalFunding: {
    impact: 8,
    impactLine: "High WC intensity means the business funds growth through trapped cash, not profit — fix it.",
    cynefin: "Complicated",
  },
  revenueGrowth: {
    impact: 10,
    impactLine: "Revenue growth compounds everything — higher sales lift margins, coverage ratios and valuation multiples simultaneously.",
    cynefin: "Complex",
  },
  capexIntensity: {
    impact: 6,
    impactLine: "Right-sizing capex frees cash for operations while ensuring the asset base keeps pace with growth.",
    cynefin: "Complicated",
  },
  assetReinvestmentRatio: {
    impact: 7,
    impactLine: "A ratio below 1× signals the business is slowly consuming its asset base — long-run capacity risk.",
    cynefin: "Complicated",
  },
  currentRatio: {
    impact: 9,
    impactLine: "Falling below 1× means current liabilities exceed current assets — insolvency risk is immediate.",
    cynefin: "Clear",
  },
  debtToEquity: {
    impact: 8,
    impactLine: "Excessive debt erodes flexibility and signals distress to lenders — every extra rand of equity de-risks the business.",
    cynefin: "Complicated",
  },
  debtToAssets: {
    impact: 7,
    impactLine: "The higher debt funds your assets, the more vulnerable you are to a revenue shock or rate rise.",
    cynefin: "Complicated",
  },
};

// =====================================================================
// Business-type → underlying economic model → benchmark adjustments.
// We never use universal SME benchmarks. Each economic model multiplies
// the risk-profile targets so that, e.g., a SaaS company is judged on
// SaaS-like margin/turnover/cash expectations, not retail ones.
// =====================================================================
type EconomicModel =
  | "service"
  | "product"
  | "saas"
  | "marketplace"
  | "asset_heavy"
  | "distribution"
  | "retail"
  | "manufacturing"
  | "project"
  | "franchise"
  | "subscription"
  | "agency"
  | "logistics"
  | "hospitality"
  | "healthcare"
  | "construction"
  | "hybrid";

type ModelTuning = {
  // Multipliers applied to RISK_TUNING targets. 1 = no change.
  opMargin: number; netMargin: number; assetTurnover: number;
  roa: number; roe: number; leverageMax: number;
  debtorDaysMax: number; inventoryDaysMax: number; creditorMax: number; wcDaysMax: number;
  // For new ratios:
  fcrMax: number; dolMax: number; ccMax: number;
  gplMin: number; speMin: number; ocf: number; rphMin: number;
  // Narrative
  note: string;
};

const MODEL_TUNING: Record<EconomicModel, ModelTuning> = {
  // High-margin, asset-light, fast cash → expect strong margins, low inventory.
  service:       { opMargin: 1.1, netMargin: 1.1, assetTurnover: 1.3, roa: 1.3, roe: 1.1, leverageMax: 0.7,  debtorDaysMax: 1.0, inventoryDaysMax: 0.2, creditorMax: 0.8, wcDaysMax: 0.7, fcrMax: 1.1, dolMax: 1.0, ccMax: 0.9, gplMin: 1.2, speMin: 1.2, ocf: 1.0, rphMin: 1.2, note: "Asset-light, people-driven. Strong margin, low inventory, low leverage tolerated." },
  product:       { opMargin: 0.85, netMargin: 0.85, assetTurnover: 1.0, roa: 1.0, roe: 1.0, leverageMax: 1.1, debtorDaysMax: 1.0, inventoryDaysMax: 1.2, creditorMax: 1.1, wcDaysMax: 1.1, fcrMax: 1.0, dolMax: 1.1, ccMax: 1.0, gplMin: 1.0, speMin: 1.0, ocf: 0.95, rphMin: 1.0, note: "Inventory and COGS-heavy. Margins thinner, working-capital cycle longer." },
  saas:          { opMargin: 1.4, netMargin: 1.4, assetTurnover: 0.8, roa: 1.2, roe: 1.3, leverageMax: 0.6,  debtorDaysMax: 0.6, inventoryDaysMax: 0.05, creditorMax: 0.7, wcDaysMax: 0.4, fcrMax: 1.3, dolMax: 1.4, ccMax: 0.8, gplMin: 1.4, speMin: 1.5, ocf: 1.1, rphMin: 1.4, note: "Recurring revenue, high gross margin, high fixed costs. Cash-strong at scale." },
  marketplace:   { opMargin: 0.9, netMargin: 0.9, assetTurnover: 1.6, roa: 1.2, roe: 1.2, leverageMax: 0.7,  debtorDaysMax: 0.5, inventoryDaysMax: 0.1, creditorMax: 0.7, wcDaysMax: 0.4, fcrMax: 1.2, dolMax: 1.3, ccMax: 0.7, gplMin: 1.3, speMin: 1.6, ocf: 1.0, rphMin: 1.3, note: "Take-rate model. Asset-light but margins compressed by both sides of the platform." },
  asset_heavy:   { opMargin: 0.9, netMargin: 0.85, assetTurnover: 0.5, roa: 0.6, roe: 0.9, leverageMax: 1.5, debtorDaysMax: 1.1, inventoryDaysMax: 1.1, creditorMax: 1.2, wcDaysMax: 1.2, fcrMax: 1.4, dolMax: 1.6, ccMax: 1.0, gplMin: 0.8, speMin: 0.8, ocf: 0.9, rphMin: 0.9, note: "Capital-intensive. Lower asset turnover, higher leverage, longer cycles are normal." },
  distribution:  { opMargin: 0.45, netMargin: 0.45, assetTurnover: 1.8, roa: 1.0, roe: 1.1, leverageMax: 1.2, debtorDaysMax: 1.1, inventoryDaysMax: 1.2, creditorMax: 1.2, wcDaysMax: 1.2, fcrMax: 0.9, dolMax: 0.9, ccMax: 1.1, gplMin: 0.9, speMin: 1.3, ocf: 0.95, rphMin: 1.0, note: "Thin margin, high turnover. Volume game; tight working-capital control critical." },
  retail:        { opMargin: 0.6, netMargin: 0.6, assetTurnover: 1.5, roa: 1.0, roe: 1.0, leverageMax: 1.2,  debtorDaysMax: 0.4, inventoryDaysMax: 1.3, creditorMax: 1.1, wcDaysMax: 1.0, fcrMax: 1.1, dolMax: 1.2, ccMax: 0.9, gplMin: 1.0, speMin: 1.1, ocf: 1.0, rphMin: 1.0, note: "Cash-on-sale but inventory-heavy. Stock turn drives the business." },
  manufacturing: { opMargin: 0.75, netMargin: 0.75, assetTurnover: 0.8, roa: 0.7, roe: 0.9, leverageMax: 1.4, debtorDaysMax: 1.1, inventoryDaysMax: 1.4, creditorMax: 1.2, wcDaysMax: 1.3, fcrMax: 1.4, dolMax: 1.5, ccMax: 1.0, gplMin: 0.9, speMin: 0.9, ocf: 0.9, rphMin: 0.9, note: "High fixed costs, long cash cycle. DOL and break-even discipline are critical." },
  project:       { opMargin: 1.0, netMargin: 1.0, assetTurnover: 1.0, roa: 1.0, roe: 1.0, leverageMax: 1.0,  debtorDaysMax: 1.4, inventoryDaysMax: 1.3, creditorMax: 1.2, wcDaysMax: 1.4, fcrMax: 1.0, dolMax: 1.0, ccMax: 1.2, gplMin: 1.0, speMin: 1.0, ocf: 0.85, rphMin: 1.0, note: "Lumpy revenue, milestone billing. WIP and debtor days dominate cash flow." },
  franchise:     { opMargin: 0.8, netMargin: 0.8, assetTurnover: 1.1, roa: 0.9, roe: 1.1, leverageMax: 1.2,  debtorDaysMax: 0.7, inventoryDaysMax: 1.0, creditorMax: 1.0, wcDaysMax: 0.9, fcrMax: 1.2, dolMax: 1.2, ccMax: 0.9, gplMin: 1.0, speMin: 1.0, ocf: 1.0, rphMin: 1.1, note: "Standardised playbook, multi-unit. Per-unit benchmarks matter more than aggregate." },
  subscription:  { opMargin: 1.2, netMargin: 1.2, assetTurnover: 1.0, roa: 1.1, roe: 1.2, leverageMax: 0.8,  debtorDaysMax: 0.6, inventoryDaysMax: 0.6, creditorMax: 0.8, wcDaysMax: 0.6, fcrMax: 1.2, dolMax: 1.3, ccMax: 0.8, gplMin: 1.2, speMin: 1.2, ocf: 1.05, rphMin: 1.2, note: "Predictable recurring revenue. Cash leads profit; churn discipline matters." },
  agency:        { opMargin: 1.0, netMargin: 1.0, assetTurnover: 1.3, roa: 1.2, roe: 1.1, leverageMax: 0.7,  debtorDaysMax: 1.1, inventoryDaysMax: 0.1, creditorMax: 0.8, wcDaysMax: 0.9, fcrMax: 1.0, dolMax: 1.0, ccMax: 0.7, gplMin: 1.3, speMin: 1.3, ocf: 0.95, rphMin: 1.2, note: "People-driven, project-billed. Customer concentration and utilisation are king." },
  logistics:     { opMargin: 0.55, netMargin: 0.55, assetTurnover: 1.2, roa: 0.8, roe: 1.0, leverageMax: 1.4, debtorDaysMax: 1.0, inventoryDaysMax: 0.5, creditorMax: 1.1, wcDaysMax: 1.0, fcrMax: 1.4, dolMax: 1.5, ccMax: 1.0, gplMin: 0.8, speMin: 1.0, ocf: 0.9, rphMin: 0.9, note: "Asset and fuel heavy. Thin margin, high fixed cost, route economics decisive." },
  hospitality:   { opMargin: 0.7, netMargin: 0.6, assetTurnover: 0.9, roa: 0.7, roe: 0.9, leverageMax: 1.3,  debtorDaysMax: 0.3, inventoryDaysMax: 0.5, creditorMax: 1.1, wcDaysMax: 0.7, fcrMax: 1.3, dolMax: 1.5, ccMax: 0.9, gplMin: 0.9, speMin: 0.7, ocf: 0.95, rphMin: 0.8, note: "Cash-on-sale, perishable inventory. High fixed costs and seasonality dominate." },
  healthcare:    { opMargin: 1.0, netMargin: 0.9, assetTurnover: 0.9, roa: 0.9, roe: 1.0, leverageMax: 1.1,  debtorDaysMax: 1.4, inventoryDaysMax: 0.7, creditorMax: 1.0, wcDaysMax: 1.2, fcrMax: 1.3, dolMax: 1.3, ccMax: 0.9, gplMin: 1.0, speMin: 1.0, ocf: 0.9, rphMin: 1.0, note: "Insurance/payor cycle drags receivables. Compliance overhead lifts fixed costs." },
  construction:  { opMargin: 0.6, netMargin: 0.55, assetTurnover: 1.0, roa: 0.7, roe: 0.9, leverageMax: 1.3, debtorDaysMax: 1.5, inventoryDaysMax: 1.4, creditorMax: 1.3, wcDaysMax: 1.5, fcrMax: 1.1, dolMax: 1.2, ccMax: 1.1, gplMin: 0.9, speMin: 0.9, ocf: 0.85, rphMin: 0.9, note: "Retentions, milestone billing, WIP. Long cash cycle is structural." },
  hybrid:        { opMargin: 1.0, netMargin: 1.0, assetTurnover: 1.0, roa: 1.0, roe: 1.0, leverageMax: 1.0,  debtorDaysMax: 1.0, inventoryDaysMax: 1.0, creditorMax: 1.0, wcDaysMax: 1.0, fcrMax: 1.0, dolMax: 1.0, ccMax: 1.0, gplMin: 1.0, speMin: 1.0, ocf: 1.0, rphMin: 1.0, note: "Mixed model — neutral baseline. Refine once dominant revenue stream is clear." },
};

type BusinessType = {
  id: string;
  label: string;
  icon: string;
  model: EconomicModel;
  blurb: string;
};

const BUSINESS_TYPES: BusinessType[] = [
  { id: "service",       label: "Service Business",          icon: "🛠️", model: "service",       blurb: "Sells time, expertise or labor (e.g. cleaning, repair, professional services)." },
  { id: "product",       label: "Product Business",          icon: "📦", model: "product",       blurb: "Designs and sells physical products to end customers or resellers." },
  { id: "saas",          label: "SaaS / Software",           icon: "💻", model: "saas",          blurb: "Recurring software subscriptions delivered over the internet." },
  { id: "marketplace",   label: "Marketplace",               icon: "🛍️", model: "marketplace",   blurb: "Connects buyers and sellers, takes a commission per transaction." },
  { id: "asset_heavy",   label: "Asset-Based Business",      icon: "🏗️", model: "asset_heavy",   blurb: "Income generated from owning and renting assets (real estate, equipment)." },
  { id: "distribution",  label: "Distribution / Wholesale",  icon: "🚚", model: "distribution",  blurb: "Buys in bulk, sells to retailers/businesses on thin margin." },
  { id: "retail",        label: "Retail / Ecommerce",        icon: "🏬", model: "retail",        blurb: "Sells finished goods directly to consumers in-store or online." },
  { id: "manufacturing", label: "Manufacturing",             icon: "🏭", model: "manufacturing", blurb: "Converts raw materials into finished products on owned plant." },
  { id: "project",       label: "Project-Based Business",    icon: "📐", model: "project",       blurb: "Discrete client projects with milestone billing (e.g. dev shops, AV install)." },
  { id: "franchise",     label: "Franchise / Multi-Branch",  icon: "🏪", model: "franchise",     blurb: "Repeatable unit economics across many physical locations." },
  { id: "subscription",  label: "Subscription Business",     icon: "🔁", model: "subscription",  blurb: "Recurring physical or service deliveries (boxes, memberships)." },
  { id: "agency",        label: "Agency / Consulting",       icon: "🎩", model: "agency",        blurb: "Sells client engagements billed by retainer or project (creative, consulting)." },
  { id: "logistics",     label: "Logistics / Transport",     icon: "🛻", model: "logistics",     blurb: "Moves goods or people on owned/leased fleet." },
  { id: "hospitality",   label: "Hospitality / Restaurant",  icon: "🍽️", model: "hospitality",   blurb: "Hotels, restaurants, cafés, venues — cash-on-sale, perishable stock." },
  { id: "healthcare",    label: "Healthcare Practice",       icon: "🩺", model: "healthcare",    blurb: "Clinics and practices billing patients, insurers or payors." },
  { id: "construction",  label: "Construction / Engineering",icon: "🏗️", model: "construction",  blurb: "Site-based builds with retentions, WIP and long cash cycles." },
  { id: "hybrid",        label: "Hybrid Business",           icon: "🧩", model: "hybrid",        blurb: "Mixed economic model — multiple streams (e.g. product + service + SaaS)." },
];

function eisenhowerOf(health: number, impact: number): "Do" | "Decide" | "Delegate" | "Delete" {
  const urgent = health < 60;
  const important = impact >= 7;
  if (urgent && important) return "Do";
  if (!urgent && important) return "Decide";
  if (urgent && !important) return "Delegate";
  return "Delete";
}

function Index() {
  const { viewMode, setViewMode } = useViewMode();
  const { user, loading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();

  // Redirect unauthenticated users to the landing page
  useEffect(() => {
    if (!authLoading && !user) navigate({ to: "/" });
  }, [user, authLoading, navigate]);

  // Handle QBO OAuth callback: ?qbo=connected or ?qbo=error
  useEffect(() => {
    if (typeof window === "undefined") return;
    const p = new URLSearchParams(window.location.search);
    const qbo = p.get("qbo");
    if (!qbo) return;
    if (qbo === "connected")
      toast.success("QuickBooks Online connected — tap Sync to import your data");
    else if (qbo === "error")
      toast.error(
        `QuickBooks connection failed: ${p.get("reason") ?? "unknown error"}`,
      );
    window.history.replaceState({}, "", "/app");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const doExtract = useServerFn(extractFinancials);
  const askAI = useServerFn(askYourNumbers);
  const uploadRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showInputs, setShowInputs] = useState(false);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [userRole, setUserRole] = useState<string | null>(null);
  const [adminOpen, setAdminOpen] = useState(false);
  const track = useTrack();

  const handleStatementUpload = async (file: File) => {
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      let payload: { fileName: string; mimeType?: string; text?: string; base64?: string };

      if (ext === "csv" || file.type === "text/csv" || ext === "txt") {
        payload = { fileName: file.name, text: await file.text() };
      } else if (ext === "xlsx" || ext === "xls") {
        const XLSX = await import("xlsx");
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const parts: string[] = [];
        for (const name of wb.SheetNames) {
          parts.push(`--- Sheet: ${name} ---`);
          parts.push(XLSX.utils.sheet_to_csv(wb.Sheets[name]));
        }
        payload = { fileName: file.name, text: parts.join("\n") };
      } else if (ext === "pdf" || file.type === "application/pdf") {
        toast.info("PDF statements now use AI extraction — open any client in your accountant dashboard and click \"Upload statement\" to use the new pipeline.");
        return;
      } else {
        toast.error("Unsupported file type. Use PDF, CSV, or Excel.");
        return;
      }

      const result = await doExtract({ data: payload });
      const extracted = (result as { financials?: Record<string, string> })?.financials ?? {};
      const filledKeys = Object.keys(extracted);
      if (filledKeys.length === 0) {
        toast.warning("Couldn't extract figures from that file. Try a text-based PDF or CSV.");
      } else {
        setV((prev) => ({ ...prev, ...extracted } as Inputs));
        toast.success(`Auto-filled ${filledKeys.length} field${filledKeys.length === 1 ? "" : "s"} from ${file.name}`);
      }
    } catch (e) {
      toast.error(`Upload failed: ${(e as Error).message}`);
    } finally {
      setUploading(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  };

  const [actingClientId, setActingClientId] = useState<string | null>(null);
  const [actingClientName, setActingClientName] = useState<string | null>(null);

  // Role guard — accountants belong in the portal, not the owner app
  // Exception: when actingClientId is set an accountant is viewing a client's board intentionally
  useEffect(() => {
    if (!userRole) return;
    if ((userRole === "accountant" || userRole === "firm_admin") && !actingClientId) {
      navigate({ to: "/dashboard" });
    }
  }, [userRole, actingClientId, navigate]);
  const [v, setV] = useState<Inputs>(defaults);
  const [weeklyInputs, setWeeklyInputs] = useState<WeeklyInputs>({ weeks: {} });
  const [hydratedClientId, setHydratedClientId] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ period_label: string; period_date: string; ratios: Record<string, number> }>>([]);

  const [effectiveClientId, setEffectiveClientId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (actingClientId) { if (!cancelled) setEffectiveClientId(actingClientId); return; }
      const { data: u } = await supabase.auth.getUser();
      if (!u.user) { if (!cancelled) setEffectiveClientId(null); return; }

      // 1. Check if user owns a client record directly
      const { data: own } = await supabase.from("clients").select("id").eq("owner_user_id", u.user.id).limit(1).maybeSingle();
      if (own?.id) { if (!cancelled) setEffectiveClientId(own.id); return; }

      // 2. Check client_memberships (invited clients land here after confirmation)
      const { data: mem } = await supabase.from("client_memberships").select("client_id").eq("user_id", u.user.id).limit(1).maybeSingle();
      if (mem?.client_id) { if (!cancelled) setEffectiveClientId(mem.client_id); return; }

      // 3. Process a pending invite stored in localStorage after email confirmation
      const pendingInvite = typeof localStorage !== "undefined" ? localStorage.getItem("pending_invite_client_id") : null;
      const metaInvite = (u.user.user_metadata?.invite_client_id as string | null) ?? null;
      const inviteClientId = pendingInvite ?? metaInvite;
      if (inviteClientId) {
        const { error } = await supabase.from("client_memberships").upsert(
          { client_id: inviteClientId, user_id: u.user.id, role: "client" },
          { onConflict: "client_id,user_id" },
        );
        if (!error) {
          localStorage.removeItem("pending_invite_client_id");
          if (!cancelled) setEffectiveClientId(inviteClientId);
          return;
        }
      }

      // 4. Self-signup with no invite — create a client record from their profile
      const meta = u.user.user_metadata as { full_name?: string; business_name?: string; signup_type?: string } | null;
      if (meta?.signup_type === "customer") {
        const clientName = meta.business_name || meta.full_name || u.user.email || "My Business";
        const { data: created } = await supabase
          .from("clients")
          .insert({ name: clientName, owner_user_id: u.user.id })
          .select("id")
          .single();
        if (!cancelled) setEffectiveClientId(created?.id ?? null);
        return;
      }

      if (!cancelled) setEffectiveClientId(null);
    })();
    return () => { cancelled = true; };
  }, [actingClientId]);

  useEffect(() => {
    if (!effectiveClientId) { setHistory([]); return; }
    supabase
      .from("client_financial_snapshots")
      .select("period_label, period_date, ratios")
      .eq("client_id", effectiveClientId)
      .order("period_date", { ascending: true })
      .limit(6)
      .then(({ data }) => { if (data) setHistory(data as never); });
  }, [effectiveClientId]);

  const [clientMeta, setClientMeta] = useState<{ business_type: string | null; cash_runway_weeks: number | null } | null>(null);
  const [openTasks, setOpenTasks] = useState<TodayTask[]>([]);
  const [activeTab, setActiveTab] = useState<string>("today");
  useEffect(() => {
    if (!effectiveClientId) { setClientMeta(null); setOpenTasks([]); return; }
    supabase.from("clients").select("business_type, cash_runway_weeks").eq("id", effectiveClientId).maybeSingle()
      .then(({ data }) => {
        setClientMeta((data as never) ?? null);
        if (data?.business_type) setBusinessTypeId(data.business_type as string);
      });
    supabase
      .from("employee_tasks")
      .select("id, title, due_date, employee:client_employees(name)")
      .eq("client_id", effectiveClientId)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(5)
      .then(({ data }) => {
        if (!data) { setOpenTasks([]); return; }
        setOpenTasks(
          (data as Array<{ id: string; title: string; due_date: string | null; employee: { name: string } | null }>).map((r) => ({
            id: r.id, title: r.title, dueDate: r.due_date, employeeName: r.employee?.name ?? null,
          })),
        );
      });
  }, [effectiveClientId]);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user: u } }) => {
      if (!u) return;
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", u.id)
        .maybeSingle()
        .then(({ data }) => {
          if (data?.role) setUserRole(data.role);
        });
    });
  }, []);

  useEffect(() => {
    if (user) {
      track("tab_viewed", { tab: activeTab, userId: user.email ?? user.id });
    }
  }, [activeTab]);

  const seriesFor = (k: RatioKey): number[] => {
    const snapKey = RATIO_KEY_TO_SNAPSHOT[k];
    if (!snapKey) return [];
    return history.map((h) => Number(h.ratios?.[snapKey] ?? NaN)).filter((n) => isFinite(n));
  };

  useEffect(() => {
    if (typeof window === "undefined") return;
    setActingClientId(sessionStorage.getItem("acting_as_client_id"));
    setActingClientName(sessionStorage.getItem("acting_as_client_name"));
  }, []);

  useEffect(() => {
    if (!actingClientId) return;
    supabase.from("clients").select("financials").eq("id", actingClientId).maybeSingle()
      .then(({ data }) => {
        if (data?.financials) {
          const fin = data.financials as Partial<Inputs> & { weeklyInputs?: WeeklyInputs };
          setV({ ...defaults, ...fin });
          if (fin.weeklyInputs) setWeeklyInputs(fin.weeklyInputs);
        }
        setHydratedClientId(actingClientId);
      });
  }, [actingClientId]);

  useEffect(() => {
    if (!actingClientId || hydratedClientId !== actingClientId) return;
    const t = setTimeout(async () => {
      const { error } = await supabase.from("clients").update({ financials: { ...v, weeklyInputs } as never }).eq("id", actingClientId);
      if (error) toast.error(`Save failed: ${error.message}`);
    }, 700);
    return () => clearTimeout(t);
  }, [v, weeklyInputs, actingClientId, hydratedClientId]);

  const exitImpersonation = async () => {
    if (actingClientId) {
      const { data: u } = await supabase.auth.getUser();
      if (u.user) {
        const { data: rows } = await supabase
          .from("impersonation_audit")
          .select("id")
          .eq("firm_user_id", u.user.id)
          .eq("client_id", actingClientId)
          .is("ended_at", null)
          .order("started_at", { ascending: false })
          .limit(1);
        if (rows?.[0]) {
          await supabase.from("impersonation_audit").update({ ended_at: new Date().toISOString() }).eq("id", rows[0].id);
        }
      }
    }
    sessionStorage.removeItem("acting_as_client_id");
    sessionStorage.removeItem("acting_as_client_name");
    navigate({ to: "/dashboard" });
  };

  const handleExport = async () => {
    try {
      toast("Generating PDF…");
      const { jsPDF } = await import("jspdf");
      const autoTable = (await import("jspdf-autotable")).default;
      const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

      const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
      const businessLabel = businessType?.label ?? "All business types";

      pdf.setFontSize(18);
      pdf.setFont("helvetica", "bold");
      pdf.text("Financial Health Report", 14, 20);
      pdf.setFontSize(10);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Generated: ${date}`, 14, 28);
      pdf.text(`Business type: ${businessLabel}`, 14, 33);

      const fmtPdf = (value: number, format: "x" | "pct" | "days" | "money") => {
        if (!isFinite(value) || value === 0) return "—";
        if (format === "pct") return `${(value * 100).toFixed(1)}%`;
        if (format === "days") return `${value.toFixed(0)} days`;
        if (format === "x") return `${value.toFixed(2)}x`;
        return value.toLocaleString(undefined, { maximumFractionDigits: 0 });
      };

      const rows = (Object.keys(RATIO_META) as RatioKey[]).map((k) => {
        const meta = RATIO_META[k];
        const vm = valueMap[k];
        const health = healthMap[k];
        const status = !isFinite(health) ? "—" : health >= 80 ? "Good" : health >= 50 ? "Fair" : "Needs work";
        return [meta.friendly, meta.techName, fmtPdf(vm.value, vm.format), isFinite(health) ? `${Math.round(health)}%` : "—", status];
      });

      autoTable(pdf, {
        startY: 40,
        head: [["Ratio", "Technical Name", "Value", "Health", "Status"]],
        body: rows,
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 247, 250] },
        columnStyles: {
          0: { fontStyle: "bold", cellWidth: 42 },
          1: { cellWidth: 40 },
          2: { halign: "right", cellWidth: 25 },
          3: { halign: "right", cellWidth: 18 },
          4: { cellWidth: 22 },
        },
      });

      pdf.save(`ledgerline-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success("PDF downloaded");
    } catch (e) {
      console.error("PDF export failed:", e);
      toast.error("PDF export failed — please try again.");
    }
  };

  const [openRatio, setOpenRatio] = useState<RatioKey | null>(null);
  const [openVideo, setOpenVideo] = useState<RatioKey | null>(null);
  const [openSop, setOpenSop] = useState<RatioKey | null>(null);
  const [doneSteps, setDoneSteps] = useState<Set<RatioKey>>(new Set());
  const toggleDone = (k: RatioKey) =>
    setDoneSteps((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const [risk, setRisk] = useState<RiskProfile>("balanced");
  const [businessTypeId, setBusinessTypeId] = useState<string | null>(null);

  const [benchmarks, setBenchmarks] = useState<Record<string, Benchmark>>({});
  useEffect(() => {
    const bt = businessTypeId ? BUSINESS_TYPE_TO_BENCHMARK[businessTypeId] : null;
    if (!bt) { setBenchmarks({}); return; }
    supabase
      .from("industry_benchmarks")
      .select("metric_key, p25, p50, p75, unit, higher_is_better")
      .eq("business_type", bt)
      .then(({ data }) => {
        if (!data) return;
        const map: Record<string, Benchmark> = {};
        for (const r of data) {
          map[r.metric_key] = {
            p25: Number(r.p25), p50: Number(r.p50), p75: Number(r.p75),
            unit: r.unit, higher_is_better: r.higher_is_better,
          };
        }
        setBenchmarks(map);
      });
  }, [businessTypeId]);

  const benchmarkFor = (k: RatioKey): Benchmark | null => benchmarks[k] ?? null;
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [showQboDialog, setShowQboDialog] = useState(false);
  const businessType = businessTypeId ? BUSINESS_TYPES.find((b) => b.id === businessTypeId) ?? null : null;
  const model: ModelTuning = businessType ? MODEL_TUNING[businessType.model] : MODEL_TUNING.hybrid;
  const set = (k: keyof Inputs) => (val: string) => setV((s) => ({ ...s, [k]: val }));

  const n = useMemo(() => {
    const num = (s: string) => (s === "" ? 0 : parseFloat(s) || 0);
    return {
      netIncome: num(v.netIncome),
      ebt: num(v.ebt),
      ebit: num(v.ebit),
      revenue: num(v.revenue),
      totalAssets: num(v.totalAssets),
      equity: num(v.equity),
      cogs: num(v.cogs),
      receivables: num(v.receivables),
      inventory: num(v.inventory),
      payables: num(v.payables),
      fixedCosts: num(v.fixedCosts),
      variableCosts: num(v.variableCosts),
      top5Revenue: num(v.top5Revenue),
      laborCost: num(v.laborCost),
      employees: num(v.employees),
      operatingCashflow: num(v.operatingCashflow),
      ebitda: num(v.ebitda),
      founderHours: num(v.founderHours),
      priorRevenue: num(v.priorRevenue),
      currentAssets: num(v.currentAssets),
      currentLiabilities: num(v.currentLiabilities),
      capex: num(v.capex),
      ppeGross: num(v.ppeGross),
      accumulatedDepreciation: num(v.accumulatedDepreciation),
      priorPpeGross: num(v.priorPpeGross),
      priorAccumDep: num(v.priorAccumDep),
    };
  }, [v]);

  const safe = (a: number, b: number) => (b === 0 ? 0 : a / b);

  const computedRatios = useMemo(() => computeRatios(v), [v]);

  const taxBurden = computedRatios["Tax Burden"];
  const interestBurden = computedRatios["Interest Burden"];
  const operatingMargin = computedRatios["Operating Margin"];
  const assetTurnover = computedRatios["Asset Turnover"];
  const equityMultiplier = computedRatios["Equity Multiplier"];
  const netMargin = computedRatios["Net Margin"];
  const roa = computedRatios["Return on Assets"];
  const roe = computedRatios["Return on Equity"];
  const roeDirect = safe(n.netIncome, n.equity);

  const clamp = (x: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, x));
  const hHigher = (val: number, target: number) => clamp((val / target) * 100);
  const hLower = (val: number, max: number) => clamp(((max - val) / max) * 100);
  const hRange = (val: number, lo: number, hi: number) => {
    if (val < lo) return clamp((val / lo) * 100);
    if (val > hi) return clamp(100 - ((val - hi) / hi) * 100);
    return 100;
  };

  const debtorDays = computedRatios["Debtor Days"];
  const inventoryDays = computedRatios["Inventory Days"];
  const creditorDays = computedRatios["Creditor Days"];
  const workingCapitalDays = computedRatios["Working Capital Days"];

  const fixedCostRatio = computedRatios["Fixed Cost Ratio"];
  const contributionMargin = n.revenue - n.variableCosts;
  const dol = computedRatios["Degree of Operating Leverage"];
  const customerConcentration = computedRatios["Top-5 Customer Share"];
  const grossProfit = n.revenue - n.cogs;
  const grossMarginRatioBE = safe(grossProfit, n.revenue);
  const breakevenRevenue = grossMarginRatioBE > 0 ? n.fixedCosts / grossMarginRatioBE : 0;
  const gpToLabor = computedRatios["Gross Profit / Labor"];
  const salesPerEmployee = computedRatios["Sales-per-Employee Ratio"];
  const ocfToEbitda = computedRatios["OCF / EBITDA"];
  const revenuePerFounderHour = safe(n.revenue, n.founderHours);

  // Six new ratios — all derivable from existing inputs, no new form fields needed
  const grossMarginRatio = computedRatios["Gross Margin"];
  const directCostsRatio = safe(n.cogs, n.revenue);
  const wcNet = n.receivables + n.inventory - n.payables;
  const workingCapitalUtilization = safe(n.revenue, Math.max(wcNet, 1));
  const fixedCapitalProxy = Math.max(n.totalAssets - n.receivables - n.inventory, 1);
  const fixedCapitalUtilization = safe(n.revenue, fixedCapitalProxy);
  const fundingStructureRatio = safe(n.equity, n.totalAssets);
  const workingCapitalFunding = safe(wcNet, n.revenue);

  // New ratios — require priorRevenue, currentAssets, currentLiabilities, capex inputs
  const revenueGrowth = n.priorRevenue > 0 ? safe(n.revenue - n.priorRevenue, n.priorRevenue) : NaN;
  const capexIntensity = safe(n.capex, n.revenue);
  const depreciation = Math.max(0, n.ebitda - n.ebit); // EBITDA − EBIT ≈ D&A
  const assetReinvestmentRatio = depreciation > 0 ? safe(n.capex, depreciation) : NaN;
  const currentRatio = n.currentLiabilities > 0 ? safe(n.currentAssets, n.currentLiabilities) : NaN;

  // PPE movement
  const netPpe      = n.ppeGross > 0 ? n.ppeGross - n.accumulatedDepreciation : NaN;
  const priorNetPpe = n.priorPpeGross > 0 ? n.priorPpeGross - n.priorAccumDep : NaN;
  const ppeMovement = isFinite(netPpe) && isFinite(priorNetPpe) ? netPpe - priorNetPpe : NaN;
  const impliedCapex = isFinite(ppeMovement) && depreciation > 0 ? ppeMovement + depreciation : NaN;

  const totalDebt = Math.max(0, n.totalAssets - n.equity);
  const debtToEquity = safe(totalDebt, n.equity);
  const debtToAssets = safe(totalDebt, n.totalAssets);

  // Risk tunings for new ratios — same per profile (kept simple).
  const baseNewTargets = {
    conservative: { fcrMax: 0.35, dolMax: 2, ccMax: 0.35, gplMin: 3, speMin: 250, ocfRange: [0.85, 1.2] as [number, number], rphMin: 1 },
    balanced:     { fcrMax: 0.45, dolMax: 3, ccMax: 0.5,  gplMin: 2.5, speMin: 200, ocfRange: [0.75, 1.3] as [number, number], rphMin: 0.6 },
    aggressive:   { fcrMax: 0.6,  dolMax: 5, ccMax: 0.65, gplMin: 2,   speMin: 150, ocfRange: [0.6, 1.5]  as [number, number], rphMin: 0.4 },
  }[risk];

  // Apply business-model multipliers so benchmarks are model-specific, not universal.
  const newTargets = {
    fcrMax:  baseNewTargets.fcrMax  * model.fcrMax,
    dolMax:  baseNewTargets.dolMax  * model.dolMax,
    ccMax:   baseNewTargets.ccMax   * model.ccMax,
    gplMin:  baseNewTargets.gplMin  * model.gplMin,
    speMin:  baseNewTargets.speMin  * model.speMin,
    ocfRange: [baseNewTargets.ocfRange[0] * model.ocf, baseNewTargets.ocfRange[1] * model.ocf] as [number, number],
    rphMin:  baseNewTargets.rphMin  * model.rphMin,
  };

  const RBase = RISK_TUNING[risk];
  const R = {
    ...RBase,
    opMarginTarget:      RBase.opMarginTarget      * model.opMargin,
    netMarginTarget:     RBase.netMarginTarget     * model.netMargin,
    assetTurnoverTarget: RBase.assetTurnoverTarget * model.assetTurnover,
    roaTarget:           RBase.roaTarget           * model.roa,
    roeTarget:           RBase.roeTarget           * model.roe,
    leverageMax:         Math.max(1.05, RBase.leverageMax * model.leverageMax),
    debtorDaysMax:       RBase.debtorDaysMax       * model.debtorDaysMax,
    inventoryDaysMax:    RBase.inventoryDaysMax    * model.inventoryDaysMax,
    creditorRange:       [RBase.creditorRange[0], RBase.creditorRange[1] * model.creditorMax] as [number, number],
    wcDaysMax:           RBase.wcDaysMax           * model.wcDaysMax,
  };

  const healthMap: Record<RatioKey, number> = {
    taxBurden: clamp(((taxBurden - R.taxBurdenFloor) / R.taxBurdenRange) * 100),
    interestBurden: clamp(((interestBurden - R.interestBurdenFloor) / R.interestBurdenRange) * 100),
    operatingMargin: hHigher(operatingMargin, R.opMarginTarget),
    assetTurnover: hHigher(assetTurnover, R.assetTurnoverTarget),
    equityMultiplier: clamp(((R.leverageMax - equityMultiplier) / (R.leverageMax - 1)) * 100),
    netMargin: hHigher(netMargin, R.netMarginTarget),
    roa: hHigher(roa, R.roaTarget),
    roe: hHigher(roe, R.roeTarget),
    debtorDays: hLower(debtorDays, R.debtorDaysMax),
    inventoryDays: hLower(inventoryDays, R.inventoryDaysMax),
    creditorDays: hRange(creditorDays, R.creditorRange[0], R.creditorRange[1]),
    workingCapitalDays: hLower(workingCapitalDays, R.wcDaysMax),
    fixedCostRatio: hLower(fixedCostRatio, newTargets.fcrMax),
    dol: hLower(dol, newTargets.dolMax),
    customerConcentration: hLower(customerConcentration, newTargets.ccMax),
    gpToLabor: hHigher(gpToLabor, newTargets.gplMin),
    salesPerEmployee: hHigher(salesPerEmployee, newTargets.speMin),
    ocfToEbitda: hRange(ocfToEbitda, newTargets.ocfRange[0], newTargets.ocfRange[1]),
    revenuePerFounderHour: hHigher(revenuePerFounderHour, newTargets.rphMin),
    grossMargin: hHigher(grossMarginRatio, 0.35),
    directCostsRatio: hLower(directCostsRatio, 0.65),
    fundingStructure: hHigher(fundingStructureRatio, 0.30),
    workingCapitalUtilization: hHigher(workingCapitalUtilization, 2.0),
    fixedCapitalUtilization: hHigher(fixedCapitalUtilization, 1.5),
    workingCapitalFunding: hLower(workingCapitalFunding, 0.25),
    revenueGrowth: isFinite(revenueGrowth) ? hHigher(revenueGrowth, 0.10) : 50,
    capexIntensity: hRange(capexIntensity, 0.02, 0.10),
    assetReinvestmentRatio: isFinite(assetReinvestmentRatio) ? hRange(assetReinvestmentRatio, 0.8, 1.5) : 50,
    currentRatio: isFinite(currentRatio) ? hRange(currentRatio, 1.5, 3.0) : 50,
    debtToEquity: hLower(debtToEquity, 2.0),
    debtToAssets: (() => {
      const dta = debtToAssets;
      if (!isFinite(dta) || dta <= 0) return 100;
      if (dta <= 0.4) return clamp(80 + (1 - dta / 0.4) * 20);
      if (dta <= 0.6) return clamp(50 + ((0.6 - dta) / 0.2) * 30);
      if (dta <= 0.8) return clamp(20 + ((0.8 - dta) / 0.2) * 30);
      return clamp((1.0 - dta) / 0.2 * 20);
    })(),
  };

  const pillarHealths = (() => {
    const avgKeys = (keys: RatioKey[]) => {
      const hs = keys.map((k) => healthMap[k]).filter((h) => isFinite(h));
      return hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : NaN;
    };
    return {
      profit: avgKeys(["revenueGrowth", "salesPerEmployee", "grossMargin", "directCostsRatio", "fixedCostRatio", "interestBurden", "taxBurden"]),
      assets: avgKeys(["assetTurnover", "roa", "inventoryDays", "fixedCapitalUtilization", "workingCapitalUtilization"]),
      financing: avgKeys(["fundingStructure", "debtToEquity", "debtToAssets", "equityMultiplier"]),
      cash: avgKeys(["debtorDays", "creditorDays", "currentRatio", "workingCapitalFunding", "ocfToEbitda"]),
    };
  })();

  const valueMap: Record<RatioKey, { value: number; format: "x" | "pct" | "days" | "money" }> = {
    taxBurden: { value: taxBurden, format: "x" },
    interestBurden: { value: interestBurden, format: "x" },
    operatingMargin: { value: operatingMargin, format: "pct" },
    assetTurnover: { value: assetTurnover, format: "x" },
    equityMultiplier: { value: equityMultiplier, format: "x" },
    netMargin: { value: netMargin, format: "pct" },
    roa: { value: roa, format: "pct" },
    roe: { value: roe, format: "pct" },
    debtorDays: { value: debtorDays, format: "days" },
    inventoryDays: { value: inventoryDays, format: "days" },
    creditorDays: { value: creditorDays, format: "days" },
    workingCapitalDays: { value: workingCapitalDays, format: "days" },
    fixedCostRatio: { value: fixedCostRatio, format: "pct" },
    dol: { value: dol, format: "x" },
    customerConcentration: { value: customerConcentration, format: "pct" },
    gpToLabor: { value: gpToLabor, format: "x" },
    salesPerEmployee: { value: salesPerEmployee, format: "money" },
    ocfToEbitda: { value: ocfToEbitda, format: "x" },
    revenuePerFounderHour: { value: revenuePerFounderHour, format: "money" },
    grossMargin: { value: grossMarginRatio, format: "pct" },
    directCostsRatio: { value: directCostsRatio, format: "pct" },
    fundingStructure: { value: fundingStructureRatio, format: "pct" },
    workingCapitalUtilization: { value: workingCapitalUtilization, format: "x" },
    fixedCapitalUtilization: { value: fixedCapitalUtilization, format: "x" },
    workingCapitalFunding: { value: workingCapitalFunding, format: "pct" },
    revenueGrowth: { value: revenueGrowth, format: "pct" },
    capexIntensity: { value: capexIntensity, format: "pct" },
    assetReinvestmentRatio: { value: assetReinvestmentRatio, format: "x" },
    currentRatio: { value: currentRatio, format: "x" },
    debtToEquity: { value: debtToEquity, format: "x" },
    debtToAssets: { value: debtToAssets, format: "pct" },
  };

  // Build ratioLookup for HoloGlobe hover cards — keys match driver section ids in holo-globe.tsx
  const ratioLookup: Record<string, RatioInfo> = {};
  (Object.keys(valueMap) as RatioKey[]).forEach((k) => {
    const meta = RATIO_META[k];
    const bm = benchmarkFor(k);
    ratioLookup[k] = {
      friendly: meta.friendly,
      techName: meta.techName,
      value: valueMap[k].value,
      format: valueMap[k].format,
      health: healthMap[k],
      series: seriesFor(k),
      benchmark: bm
        ? { p25: bm.p25, p50: bm.p50, p75: bm.p75, higher_is_better: bm.higher_is_better }
        : null,
    };
  });

  // Aggregate financial health score — average of the four pillar averages (mirrors HoloGlobe)
  const avgHealth = (() => {
    const pillarGroups: RatioKey[][] = [
      ["revenueGrowth", "salesPerEmployee", "grossMargin", "directCostsRatio", "fixedCostRatio", "interestBurden", "taxBurden"],
      ["assetTurnover", "roa", "inventoryDays", "fixedCapitalUtilization", "workingCapitalUtilization"],
      ["fundingStructure", "debtToEquity", "debtToAssets", "equityMultiplier", "interestBurden", "workingCapitalDays"],
      ["debtorDays", "creditorDays", "inventoryDays", "currentRatio", "workingCapitalFunding", "capexIntensity", "assetReinvestmentRatio", "ocfToEbitda"],
    ];
    const pillarAvgs = pillarGroups.map((keys) => {
      const hs = keys.map((k) => healthMap[k]).filter((h) => isFinite(h));
      return hs.length ? hs.reduce((a, b) => a + b, 0) / hs.length : NaN;
    }).filter((h) => isFinite(h));
    return pillarAvgs.length ? pillarAvgs.reduce((a, b) => a + b, 0) / pillarAvgs.length : NaN;
  })();

  const spherePillars = buildSpherePillars({
    overallHealth: avgHealth,
    pillarHealths,
    healthMap,
    ratioMeta: RATIO_META,
  });

  // Ask-AI handler for the overview tab
  const handleAskAI = async () => {
    if (!aiQuestion.trim()) return;
    setAiLoading(true);
    setAiAnswer("");
    try {
      const snapshot: Record<string, number> = {};
      (Object.keys(valueMap) as (keyof typeof valueMap)[]).forEach((k) => {
        const v = valueMap[k];
        if (isFinite(v.value)) snapshot[k] = Number(v.value.toFixed(4));
      });
      const res = await askAI({
        data: {
          clientId: effectiveClientId ?? undefined,
          question: aiQuestion.trim(),
          context: {
            clientName: actingClientName ?? undefined,
            businessType: clientMeta?.business_type ?? undefined,
            cashRunwayWeeks: clientMeta?.cash_runway_weeks ?? null,
            ratios: snapshot,
            financials: {},
            alerts: [],
          },
        },
      });
      setAiAnswer(res.answer || "No answer.");
    } catch (e: unknown) {
      toast.error((e as Error)?.message ?? "Ask failed");
    } finally {
      setAiLoading(false);
    }
  };

  // Next-steps prioritisation: Pareto (impact weighting) × Eisenhower (urgency from health) × Cynefin (problem domain).
  const nextSteps = (Object.keys(RATIO_META) as RatioKey[])
    .map((k) => {
      const meta = RATIO_META[k];
      const ns = NEXT_STEP_META[k];
      const health = healthMap[k];
      const urgency = isFinite(health) ? 100 - health : 50;
      const score = urgency * ns.impact;
      return {
        key: k,
        title: meta.steps[0],
        ratioName: meta.friendly,
        icon: meta.icon,
        cynefin: ns.cynefin,
        eisenhower: eisenhowerOf(health, ns.impact),
        impact: ns.impact,
        impactLine: ns.impactLine,
        health,
        score,
      };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  // Auto-clear the globe highlight after 2s and scroll the row into view.
  // Small delay lets the tab re-render before we query the DOM.
  useEffect(() => {
    if (!highlightId) return;
    const scrollTimer = setTimeout(() => {
      const el = document.querySelector(`[data-row-id="${highlightId}"]`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    const clearTimer = setTimeout(() => setHighlightId(null), 2000);
    return () => { clearTimeout(scrollTimer); clearTimeout(clearTimer); };
  }, [highlightId]);

  const updateWeek = useCallback(
    (weekKey: string, field: keyof WeeklyRow, value: number) => {
      setWeeklyInputs((prev) => ({
        weeks: {
          ...prev.weeks,
          [weekKey]: { ...(prev.weeks[weekKey] ?? DEFAULT_WEEKLY_ROW), [field]: value },
        },
      }));
    },
    [],
  );

  const financialInputsCtxValue = useMemo(
    () => ({ weeklyInputs, updateWeek }),
    [weeklyInputs, updateWeek],
  );

  // Don't flash the dashboard while auth resolves or if unauthenticated
  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#07090f] grid place-items-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#c9962b]/30 border-t-[#c9962b]" />
      </div>
    );
  }

  return (
    <FinancialInputsContext.Provider value={financialInputsCtxValue}>
    <main className="min-h-screen overflow-x-hidden bg-slate-950 text-slate-100">
      <SplashScreen />
      {!actingClientId && <WalkthroughWizard onTabChange={setActiveTab} userRole={userRole ?? undefined} />}
      {actingClientId && (
        <div className="border-b border-amber-600/40 bg-amber-500/15 print:hidden">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-xs text-amber-100 sm:px-6">
            <div>
              <span className="font-semibold">Acting as client:</span>{" "}
              <span className="text-amber-200">{actingClientName ?? "Client"}</span>
              <span className="ml-2 text-amber-200/70">(audited — changes save to this client)</span>
            </div>
            <button
              onClick={exitImpersonation}
              className="inline-flex items-center gap-1 rounded-md border border-amber-400/40 bg-amber-500/20 px-2 py-1 text-amber-50 hover:bg-amber-500/30"
            >
              <ArrowLeft className="h-3 w-3" /> Exit to firm dashboard
            </button>
          </div>
        </div>
      )}
      <div id="board-pack" className="mx-auto max-w-6xl px-4 py-5 sm:px-6 lg:py-7">
        {/* App bar */}
        <header className="mb-4 flex items-center justify-between gap-3 border-b border-[#b7872a]/20 pb-4">
          <div className="flex min-w-0 items-center gap-3">
            <img
              src="/milon-wordmark.png"
              alt="Milōn"
              className="h-6 w-auto shrink-0 dark:brightness-110"
              style={{ filter: "brightness(0.85) saturate(1.2)" }}
            />
            <div className="mt-0.5 truncate text-[10px] font-medium uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">
              {actingClientName ?? "Operating finance"}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 print:hidden">
            {/* Business Profile pill */}
            <button
              onClick={() => setShowOnboarding(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500 transition-colors hover:border-[#b7872a]/50 hover:text-[#b8860b] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-[#b7872a]/60 dark:hover:text-[#d4a550]"
              title="Business Profile"
            >
              <Building2 className="h-3 w-3 shrink-0" />
              <span className="hidden sm:inline">{businessType ? businessType.label : "Profile"}</span>
            </button>
            {/* Risk Profile popover */}
            <Popover>
              <PopoverTrigger asChild>
                <button
                  className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500 transition-colors hover:border-[#b7872a]/50 hover:text-[#b8860b] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-[#b7872a]/60 dark:hover:text-[#d4a550]"
                  title="Risk Profile"
                >
                  <Shield className="h-3 w-3 shrink-0" />
                  <span className="hidden sm:inline capitalize">{risk}</span>
                </button>
              </PopoverTrigger>
              <PopoverContent className="w-44 border border-slate-700 bg-slate-900 p-2 shadow-xl" align="end">
                <p className="mb-2 px-1 text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-500">Risk Profile</p>
                <div className="flex flex-col gap-1">
                  {(["conservative", "balanced", "aggressive"] as RiskProfile[]).map((r) => (
                    <button
                      key={r}
                      onClick={() => setRisk(r)}
                      className={`rounded px-2 py-1.5 text-left text-[11px] font-medium capitalize transition-colors ${
                        risk === r
                          ? "border border-[#b7872a]/40 bg-[#b7872a]/15 text-[#d4a550]"
                          : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                      }`}
                    >
                      {RISK_TUNING[r].label}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
            {/* QuickBooks */}
            <button
              onClick={() => setShowQboDialog(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500 transition-colors hover:border-[#b7872a]/50 hover:text-[#b8860b] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-[#b7872a]/60 dark:hover:text-[#d4a550]"
              title="QuickBooks Integration"
            >
              <Plug2 className="h-3 w-3 shrink-0" />
              <span className="hidden lg:inline">QuickBooks</span>
            </button>
            {userRole === "firm_admin" && (
              <button
                onClick={() => setAdminOpen(true)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#d4a550]/30 bg-[#d4a550]/10 px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-[#d4a550] transition-colors hover:border-[#d4a550]/60 hover:bg-[#d4a550]/20"
                title="Admin Dashboard"
              >
                ⬡ <span className="hidden sm:inline">Admin</span>
              </button>
            )}
            <ThemeToggle />
            <HeaderShareButton />
            <button
              onClick={handleExport}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500 transition-colors hover:border-[#b7872a]/50 hover:text-[#b8860b] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-[#b7872a]/60 dark:hover:text-[#d4a550]"
              title="Export as PDF"
            >
              Export
            </button>
            <button
              onClick={() => signOut().then(() => { window.location.href = "/"; })}
              className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500 transition-colors hover:border-[#b7872a]/50 hover:text-[#b8860b] dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400 dark:hover:border-[#b7872a]/60 dark:hover:text-[#d4a550]"
              title="Sign out"
            >
              Sign out
            </button>
          </div>
        </header>


        {/* Optional onboarding — user can change business model anytime, but is never gated. */}
        <Dialog
          open={showOnboarding}
          onOpenChange={setShowOnboarding}
        >
          <DialogContent className="[display:flex] h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-3xl flex-col overflow-hidden border border-slate-800 bg-slate-950 p-4 text-slate-50 sm:h-auto sm:max-h-[90vh] sm:p-6">
            <DialogHeader className="shrink-0 pr-8">
              <DialogTitle className="text-2xl text-slate-100">
                Select Your Business Type
              </DialogTitle>
              <DialogDescription className="text-slate-400">
                Required. Every benchmark, KPI target, cash-flow expectation and health score
                adapts to your underlying economic model.
              </DialogDescription>
            </DialogHeader>
            <div className="-mx-1 min-h-0 flex-1 touch-pan-y overflow-y-scroll overscroll-contain px-1 [-webkit-overflow-scrolling:touch]">
            <div className="grid gap-2 pb-2 sm:grid-cols-2">
              {BUSINESS_TYPES.map((bt) => {
                const selected = bt.id === businessTypeId;
                return (
                  <button
                    key={bt.id}
                    onClick={() => {
                      setBusinessTypeId(bt.id);
                      setShowOnboarding(false);
                      if (effectiveClientId) {
                        supabase
                          .from("clients")
                          .update({ business_type: bt.id })
                          .eq("id", effectiveClientId)
                          .then(({ error }) => {
                            if (error) console.error("Failed to persist business type:", error);
                          });
                      }
                    }}
                    className={`group rounded-lg border p-3 text-left transition-all ${
                      selected
                        ? "border-slate-300 bg-slate-800"
                        : "border-slate-800 bg-slate-900 hover:border-slate-600 hover:bg-slate-800"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="text-xl">{bt.icon}</span>
                      <span className="font-semibold text-slate-100">{bt.label}</span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-400">{bt.blurb}</p>
                    <p className="mt-2 text-[10px] uppercase tracking-wider text-slate-500">
                      Model: {bt.model.replace("_", " ")}
                    </p>
                  </button>
                );
              })}
            </div>
            </div>
          </DialogContent>
        </Dialog>


        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="mb-5 grid h-auto w-full grid-cols-5 gap-0 rounded-none border-0 border-b border-[#b7872a]/20 bg-transparent p-0">
            {[
              { value: "today", label: "Overview" },
              { value: "dashboard", label: "Ratios" },
              { value: "cash", label: "Cash" },
              { value: "next", label: "Moves" },
              { value: "tasks", label: "Tasks" },
            ].map((t) => (
              <TabsTrigger
                key={t.value}
                value={t.value}
                className="min-w-0 truncate rounded-none border-0 border-b-2 border-transparent bg-transparent px-1 py-2.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400 shadow-none transition-all data-[state=active]:border-[#d4a550] data-[state=active]:bg-transparent data-[state=active]:text-[#b8860b] data-[state=active]:shadow-none dark:text-slate-500 dark:data-[state=active]:text-[#d4a550] sm:text-[10px]"
              >
                {t.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Simplified / Complex toggle — persists across all tabs */}
          <div className="flex justify-center mt-1 mb-4">
            <div className="flex items-center gap-0.5 rounded-full bg-white/5 p-[3px]">
              {(["simplified", "complex"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => {
                    setViewMode(m);
                    track("view_mode_toggled", { mode: m, userId: user?.email ?? user?.id ?? "anon" });
                  }}
                  className={`rounded-full px-4 py-[5px] text-[11px] font-semibold uppercase tracking-[0.08em] transition-all ${
                    viewMode === m
                      ? "bg-[#d4a550] text-[#0a0e1a] shadow-[0_2px_8px_rgba(212,165,80,0.35)]"
                      : "bg-transparent text-slate-400/70 hover:text-slate-300"
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <TabsContent value="today">
            <div className="flex flex-col items-center gap-4 pb-8">
              {/* LIVE timestamp badge row */}
              <div className="flex w-full max-w-[640px] items-center justify-between">
                <span className="text-[9px] font-semibold uppercase tracking-[0.22em] text-slate-400 dark:text-slate-600">
                  Business Overview
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/8 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.18em] text-emerald-700 dark:text-emerald-400">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />
                  Live &middot; {new Date().toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}
                </span>
              </div>
              {/* Sphere hero — financial health visualisation */}
              <div className="w-full flex justify-center">
                <SphereHero
                  overallHealth={avgHealth}
                  pillars={spherePillars}
                  topPriority={{
                    title: "Improve cash conversion cycle",
                    description: "Focus on reducing debtor days to improve cash flow.",
                  }}
                  onTopPriority={() => {
                    setActiveTab("cash");
                  }}
                />
              </div>

              {/* Ask your numbers — ink-and-gold AI chat */}
              <div className="w-full max-w-[640px]">
                <div
                  className="rounded-xl border border-[#b7872a]/30 bg-white dark:bg-[#0a1020]/80"
                  style={{ fontFamily: "ui-monospace, SF Mono, Menlo, monospace" }}
                >
                  {!aiOpen ? (
                    <button
                      type="button"
                      onClick={() => setAiOpen(true)}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left"
                    >
                      <Sparkles className="h-4 w-4 shrink-0 text-[#b8860b] dark:text-[#d4a550]" />
                      <span className="text-[12px] tracking-[0.12em] text-slate-500 dark:text-[#f1e6c8]/60">
                        Ask anything about your numbers…
                      </span>
                    </button>
                  ) : (
                    <div className="space-y-3 p-4">
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-[#b8860b] dark:text-[#d4a550]/80">
                        <Sparkles className="h-3.5 w-3.5 text-[#b8860b] dark:text-[#d4a550]" />
                        Ask your numbers
                      </div>
                      <Textarea
                        value={aiQuestion}
                        onChange={(e) => setAiQuestion(e.target.value)}
                        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAskAI(); }}
                        placeholder="e.g. Can I afford to hire a junior next month? What's killing my margin?"
                        className="min-h-[72px] border-[#b7872a]/30 bg-slate-50 text-slate-900 placeholder:text-slate-400 focus-visible:ring-[#d4a550]/40 text-[12px] dark:bg-[#060a18] dark:text-[#f1e6c8] dark:placeholder:text-[#f1e6c8]/30"
                        autoFocus
                      />
                      <div className="flex flex-wrap gap-2">
                        {[
                          "Can I afford a new hire?",
                          "What's my biggest cash leak?",
                          "Where am I weakest vs industry?",
                        ].map((q) => (
                          <button
                            key={q}
                            type="button"
                            onClick={() => setAiQuestion(q)}
                            className="rounded-full border border-[#b7872a]/30 px-3 py-1 text-[10px] tracking-[0.1em] text-slate-500 transition-colors hover:border-[#d4a550]/60 hover:text-[#b8860b] dark:text-[#f1e6c8]/60 dark:hover:text-[#f7d98a]"
                          >
                            {q}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-3">
                        <button
                          type="button"
                          onClick={handleAskAI}
                          disabled={aiLoading || !aiQuestion.trim()}
                          className="inline-flex items-center gap-2 rounded-md border border-[#d4a550]/50 bg-[#d4a550]/10 px-4 py-2 text-[11px] tracking-[0.18em] text-[#b8860b] transition-colors hover:bg-[#d4a550]/20 disabled:opacity-40 dark:text-[#f7d98a]"
                        >
                          <Send className="h-3.5 w-3.5" />
                          {aiLoading ? "Thinking…" : "Ask"}
                        </button>
                        <button
                          type="button"
                          onClick={() => { setAiOpen(false); setAiAnswer(""); setAiQuestion(""); }}
                          className="text-[11px] tracking-[0.14em] text-slate-400 transition-colors hover:text-slate-600 dark:text-[#f1e6c8]/40 dark:hover:text-[#f1e6c8]/70"
                        >
                          Cancel
                        </button>
                      </div>
                      {aiAnswer && (
                        <div className="rounded-lg border border-[#b7872a]/25 bg-slate-50 p-3 text-[12px] leading-relaxed text-slate-700 whitespace-pre-wrap dark:bg-[#060a18] dark:text-[#f1e6c8]/80">
                          {aiAnswer}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {businessType && (
                <IndustryPulse industry={businessType.label} />
              )}
            </div>
          </TabsContent>

          <TabsContent value="dashboard">
            <div className="mb-4 flex items-center gap-3 pb-3">
              <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[#b8860b] dark:text-[#d4a550]/80">Financial Ratios</span>
              <span className="h-px flex-1 bg-gradient-to-r from-[#b7872a]/30 to-transparent" />
            </div>
        {viewMode === "simplified" ? (
          <SimplifiedRatios
            sections={[
              { id: "profit",    label: "Profit",     health: pillarHealths.profit,    series: seriesFor("grossMargin") },
              { id: "assets",    label: "Assets",     health: pillarHealths.assets,    series: seriesFor("assetTurnover") },
              { id: "cash",      label: "Cash",       health: pillarHealths.cash,      series: seriesFor("currentRatio") },
              { id: "financing", label: "Financing",  health: pillarHealths.financing, series: seriesFor("debtToAssets") },
            ]}
          />
        ) : (
        <div className="space-y-3">
          {/* Inputs panel — collapsible */}
          <Card id="wizard-ratio-inputs" className="border border-slate-800 bg-slate-900/60 shadow-sm print:hidden">
            <CardHeader className="border-b border-slate-800 pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-sm font-semibold text-slate-100">Financial Inputs</CardTitle>
                  <CardDescription className="text-xs text-slate-400 mt-0.5">
                    {showInputs ? "Enter figures in any consistent currency — ratios update instantly." : "Upload a statement or expand to enter figures manually."}
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={uploadRef}
                    type="file"
                    accept=".pdf,.csv,.xlsx,.xls,.txt"
                    className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) handleStatementUpload(f); }}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5 border-slate-600 bg-slate-800 text-slate-200 hover:bg-slate-700 text-xs"
                    disabled={uploading}
                    onClick={() => uploadRef.current?.click()}
                  >
                    {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                    {uploading ? "Reading…" : "Upload statement"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-slate-400 hover:text-slate-100 text-xs px-2"
                    onClick={() => setShowInputs((s) => !s)}
                  >
                    {showInputs ? "▲ Hide" : "▼ Edit inputs"}
                  </Button>
                </div>
              </div>
            </CardHeader>
            {showInputs && (
              <CardContent className="pt-4 pb-4">
                <div className="grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {(
                    [
                      { k: "revenue", l: "Revenue" }, { k: "cogs", l: "COGS" },
                      { k: "ebit", l: "EBIT" }, { k: "ebt", l: "EBT" },
                      { k: "netIncome", l: "Net Income" }, { k: "ebitda", l: "EBITDA" },
                      { k: "operatingCashflow", l: "Operating Cash Flow" },
                      { k: "totalAssets", l: "Total Assets" }, { k: "equity", l: "Equity" },
                      { k: "receivables", l: "Receivables" }, { k: "inventory", l: "Inventory" },
                      { k: "payables", l: "Payables" }, { k: "fixedCosts", l: "Fixed Costs" },
                      { k: "variableCosts", l: "Variable Costs" }, { k: "laborCost", l: "Labor Cost" },
                      { k: "top5Revenue", l: "Top-5 Customer Rev." }, { k: "employees", l: "Employees" },
                      { k: "founderHours", l: "Founder Hours/yr" },
                      { k: "priorRevenue", l: "Prior Period Revenue" },
                      { k: "currentAssets", l: "Current Assets" },
                      { k: "currentLiabilities", l: "Current Liabilities" },
                      { k: "capex", l: "Capital Expenditure" },
                      { k: "ppeGross", l: "PPE at Cost (Gross)" },
                      { k: "accumulatedDepreciation", l: "Accumulated Depreciation" },
                      { k: "priorPpeGross", l: "Prior Year PPE (Gross)" },
                      { k: "priorAccumDep", l: "Prior Year Accum. Dep." },
                    ] as Array<{ k: keyof Inputs; l: string }>
                  ).map(({ k, l }) => (
                    <div key={k} className="flex items-center gap-2 min-w-0">
                      <Label className="w-36 shrink-0 text-xs text-slate-400 truncate">{l}</Label>
                      <Input
                        className="h-7 text-xs bg-slate-950/60 border-slate-700 min-w-0"
                        value={v[k]}
                        onChange={(e) => set(k)(e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>

          {/* Weekly inputs — collapsible table feeding the waterfall */}
          <WeeklyInputTable role={actingClientId ? "accountant" : "owner"} />

          {/* Break-even callout */}
          {isFinite(breakevenRevenue) && breakevenRevenue > 0 && (
            <div className="rounded-md border border-amber-800/40 bg-amber-950/20 px-4 py-2 text-xs text-amber-200 flex items-center gap-2">
              <span className="text-amber-400">⚡</span>
              Estimated break-even revenue: <span className="font-mono font-semibold ml-1">R{breakevenRevenue.toFixed(0)}</span>
            </div>
          )}

          {/* PPE movement callout — only shown when PPE inputs are provided */}
          {isFinite(netPpe) && (
            <div className="rounded-md border border-slate-700/60 bg-slate-800/30 px-4 py-3 text-xs text-slate-300">
              <div className="mb-1.5 font-semibold text-slate-200 uppercase tracking-wide text-[10px]">PPE Movement</div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-4">
                <div><span className="text-slate-500">Net PPE (current)</span><div className="font-mono text-slate-200">R{netPpe.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
                {isFinite(priorNetPpe) && (
                  <div><span className="text-slate-500">Net PPE (prior)</span><div className="font-mono text-slate-200">R{priorNetPpe.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
                )}
                {isFinite(ppeMovement) && (
                  <div>
                    <span className="text-slate-500">PPE Movement</span>
                    <div className={`font-mono font-semibold ${ppeMovement >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                      {ppeMovement >= 0 ? "+" : ""}R{ppeMovement.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                )}
                {isFinite(impliedCapex) && (
                  <div><span className="text-slate-500">Implied CAPEX</span><div className="font-mono text-slate-200">R{impliedCapex.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div></div>
                )}
              </div>
            </div>
          )}

          {/* Ratio section tables */}
          {(
            [
              {
                id: "profit",
                title: "Profit Drivers",
                desc: "How your business converts sales into profit",
                rows: [
                  { sub: "Revenue" },
                  { key: "revenueGrowth", indent: true },
                  { key: "salesPerEmployee", indent: true },
                  { sub: "Margins" },
                  { key: "grossMargin", indent: true },
                  { key: "directCostsRatio", indent: true },
                  { key: "operatingMargin", indent: true },
                  { key: "netMargin", indent: true },
                  { sub: "Operating Expenses (OpEx)" },
                  { key: "fixedCostRatio", indent: true },
                  { key: "dol", indent: true },
                  { sub: "Below-the-Line" },
                  { key: "interestBurden", indent: true },
                  { key: "taxBurden", indent: true },
                ],
              },
              {
                id: "asset",
                title: "Asset Productivity",
                desc: "How efficiently assets generate revenue and return",
                rows: [
                  { sub: "Returns" },
                  { key: "assetTurnover", indent: true },
                  { key: "roa", indent: true },
                  { sub: "Working Capital Utilisation" },
                  { key: "workingCapitalUtilization", indent: true },
                  { key: "workingCapitalDays", indent: true },
                  { sub: "Fixed Capital Utilisation" },
                  { key: "fixedCapitalUtilization", indent: true },
                  { key: "inventoryDays", indent: true },
                  { sub: "Capex" },
                  { key: "capexIntensity", indent: true },
                  { key: "assetReinvestmentRatio", indent: true },
                ],
              },
              {
                id: "leverage",
                title: "Leverage & Finance",
                desc: "Capital structure and shareholder return",
                rows: [
                  { sub: "Funding Structure" },
                  { key: "fundingStructure", indent: true },
                  { key: "debtToEquity", indent: true },
                  { key: "debtToAssets", indent: true },
                  { sub: "Shareholder Return" },
                  { key: "equityMultiplier", indent: true },
                  { key: "roe", indent: true },
                ],
              },
              {
                id: "cash",
                title: "Cash Flow",
                desc: "Working capital cycle and cash quality",
                rows: [
                  { sub: "Working Capital Cycle" },
                  { key: "debtorDays", indent: true },
                  { key: "creditorDays", indent: true },
                  { sub: "Liquidity" },
                  { key: "currentRatio", indent: true },
                  { key: "workingCapitalFunding", indent: true },
                  { sub: "Cash Quality" },
                  { key: "ocfToEbitda", indent: true },
                ],
              },
              {
                id: "people",
                title: "People & Systems",
                desc: "Team productivity, customer dependency, and founder reliance",
                rows: [
                  { key: "customerConcentration" },
                  { key: "gpToLabor" },
                  { key: "revenuePerFounderHour" },
                ],
              },
            ] as Array<{
              id: string;
              title: string;
              desc: string;
              rows: Array<{ key: RatioKey; indent?: boolean } | { sub: string }>;
            }>
          ).map((section) => (
            <div key={section.id} className="rounded-lg border border-slate-800 overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-800/60 border-b border-slate-700/50 flex items-baseline gap-3">
                <span className="font-semibold text-slate-100 text-sm">{section.title}</span>
                <span className="text-xs text-slate-400 hidden sm:inline">{section.desc}</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-800/80 bg-slate-900/30">
                    <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 w-44">Metric</th>
                    <th className="px-4 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-500 hidden md:table-cell">Description</th>
                    <th className="px-4 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 w-20">Trend</th>
                    <th className="px-4 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 w-20">vs Industry</th>
                    <th className="px-4 py-2 text-right text-[10px] font-semibold uppercase tracking-wider text-slate-500 w-24">Health</th>
                  </tr>
                </thead>
                <tbody>
                  {section.rows.map((row, ri) => {
                    if ("sub" in row) {
                      return (
                        <tr key={`sub-${ri}`} className="border-t border-slate-700/20 bg-slate-800/25">
                          <td colSpan={5} className="px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 pl-8">
                            ↳ {row.sub}
                          </td>
                        </tr>
                      );
                    }
                    const k = row.key;
                    const meta = RATIO_META[k];
                    const rawVal = valueMap[k].value;
                    const fmt = valueMap[k].format;
                    const health = healthMap[k];
                    const series = seriesFor(k);
                    const delta = pctDelta(series);
                    const bm = benchmarkFor(k);
                    const quintile = isFinite(health) ? Math.min(5, Math.max(1, Math.ceil(health / 20))) : 0;
                    const qCols = ["bg-rose-600", "bg-orange-500", "bg-amber-400", "bg-lime-500", "bg-emerald-500"] as const;
                    const fmtd = !isFinite(rawVal) ? "—"
                      : fmt === "pct" ? `${(rawVal * 100).toFixed(1)}%`
                      : fmt === "x" ? `${rawVal.toFixed(2)}×`
                      : fmt === "days" ? `${Math.round(rawVal)} d`
                      : rawVal.toLocaleString("en-ZA", { maximumFractionDigits: 0 });
                    const hCls = !isFinite(health) ? "text-slate-400" : health >= 70 ? "text-emerald-400" : health >= 40 ? "text-amber-400" : "text-rose-400";
                    const hLabelCls = !isFinite(health) ? "text-slate-500/70" : health >= 70 ? "text-emerald-500/70" : health >= 40 ? "text-amber-500/70" : "text-rose-500/70";
                    return (
                      <tr
                        key={k}
                        data-row-id={k}
                        onClick={() => setOpenRatio(k)}
                        className={`border-b border-slate-800/40 cursor-pointer transition-colors ${row.indent ? "bg-slate-800/10" : ""} ${k === highlightId ? "ring-2 ring-inset ring-[#f7d98a] bg-[rgba(247,217,138,0.08)]" : "hover:bg-slate-800/50"}`}
                      >
                        <td className="px-4 py-3">
                          <div className="font-medium text-slate-100 text-[13px] leading-tight">{meta.friendly}</div>
                          <div className="text-[10px] text-slate-500 font-mono mt-0.5">{meta.techName}</div>
                          <div className={`text-xs font-semibold tabular-nums mt-0.5 ${hCls}`}>{fmtd}</div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-400 hidden md:table-cell leading-relaxed" style={{ maxWidth: 240 }}>{meta.hint}</td>
                        <td className="px-4 py-3 text-center">
                          {series.length >= 2 ? (
                            <div className="flex flex-col items-center gap-0.5">
                              <KpiTrendline values={series} width={52} height={18} />
                              {delta !== null && (
                                <span className={`text-[9px] tabular-nums ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                  {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(1)}%
                                </span>
                              )}
                            </div>
                          ) : <span className="text-[11px] text-slate-700">—</span>}
                        </td>
                        <td className="px-2 py-3 text-center">
                          {bm && isFinite(rawVal) ? (
                            <div className="flex gap-[2px] justify-center" title={`Industry benchmark: p25=${bm.p25} p50=${bm.p50} p75=${bm.p75}`}>
                              {qCols.map((c, qi) => (
                                <div key={qi} className={`h-2 w-2.5 rounded-[2px] sm:h-2.5 sm:w-3.5 sm:rounded-[3px] ${qi === quintile - 1 ? c : "bg-slate-700/50"}`} />
                              ))}
                            </div>
                          ) : <span className="text-[11px] text-slate-700">—</span>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className={`text-sm font-bold tabular-nums ${hCls}`}>
                            {isFinite(health) ? `${Math.round(health)}%` : "—"}
                          </div>
                          <div className={`text-[10px] ${hLabelCls}`}>
                            {isFinite(health) ? (health >= 70 ? "Healthy" : health >= 40 ? "Watch" : "Action") : "—"}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}

          {/* Profitability Waterfall — complex view only */}
          <ProfitabilityWaterfall
            fallback={{
              revenue:    n.revenue,
              cogs:       n.cogs,
              fixedCosts: n.fixedCosts,
              interest:   n.ebit - n.ebt,
              tax:        n.ebt - n.netIncome,
            }}
          />
        </div>
        )}
          </TabsContent>

          <TabsContent value="next">
            <div className="mb-4 flex items-center gap-3 pb-3">
              <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[#b8860b] dark:text-[#d4a550]/80">Strategic Moves</span>
              <span className="h-px flex-1 bg-gradient-to-r from-[#b7872a]/30 to-transparent" />
            </div>
            <div id="wizard-moves-list">
              <NextStepsPanel
                steps={viewMode === "simplified" ? nextSteps.slice(0, 3) : nextSteps}
                done={doneSteps}
                onToggleDone={toggleDone}
                onOpenSop={(k) => setOpenSop(k)}
                clientId={effectiveClientId}
                clientName={actingClientName ?? undefined}
              />
            </div>
          </TabsContent>

          <TabsContent value="cash">
            <div className="mb-4 flex items-center gap-3 pb-3">
              <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[#b8860b] dark:text-[#d4a550]/80">Cash Forecast</span>
              <span className="h-px flex-1 bg-gradient-to-r from-[#b7872a]/30 to-transparent" />
            </div>
            <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading cash forecast…</div>}>
              <CashForecastPanel clientId={effectiveClientId ?? undefined} simplified={viewMode === "simplified"} />
            </Suspense>
          </TabsContent>

          <TabsContent value="tasks">
            <div className="mb-4 flex items-center gap-3 pb-3">
              <span className="text-[9px] font-semibold uppercase tracking-[0.25em] text-[#b8860b] dark:text-[#d4a550]/80">Tasks</span>
              <span className="h-px flex-1 bg-gradient-to-r from-[#b7872a]/30 to-transparent" />
            </div>
            <div id="wizard-tasks-panel">
              <Suspense fallback={<div className="p-6 text-sm text-slate-400">Loading tasks…</div>}>
                {effectiveClientId ? (
                  <TasksPanel clientId={effectiveClientId} clientName={actingClientName ?? undefined} readOnly={false} />
                ) : (
                  <div className="p-6 text-sm text-slate-400">No client linked yet.</div>
                )}
              </Suspense>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Contextual Notes overlay — fixed to viewport, tab-scoped */}
      <NoteLayer
        tab={activeTab}
        authorName={
          (user?.user_metadata as { full_name?: string; name?: string } | null)?.full_name
          ?? (user?.user_metadata as { full_name?: string; name?: string } | null)?.name
          ?? user?.email
          ?? "User"
        }
      />

      {/* Admin Dashboard Dialog — firm_admin only */}
      <Dialog open={adminOpen} onOpenChange={setAdminOpen}>
        <DialogContent className="max-h-[80vh] max-w-xl overflow-y-auto border border-[#d4a550]/30 bg-[#0d1628] text-slate-100">
          <DialogHeader>
            <DialogTitle className="text-base font-bold tracking-wide text-[#d4a550]">
              Admin · Activity Dashboard
            </DialogTitle>
            <DialogDescription className="text-[11px] text-slate-500">
              Session analytics — in-memory, not persisted across reloads.
            </DialogDescription>
          </DialogHeader>
          <AdminDashboard />
        </DialogContent>
      </Dialog>

      <Dialog open={openRatio !== null} onOpenChange={(o) => !o && setOpenRatio(null)}>
        <DialogContent className="max-w-lg border-2 border-sky-500/50 bg-slate-900 text-slate-50">
          {openRatio && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3 text-2xl">
                  <span className="text-3xl">{RATIO_META[openRatio].icon}</span>
                  <span>{RATIO_META[openRatio].friendly}</span>
                </DialogTitle>
                <DialogDescription className="text-slate-400">
                  {RATIO_META[openRatio].techName} · {RATIO_META[openRatio].formula}
                </DialogDescription>
              </DialogHeader>
              <div className="rounded-lg border border-slate-700/40 bg-slate-950/60 p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-slate-400">Current</span>
                  <span className="font-mono text-2xl font-bold text-slate-100">
                    {formatVal(valueMap[openRatio].value, valueMap[openRatio].format)}
                  </span>
                </div>
                <div className="mt-3">
                  <HealthBar health={healthMap[openRatio]} />
                </div>
              </div>
              <button
                onClick={() => {
                  const k = openRatio;
                  setOpenRatio(null);
                  setOpenVideo(k);
                }}
                className="flex w-full items-center justify-center gap-2 rounded-md border-2 border-sky-500/60 bg-gradient-to-r from-sky-600/20 to-sky-500/20 px-4 py-2.5 text-sm font-bold uppercase tracking-wider text-slate-200 transition-all hover:from-sky-600/40 hover:to-sky-500/40 hover:text-slate-50"
              >
                ▶ Explanation Video (5 min)
              </button>
              <div>
                <p className="mb-3 text-xs font-bold uppercase tracking-[0.2em] text-sky-400">
                  Strategic Moves to Improve
                </p>
                <ol className="space-y-2">
                  {RATIO_META[openRatio].steps.map((step, i) => (
                    <li
                      key={i}
                      className="group flex items-start gap-3 rounded-md border border-slate-700/30 bg-slate-950/40 p-3 transition-all hover:border-sky-500/60 hover:bg-slate-900/30"
                    >
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-sky-500/60 bg-sky-500/10 font-mono text-xs font-bold text-sky-300">
                        {i + 1}
                      </span>
                      <span className="text-sm text-slate-200">{step}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* Explanation video dialog (placeholder until real videos shipped) */}
      <Dialog open={openVideo !== null} onOpenChange={(o) => !o && setOpenVideo(null)}>
        <DialogContent className="max-w-2xl border-2 border-sky-500/50 bg-slate-900 text-slate-50">
          {openVideo && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3 text-xl">
                  <span className="text-2xl">{RATIO_META[openVideo].icon}</span>
                  <span>{RATIO_META[openVideo].friendly} — Explanation Video</span>
                </DialogTitle>
                <DialogDescription className="text-slate-400">
                  {RATIO_META[openVideo].techName} · ~5 min
                </DialogDescription>
              </DialogHeader>
              <div className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border-2 border-slate-700/40 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,hsl(210_90%_55%/0.08),transparent_70%)]" />
                <div className="relative text-center">
                  <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-full border-2 border-sky-500/60 bg-sky-500/10 text-3xl text-sky-300 shadow-[0_0_30px_-5px_rgb(245,158,11,0.5)]">
                    ▶
                  </div>
                  <p className="mt-4 text-sm font-bold uppercase tracking-widest text-sky-300">
                    Video Coming Soon
                  </p>
                  <p className="mt-1 text-xs text-slate-400">This explainer will be available soon.</p>
                </div>
              </div>
              <p className="rounded-md border border-slate-700/30 bg-slate-950/60 p-3 text-sm italic text-slate-300">
                {RATIO_META[openVideo].videoSummary}
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>

      {/* QuickBooks connect dialog */}
      <Dialog open={showQboDialog} onOpenChange={setShowQboDialog}>
        <DialogContent className="max-w-2xl border border-slate-800 bg-slate-950 text-slate-50">
          <DialogHeader>
            <DialogTitle className="text-[15px] font-semibold uppercase tracking-[0.15em] text-slate-100">
              QuickBooks Integration
            </DialogTitle>
            <DialogDescription className="text-xs text-slate-400">
              Connect your QuickBooks Online account to auto-fill financial inputs from live accounting data.
            </DialogDescription>
          </DialogHeader>
          <QboConnectCard
            clientId={effectiveClientId}
            onSyncComplete={(inputs) => {
              setV((prev) => ({
                ...prev,
                ...Object.fromEntries(
                  Object.entries(inputs).map(([k, val]) => [k, String(val)]),
                ),
              }));
              setShowQboDialog(false);
            }}
          />
        </DialogContent>
      </Dialog>

      {/* SOP best-practice dialog (opened from a Next Step) */}
      <Dialog open={openSop !== null} onOpenChange={(o) => !o && setOpenSop(null)}>
        <DialogContent className="max-w-lg border-2 border-emerald-500/50 bg-slate-900 text-slate-50">
          {openSop && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-3 text-xl">
                  <span className="text-2xl">{RATIO_META[openSop].icon}</span>
                  <span>SOP · {RATIO_META[openSop].friendly}</span>
                </DialogTitle>
                <DialogDescription className="text-slate-400">
                  Practical, simple best-practice playbook to implement this step.
                </DialogDescription>
              </DialogHeader>
              <ol className="space-y-2">
                {RATIO_META[openSop].sop.map((s, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-3 rounded-md border border-emerald-700/30 bg-slate-950/40 p-3"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-500/60 bg-emerald-500/10 font-mono text-xs font-bold text-emerald-300">
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 text-sm text-slate-200">{s}</span>
                    {effectiveClientId && (
                      <AssignButton
                        clientId={effectiveClientId}
                        clientName={actingClientName ?? undefined}
                        source="improvement"
                        sourceRef={`${openSop}:sop:${i}`}
                        defaultTitle={s}
                        defaultDescription={`${RATIO_META[openSop].friendly} · SOP step ${i + 1}`}
                        size="xs"
                      />
                    )}
                  </li>
                ))}
              </ol>
              <p className="text-[11px] uppercase tracking-wider text-slate-500">
                Tip: keep this open as a checklist — implement one point per week.
              </p>
            </>
          )}
        </DialogContent>
      </Dialog>
    </main>
    </FinancialInputsContext.Provider>
  );
}

function pct(x: number) {
  if (!isFinite(x)) return "—";
  return `${(x * 100).toFixed(2)}%`;
}

function formatVal(v: number, f: "x" | "pct" | "days" | "money") {
  if (!isFinite(v)) return "—";
  if (f === "pct") return pct(v);
  if (f === "days") return `${v.toFixed(1)} d`;
  if (f === "money") return v >= 1000 ? `R${(v / 1000).toFixed(1)}k` : `R${v.toFixed(2)}`;
  return `${v.toFixed(3)}×`;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-[10px] font-bold uppercase tracking-[0.25em] text-sky-400/80">{title}</p>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-xs text-slate-300">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="border-slate-700/40 bg-slate-950/60 text-slate-50 tabular-nums focus-visible:ring-sky-500"
      />
    </div>
  );
}

function tierColor(h: number) {
  if (!isFinite(h)) return { bar: "bg-slate-500", text: "text-slate-300", border: "border-slate-600", glow: "" };
  if (h >= 80)
    return {
      bar: "bg-gradient-to-r from-emerald-500 to-emerald-400",
      text: "text-emerald-300",
      border: "border-emerald-500/50",
      glow: "shadow-[0_0_20px_-5px_rgb(16,185,129,0.6)]",
    };
  if (h >= 60)
    return {
      bar: "bg-gradient-to-r from-yellow-500 to-yellow-400",
      text: "text-yellow-300",
      border: "border-yellow-500/50",
      glow: "shadow-[0_0_20px_-5px_rgb(234,179,8,0.5)]",
    };
  if (h >= 35)
    return {
      bar: "bg-gradient-to-r from-orange-500 to-orange-400",
      text: "text-orange-300",
      border: "border-orange-500/50",
      glow: "shadow-[0_0_20px_-5px_rgb(249,115,22,0.5)]",
    };
  return {
    bar: "bg-gradient-to-r from-red-600 to-red-500",
    text: "text-red-300",
    border: "border-red-500/50",
    glow: "shadow-[0_0_20px_-5px_rgb(239,68,68,0.6)]",
  };
}

function tierLabel(h: number) {
  if (!isFinite(h)) return "—";
  if (h >= 80) return "Healthy";
  if (h >= 60) return "Average";
  if (h >= 35) return "High Risk";
  return "Danger";
}

function HealthBar({ health }: { health: number }) {
  const t = tierColor(health);
  const w = clampN(health, 0, 100);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider">
        <span className={t.text}>{tierLabel(health)}</span>
        <span className={`tabular-nums ${t.text}`}>{isFinite(health) ? `${health.toFixed(0)}%` : "—"}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full border border-slate-700 bg-slate-950">
        <div className={`h-full ${t.bar} transition-all duration-500`} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

function clampN(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function HeroStat({
  title,
  subtitle,
  value,
  health,
  icon,
  footer,
  onClick,
}: {
  title: string;
  subtitle: string;
  value: string;
  health: number;
  icon: string;
  footer?: string;
  onClick: () => void;
}) {
  const t = tierColor(health);
  return (
    <button
      onClick={onClick}
      className={`group relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900/60 p-5 text-left shadow-sm transition-colors hover:border-slate-700 hover:bg-slate-900`}
    >
      <div className="absolute right-3 top-3 text-2xl opacity-30">{icon}</div>
      <p className="text-[10px] font-medium uppercase tracking-widest text-slate-500">{title}</p>
      <p className="text-xs text-slate-500">{subtitle}</p>
      <p className="mt-3 font-mono text-3xl font-semibold tabular-nums text-slate-50">{value}</p>
      <div className="mt-3">
        <HealthBar health={health} />
      </div>
      {footer && <p className="mt-2 text-[10px] text-slate-500">{footer}</p>}
    </button>
  );
}

function Ratio({
  rkey,
  value,
  format,
  health,
  onClick,
  className,
  series,
  benchmark,
  clientId,
  clientName,
}: {
  rkey: RatioKey;
  value: number;
  format: "x" | "pct" | "days" | "money";
  health: number;
  onClick: () => void;
  className?: string;
  series?: number[];
  benchmark?: Benchmark | null;
  clientId?: string | null;
  clientName?: string;
}) {
  const meta = RATIO_META[rkey];
  const t = tierColor(health);
  const fullSeries = [...(series ?? []), value].filter((n) => isFinite(n));
  const delta = pctDelta(fullSeries);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick(); } }}
      className={`group relative overflow-hidden rounded-lg border border-slate-800 bg-slate-900/40 p-4 text-left transition-colors hover:border-slate-700 hover:bg-slate-900 cursor-pointer ${className ?? ""}`}
    >
      {clientId && (
        <div className="absolute right-2 top-2 z-10">
          <AssignButton
            clientId={clientId}
            clientName={clientName}
            source="kpi"
            sourceRef={rkey}
            defaultTitle={`Improve: ${meta.friendly}`}
            defaultDescription={`${meta.techName} — ${meta.hint}\n\nFirst move: ${meta.steps[0]}`}
          />
        </div>
      )}
      <div className="flex items-start justify-between gap-2 pr-16">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
            <span>{meta.icon}</span>
            <span className="truncate">{meta.friendly}</span>
          </p>
          <p className="mt-0.5 text-[10px] uppercase tracking-wider text-slate-500">
            {meta.techName}
          </p>
        </div>
        <p className={`shrink-0 font-mono text-lg font-bold tabular-nums ${t.text}`}>
          {formatVal(value, format)}
        </p>
      </div>
      <p className="mt-2 text-xs text-slate-400">{meta.hint}</p>
      <div className="mt-3">
        <HealthBar health={health} />
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        {fullSeries.length >= 2 ? (
          <>
            <KpiTrendline values={fullSeries} />
            {delta !== null && (
              <span className={`text-[11px] font-semibold tabular-nums ${delta >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {delta >= 0 ? "+" : ""}{(delta * 100).toFixed(1)}% 6mo
              </span>
            )}
          </>
        ) : (
          <span className="text-[10px] uppercase tracking-wider text-slate-600">trend builds with snapshots</span>
        )}
      </div>
      {benchmark && isFinite(value) && (
        <div className="mt-3 border-t border-slate-700/40 pt-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-wider text-slate-500">vs industry</span>
            <span className="text-[10px] font-mono text-slate-400 tabular-nums">
              25% {formatVal(benchmark.p25, format)} · 50% {formatVal(benchmark.p50, format)} · 75% {formatVal(benchmark.p75, format)}
            </span>
          </div>
          <div className="mt-1">
            <BenchmarkBar value={value} benchmark={benchmark} width={260} />
          </div>
        </div>
      )}
      <p className="mt-2 text-[10px] font-bold uppercase tracking-wider text-sky-500/0 transition-colors group-hover:text-sky-500/80">
        ▸ Tap for 5 strategic moves
      </p>
    </div>
  );
}

type NextStep = {
  key: RatioKey;
  title: string;
  ratioName: string;
  icon: string;
  cynefin: "Clear" | "Complicated" | "Complex" | "Chaotic";
  eisenhower: "Do" | "Decide" | "Delegate" | "Delete";
  impact: number;
  impactLine: string;
  health: number;
  score: number;
};

function NextStepsPanel({
  steps,
  done,
  onToggleDone,
  onOpenSop,
  clientId,
  clientName,
}: {
  steps: NextStep[];
  done: Set<RatioKey>;
  onToggleDone: (k: RatioKey) => void;
  onOpenSop: (k: RatioKey) => void;
  clientId?: string | null;
  clientName?: string;
}) {
  const top5 = steps.slice(0, 5);
  const rest = steps.slice(5);
  const completed = steps.filter((s) => done.has(s.key)).length;
  return (
    <div className="space-y-5">
      <Card className="border border-slate-800 bg-slate-900/60 shadow-sm">
        <CardHeader className="border-b border-slate-800 pb-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-slate-100">Strategic Next Steps</CardTitle>
              <CardDescription className="text-slate-400">
                Filtered through <span className="text-sky-300">Cynefin</span> (problem type),{" "}
                <span className="text-sky-300">Eisenhower</span> (urgent × important) and{" "}
                <span className="text-sky-300">Pareto</span> (vital few). Tap a step for the SOP
                playbook, mark it done as you ship.
              </CardDescription>
            </div>
            <span className="shrink-0 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-emerald-200">
              ✓ {completed} / {steps.length}
            </span>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 pt-5">
          {top5.map((s, i) => (
            <NextStepRow
              key={s.key}
              step={s}
              rank={i + 1}
              highlighted
              isDone={done.has(s.key)}
              onToggleDone={() => onToggleDone(s.key)}
              onOpenSop={() => onOpenSop(s.key)}
              clientId={clientId}
              clientName={clientName}
            />
          ))}
        </CardContent>
      </Card>

      <Card className="border border-slate-800 bg-slate-900/60 shadow-sm">
        <CardHeader className="border-b border-slate-800 pb-4">
          <CardTitle className="text-slate-100">Supporting Moves (6–10)</CardTitle>
          <CardDescription className="text-slate-400">
            Useful, but lower combined impact-and-urgency than the top 5.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 pt-5">
          {rest.map((s, i) => (
            <NextStepRow
              key={s.key}
              step={s}
              rank={i + 6}
              isDone={done.has(s.key)}
              onToggleDone={() => onToggleDone(s.key)}
              onOpenSop={() => onOpenSop(s.key)}
              clientId={clientId}
              clientName={clientName}
            />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function NextStepRow({
  step,
  rank,
  highlighted,
  isDone,
  onToggleDone,
  onOpenSop,
  clientId,
  clientName,
}: {
  step: NextStep;
  rank: number;
  highlighted?: boolean;
  isDone: boolean;
  onToggleDone: () => void;
  onOpenSop: () => void;
  clientId?: string | null;
  clientName?: string;
}) {
  const t = tierColor(step.health);
  const cynefinColor: Record<NextStep["cynefin"], string> = {
    Clear: "border-emerald-500/40 bg-emerald-500/10 text-emerald-200",
    Complicated: "border-sky-500/40 bg-sky-500/10 text-sky-200",
    Complex: "border-violet-500/40 bg-violet-500/10 text-violet-200",
    Chaotic: "border-red-500/50 bg-red-500/10 text-red-200",
  };
  const eisenhowerColor: Record<NextStep["eisenhower"], string> = {
    Do: "border-red-500/50 bg-red-500/15 text-red-200",
    Decide: "border-sky-500/50 bg-sky-500/15 text-slate-200",
    Delegate: "border-sky-500/40 bg-sky-500/10 text-sky-200",
    Delete: "border-slate-500/40 bg-slate-500/10 text-slate-300",
  };
  return (
    <div
      className={`relative rounded-lg border p-4 transition-colors ${
        isDone
          ? "border-emerald-700/40 bg-emerald-950/20 opacity-70"
          : highlighted
            ? `border-slate-700 bg-slate-900`
            : "border-slate-800 bg-slate-900/40"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 font-mono text-sm font-bold ${
            highlighted
              ? "border-sky-400 bg-sky-500/20 text-slate-200"
              : "border-slate-600 bg-slate-900 text-slate-400"
          }`}
        >
          {rank}
        </div>
        <button
          onClick={onOpenSop}
          className="min-w-0 flex-1 cursor-pointer text-left"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-lg">{step.icon}</span>
            <span
              className={`text-sm font-semibold ${
                isDone ? "text-slate-400 line-through" : "text-slate-50"
              }`}
            >
              {step.title}
            </span>
            <span className="rounded border border-emerald-500/30 bg-emerald-500/5 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">
              ▸ SOP
            </span>
          </div>
          <p className="mt-1 text-[11px] uppercase tracking-wider text-slate-500">
            Lever: {step.ratioName}
          </p>
          {highlighted && !isDone && (
            <p className="mt-2 rounded-md border border-sky-500/30 bg-sky-500/5 p-2 text-xs italic text-slate-100">
              💡 {step.impactLine}
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-1.5">
            <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${eisenhowerColor[step.eisenhower]}`}>
              Eisenhower · {step.eisenhower}
            </span>
            <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cynefinColor[step.cynefin]}`}>
              Cynefin · {step.cynefin}
            </span>
            <span className="rounded border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-200">
              Pareto Impact · {step.impact}/10
            </span>
            <span className={`rounded border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${t.border} ${t.text}`}>
              Health · {isFinite(step.health) ? `${step.health.toFixed(0)}%` : "—"}
            </span>
          </div>
        </button>
        <div className="flex shrink-0 flex-col items-stretch gap-1.5">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleDone();
            }}
            className={`flex flex-col items-center gap-1 rounded-md border-2 px-3 py-2 text-[10px] font-bold uppercase tracking-wider transition-all ${
              isDone
                ? "border-emerald-500 bg-emerald-500/20 text-emerald-200"
                : "border-slate-600 bg-slate-900 text-slate-400 hover:border-emerald-500/60 hover:text-emerald-300"
            }`}
            aria-label="Mark step done"
          >
            <span className="text-lg leading-none">{isDone ? "✓" : "○"}</span>
            <span>{isDone ? "Done" : "Mark"}</span>
          </button>
          {clientId && !isDone && (
            <AssignButton
              clientId={clientId}
              clientName={clientName}
              source="improvement"
              sourceRef={step.key}
              defaultTitle={step.title}
              defaultDescription={`${step.ratioName} · ${step.impactLine}`}
              size="xs"
            />
          )}
        </div>
      </div>
    </div>
  );
}
