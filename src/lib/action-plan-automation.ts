/**
 * Suggested owner, due date, follow-up, and duplicate/contradiction checks.
 * Suggestions are labelled for the accountant to confirm. Nothing is dropped
 * until they say so. Dates come from the action's stored created date.
 */

export type AutomationStatus = "not_started" | "in_progress" | "done" | "blocked" | string;

export type AutomationItem = {
  id: string;
  title: string;
  ownerId: string | null;
  ownerName: string | null;
  dueDate: string | null;
  status: AutomationStatus;
  createdAt: string;
  lastNudgeAt?: string | null;
};

export type TeamOption = { id: string; name: string };

export type BotKey = "financial_manager" | "analyst" | "advisor";

export type SuggestedOwner =
  | { kind: "team"; id: string; name: string }
  | { kind: "bot"; id: BotKey; name: string };

export type FollowUpState = "overdue" | "nudged" | "waiting" | "none" | "done";

export type ActionAutomationRow = {
  id: string;
  title: string;
  owner: SuggestedOwner | null;
  ownerSuggested: boolean;
  dueDate: string | null;
  dueSuggested: boolean;
  followUp: FollowUpState;
  overdue: boolean;
};

export type DuplicateGroup = {
  keepId: string;
  dropIds: string[];
  title: string;
};

export type Contradiction = {
  leftId: string;
  rightId: string;
  leftTitle: string;
  rightTitle: string;
  reason: string;
};

const BOTS: { id: BotKey; name: string; test: RegExp }[] = [
  { id: "financial_manager", name: "Financial Manager", test: /cash|invoice|debtor|collect|budget|forecast|payroll|chase/i },
  { id: "analyst", name: "Analyst", test: /margin|ratio|health|variance|profit/i },
  { id: "advisor", name: "Advisor", test: /price|hire|strateg|advisory|customer/i },
];

const SIDES: { id: string; test: RegExp; opposite: string; reason: string }[] = [
  { id: "price-up", test: /raise price|increase price|put prices up/, opposite: "price-down", reason: "One action raises prices and another cuts them." },
  { id: "price-down", test: /cut price|lower price|discount price/, opposite: "price-up", reason: "One action raises prices and another cuts them." },
  { id: "hire", test: /\bhire\b|recruit|new headcount/, opposite: "freeze", reason: "One action adds people and another freezes hiring." },
  { id: "freeze", test: /hiring freeze|freeze hiring|stop hiring|no new hire/, opposite: "hire", reason: "One action adds people and another freezes hiring." },
  { id: "chase", test: /\bchase\b|collect the|collect invoice/, opposite: "writeoff", reason: "One action chases a balance and another writes it off." },
  { id: "writeoff", test: /write off|write-off|forgive the debt/, opposite: "chase", reason: "One action chases a balance and another writes it off." },
];

export function actionTitleKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function addDays(iso: string, days: number): string | null {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return null;
  return new Date(time + days * 86400000).toISOString().slice(0, 10);
}

export function suggestOwner(title: string, team: readonly TeamOption[]): SuggestedOwner {
  const hay = title.toLowerCase();
  const people = team
    .map((person) => ({ ...person, name: person.name.trim() }))
    .filter((person) => person.name.length >= 4 && hay.includes(person.name.toLowerCase()))
    .sort((a, b) => b.name.length - a.name.length);
  if (people[0]) return { kind: "team", id: people[0].id, name: people[0].name };
  const bot = BOTS.find((row) => row.test.test(title));
  if (bot) return { kind: "bot", id: bot.id, name: bot.name };
  return { kind: "bot", id: "financial_manager", name: "Financial Manager" };
}

function sideOf(title: string): { id: string; reason: string } | null {
  const matches = SIDES.filter((side) => side.test.test(title.toLowerCase()));
  if (matches.length !== 1) return null;
  return { id: matches[0]!.id, reason: matches[0]!.reason };
}

function open(item: AutomationItem): boolean {
  return item.status !== "done";
}

export function planAutomation(
  items: readonly AutomationItem[],
  team: readonly TeamOption[],
  today: string,
): {
  rows: ActionAutomationRow[];
  duplicates: DuplicateGroup[];
  contradictions: Contradiction[];
} {
  const rows: ActionAutomationRow[] = items.map((item) => {
    const hasOwner = Boolean(item.ownerId || item.ownerName?.trim());
    const owner = hasOwner ? null : suggestOwner(item.title, team);
    const dueSuggested = !item.dueDate;
    const dueDate = item.dueDate ?? (dueSuggested ? addDays(item.createdAt, 14) : null);
    let followUp: FollowUpState = "none";
    if (item.status === "done") followUp = "done";
    else if (item.dueDate && item.dueDate < today) followUp = "overdue";
    else if (item.lastNudgeAt) followUp = "nudged";
    else if (hasOwner) followUp = "waiting";
    return {
      id: item.id,
      title: item.title,
      owner,
      ownerSuggested: owner != null,
      dueDate,
      dueSuggested: dueSuggested && dueDate != null,
      followUp,
      overdue: followUp === "overdue",
    };
  });

  const groups = new Map<string, AutomationItem[]>();
  for (const item of items) {
    if (!open(item)) continue;
    const key = actionTitleKey(item.title);
    if (!key) continue;
    const list = groups.get(key) ?? [];
    list.push(item);
    groups.set(key, list);
  }
  const duplicates: DuplicateGroup[] = [];
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const ordered = [...list].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    const keep = ordered[0]!;
    duplicates.push({
      keepId: keep.id,
      dropIds: ordered.slice(1).map((item) => item.id),
      title: keep.title,
    });
  }
  const drop = new Set(duplicates.flatMap((group) => group.dropIds));

  const contradictions: Contradiction[] = [];
  const seen = new Set<string>();
  const candidates = items.filter((item) => open(item) && !drop.has(item.id));
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const left = candidates[i]!;
      const right = candidates[j]!;
      const a = sideOf(left.title);
      const b = sideOf(right.title);
      if (!a || !b || a.id === b.id) continue;
      const opposite = SIDES.find((side) => side.id === a.id)?.opposite;
      if (opposite !== b.id) continue;
      const key = [left.id, right.id].sort().join(":");
      if (seen.has(key)) continue;
      seen.add(key);
      contradictions.push({
        leftId: left.id,
        rightId: right.id,
        leftTitle: left.title,
        rightTitle: right.title,
        reason: a.reason,
      });
    }
  }

  return { rows, duplicates, contradictions };
}
