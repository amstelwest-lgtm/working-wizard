/**
 * Accountant studio clarity — tour card, complex ratios, playbooks, cash orb,
 * summary Answer controls, bot context.
 * Run: pnpm test:accountant-studio-clarity
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { playbookKeyForRatioName } from "../src/lib/playbook-key";
import { ratioActualLine } from "../src/lib/ratio-actuals";
import { PILLAR_DRIVER_KEYS } from "../src/components/sphere-hero-adapter";
import { computeRatios, type RatioInputs } from "../src/lib/ratios";
import { classify } from "../supabase/functions/ask-ai/classifier.ts";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const wizard = readFileSync(resolve("src/components/walkthrough-wizard.tsx"), "utf8");
assert(wizard.includes("min(560px"), "tour card is wide enough to read");
assert(wizard.includes("vh * 0.68"), "tour card can use most of the viewport height");
assert(wizard.includes("vh * 0.28"), "spotlight hole stays compact so the card has room");

const studio = readFileSync(
  resolve("src/routes/_authenticated/clients.$clientId.tsx"),
  "utf8",
);
assert(
  studio.includes("const [finOpen, setFinOpen] = useState(false)"),
  "Financials starts closed",
);
assert(studio.includes("playbookKeyForRatioName"), "complex ratios open camelCase playbooks");
assert(studio.includes("ratioActualLine"), "complex rows show mini actuals");
assert(studio.includes("PILLAR_RATIO_NAMES"), "complex list is grouped by pillar");
assert(studio.includes("onAnswerProfile"), "summary can open the profile funnel");
assert(studio.includes("upsertCurrentPeriodSnapshot"), "bank apply writes a snapshot for Ask AI");
assert(!studio.includes("<WeeklyInputTable"), "weekly grid removed from accountant Profit");

const sphere = readFileSync(resolve("src/components/sphere-hero.tsx"), "utf8");
assert(sphere.includes("go(3, p.id)"), "L1 pillar tiles drill into that pillar's drivers");

assert(PILLAR_DRIVER_KEYS.cash.includes("workingCapitalDays"), "cash drivers match scored ratios");
assert(!PILLAR_DRIVER_KEYS.cash.includes("currentRatio"), "cash drivers do not list uncollected fields");
assert(PILLAR_DRIVER_KEYS.cash.includes("debtorDays"), "cash includes debtor days");
assert(PILLAR_DRIVER_KEYS.profit.includes("netMargin"), "profit includes net margin");

assert(playbookKeyForRatioName("Gross Margin") === "grossMargin", "Gross Margin → grossMargin");
assert(playbookKeyForRatioName("Net Margin") === "netMargin", "Net Margin → netMargin");
assert(playbookKeyForRatioName("Inventory Days") === "wipDays", "Inventory Days aliases wipDays playbook");
assert(
  playbookKeyForRatioName("Working Capital Days") === "workingCapitalFunding",
  "WC days aliases working-capital playbook",
);
assert(playbookKeyForRatioName("Operating Margin") === "operatingMargin", "Operating Margin stays camelCase");

const inputs: RatioInputs = {
  revenue: "800000",
  cogs: "400000",
  ebit: "160000",
  ebt: "140000",
  netIncome: "120000",
  ebitda: "180000",
  operatingCashflow: "150000",
  totalAssets: "500000",
  equity: "250000",
  receivables: "80000",
  inventory: "40000",
  payables: "30000",
  fixedCosts: "200000",
  variableCosts: "240000",
  top5Revenue: "200000",
  laborCost: "180000",
  employees: "6",
  founderHours: "2000",
};
const ratios = computeRatios(inputs);
assert(Object.keys(ratios).length === 19, "computeRatios still returns the full 19");
const net = ratioActualLine("Net Margin", inputs, (n) => `R${n.toLocaleString("en-ZA")}`);
assert(net.formula.includes("Net income"), "net margin formula");
assert(net.calculation?.includes("15.0%"), `net margin mini actual, got ${net.calculation}`);
const missing = ratioActualLine(
  "Debtor Days",
  { ...inputs, receivables: "" },
  (n) => String(n),
);
assert(missing.missing.includes("Receivables"), "mini actual names the missing field");

assert(
  classify("What's the biggest drag on this client's score vs peers?") === "full",
  "peer drag question is full disclosure",
);

const drawer = readFileSync(resolve("src/components/playbook-drawer.tsx"), "utf8");
assert(drawer.includes("fallbackSteps"), "drawer shows working notes when JSON pack is missing");
assert(drawer.includes("actualLine"), "drawer shows the mini actual calculation");

const summary = readFileSync(resolve("src/components/client-brain-summary.tsx"), "utf8");
assert(summary.includes("AnswerButton"), "summary has a dedicated Answer control");
assert(summary.includes("kind: \"map\""), "business-map blanks are fillable");

const builder = readFileSync(resolve("supabase/functions/ask-ai/context-builder.ts"), "utf8");
assert(builder.includes("resolveRatioRecord"), "Ask AI derives ratios when the snapshot is empty");

console.log("accountant-studio-clarity-test: all assertions passed");
