/**
 * Owner board and accountant studio use different tab IDs for the same
 * deliverable. Notes store whichever ID the author was on. Read, pin
 * visibility, and “show on page” must treat those pairs as one page.
 *
 * Pairs:
 *   Health        today | today-complex | ratios
 *   Profit        waterfall | profit
 *   Action plan   tasks | plan
 *   Cash          cash
 *   Collections   collections (accountant only)
 *   Budget        budget
 *
 * No parallel page (stay in Open queries; do not dump the user on the wrong tab):
 *   next → owner Next moves only
 *   overview, summary, ask, reports, advisory → accountant studio only
 */

export type NotesWorkspace = "owner" | "accountant";

export const OWNER_NOTE_TABS = [
  "today",
  "waterfall",
  "cash",
  "budget",
  "next",
  "tasks",
] as const;

export const ACCOUNTANT_NOTE_TABS = [
  "overview",
  "summary",
  "ask",
  "ratios",
  "profit",
  "cash",
  "collections",
  "budget",
  "reports",
  "plan",
  "advisory",
] as const;

/** Same-deliverable aliases. First owner-native id, then accountant-native id. */
const TAB_GROUPS: readonly (readonly string[])[] = [
  ["today", "today-complex", "ratios"],
  ["waterfall", "profit"],
  ["tasks", "plan"],
  ["cash"],
  ["collections"],
  ["budget"],
  ["next"],
  ["overview"],
  ["summary"],
  ["ask"],
  ["reports"],
  ["advisory"],
];

const GROUP_BY_TAB = new Map<string, readonly string[]>();
for (const group of TAB_GROUPS) {
  for (const id of group) GROUP_BY_TAB.set(id, group);
}

export const NOTE_TAB_LABELS: Record<string, string> = {
  today: "Health",
  "today-complex": "Health",
  ratios: "Health",
  waterfall: "Profit",
  profit: "Profit",
  next: "Next moves",
  cash: "Cash",
  collections: "Collections",
  budget: "Budget",
  tasks: "Action plan",
  plan: "Action plan",
  reports: "Reports",
  advisory: "Advisory",
  overview: "Overview",
  summary: "Client Brain",
  ask: "Milōn Bot",
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
