# Replit Implementation Prompt — Weekly Inputs + Profitability Waterfall

Paste this entire prompt into Replit AI or your working-wizard codebase chat.

---

## Context

MILŌN is a mobile-first financial dashboard for SME owners and accountants. It already has:
- A tab bar: Overview / Ratios / Cash / Moves / Tasks
- A Simplified / Complex view toggle (below the tab bar)
- A collapsible "Financial Inputs" section at the top of the Ratios tab
- A dark theme: deep navy background, gold/amber accents, white text

---

## What to build

### PART 1 — Shared Weekly Input State

The weekly figures must be shared between the Accountant view and the SME Owner view. If one party updates a figure, the other sees it immediately.

#### 1a. Extend your data context

```js
// context/FinancialInputsContext.js

import { createContext, useContext, useState } from 'react';

const defaultWeeklyInputs = {
  // Keyed by ISO week string e.g. "2026-W23"
  weeks: {
    "2026-W21": { revenue: 13728, costOfSales: 4750, fixedCosts: 4750, cashMovements: 3253, interest: 175, tax: 0 },
    "2026-W22": { revenue: 0,     costOfSales: 0,    fixedCosts: 0,    cashMovements: 0,    interest: 0,   tax: 0 },
    "2026-W23": { revenue: 0,     costOfSales: 0,    fixedCosts: 0,    cashMovements: 0,    interest: 0,   tax: 0 },
  }
};

const FinancialInputsContext = createContext();

export function FinancialInputsProvider({ children }) {
  const [inputs, setInputs] = useState(defaultWeeklyInputs);

  function updateWeek(weekKey, field, value) {
    setInputs(prev => ({
      ...prev,
      weeks: {
        ...prev.weeks,
        [weekKey]: {
          ...prev.weeks[weekKey],
          [field]: parseFloat(value) || 0,
        }
      }
    }));
  }

  function addWeek(weekKey) {
    if (!inputs.weeks[weekKey]) {
      setInputs(prev => ({
        ...prev,
        weeks: {
          ...prev.weeks,
          [weekKey]: { revenue: 0, costOfSales: 0, fixedCosts: 0, cashMovements: 0, interest: 0, tax: 0 }
        }
      }));
    }
  }

  return (
    <FinancialInputsContext.Provider value={{ inputs, updateWeek, addWeek }}>
      {children}
    </FinancialInputsContext.Provider>
  );
}

export const useFinancialInputs = () => useContext(FinancialInputsContext);
```

Wrap your app root:

```jsx
// App.jsx
import { FinancialInputsProvider } from './context/FinancialInputsContext';
import { ViewModeProvider } from './context/ViewModeContext';

<ViewModeProvider>
  <FinancialInputsProvider>
    <YourApp />
  </FinancialInputsProvider>
</ViewModeProvider>
```

---

### PART 2 — Weekly Input Table Component

This replaces / extends the existing collapsible "Financial Inputs" section in the Ratios tab. Both the Accountant and SME Owner panels render the same component — edits from either side push to the shared context.

```jsx
// components/WeeklyInputTable.jsx

import { useState } from 'react';
import { useFinancialInputs } from '../context/FinancialInputsContext';

// Helper: get ISO week key from a date
function getISOWeek(date = new Date()) {
  const d = new Date(date);
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() + 3 - ((d.getDay() + 6) % 7));
  const week1 = new Date(d.getFullYear(), 0, 4);
  const weekNum = 1 + Math.round(((d - week1) / 86400000 - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${d.getFullYear()}-W${String(weekNum).padStart(2,'0')}`;
}

// Get last N week keys ending at current week
function getRecentWeeks(n = 4) {
  const weeks = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i * 7);
    weeks.push(getISOWeek(d));
  }
  return weeks;
}

const WEEKLY_FIELDS = [
  { key: 'revenue',       label: 'Revenue',         hint: 'Total sales banked this week' },
  { key: 'costOfSales',   label: 'Cost of Sales',   hint: 'Direct costs for goods/services sold' },
  { key: 'fixedCosts',    label: 'Fixed Costs',     hint: 'Rent, salaries, recurring overheads' },
  { key: 'cashMovements', label: 'Cash Movements',  hint: 'Net cash in/out (excl. above)' },
];

const ACCOUNTANT_FIELDS = [
  { key: 'interest', label: 'Interest & Finance', hint: 'Loan interest paid this period' },
  { key: 'tax',      label: 'Income Tax',         hint: 'Tax provision for this period' },
];

export default function WeeklyInputTable({ role = 'owner' }) {
  // role: 'owner' | 'accountant'
  const { inputs, updateWeek } = useFinancialInputs();
  const [isOpen, setIsOpen] = useState(false);
  const weeks = getRecentWeeks(4);
  const currentWeek = getISOWeek();

  const fields = role === 'accountant'
    ? [...WEEKLY_FIELDS, ...ACCOUNTANT_FIELDS]
    : WEEKLY_FIELDS;

  return (
    <div className="weekly-input-wrapper">
      {/* Collapsible header */}
      <button className="input-collapse-header" onClick={() => setIsOpen(!isOpen)}>
        <span className="input-collapse-title">Financial Inputs</span>
        <span className="input-collapse-hint">
          Upload a statement or enter figures manually
        </span>
        <span className="input-collapse-arrow">{isOpen ? '▲' : '▼'}</span>
      </button>

      {isOpen && (
        <div className="weekly-input-table-container">
          <p className="weekly-input-subtitle">
            Weekly figures · Last 4 weeks · Current week highlighted
          </p>

          <div className="weekly-table-scroll">
            <table className="weekly-table">
              <thead>
                <tr>
                  <th className="field-col">Field</th>
                  {weeks.map(w => (
                    <th
                      key={w}
                      className={`week-col ${w === currentWeek ? 'current-week' : ''}`}
                    >
                      {w === currentWeek ? `${w} ★` : w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {fields.map(field => (
                  <tr key={field.key}>
                    <td className="field-label-cell">
                      <div className="field-name">{field.label}</div>
                      <div className="field-hint">{field.hint}</div>
                    </td>
                    {weeks.map(w => {
                      const val = inputs.weeks[w]?.[field.key] ?? '';
                      return (
                        <td key={w} className={`input-cell ${w === currentWeek ? 'current-week' : ''}`}>
                          <div className="input-prefix">R</div>
                          <input
                            type="number"
                            value={val === 0 ? '' : val}
                            placeholder="0"
                            onChange={e => updateWeek(w, field.key, e.target.value)}
                            className="weekly-input"
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {role === 'accountant' && (
            <p className="accountant-note">
              ✦ Interest & Tax fields are visible to accountants only in input mode —
              they flow into the Profitability Waterfall report.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
```

```css
/* WeeklyInputTable styles */
.weekly-input-wrapper {
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 14px;
  margin: 0 16px 16px 16px;
  overflow: hidden;
}

.input-collapse-header {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}

.input-collapse-title {
  font-size: 14px;
  font-weight: 700;
  color: #ffffff;
}

.input-collapse-hint {
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  flex: 1;
}

.input-collapse-arrow {
  font-size: 10px;
  color: #C9A84C;
}

.weekly-input-subtitle {
  font-size: 11px;
  color: rgba(255,255,255,0.35);
  letter-spacing: 0.06em;
  padding: 0 16px 8px 16px;
  text-transform: uppercase;
}

.weekly-table-scroll {
  overflow-x: auto;
  padding: 0 16px 16px 16px;
}

.weekly-table {
  width: 100%;
  border-collapse: collapse;
  min-width: 480px;
}

.weekly-table th {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  color: rgba(255,255,255,0.4);
  text-transform: uppercase;
  padding: 8px 6px;
  text-align: right;
  border-bottom: 1px solid rgba(255,255,255,0.08);
}

.weekly-table th.field-col {
  text-align: left;
  min-width: 130px;
}

.weekly-table th.current-week {
  color: #C9A84C;
}

.field-label-cell {
  padding: 10px 6px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
}

.field-name {
  font-size: 13px;
  font-weight: 600;
  color: #ffffff;
}

.field-hint {
  font-size: 10px;
  color: rgba(255,255,255,0.35);
  margin-top: 2px;
}

.input-cell {
  padding: 8px 4px;
  border-bottom: 1px solid rgba(255,255,255,0.05);
  text-align: right;
  position: relative;
}

.input-cell.current-week {
  background: rgba(201, 168, 76, 0.06);
}

.input-prefix {
  font-size: 10px;
  color: rgba(255,255,255,0.3);
  position: absolute;
  top: 50%;
  left: 8px;
  transform: translateY(-50%);
  pointer-events: none;
}

.weekly-input {
  width: 80px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 6px;
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  text-align: right;
  padding: 6px 8px 6px 18px;
  outline: none;
  transition: border-color 0.2s;
}

.weekly-input:focus {
  border-color: #C9A84C;
}

/* Remove number input arrows */
.weekly-input::-webkit-outer-spin-button,
.weekly-input::-webkit-inner-spin-button { -webkit-appearance: none; }
.weekly-input[type=number] { -moz-appearance: textfield; }

.accountant-note {
  font-size: 11px;
  color: rgba(201, 168, 76, 0.7);
  padding: 0 16px 12px 16px;
  border-top: 1px solid rgba(255,255,255,0.05);
  padding-top: 10px;
}
```

---

### PART 3 — Profitability Waterfall (Complex Ratios View, Collapsible)

Appears only when `viewMode === 'complex'` on the Ratios tab. Collapsible section. Pulls live data from `FinancialInputsContext` — aggregates all weeks.

```jsx
// components/ProfitabilityWaterfall.jsx

import { useState } from 'react';
import { useFinancialInputs } from '../context/FinancialInputsContext';

function aggregateTotals(weeks) {
  return Object.values(weeks).reduce((acc, w) => ({
    revenue:       acc.revenue       + (w.revenue       || 0),
    costOfSales:   acc.costOfSales   + (w.costOfSales   || 0),
    fixedCosts:    acc.fixedCosts    + (w.fixedCosts    || 0),
    interest:      acc.interest      + (w.interest      || 0),
    tax:           acc.tax           + (w.tax           || 0),
  }), { revenue: 0, costOfSales: 0, fixedCosts: 0, interest: 0, tax: 0 });
}

function fmt(n) {
  return `R ${n.toLocaleString('en-ZA')}`;
}

function pct(n, total) {
  if (!total) return '—';
  return `${((n / total) * 100).toFixed(1)}%`;
}

function getStatus(p) {
  if (p >= 0.20) return { label: 'HEALTHY', color: '#4CAF82', bg: 'rgba(76,175,130,0.15)' };
  if (p >= 0.10) return { label: 'AT RISK',  color: '#C9A84C', bg: 'rgba(201,168,76,0.15)' };
  return               { label: 'CRITICAL', color: '#e05c5c', bg: 'rgba(224,92,92,0.15)' };
}

export default function ProfitabilityWaterfall() {
  const { inputs } = useFinancialInputs();
  const [isOpen, setIsOpen] = useState(true);
  const t = aggregateTotals(inputs.weeks);

  const grossProfit    = t.revenue - t.costOfSales;
  const operatingProfit = grossProfit - t.fixedCosts;
  const ebt            = operatingProfit - t.interest;
  const netProfit      = ebt - t.tax;

  const steps = [
    {
      id: 'revenue',
      label: 'Revenue',
      value: t.revenue,
      barWidth: 100,
      color: '#1a3a5c',
      subtractLabel: null,
      subtractValue: null,
      showStatus: false,
    },
    {
      id: 'gross',
      label: 'Gross Profit',
      value: grossProfit,
      barWidth: t.revenue ? (grossProfit / t.revenue) * 100 : 0,
      color: '#C9A84C',
      subtractLabel: 'Cost of Goods Sold',
      subtractValue: t.costOfSales,
      showStatus: true,
    },
    {
      id: 'operating',
      label: 'Operating Profit',
      value: operatingProfit,
      barWidth: t.revenue ? (operatingProfit / t.revenue) * 100 : 0,
      color: '#4CAF82',
      subtractLabel: 'Operating Expenses',
      subtractValue: t.fixedCosts,
      showStatus: true,
    },
    {
      id: 'ebt',
      label: 'Earnings Before Tax',
      value: ebt,
      barWidth: t.revenue ? (ebt / t.revenue) * 100 : 0,
      color: '#6b7fa3',
      subtractLabel: 'Interest & Finance Costs',
      subtractValue: t.interest,
      showStatus: false,
    },
    {
      id: 'net',
      label: 'Net Profit',
      value: netProfit,
      barWidth: t.revenue ? (netProfit / t.revenue) * 100 : 0,
      color: '#C9A84C',
      subtractLabel: 'Income Tax',
      subtractValue: t.tax,
      showStatus: true,
    },
  ];

  return (
    <div className="waterfall-wrapper">
      {/* Collapsible header */}
      <button className="waterfall-collapse-btn" onClick={() => setIsOpen(!isOpen)}>
        <div>
          <div className="waterfall-title">Profitability Waterfall</div>
          <div className="waterfall-subtitle">How R1 of revenue becomes profit</div>
        </div>
        <div className="waterfall-collapse-controls">
          <button className="waterfall-export-btn" onClick={e => { e.stopPropagation(); exportWaterfallPDF(steps, t); }}>
            ↓ Export PDF
          </button>
          <span className="waterfall-arrow">{isOpen ? '▲' : '▼'}</span>
        </div>
      </button>

      {isOpen && (
        <div className="waterfall-body">
          {steps.map((step, i) => {
            const p = t.revenue ? step.value / t.revenue : 0;
            const status = step.showStatus ? getStatus(p) : null;

            return (
              <div key={step.id} className="waterfall-row-group">
                {/* Deduction label above */}
                {step.subtractLabel && step.subtractValue > 0 && (
                  <div className="waterfall-deduction">
                    <span className="deduction-quote">"</span>
                    {step.subtractLabel}:
                    <span className="deduction-value"> ({fmt(step.subtractValue)})</span>
                  </div>
                )}

                {/* Main row */}
                <div className="waterfall-row">
                  <div className="waterfall-row-label">
                    <div className="wf-label">{step.label}</div>
                    <div className="wf-value">{fmt(step.value)}</div>
                    <div className="wf-pct-sub">{pct(step.value, t.revenue)} of revenue</div>
                  </div>

                  <div className="waterfall-bar-track">
                    <div
                      className="waterfall-bar-fill"
                      style={{
                        width: `${Math.max(step.barWidth, 0)}%`,
                        background: step.color,
                        transition: 'width 0.6s cubic-bezier(0.4,0,0.2,1)',
                      }}
                    />
                  </div>

                  <div className="waterfall-row-right">
                    <span className="wf-pct">{pct(step.value, t.revenue)}</span>
                    {status && (
                      <span
                        className="wf-status-badge"
                        style={{ color: status.color, background: status.bg, borderColor: status.color }}
                      >
                        {status.label}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

```css
/* Profitability Waterfall styles */
.waterfall-wrapper {
  background: rgba(255,255,255,0.03);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 16px;
  margin: 0 16px 24px 16px;
  overflow: hidden;
}

.waterfall-collapse-btn {
  width: 100%;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 18px 16px;
  background: transparent;
  border: none;
  cursor: pointer;
  text-align: left;
}

.waterfall-title {
  font-size: 16px;
  font-weight: 800;
  color: #ffffff;
  letter-spacing: 0.01em;
}

.waterfall-subtitle {
  font-size: 11px;
  color: rgba(255,255,255,0.4);
  margin-top: 2px;
}

.waterfall-collapse-controls {
  display: flex;
  align-items: center;
  gap: 10px;
}

.waterfall-export-btn {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  padding: 6px 12px;
  border-radius: 8px;
  background: rgba(201,168,76,0.15);
  border: 1px solid rgba(201,168,76,0.4);
  color: #C9A84C;
  cursor: pointer;
  transition: background 0.2s;
}

.waterfall-export-btn:hover {
  background: rgba(201,168,76,0.25);
}

.waterfall-arrow {
  font-size: 10px;
  color: #C9A84C;
}

.waterfall-body {
  padding: 0 16px 20px 16px;
  border-top: 1px solid rgba(255,255,255,0.06);
}

.waterfall-row-group {
  margin-top: 4px;
}

.waterfall-deduction {
  font-size: 11px;
  color: rgba(255,255,255,0.35);
  padding: 10px 0 4px 4px;
  font-style: italic;
}

.deduction-quote {
  margin-right: 3px;
  color: rgba(255,255,255,0.2);
}

.deduction-value {
  color: #e05c5c;
  font-weight: 600;
}

.waterfall-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
}

.waterfall-row-label {
  width: 130px;
  flex-shrink: 0;
}

.wf-label {
  font-size: 12px;
  font-weight: 700;
  color: #ffffff;
}

.wf-value {
  font-size: 13px;
  font-weight: 800;
  color: #ffffff;
  margin-top: 1px;
}

.wf-pct-sub {
  font-size: 10px;
  color: rgba(255,255,255,0.35);
  margin-top: 1px;
}

.waterfall-bar-track {
  flex: 1;
  height: 28px;
  background: rgba(255,255,255,0.06);
  border-radius: 6px;
  overflow: hidden;
}

.waterfall-bar-fill {
  height: 100%;
  border-radius: 6px;
  min-width: 4px;
}

.waterfall-row-right {
  width: 90px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.wf-pct {
  font-size: 13px;
  font-weight: 700;
  color: #ffffff;
}

.wf-status-badge {
  font-size: 9px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 3px 7px;
  border-radius: 4px;
  border: 1px solid;
}
```

---

### PART 4 — PDF Export Function

Add this utility. It uses the browser's print API for a clean zero-dependency PDF.

```js
// utils/exportWaterfallPDF.js

export function exportWaterfallPDF(steps, totals) {
  const fmt = n => `R ${n.toLocaleString('en-ZA')}`;
  const pct = (n, t) => t ? `${((n/t)*100).toFixed(1)}%` : '—';

  const rows = steps.map(step => {
    const p = totals.revenue ? step.value / totals.revenue : 0;
    const pctVal = pct(step.value, totals.revenue);
    const deductionRow = step.subtractLabel && step.subtractValue > 0
      ? `<tr class="deduction-row">
          <td colspan="3">" ${step.subtractLabel}: <span class="neg">(${fmt(step.subtractValue)})</span></td>
         </tr>`
      : '';
    const statusMap = p >= 0.20 ? ['HEALTHY','#1a7a4a'] : p >= 0.10 ? ['AT RISK','#b8860b'] : ['CRITICAL','#c0392b'];
    const badge = step.showStatus
      ? `<span class="badge" style="background:${statusMap[1]}20;color:${statusMap[1]};border:1px solid ${statusMap[1]}">${statusMap[0]}</span>`
      : '';

    return `
      ${deductionRow}
      <tr class="data-row">
        <td><strong>${step.label}</strong><br/><small>${fmt(step.value)} · ${pctVal} of revenue</small></td>
        <td><div class="bar-track"><div class="bar-fill" style="width:${Math.max(step.barWidth,0)}%;background:${step.color}"></div></div></td>
        <td class="right-col">${pctVal} ${badge}</td>
      </tr>
    `;
  }).join('');

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <title>MILŌN — Profitability Waterfall</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #111; padding: 40px; }
        h1 { font-size: 26px; font-weight: 900; color: #0a1628; margin-bottom: 4px; }
        .subtitle { font-size: 13px; color: #888; margin-bottom: 32px; }
        table { width: 100%; border-collapse: collapse; }
        .deduction-row td { font-size: 12px; color: #888; font-style: italic; padding: 10px 0 2px 0; }
        .neg { color: #c0392b; font-weight: 700; }
        .data-row td { padding: 8px 0; vertical-align: middle; }
        .data-row td:first-child { width: 200px; font-size: 13px; }
        .data-row td:first-child small { font-size: 11px; color: #888; }
        .bar-track { width: 100%; height: 24px; background: #f0f0f0; border-radius: 4px; overflow: hidden; margin: 0 20px; }
        .bar-fill { height: 100%; border-radius: 4px; }
        .right-col { width: 120px; text-align: right; font-weight: 700; font-size: 13px; white-space: nowrap; }
        .badge { font-size: 10px; font-weight: 800; letter-spacing: 0.08em; padding: 3px 7px; border-radius: 4px; margin-left: 6px; }
        .footer { margin-top: 40px; font-size: 11px; color: #aaa; border-top: 1px solid #eee; padding-top: 12px; }
        @media print { body { padding: 20px; } }
      </style>
    </head>
    <body>
      <h1>Profitability Waterfall</h1>
      <div class="subtitle">How R1 of revenue becomes profit · Generated ${new Date().toLocaleDateString('en-ZA')} · MILŌN</div>
      <table>${rows}</table>
      <div class="footer">Generated by MILŌN · Confidential · ${new Date().getFullYear()}</div>
      <script>window.onload = () => { window.print(); window.onafterprint = () => window.close(); }</script>
    </body>
    </html>
  `;

  const win = window.open('', '_blank');
  win.document.write(html);
  win.document.close();
}
```

Import and call it in `ProfitabilityWaterfall.jsx`:

```js
import { exportWaterfallPDF } from '../utils/exportWaterfallPDF';
```

---

### PART 5 — Wire into Ratios Tab

```jsx
// RatiosTab.jsx
import { useViewMode } from '../context/ViewModeContext';
import WeeklyInputTable from '../components/WeeklyInputTable';
import SimplifiedRatios from '../components/SimplifiedRatios';
import ProfitabilityWaterfall from '../components/ProfitabilityWaterfall';

export default function RatiosTab({ role = 'owner' }) {
  // role prop passed from parent: 'owner' | 'accountant'
  const { viewMode } = useViewMode();

  return (
    <div className="tab-content">

      {/* Shared weekly input — collapsible, same data for both roles */}
      <WeeklyInputTable role={role} />

      {/* Simplified: 4 health cards */}
      {viewMode === 'simplified' && <SimplifiedRatios />}

      {/* Complex: full profit drivers table + waterfall */}
      {viewMode === 'complex' && (
        <>
          <ComplexRatiosView />
          <ProfitabilityWaterfall />
        </>
      )}

    </div>
  );
}
```

---

## Files to create / modify

| Action | File |
|--------|------|
| Create | `context/FinancialInputsContext.js` |
| Create | `components/WeeklyInputTable.jsx` |
| Create | `components/ProfitabilityWaterfall.jsx` |
| Create | `utils/exportWaterfallPDF.js` |
| Modify | `App.jsx` — add `FinancialInputsProvider` wrapper |
| Modify | `RatiosTab.jsx` — add `WeeklyInputTable`, conditional `ProfitabilityWaterfall` |

---

## Data flow summary

```
FinancialInputsContext (shared state)
    ├── WeeklyInputTable (accountant fills interest + tax; owner fills revenue/COS/fixed/cash)
    ├── SimplifiedRatios (reads aggregated totals → 4 health cards)
    └── ProfitabilityWaterfall (reads aggregated totals → waterfall bars + PDF export)
```

Both accountant and SME owner render the same `<WeeklyInputTable>` and `<RatiosTab>` — the `role` prop controls which fields are visible in the input section. All data lives in the shared context, so any update is reflected for both users immediately.
