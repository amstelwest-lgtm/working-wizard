import type { AgentKey } from "@/lib/milon-team-feed";

export type AgentWorkLink = {
  to:
    | "/dashboard"
    | "/practice"
    | "/practice/insights"
    | "/practice/follow-up"
    | "/clients"
    | "/clients/$clientId";
  params?: { clientId: string };
  hash?: string;
  search?: Record<string, unknown>;
};

export type AgentWorkItem = {
  id: string;
  title: string;
  detail: string;
  link: AgentWorkLink;
};

export type PracticeAgentWorkInput = {
  loading: boolean;
  clients: readonly { id: string; name: string; openQueries: number }[];
  attention: readonly {
    clientId: string;
    name: string;
    reason: string;
    openPlan: boolean;
    overdue: boolean;
  }[];
  followUps: readonly {
    clientId: string;
    name: string;
    overdueActions: number;
    openActions: number;
  }[];
};

function clientLink(clientId: string, search: Record<string, unknown>): AgentWorkLink {
  return { to: "/clients/$clientId", params: { clientId }, search };
}

/** The clients behind a practice-home agent. Empty while the book is loading. */
export function practiceAgentWork(
  agent: AgentKey,
  input: PracticeAgentWorkInput,
): { empty: string; items: AgentWorkItem[] } {
  if (input.loading) return { empty: "Loading the book.", items: [] };
  if (agent === "financial_manager") {
    const rows = input.clients.filter((client) => client.openQueries > 0);
    if (rows.length === 0) {
      return {
        empty: "",
        items: [
          {
            id: "clients",
            title: "Clients",
            detail: "No open queries. The list is the book.",
            link: { to: "/clients", hash: "clients-table" },
          },
        ],
      };
    }
    return {
      empty: "",
      items: rows.map((client) => ({
        id: client.id,
        title: client.name,
        detail: client.openQueries === 1 ? "1 open query" : `${client.openQueries} open queries`,
        link: clientLink(client.id, { tab: "home", agent: "financial_manager", queries: "open" }),
      })),
    };
  }
  if (agent === "analyst") {
    if (input.attention.length === 0) {
      return {
        empty: "",
        items: [
          {
            id: "insights",
            title: "Health trend",
            detail: "No client needs attention.",
            link: { to: "/practice/insights" },
          },
        ],
      };
    }
    return {
      empty: "",
      items: input.attention.map((item) => ({
        id: item.clientId,
        title: item.name,
        detail: item.reason,
        link: clientLink(
          item.clientId,
          item.openPlan
            ? {
                tab: "plan",
                section: item.overdue ? "overdue" : "open",
                ...(item.overdue ? { filter: "overdue" } : {}),
              }
            : { tab: "health", section: "score" },
        ),
      })),
    };
  }
  if (input.followUps.length === 0) {
    return {
      empty: "",
      items: [
        {
          id: "follow-up",
          title: "Follow up",
          detail: "No follow-up waiting.",
          link: { to: "/practice/follow-up" },
        },
      ],
    };
  }
  return {
    empty: "",
    items: input.followUps.map((item) => ({
      id: item.clientId,
      title: item.name,
      detail:
        item.overdueActions > 0
          ? item.overdueActions === 1
            ? "1 overdue"
            : `${item.overdueActions} overdue`
          : item.openActions === 1
            ? "1 open"
            : `${item.openActions} open`,
      link: clientLink(item.clientId, {
        tab: "plan",
        section: item.overdueActions > 0 ? "overdue" : "open",
        ...(item.overdueActions > 0 ? { filter: "overdue" } : {}),
      }),
    })),
  };
}

/** Pages this agent works from. The figures stay on those pages. */
export function clientAgentWork(agent: AgentKey, clientId: string): AgentWorkItem[] {
  const rows =
    agent === "financial_manager"
      ? [
          {
            id: "forecast",
            title: "13-week forecast",
            detail: "Expected cash in and out, week by week.",
            search: { tab: "cash", section: "forecast" },
          },
          {
            id: "collections",
            title: "Who to chase",
            detail: "Customers who owe money, oldest first.",
            search: { tab: "cash", section: "collections" },
          },
        ]
      : agent === "analyst"
        ? [
            {
              id: "score",
              title: "Health score",
              detail: "The overall score, each pillar, and the PDF report.",
              search: { tab: "health", section: "score" },
            },
            {
              id: "waterfall",
              title: "Profit waterfall",
              detail: "How revenue turns into profit, step by step.",
              search: { tab: "profit", section: "waterfall" },
            },
          ]
        : [
            {
              id: "moves",
              title: "Next moves",
              detail: "Suggested actions for this client, ranked by impact.",
              search: { tab: "moves" },
            },
            {
              id: "plan",
              title: "Action plan",
              detail: "Tasks already agreed, who owns them, and what is overdue.",
              search: { tab: "plan" },
            },
          ];
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    detail: row.detail,
    link: clientLink(clientId, row.search),
  }));
}
