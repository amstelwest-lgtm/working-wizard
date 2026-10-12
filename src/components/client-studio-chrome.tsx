import { AccountantNav, type NavDestination, type NavSection } from "@/components/accountant-nav";
import { CLIENT_NAV_OPEN_KEY } from "@/lib/accountant-nav-open";
import { clientNavSearch, clientRailSelection } from "@/lib/client-route-search";
import { agentDisplayName } from "@/lib/milon-team";
import { openPracticeSettings } from "@/lib/user-roles";

/** Flat heading list, top to bottom. Kickers are not items. */
export const CLIENT_RAIL = [
  { id: "home", label: "Home" },
  { id: "health", label: "Health" },
  { id: "cash", label: "Cash flow" },
  { id: "profit", label: "Profit" },
  { id: "budget", label: "Budget" },
  { id: "moves", label: "Next moves" },
  { id: "plan", label: "Action plan" },
  { id: "reports", label: "Reports" },
  { id: "books", label: "Books" },
] as const;

const AGENTS = [
  { id: "financial_manager" as const, label: agentDisplayName("financial_manager") },
  { id: "analyst" as const, label: agentDisplayName("analyst") },
  { id: "advisor" as const, label: agentDisplayName("advisor") },
];

function clientSections(clientId: string): NavSection[] {
  const go = (headingId: string, subId?: string | null): NavDestination => ({
    to: "/clients/$clientId",
    params: { clientId },
    search: (prev) => clientNavSearch(prev, headingId, subId) as Record<string, unknown>,
  });
  const subs = (headingId: string, items: { id: string; label: string }[]) =>
    items.map((item) => ({ ...item, to: go(headingId, item.id) }));

  return [
    {
      id: "team",
      label: "Team",
      headings: [
        {
          id: "home",
          label: "Home",
          bot: true,
          to: go("home"),
          items: subs("home", [...AGENTS]),
        },
      ],
    },
    {
      id: "numbers",
      label: "Numbers",
      headings: [
        {
          id: "health",
          label: "Health",
          to: go("health", "score"),
          items: subs("health", [
            { id: "score", label: "Score" },
            { id: "pillars", label: "Where it hurts" },
          ]),
        },
        {
          id: "cash",
          label: "Cash flow",
          to: go("cash", "forecast"),
          items: subs("cash", [
            { id: "forecast", label: "13-week forecast" },
            { id: "collections", label: "Who to chase" },
            { id: "payables", label: "Who to pay" },
          ]),
        },
        {
          id: "profit",
          label: "Profit",
          to: go("profit", "waterfall"),
          items: subs("profit", [
            { id: "waterfall", label: "Waterfall" },
            { id: "lines", label: "Product lines" },
          ]),
        },
        {
          id: "budget",
          label: "Budget",
          to: go("budget", "year"),
          items: subs("budget", [
            { id: "year", label: "This year" },
            { id: "months", label: "Month by month" },
          ]),
        },
      ],
    },
    {
      id: "work",
      label: "Work",
      headings: [
        { id: "moves", label: "Next moves", to: go("moves") },
        {
          id: "plan",
          label: "Action plan",
          to: go("plan", "open"),
          items: subs("plan", [
            { id: "open", label: "Open work" },
            { id: "overdue", label: "Overdue" },
          ]),
        },
        {
          id: "reports",
          label: "Reports",
          to: go("reports", "all"),
          items: subs("reports", [
            { id: "scorecard", label: "Health scorecard" },
            { id: "forecast", label: "13-week cash forecast" },
            { id: "waterfall", label: "Profitability waterfall" },
            { id: "drafts", label: "Drafts" },
            { id: "sent", label: "Sent" },
            { id: "all", label: "All reports" },
          ]),
        },
      ],
    },
    {
      id: "file",
      label: "File",
      headings: [
        {
          id: "books",
          label: "Books",
          to: go("books", "documents"),
          items: subs("books", [
            { id: "documents", label: "Documents" },
            { id: "connections", label: "Connections" },
          ]),
        },
      ],
    },
  ];
}

type ClientSearch = {
  tab?: string | null;
  section?: string | null;
  focus?: string | null;
  report?: string | null;
  filter?: string | null;
  agent?: string | null;
};

/** Client nav. All clients sits above the kickers. Settings is pinned. */
export function ClientRail({
  clientId,
  search,
  onNavigate,
}: {
  clientId: string;
  search: ClientSearch;
  onNavigate?: () => void;
}) {
  const selection = clientRailSelection(search);
  return (
    <AccountantNav
      label="Client workspace"
      sections={clientSections(clientId)}
      selection={selection}
      storageKey={CLIENT_NAV_OPEN_KEY}
      back={{ label: "All clients", to: { to: "/clients" } }}
      onNavigate={onNavigate}
      onSettings={() => openPracticeSettings()}
    />
  );
}
