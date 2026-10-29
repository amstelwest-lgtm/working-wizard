/**
 * Titles and one-sentence purposes for the sections on an agent page.
 * One place, so every agent says the same thing the same way.
 */
export type AgentSectionKey =
  | "work"
  | "noticed"
  | "offered"
  | "activity"
  | "forms"
  | "workings"
  | "deadlines";

export const AGENT_SECTION_COPY: Record<AgentSectionKey, { title: string; purpose: string }> = {
  work: {
    title: "Where I work",
    purpose: "The pages I keep up to date for this client. Open one to see the full figures.",
  },
  noticed: {
    title: "What I noticed",
    purpose: "Things I found in this client's latest figures that you should know about.",
  },
  offered: {
    title: "Work I can do for you",
    purpose: "Drafts I can prepare. Nothing is sent until you approve it.",
  },
  activity: {
    title: "Recent activity",
    purpose: "What I have done on this client recently, newest first.",
  },
  forms: {
    title: "SARS forms",
    purpose:
      "Pick a form. I fill in what I can from this client's records, you check it, then you file it on SARS eFiling.",
  },
  workings: {
    title: "Tax workings",
    purpose: "Company tax and provisional tax calculations for this client.",
  },
  deadlines: {
    title: "Deadlines",
    purpose: "The next SARS dates for this client.",
  },
};

/** "What I noticed" is never hidden. This is its empty state. */
export const NOTICED_EMPTY = "Nothing new since the last sync.";

/** Rows shown before "Show all" in What I noticed and Recent activity. */
export const NOTICED_CAP = 3;
export const ACTIVITY_CAP = 5;

/** Title of the chat card under the hero. */
export function askAgentTitle(shortName: string): string {
  return `Ask the ${shortName}`;
}
