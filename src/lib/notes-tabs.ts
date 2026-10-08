/**
 * Owner board and accountant studio use different tab IDs for the same
 * deliverable. Notes store whichever ID the author was on. Read, pin
 * visibility, and “show on page” must treat those pairs as one page.
 *
 * Pairs:
 *   Health        today | today-complex | ratios | health | pillars
 *   Profit        waterfall | profit
 *   Action plan   tasks | plan | actions | action-plan
 *   Cash          cash
 *   Collections   collections (accountant only)
 *   Payables      payables (accountant only)
 *   Budget        budget
 *   Books         summary | data | brain | books | client-brain
 *   Advisory      advisory | pack | drafter (one note group across the split)
 *
 * No parallel page (stay in Open queries; do not dump the user on the wrong tab):
 *   next → owner Next moves only
 *   moves → accountant Strategic Moves (not the owner Next tab)
 *   overview, summary, ask, reports, advisory → accountant studio only
 */

export type NotesWorkspace = "owner" | "accountant";

export const OWNER_NOTE_TABS = ["today", "waterfall", "cash", "budget", "next", "tasks"] as const;

export const ACCOUNTANT_NOTE_TABS = [
  "overview",
  "summary",
  "ask",
  "ratios",
  "profit",
  "cash",
  "collections",
  "payables",
  "budget",
  "reports",
  "plan",
  "advisory",
  "moves",
] as const;

/** Same-deliverable aliases. First owner-native id, then accountant-native id. */
const TAB_GROUPS: readonly (readonly string[])[] = [
  ["today", "today-complex", "ratios", "health", "pillars"],
  ["waterfall", "profit", "profitability"],
  ["tasks", "plan", "actions", "action", "action-plan"],
  ["cash", "forecast", "cash-forecast"],
  ["collections"],
  ["payables"],
  ["budget"],
  ["next"],
  ["moves", "strategic-moves"],
  ["overview"],
  ["summary", "data", "brain", "books", "client-brain"],
  ["ask", "bot", "milon-bot"],
  ["reports", "report"],
  ["advisory", "pack", "drafter"],
];

const GROUP_BY_TAB = new Map<string, readonly string[]>();
for (const group of TAB_GROUPS) {
  for (const id of group) GROUP_BY_TAB.set(id, group);
}

export const NOTE_TAB_LABELS: Record<string, string> = {
  today: "Health",
  "today-complex": "Health",
  ratios: "Health",
  health: "Health",
  pillars: "Health",
  waterfall: "Profit",
  profit: "Profit",
  next: "Next moves",
  moves: "Moves",
  cash: "Cash",
  collections: "Collections",
  payables: "Payables",
  budget: "Budget",
  tasks: "Action plan",
  plan: "Action plan",
  actions: "Action plan",
  reports: "Reports",
  report: "Reports",
  advisory: "Advisory",
  pack: "Advisory",
  overview: "Overview",
  summary: "Books",
  data: "Books",
  brain: "Books",
  books: "Books",
  "client-brain": "Books",
  ask: "Milōn Bot",
  bot: "Milōn Bot",
  "milon-bot": "Milōn Bot",
};

export function noteTabLabel(tab: string): string {
  return NOTE_TAB_LABELS[tab] ?? tab;
}

function groupOf(tab: string): readonly string[] {
  return GROUP_BY_TAB.get(tab) ?? [tab];
}

export function noteTabsMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  return groupOf(a) === groupOf(b);
}

function pickAllowed(group: readonly string[], allowed: readonly string[]): string | null {
  return group.find((id) => allowed.includes(id)) ?? null;
}

/** Studio tab that should show this note, or null if this workspace has no matching page. */
export function destinationTab(storedTab: string, workspace: NotesWorkspace): string | null {
  const group = groupOf(storedTab);
  if (workspace === "accountant") return pickAllowed(group, ACCOUNTANT_NOTE_TABS);
  return pickAllowed(group, OWNER_NOTE_TABS);
}

export function accountantWorkspaceTab(storedTab: string): string | null {
  return destinationTab(storedTab, "accountant");
}

export function ownerWorkspaceTab(storedTab: string): string | null {
  return destinationTab(storedTab, "owner");
}

/** Gold CTA copy, or null when the note can only be answered in the list. */
export function showOnPageLabel(storedTab: string, workspace: NotesWorkspace): string | null {
  const dest = destinationTab(storedTab, workspace);
  if (!dest) return null;
  return `Show on ${noteTabLabel(dest)}`;
}

export function stayInListHint(storedTab: string, workspace: NotesWorkspace): string {
  const who = workspace === "accountant" ? "owner's" : "accountant's";
  return `Pinned on the ${who} ${noteTabLabel(storedTab)}. Reply here.`;
}
