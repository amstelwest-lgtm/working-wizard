export const LIGHTHOUSE_TABS = ["agent", "firms", "system"] as const;

export type LighthouseTab = (typeof LIGHTHOUSE_TABS)[number];

const LIGHTHOUSE_TAB_ALIASES: Record<string, LighthouseTab> = {
  pipeline: "firms",
  settings: "system",
  playbook: "agent",
  assets: "agent",
};

export function parseLighthouseTab(raw: unknown): LighthouseTab | undefined {
  if (typeof raw !== "string") return undefined;
  if ((LIGHTHOUSE_TABS as readonly string[]).includes(raw)) return raw as LighthouseTab;
  return LIGHTHOUSE_TAB_ALIASES[raw];
}
