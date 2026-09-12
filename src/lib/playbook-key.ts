import { RATIO_NAME_TO_KEY } from "@/lib/health-score";

/**
 * Playbook JSON uses camelCase keys (`grossMargin`). A few computed ratios
 * share a nearest existing playbook when they do not have their own pack.
 */
const PLAYBOOK_ALIASES: Record<string, string> = {
  inventoryDays: "wipDays",
  workingCapitalDays: "workingCapitalFunding",
};

function toCamelKey(name: string): string {
  const mapped = RATIO_NAME_TO_KEY[name];
  if (mapped) return mapped;
  const cleaned = name.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!cleaned) return name;
  const [first, ...rest] = cleaned.split(/\s+/);
  return (
    first.toLowerCase() +
    rest.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join("")
  );
}

/** Resolve the playbook JSON key for a `computeRatios()` display name. */
export function playbookKeyForRatioName(name: string): string {
  const key = toCamelKey(name);
  return PLAYBOOK_ALIASES[key] ?? key;
}
