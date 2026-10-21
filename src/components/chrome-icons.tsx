/**
 * Line icons for the portal chrome: rail items, agent card chips, and the
 * topbar period pill. 16px grid, stroke inherits currentColor so the rails
 * tint them in either theme.
 */
import type { ReactNode } from "react";
import type { AgentKey } from "@/lib/milon-team-feed";
import { useMarketFormat } from "@/contexts/market";
import { formatMonthYear } from "@/lib/market/format";

function Svg({ children, boxSize = 16 }: { children: ReactNode; boxSize?: number }) {
  return (
    <svg
      viewBox={`0 0 ${boxSize} ${boxSize}`}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const RAIL_PATHS: Record<string, ReactNode> = {
  home: (
    <>
      <path d="M2.8 7.2 8 2.8l5.2 4.4" />
      <path d="M4.2 8.6v4.6h7.6V8.6" />
    </>
  ),
  health: <path d="M1.8 8.4h2.8l1.6-3.8 2.6 7 1.6-3.2h3.8" />,
  cash: (
    <>
      <rect x="1.8" y="4.2" width="12.4" height="7.6" rx="1.6" />
      <circle cx="8" cy="8" r="1.9" />
    </>
  ),
  profit: (
    <>
      <path d="M2.2 11.8 6.4 7.4l2.6 2.4 4.6-5" />
      <path d="M10.4 4.8h3.2V8" />
    </>
  ),
  budget: (
    <>
      <path d="M8 2.2a5.8 5.8 0 1 0 5.8 5.8H8Z" />
      <path d="M10 1.9a6 6 0 0 1 4.1 4.3h-4.1Z" />
    </>
  ),
  moves: (
    <>
      <circle cx="8" cy="8" r="5.9" />
      <path d="m10.6 5.4-1.5 3.7-3.7 1.5 1.5-3.7Z" />
    </>
  ),
  plan: (
    <>
      <rect x="3" y="2.6" width="10" height="11" rx="1.6" />
      <path d="M5.6 6h4.8M5.6 8.6h4.8M5.6 11.2h2.8" />
    </>
  ),
  reports: (
    <>
      <path d="M4 1.9h5.4L12.8 5v9.1H4Z" />
      <path d="M9.2 2.2V5h2.9" />
    </>
  ),
  books: (
    <>
      <path d="M8 3.4C6.8 2.5 4.9 2.2 2.4 2.4v10.2c2.5-.2 4.4.1 5.6 1 1.2-.9 3.1-1.2 5.6-1V2.4c-2.5-.2-4.4.1-5.6 1Z" />
      <path d="M8 3.4v10.2" />
    </>
  ),
  accountant: (
    <>
      <rect x="2.2" y="5" width="11.6" height="8.4" rx="1.6" />
      <path d="M5.6 5V3.6A1.4 1.4 0 0 1 7 2.2h2a1.4 1.4 0 0 1 1.4 1.4V5" />
      <path d="M2.2 8.6h11.6" />
    </>
  ),
  back: <path d="M9.8 3.2 5 8l4.8 4.8" />,
  building: (
    <>
      <rect x="3" y="2.4" width="10" height="11.2" rx="1.2" />
      <path d="M5.8 5.2h1.6M8.6 5.2h1.6M5.8 7.8h1.6M8.6 7.8h1.6M6.8 13.6v-2.8h2.4v2.8" />
    </>
  ),
  calendar: (
    <>
      <rect x="2.4" y="3.2" width="11.2" height="10.4" rx="1.6" />
      <path d="M2.4 6.4h11.2M5.4 1.8v2.8M10.6 1.8v2.8" />
    </>
  ),
  caret: <path d="m4.6 6.4 3.4 3.4 3.4-3.4" />,
};

/** Rail/nav item icon. Unknown ids render nothing (practice rail, future items). */
export function RailIcon({ id }: { id: string }) {
  const path = RAIL_PATHS[id];
  if (!path) return null;
  return <Svg>{path}</Svg>;
}

const AGENT_PATHS: Record<AgentKey, ReactNode> = {
  financial_manager: (
    <>
      <ellipse cx="8" cy="4.6" rx="4.8" ry="2.1" />
      <path d="M3.2 4.6v3.2c0 1.2 2.1 2.1 4.8 2.1s4.8-.9 4.8-2.1V4.6" />
      <path d="M3.2 7.8V11c0 1.2 2.1 2.1 4.8 2.1s4.8-.9 4.8-2.1V7.8" />
    </>
  ),
  analyst: <path d="M3 13.2V9.4M8 13.2V5.6M13 13.2V2.8" />,
  advisor: (
    <>
      <circle cx="8" cy="8" r="5.9" />
      <path d="M8 5v3.4l2.4 1.4" />
    </>
  ),
};

/** Small decorative chip icon on the agent portraits. */
export function AgentChipIcon({ agent }: { agent: AgentKey }) {
  return <Svg>{AGENT_PATHS[agent]}</Svg>;
}

/**
 * Quiet topbar pill. A client header passes the books' period end
 * ("Sep 2026"). With no books, the pill stays the calendar month.
 */
export function PeriodPill({ periodLabel }: { periodLabel?: string | null }) {
  const { market } = useMarketFormat();
  const books = periodLabel?.trim() || "";
  const label = books || formatMonthYear(new Date(), market.timezone);
  return (
    <span className="period-pill" title={books ? "Figures period" : "Current period"}>
      <RailIcon id="calendar" />
      {label}
    </span>
  );
}
