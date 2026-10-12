import { useRouterState } from "@tanstack/react-router";
import { AccountantNav, type NavSection } from "@/components/accountant-nav";
import { agentDisplayName } from "@/lib/milon-team";
import { openPracticeSettings } from "@/lib/user-roles";

const dash = (hash = "") => ({ to: "/dashboard" as const, hash });

const SECTIONS: NavSection[] = [
  {
    id: "team",
    label: "Team",
    headings: [
      {
        id: "home",
        label: "Home",
        to: dash(),
        bot: true,
        items: [
          { id: "financial_manager", label: agentDisplayName("financial_manager"), to: dash("ask-financial-manager") },
          { id: "analyst", label: agentDisplayName("analyst"), to: dash("ask-analyst") },
          { id: "advisor", label: agentDisplayName("advisor"), to: dash("ask-advisor") },
        ],
      },
    ],
  },
  {
    id: "book",
    label: "Book",
    headings: [
      {
        id: "clients",
        label: "Clients",
        to: dash("clients-table"),
        items: [
          { id: "all", label: "All clients", to: dash("clients-table") },
          { id: "queries", label: "Open queries", to: dash("wizard-dash-open-queries") },
          { id: "add", label: "Add client", to: dash("wizard-add-client") },
        ],
      },
      {
        id: "practice",
        label: "Practice",
        to: dash("needs-attention"),
        items: [
          { id: "attention", label: "Needs attention", to: dash("needs-attention") },
          { id: "follow", label: "Follow up", to: dash("follow-up") },
          { id: "insights", label: "Insights", to: dash("portfolio-insights") },
          { id: "marketplace", label: "Marketplace", to: dash("accountant-inbox") },
          { id: "playbooks", label: "Playbooks", to: dash("playbooks") },
        ],
      },
    ],
  },
];

const PRACTICE_HASH: Record<string, { headingId: string; subId: string | null }> = {
  "ask-financial-manager": { headingId: "home", subId: "financial_manager" },
  "ask-analyst": { headingId: "home", subId: "analyst" },
  "ask-advisor": { headingId: "home", subId: "advisor" },
  "clients-table": { headingId: "clients", subId: "all" },
  "wizard-dash-open-queries": { headingId: "clients", subId: "queries" },
  "wizard-add-client": { headingId: "clients", subId: "add" },
  "needs-attention": { headingId: "practice", subId: "attention" },
  "follow-up": { headingId: "practice", subId: "follow" },
  "portfolio-insights": { headingId: "practice", subId: "insights" },
  "accountant-inbox": { headingId: "practice", subId: "marketplace" },
  playbooks: { headingId: "practice", subId: "playbooks" },
};

function practiceSelection(pathname: string, hash: string) {
  const bare = hash.replace(/^#/, "");
  if (pathname === "/settings" || pathname.startsWith("/settings/")) {
    return { headingId: null, subId: null, settings: true };
  }
  const fromHash = PRACTICE_HASH[bare];
  if (fromHash) return { ...fromHash, settings: false };
  if (pathname === "/dashboard" || pathname === "/dashboard/" || pathname === "/desk" || pathname === "/desk/") {
    return { headingId: "home", subId: null, settings: false };
  }
  return { headingId: null, subId: null, settings: false };
}

/** Practice nav: Team (Home) and Book (Clients, Practice), with Settings pinned. */
export function PracticeRail({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const hash = useRouterState({ select: (s) => s.location.hash });
  const selection = practiceSelection(pathname, hash ?? "");
  return (
    <AccountantNav
      label="Practice"
      sections={SECTIONS}
      selection={selection}
      settingsActive={selection.settings}
      onNavigate={onNavigate}
      onSettings={() => openPracticeSettings()}
    />
  );
}
