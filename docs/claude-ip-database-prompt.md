# Prompt: Build the Milōn Intervention Playbooks IP Database

Copy and paste everything below this line into Claude.

---

## Context

I am building a financial intelligence platform called **Milōn** — an SME CFO copilot that monitors key financial ratios and health scores for small and medium businesses.

The platform tracks **25 financial ratios** organised across four pillars: Profit, Assets, Financing, and Cash. Each ratio has a health score from 0–100. When a ratio is unhealthy, the system surfaces an **intervention playbook** — a prioritised list of concrete steps the business owner or CFO should take.

I need you to help me build the content for this playbook database.

---

## The 25 Ratio Keys

| Key | Friendly Name | Formula | Pillar |
|-----|--------------|---------|--------|
| `grossMargin` | Gross Profit Margin | (Revenue − COGS) / Revenue | Profit |
| `directCostsRatio` | Direct Cost Burden | COGS / Revenue | Profit |
| `fixedCostRatio` | Fixed Cost Burden (Opex) | Fixed Costs / Revenue | Profit |
| `interestBurden` | Interest Burden | EBT / EBIT | Profit / Financing |
| `taxBurden` | Tax Burden | Net Income / EBT | Profit |
| `operatingMargin` | Operating Margin | EBIT / Revenue | Profit |
| `netMargin` | Net Margin | Net Income / Revenue | Profit |
| `assetTurnover` | Asset Turnover | Revenue / Total Assets | Assets |
| `roa` | Return on Assets | Net Margin × Asset Turnover | Assets |
| `inventoryDays` | Inventory Days | (Inventory / COGS) × 365 | Assets |
| `fixedCapitalUtilization` | Fixed Asset Productivity | Revenue / Fixed Assets | Assets |
| `workingCapitalUtilization` | WC Efficiency | Revenue / Net Working Capital | Assets |
| `fundingStructure` | Equity Solvency | Equity / Total Assets | Financing |
| `equityMultiplier` | Leverage Level | Total Assets / Equity | Financing |
| `roe` | Return on Equity | ROA × Equity Multiplier | Financing |
| `workingCapitalDays` | Cash Trapped Days | Debtor Days + Inv Days − Creditor Days | Financing |
| `debtorDays` | Debtor Days | (Receivables / Revenue) × 365 | Cash |
| `creditorDays` | Creditor Days | (Payables / COGS) × 365 | Cash |
| `wipDays` | WIP Days | (WIP / COGS) × 365 | Cash |
| `workingCapitalFunding` | WC Funding Intensity | (Debtors + Inventory − Creditors) / Revenue | Cash |
| `capexIntensity` | Capex Intensity | Capex / Revenue | Cash |
| `ocfToEbitda` | Cash Quality | Operating Cash Flow / EBITDA | Cash |
| `dol` | Operating Leverage | Contribution Margin / EBIT | Risk |
| `gpToLabor` | Labor ROI | (Revenue − COGS) / Labor Cost | Efficiency |
| `customerConcentration` | Customer Dependency | Top-5 Revenue / Total Revenue | Risk |

---

## Health Tiers

Each ratio has a health score 0–100 calculated against industry benchmarks. Three tiers require different intervention intensity:

| Tier | Score Range | Meaning |
|------|------------|---------|
| `critical` | 0–40 | Urgent — business survival at risk, act immediately |
| `at_risk` | 40–65 | Warning — deteriorating, intervene proactively within 30–90 days |
| `healthy` | 65–100 | Maintenance — protect gains and optimise further |

---

## What I Need You To Generate

For **each of the 25 ratios** × **each of the 3 health tiers** = **75 combinations**, generate **10 intervention steps**.

Each step must have:
1. **step_number** (1–10, ordered from highest to lowest urgency/impact)
2. **step_title** (5–8 words, action-oriented, imperative verb)
3. **step_description** (2–3 sentences — specific, practical, measurable where possible. No fluff.)
4. **timeframe** — one of: `immediate` | `week_1_2` | `month_1` | `month_1_3` | `month_3_6` | `year_1`
5. **effort** — one of: `low` | `medium` | `high`
6. **impact** — one of: `low` | `medium` | `high`
7. **category** — one of: `revenue` | `cost` | `cash` | `structure` | `operations` | `risk` | `people`

### Rules:
- Steps 1–3 should always be `immediate` or `week_1_2` for `critical` tier
- Steps should be SME-appropriate (not Fortune 500 advice)
- Steps must be specific to the ratio — not generic "improve your business" advice
- Critical tier steps must be more drastic than at_risk steps (e.g., emergency cash calls, stop all discretionary spend, call your bank)
- Healthy tier steps should be maintenance / optimisation focused (continuous improvement)
- Steps should follow a logical sequence — quick wins first, structural fixes last
- Reference specific financial ratios, benchmarks, or percentages where helpful
- South African business context where relevant (but globally applicable principles apply)

---

## Output Format

Please output as a **JSON array** of objects with this exact structure:

```json
[
  {
    "ratio_key": "grossMargin",
    "ratio_name": "Gross Profit Margin",
    "health_tier": "critical",
    "health_score_min": 0,
    "health_score_max": 40,
    "step_number": 1,
    "step_title": "Halt all new low-margin sales immediately",
    "step_description": "Identify and stop accepting orders below 20% gross margin. Calculate your break-even GM% and use this as a hard floor for all new business. Every below-threshold sale erodes cash faster than no sale at all.",
    "timeframe": "immediate",
    "effort": "low",
    "impact": "high",
    "category": "revenue"
  },
  ...
]
```

**Health score ranges to use:**
- `critical`: `health_score_min: 0`, `health_score_max: 40`
- `at_risk`: `health_score_min: 40`, `health_score_max: 65`
- `healthy`: `health_score_min: 65`, `health_score_max: 100`

---

## Also Generate: Cash Flow Forecast Interventions

In addition to the ratio playbooks, generate interventions for **cash flow forecasting** — week-by-week for a business in a cash crisis.

For **3 scenarios** × **12 time periods** (weeks 1–4 + months 1–6 + months 6–12 mapped to period_numbers 1–12) × **8 steps each**:

| Scenario | Meaning |
|----------|---------|
| `critical` | Severe cash crisis — runway under 4 weeks |
| `moderate` | Tight cash — runway 4–12 weeks |
| `growth` | Positive but scaling — cash absorbed by growth |

Period mapping: weeks 1–4 = `period_type: "week"`, `period_number: 1–4`. Months 1–6 = `period_type: "month"`, `period_number: 1–6`.

Each cashflow step needs:
1. **step_number** (1–8)
2. **step_title**
3. **step_description** (specific cash action for that exact week/month)
4. **impact_area**: `receipts` | `payments` | `funding` | `operations` | `structure`
5. **effort**: `low` | `medium` | `high`

### Example cashflow step:
```json
{
  "period_type": "week",
  "period_number": 1,
  "scenario": "critical",
  "step_number": 1,
  "step_title": "Build a 13-week rolling cash forecast today",
  "step_description": "List every expected receipt and payment for the next 13 weeks. Include only confirmed receivables — not projected sales. This is your survival map and must be updated every Monday morning without exception.",
  "impact_area": "operations",
  "effort": "medium"
}
```

---

## Total Output Expected

- 25 ratios × 3 tiers × 10 steps = **750 ratio intervention rows**
- 2 period types × up to 10 periods × 3 scenarios × 8 steps = **~480 cashflow intervention rows**
- **~1,230 total rows**

Please generate the complete JSON. If you need to split the output into multiple responses, start with Profit pillar ratios (critical tier first), then Assets, Financing, Cash, then cashflow interventions.

---

## Database Schema Reference

```sql
-- Ratio intervention steps
intervention_playbooks (
  ratio_key text,
  ratio_name text,
  health_tier text,       -- 'critical' | 'at_risk' | 'healthy'
  health_score_min integer,
  health_score_max integer,
  step_number integer,    -- 1–10
  step_title text,
  step_description text,
  timeframe text,         -- 'immediate' | 'week_1_2' | 'month_1' | 'month_1_3' | 'month_3_6' | 'year_1'
  effort text,            -- 'low' | 'medium' | 'high'
  impact text,            -- 'low' | 'medium' | 'high'
  category text           -- 'revenue' | 'cost' | 'cash' | 'structure' | 'operations' | 'risk' | 'people'
)

-- Cash flow forecast intervention steps
cashflow_interventions (
  period_type text,       -- 'week' | 'month'
  period_number integer,  -- 1–12
  scenario text,          -- 'critical' | 'moderate' | 'growth'
  step_number integer,    -- 1–8
  step_title text,
  step_description text,
  impact_area text,       -- 'receipts' | 'payments' | 'funding' | 'operations' | 'structure'
  effort text             -- 'low' | 'medium' | 'high'
)
```

Once Claude gives you the JSON, paste it back and we will import it directly into the database.
