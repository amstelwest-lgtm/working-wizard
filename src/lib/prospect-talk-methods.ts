/**
 * /talk method answers. One table, keyed by the scoring registry
 * (METRIC_DIRECTIONS). Formula text comes from RATIO_EXPLAIN. The figures
 * cover is the same rule annualiseFinancials and computedDaysAr use.
 */
import { CASH_FORECAST_WEEKS } from "./cash-runway.ts";
import { FLOW_FIELD_KEYS } from "./flow-fields.ts";
import { PILLAR_RATIO_NAMES } from "./health-catalogue.ts";
import { METRIC_DIRECTIONS } from "./metric-directions.ts";
import { PERIOD_MONEY_RATIOS, RATIO_EXPLAIN } from "./ratio-explain.ts";

const FLOW = new Set<string>(FLOW_FIELD_KEYS);

/**
 * Registry name → formula-table name, where the scored name and the explain
 * name differ. WIP days are the inventory-days formula (the playbook scores
 * wipDays as inventoryDays).
 */
const EXPLAIN_NAME: Record<string, string> = {
  "Revenue Growth": "Revenue Growth Rate",
  "WIP Days": "Inventory Days",
};

/** Catalogue ratios whose scored key is not the METRIC_DIRECTIONS key. */
const CATALOGUE_KEY: Record<string, string> = {
  "Degree of Operating Leverage": "dol",
};

const COVER_ANNUALISED =
  "Flows are annualised to the stored figures cover (revenue × 12 / months when the cover is 1–11 months, and the same scale on every other flow). A missing or invalid cover is 12 months, so the stored flow is already a year. A year-to-date span does not replace that cover.";

const COVER_DAYS = `${COVER_ANNUALISED} Balance-sheet stocks are not annualised. Days are the stock divided by the annualised flow, times 365.`;

const COVER_CANCELS =
  "Both figures are flows from the same period, so the ratio is unchanged when the stored figures cover annualises them (revenue × 12 / months when the cover is 1–11 months; a missing cover is 12). A year-to-date span does not replace that cover.";

const COVER_STOCKS =
  "These figures are balance-sheet stocks, so the stored figures cover does not annualise them.";

const COVER_MIXED = `${COVER_ANNUALISED} Balance-sheet stocks are not annualised.`;

export type ProspectMethodEntry = {
  key: string;
  name: string;
  formula: string;
  answer: string;
};

function coverFor(
  name: string,
  explainName: string,
  formula: string,
  needed: readonly string[],
): string {
  if (formula.includes("365") || /\bDays\b/.test(name)) return COVER_DAYS;
  if (PERIOD_MONEY_RATIOS.has(explainName)) return COVER_CANCELS;
  const flows = needed.some((key) => FLOW.has(key));
  const stocks = needed.some((key) => !FLOW.has(key));
  if (flows && stocks) return COVER_MIXED;
  if (flows) return COVER_CANCELS;
  return COVER_STOCKS;
}

function entryFor(key: string, name: string): ProspectMethodEntry {
  const explainName = EXPLAIN_NAME[name] ?? name;
  const pack = RATIO_EXPLAIN[explainName];
  if (!pack?.formula) {
    throw new Error(`${name} has no formula in the ratio registry`);
  }
  const lead =
    explainName === name
      ? `${name} is ${pack.formula}.`
      : `${name} follows ${explainName}: ${pack.formula}.`;
  let answer = `${lead} ${coverFor(name, explainName, pack.formula, pack.needed)}`;
  if (key === "currentRatio") {
    answer +=
      " A quick ratio (acid test) is not a separate scored line. Liquidity is this current ratio.";
  }
  return { key, name, formula: pack.formula, answer };
}

function registryEntries(): ProspectMethodEntry[] {
  const entries = METRIC_DIRECTIONS.map((spec) => entryFor(spec.key, spec.name));
  const covered = new Set(entries.map((entry) => entry.name));
  for (const name of Object.values(PILLAR_RATIO_NAMES).flat()) {
    if (covered.has(name)) continue;
    entries.push(entryFor(CATALOGUE_KEY[name] ?? name, name));
    covered.add(name);
  }
  return entries;
}

const RUNWAY_FORMULA = "cash on hand ÷ weekly burn";

export const PROSPECT_RUNWAY_METHOD =
  `Cash runway is ${RUNWAY_FORMULA}, read in weeks. The weekly burn is the cash used in the period divided by the weeks in the stored figures cover (that cover's months, or 12 when the cover is missing). A negative operating cash flow is the burn when it is on file. When the ${CASH_FORECAST_WEEKS}-week forecast spends more than it takes in, runway is opening cash divided by that forecast's weekly net outflow.`;

export const PROSPECT_METHOD_ENTRIES: readonly ProspectMethodEntry[] = registryEntries();

const BY_KEY = new Map<string, ProspectMethodEntry>(
  PROSPECT_METHOD_ENTRIES.map((entry) => [entry.key, entry]),
);
BY_KEY.set("runway", {
  key: "runway",
  name: "Cash runway",
  formula: RUNWAY_FORMULA,
  answer: PROSPECT_RUNWAY_METHOD,
});

export function prospectMethodEntry(key: string): ProspectMethodEntry | null {
  return BY_KEY.get(key) ?? null;
}

const grossMarginEntry = prospectMethodEntry("grossMargin");
if (!grossMarginEntry) throw new Error("Gross Margin has no method entry");
export const PROSPECT_GROSS_MARGIN_METHOD = grossMarginEntry.answer;

/** Phrases that are not already the registry's display name. */
export const METHOD_SYNONYMS: readonly { phrase: string; key: string }[] = [
  { phrase: "days sales outstanding", key: "debtorDays" },
  { phrase: "days receivable", key: "debtorDays" },
  { phrase: "days receivables", key: "debtorDays" },
  { phrase: "receivable days", key: "debtorDays" },
  { phrase: "days ar", key: "debtorDays" },
  { phrase: "dso", key: "debtorDays" },
  { phrase: "days payable outstanding", key: "creditorDays" },
  { phrase: "days payable", key: "creditorDays" },
  { phrase: "payable days", key: "creditorDays" },
  { phrase: "dpo", key: "creditorDays" },
  { phrase: "days inventory", key: "inventoryDays" },
  { phrase: "stock days", key: "inventoryDays" },
  { phrase: "dio", key: "inventoryDays" },
  { phrase: "days wip", key: "wipDays" },
  { phrase: "cash conversion cycle", key: "workingCapitalDays" },
  { phrase: "cash conversion days", key: "workingCapitalDays" },
  { phrase: "cash conversion", key: "workingCapitalDays" },
  { phrase: "wc days", key: "workingCapitalDays" },
  { phrase: "ccc", key: "workingCapitalDays" },
  { phrase: "quick ratio", key: "currentRatio" },
  { phrase: "acid test", key: "currentRatio" },
  { phrase: "debt to equity", key: "debtToEquity" },
  { phrase: "d/e", key: "debtToEquity" },
  { phrase: "gearing", key: "debtToEquity" },
  { phrase: "debt to assets", key: "debtToAssets" },
  { phrase: "burn rate", key: "runway" },
  { phrase: "cash burn", key: "runway" },
  { phrase: "cash runway", key: "runway" },
  { phrase: "runway", key: "runway" },
  { phrase: "burn", key: "runway" },
  { phrase: "gm", key: "grossMargin" },
  { phrase: "roe", key: "roe" },
  { phrase: "roa", key: "roa" },
  { phrase: "asset turnover", key: "assetTurnover" },
  { phrase: "fixed cost ratio", key: "fixedCostRatio" },
  { phrase: "degree of operating leverage", key: "dol" },
  { phrase: "operating leverage", key: "dol" },
  { phrase: "customer concentration", key: "customerConcentration" },
  { phrase: "ocf / ebitda", key: "ocfToEbitda" },
  { phrase: "interest burden", key: "interestBurden" },
  { phrase: "tax burden", key: "taxBurden" },
  { phrase: "equity multiplier", key: "equityMultiplier" },
  { phrase: "sales per employee", key: "salesPerEmployee" },
  { phrase: "gross profit / labor", key: "gpToLabor" },
];

const PHRASES = [
  ...PROSPECT_METHOD_ENTRIES.map((entry) => ({ phrase: entry.name.toLowerCase(), key: entry.key })),
  ...METHOD_SYNONYMS,
].sort((a, b) => b.phrase.length - a.phrase.length);

function mentions(haystack: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|[^a-z0-9])${escaped}(?:$|[^a-z0-9])`, "i").test(haystack);
}

export const PROSPECT_METHOD_GENERIC =
  "I can walk the method without quoting the sample. Use the statement inputs for that metric. Flows are annualised to the stored figures cover (flow × 12 / months when the cover is 1–11 months). A missing or invalid cover is 12 months, so the stored flow is already a year. Balance-sheet stocks are not annualised. A year-to-date span does not replace that cover.";

/** True when the message names a scored metric or a runway synonym. */
export function messageNamesMethod(message: string): boolean {
  return PHRASES.some((item) => mentions(message, item.phrase) && BY_KEY.has(item.key));
}

export function plainMethodReply(message: string): string {
  for (const item of PHRASES) {
    if (!mentions(message, item.phrase)) continue;
    const entry = BY_KEY.get(item.key);
    if (entry) return entry.answer;
  }
  return PROSPECT_METHOD_GENERIC;
}
