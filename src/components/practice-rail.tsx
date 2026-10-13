import { useRouterState } from "@tanstack/react-router";
import { AccountantNav, type NavSection } from "@/components/accountant-nav";
import { PRACTICE_NAV_OPEN_KEY } from "@/lib/accountant-nav-open";
import { agentDisplayName } from "@/lib/milon-team";
import { practiceAgentFromHash, practiceAgentHash } from "@/lib/practice-agent-hash";
import { openPracticeSettings } from "@/lib/user-roles";

const home = (hash = "") => ({ to: "/dashboard" as const, hash });
const clients = (hash = "") => ({ to: "/clients" as const, hash });
const practice = (hash = "") => ({ to: "/practice" as const, hash });

const SECTIONS: NavSection[] = [
  {
    id: "team",
    label: "Team",
    headings: [
      {
        id: "home",
        label: "Home",
        to: home(),
        bot: true,
        items: [
          {
            id: "financial_manager",
            label: agentDisplayName("financial_manager"),
            to: home(practiceAgentHash("financial_manager")),
          },
          { id: "analyst", label: agentDisplayName("analyst"), to: home(practiceAgentHash("analyst")) },
          { id: "advisor", label: agentDisplayName("advisor"), to: home(practiceAgentHash("advisor")) },
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
        to: clients(),
        items: [
          { id: "all", label: "All clients", to: clients("clients-table") },
          { id: "queries", label: "Open queries", to: practice("wizard-dash-open-queries") },
          { id: "add", label: "Add client", to: clients("wizard-add-client") },
        ],
      },
      {
        id: "practice",
        label: "Practice",
        to: practice(),
        items: [
          { id: "attention", label: "Needs attention", to: practice("needs-attention") },
          { id: "follow", label: "Follow up", to: practice("follow-up") },
          { id: "insights", label: "Insights", to: practice("portfolio-insights") },
          { id: "marketplace", label: "Marketplace", to: practice("accountant-inbox") },
          { id: "playbooks", label: "Playbooks", to: practice("playbooks") },
        ],
      },
    ],
  },
];

const CLIENT_HASH: Record<string, string> = {
  "clients-table": "all",
  "wizard-add-client": "add",
};

const PRACTICE_HASH: Record<string, string> = {
  "needs-attention": "attention",
  "follow-up": "follow",
  "portfolio-insights": "insights",
  "accountant-inbox": "marketplace",
  playbooks: "playbooks",
};

function barePath(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) return pathname.slice(0, -1);
  return pathname;
}

function practiceSelection(pathname: string, hash: string) {
  const bare = hash.replace(/^#/, "");
  const path = barePath(pathname);
  if (path === "/settings" || pathname.startsWith("/settings/")) {
    return { headingId: null, subId: null, settings: true };
  }
  if (path === "/clients") {
    return { headingId: "clients", subId: CLIENT_HASH[bare] ?? "all", settings: false };
  }
  if (path === "/practice") {
    if (bare === "wizard-dash-open-queries") {
      return { headingId: "clients", subId: "queries", settings: false };
    }
    return { headingId: "practice", subId: PRACTICE_HASH[bare] ?? null, settings: false };
  }
  if (path === "/dashboard" || path === "/desk") {
    const subId = practiceAgentFromHash(bare);
    return { headingId: "home", subId, settings: false };
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
      storageKey={PRACTICE_NAV_OPEN_KEY}
      settingsActive={selection.settings}
      onNavigate={onNavigate}
      onSettings={() => openPracticeSettings()}
    />
  );
}
