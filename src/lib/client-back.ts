/** Where the header back control on an accountant client page returns. */
export function clientBackTarget(input: {
  tab?: string | null;
  section?: string | null;
  agent?: string | null;
}): { label: string; tab: string } | null {
  const pane = (input.tab ?? "overview").trim() || "overview";
  if (input.agent) return { label: "Home", tab: "home" };
  const parent: Record<string, { label: string; tab: string }> = {
    overview: { label: "Home", tab: "home" },
    ask: { label: "Home", tab: "home" },
    ratios: { label: "Health", tab: "health" },
    health: { label: "Health", tab: "health" },
    cash: { label: "Cash flow", tab: "cash" },
    profit: { label: "Profit", tab: "profit" },
    budget: { label: "Budget", tab: "budget" },
    moves: { label: "Next moves", tab: "moves" },
    plan: { label: "Action plan", tab: "plan" },
    reports: { label: "Reports", tab: "reports" },
    tax: { label: "Tax", tab: "tax" },
    summary: { label: "Books", tab: "portal" },
    portal: { label: "Books", tab: "portal" },
  };
  const row = parent[pane];
  if (!row) return null;
  if (pane === "overview") return null;
  if ((input.section ?? "").trim()) return { label: row.label, tab: row.tab };
  return { label: "Home", tab: "home" };
}
