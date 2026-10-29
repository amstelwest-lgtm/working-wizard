import { AccountantNav, type NavDestination, type NavSection } from "@/components/accountant-nav";
import { CLIENT_NAV_OPEN_KEY } from "@/lib/accountant-nav-open";
import {
  canonicalizeAccountantSearch,
  clientNavSearch,
  clientRailSelection,
} from "@/lib/client-route-search";
import { askHashForAgent, searchWithAskAgent } from "@/lib/ask-agent";
import { agentDisplayName } from "@/lib/milon-team";

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

function clientSections(clientId: string, showSendAgent: boolean): NavSection[] {
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
          items: AGENTS.map((agent) => ({
            id: agent.id,
            label: agent.label,
            to: {
              to: "/clients/$clientId" as const,
              params: { clientId },
              hash: askHashForAgent(agent.id),
              search: (prev: Record<string, unknown>) =>
                searchWithAskAgent(prev, agent.id) as Record<string, unknown>,
            },
          })),
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
          to: go("health"),
          items: subs("health", [
            { id: "score", label: "Score" },
            { id: "pillars", label: "Where it hurts" },
          ]),
        },
        {
          id: "cash",
          label: "Cash flow",
          to: go("cash"),
          items: subs("cash", [
            { id: "forecast", label: "13-week forecast" },
            { id: "collections", label: "Who to chase" },
            { id: "payables", label: "Who to pay" },
          ]),
        },
        {
          id: "profit",
          label: "Profit",
          to: go("profit"),
          items: subs("profit", [
            { id: "waterfall", label: "Waterfall" },
            { id: "lines", label: "Product lines" },
          ]),
        },
        {
          id: "budget",
          label: "Budget",
          to: go("budget"),
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
          to: go("plan"),
          items: subs("plan", [
            { id: "open", label: "Open work" },
            { id: "overdue", label: "Overdue" },
          ]),
        },
        {
          id: "reports",
          label: "Reports",
          to: go("reports"),
          items: subs("reports", [
            { id: "scorecard", label: "Health scorecard" },
            { id: "budget-pdf", label: "Budget & variance" },
            { id: "benchmark", label: "Benchmark" },
            { id: "forecast", label: "13-week cash forecast" },
            { id: "waterfall", label: "Profitability waterfall" },
            { id: "drafts", label: "Advisory pack" },
            { id: "draft-tool", label: "Draft tool" },
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
          to: go("books"),
          items: subs("books", [
            { id: "documents", label: "Client library" },
            { id: "connections", label: "Connections" },
            ...(showSendAgent ? [{ id: "send-agent", label: "Send an agent" }] : []),
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
  showSendAgent = false,
  onNavigate,
}: {
  clientId: string;
  search: ClientSearch;
  showSendAgent?: boolean;
  onNavigate?: () => void;
}) {
  const selection = clientRailSelection(search);
  const onClientSettings = canonicalizeAccountantSearch(search).tab === "settings";
  return (
    <AccountantNav
      label="Client workspace"
      sections={clientSections(clientId, showSendAgent)}
      selection={selection}
      storageKey={CLIENT_NAV_OPEN_KEY}
      settingsActive={onClientSettings}
      settingsTo={{
        to: "/clients/$clientId",
        params: { clientId },
        search: (prev) => clientNavSearch(prev, "settings"),
      }}
      back={{ label: "All clients", to: { to: "/clients" } }}
      onNavigate={onNavigate}
    />
  );
}
