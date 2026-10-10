/**
 * Owner-door bot names. Theo renames the team here, and nowhere else.
 * This mockup does not read src/lib/milon-team.ts: that file still names
 * the accountant desk, including the bookkeeper key.
 */

export const OWNER_TEAM_ORDER = ["financial_manager", "analyst", "advisor"] as const;

export type OwnerBotKey = (typeof OWNER_TEAM_ORDER)[number];

export type OwnerPresence = "working" | "found" | "waiting";

export const OWNER_PRESENCE_LABEL: Record<OwnerPresence, string> = {
  working: "Working",
  found: "Found something",
  waiting: "Waiting on you",
};

export const OWNER_TEAM = {
  financial_manager: {
    key: "financial_manager",
    name: "Milōn Financial Manager",
    short: "Fin. Manager",
    voice: "Financial Manager",
    initial: "F",
    kicker: "Runs the team",
    role: "Data quality from the books, the 13-week cash forecast and budget, action points, and the accountant.",
    mark: "M8 7.5a1.6 1.6 0 1 0 .01 0M16 7.5a1.6 1.6 0 1 0 .01 0M12 16.2a1.6 1.6 0 1 0 .01 0M9.2 8.8 11 14.2M14.8 8.8 13 14.2",
  },
  analyst: {
    key: "analyst",
    name: "Milōn Analyst",
    short: "Analyst",
    voice: "Analyst",
    initial: "A",
    kicker: "Diagnosis",
    role: "Health score, ratios, and variances. What the books already show.",
    mark: "M4 19h16M6 15.5l4.2-5 3.1 2.8L18 6",
  },
  advisor: {
    key: "advisor",
    name: "Milōn Advisor",
    short: "Advisor",
    voice: "Advisor",
    initial: "V",
    kicker: "Next moves",
    role: "Next moves, and the advisory deliverables those moves become.",
    mark: "M5 12h12M13 7l5 5-5 5",
  },
} as const;

export function ownerVoice(bot: OwnerBotKey): string {
  return OWNER_TEAM[bot].voice;
}

/** Feed hand-off. `to` is a voice name or an outside party, such as the firm. */
export function ownerHandoff(from: OwnerBotKey, to: string, what: string): string {
  return `${OWNER_TEAM[from].voice} → ${to}: ${what}`;
}
