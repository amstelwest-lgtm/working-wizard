# Replit Implementation Prompt — Simplified / Complex Toggle

Paste this entire prompt into Replit's AI assistant (or your working-wizard codebase chat).

---

## Context

I have a mobile-first financial dashboard app called MILŌN built with React. It has a tab bar with 5 tabs: Overview, Ratios, Cash, Moves, Tasks. The app uses a dark theme (deep navy/black backgrounds, gold/amber accents, white text). I need to add a **Simplified / Complex** view toggle.

---

## What to build

### 1. Toggle Component

Create a reusable `ViewToggle` component:

```jsx
// components/ViewToggle.jsx

export default function ViewToggle({ mode, onChange }) {
  return (
    <div className="view-toggle">
      <button
        className={`toggle-pill ${mode === 'simplified' ? 'active' : ''}`}
        onClick={() => onChange('simplified')}
      >
        Simplified
      </button>
      <button
        className={`toggle-pill ${mode === 'complex' ? 'active' : ''}`}
        onClick={() => onChange('complex')}
      >
        Complex
      </button>
    </div>
  );
}
```

```css
/* Styles for ViewToggle */
.view-toggle {
  display: flex;
  background: rgba(255, 255, 255, 0.06);
  border-radius: 999px;
  padding: 3px;
  gap: 2px;
  width: fit-content;
  margin: 0 auto 16px auto;
}

.toggle-pill {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  padding: 5px 16px;
  border-radius: 999px;
  border: none;
  background: transparent;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  transition: all 0.2s ease;
}

.toggle-pill.active {
  background: #C9A84C; /* gold accent */
  color: #0a0e1a;      /* dark navy */
  box-shadow: 0 2px 8px rgba(201, 168, 76, 0.35);
}
```

---

### 2. Persist toggle state

Store the toggle state at the app/layout level so it persists across tab switches:

```jsx
// In your root App.jsx or layout component
const [viewMode, setViewMode] = useState('simplified');
```

Pass `viewMode` and `setViewMode` down to each tab, or use a lightweight context:

```jsx
// context/ViewModeContext.js
import { createContext, useContext, useState } from 'react';

const ViewModeContext = createContext();

export function ViewModeProvider({ children }) {
  const [viewMode, setViewMode] = useState('simplified');
  return (
    <ViewModeContext.Provider value={{ viewMode, setViewMode }}>
      {children}
    </ViewModeContext.Provider>
  );
}

export const useViewMode = () => useContext(ViewModeContext);
```

Wrap your app in `<ViewModeProvider>`.

---

### 3. Toggle placement

**Mobile (primary):** Place `<ViewToggle>` directly below the tab bar, above the page content, centered. It should appear on every tab.

**Desktop:** When screen width > 768px, reposition the toggle to float top-right of the content area, inline with the section heading. Use a media query or conditional className.

```css
@media (min-width: 768px) {
  .view-toggle {
    margin: 0 0 0 auto; /* push right */
  }
  /* wrap section-header and toggle in a flex row */
}
```

---

### 4. Simplified Ratios Tab — 4 Health Cards with Sparklines

When `viewMode === 'simplified'` on the **Ratios tab**, replace the full profit drivers table with this 2×2 card grid:

```jsx
// components/SimplifiedRatios.jsx
import Sparkline from './Sparkline';

const RATIO_CARDS = [
  {
    id: 'cash',
    label: 'CASH',
    value: 45,
    status: 'HIGH RISK',
    statusColor: '#e05c5c',
    data: [62, 58, 53, 49, 46, 45],
    trend: 'down',
  },
  {
    id: 'profit',
    label: 'PROFIT',
    value: 59,
    status: 'HIGH RISK',
    statusColor: '#e05c5c',
    data: [71, 68, 65, 62, 60, 59],
    trend: 'down',
  },
  {
    id: 'assets',
    label: 'ASSETS',
    value: 83,
    status: 'HEALTHY',
    statusColor: '#4CAF82',
    data: [78, 79, 81, 82, 83, 83],
    trend: 'up',
  },
  {
    id: 'financing',
    label: 'FINANCING',
    value: 58,
    status: 'HIGH RISK',
    statusColor: '#e05c5c',
    data: [65, 63, 61, 60, 59, 58],
    trend: 'down',
  },
];

export default function SimplifiedRatios() {
  return (
    <div className="simplified-ratios-grid">
      {RATIO_CARDS.map(card => (
        <div key={card.id} className="ratio-card">
          <div className="ratio-label">{card.label}</div>
          <div className="ratio-value">{card.value}%</div>
          <div
            className="ratio-status"
            style={{ color: card.statusColor }}
          >
            {card.status}
          </div>
          <Sparkline
            data={card.data}
            trend={card.trend}
            width={100}
            height={36}
          />
        </div>
      ))}
    </div>
  );
}
```

```css
.simplified-ratios-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 16px;
}

.ratio-card {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  padding: 16px 14px 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ratio-label {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.12em;
  color: rgba(255, 255, 255, 0.45);
  text-transform: uppercase;
}

.ratio-value {
  font-size: 28px;
  font-weight: 700;
  color: #ffffff;
  line-height: 1.1;
}

.ratio-status {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
```

---

### 5. Sparkline Component

```jsx
// components/Sparkline.jsx
export default function Sparkline({ data, trend, width = 100, height = 36 }) {
  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;
  const padX = 4;
  const padY = 4;
  const w = width - padX * 2;
  const h = height - padY * 2;

  const points = data.map((val, i) => {
    const x = padX + (i / (data.length - 1)) * w;
    const y = padY + h - ((val - min) / range) * h;
    return `${x},${y}`;
  });

  const color = trend === 'up' ? '#4CAF82' : '#e05c5c';
  const polyline = points.join(' ');

  // Fill area under line
  const firstPoint = points[0].split(',');
  const lastPoint = points[points.length - 1].split(',');
  const fillPoints = [
    `${firstPoint[0]},${height - padY}`,
    ...points,
    `${lastPoint[0]},${height - padY}`,
  ].join(' ');

  return (
    <svg width={width} height={height} style={{ marginTop: 6 }}>
      <defs>
        <linearGradient id={`grad-${trend}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={fillPoints}
        fill={`url(#grad-${trend})`}
      />
      <polyline
        points={polyline}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Dot on last point */}
      <circle
        cx={lastPoint[0]}
        cy={lastPoint[1]}
        r="3"
        fill={color}
      />
    </svg>
  );
}
```

---

### 6. Wire it all together in the Ratios tab

```jsx
// In your RatiosTab.jsx
import { useViewMode } from '../context/ViewModeContext';
import SimplifiedRatios from '../components/SimplifiedRatios';

export default function RatiosTab() {
  const { viewMode } = useViewMode();

  return (
    <div className="tab-content">
      {viewMode === 'simplified' ? (
        <SimplifiedRatios />
      ) : (
        <ComplexRatiosView /> // your existing full ratios view
      )}
    </div>
  );
}
```

---

### 7. Data hookup note

The `RATIO_CARDS` data in `SimplifiedRatios.jsx` is currently hardcoded with the values visible in the app screenshots (Cash 45%, Profit 59%, Assets 83%, Financing 58%). Replace these with your live data source — pass in props or connect to your existing state/API calls that power the current ratios view.

The `data` array for each sparkline should be the last 6 historical readings for that metric in chronological order (oldest first, newest last).

---

## Files to create / modify

| Action | File |
|--------|------|
| Create | `components/ViewToggle.jsx` |
| Create | `components/SimplifiedRatios.jsx` |
| Create | `components/Sparkline.jsx` |
| Create | `context/ViewModeContext.js` |
| Modify | `App.jsx` — wrap in `ViewModeProvider`, render `ViewToggle` below tab bar |
| Modify | `RatiosTab.jsx` — conditional render based on `viewMode` |

---

That's the full implementation. Build these files, wire up the context, and the toggle will work across all tabs with the simplified 4-card ratios view on mobile.
