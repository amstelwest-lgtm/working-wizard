/**
 * Deliverable input config — catalog, merge, fingerprint, persistence, UI wiring.
 * Run: pnpm test:deliverable-input-config
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildDeliverableInputDefinition,
  catalogCopyIsClientFacing,
  computedDaysAp,
  computedDaysAr,
  configNeedsRefresh,
  countCheckedSources,
  defaultDaysAp,
  defaultDaysAr,
  DELIVERABLE_INPUT_IDS,
  deliverableInputContextKey,
  deliverableInputFingerprint,
  DEFAULT_DAYS_AP,
  DEFAULT_SPEND_TREND_DAYS,
  liveAssumptionOverlay,
  markConfigApplied,
  mergeDeliverableInputState,
  onlyLiveEngineValuesChanged,
  bankAccountsFromDraft,
} from "../src/lib/deliverable-input-config";
import {
  DELIVERABLE_INPUT_STORAGE_PREFIX,
  parseStoredDeliverableInputs,
  parseDeliverableInputState,
} from "../src/lib/deliverable-input-config.store";
import { CASH_RUNWAY_THRESHOLD_RAND } from "../src/lib/cash-runway";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const cash = buildDeliverableInputDefinition("cash", {});
assert(
  cash.sources.some((s) => s.id === "pl"),
  "cash includes P&L",
);
assert(
  cash.sources.some((s) => s.id === "balance_sheet"),
  "cash includes balance sheet",
);
assert(
  cash.sources.some((s) => s.id === "bank_accounts"),
  "cash includes bank accounts",
);
assert(
  cash.sources.some((s) => s.id === "ar_ap"),
  "cash includes AR/AP",
);
assert(
  cash.assumptions.some((a) => a.id === "daysAr" && a.kind === "number"),
  "cash days AR",
);
assert(
  cash.assumptions.some((a) => a.id === "daysAp" && a.kind === "number"),
  "cash days AP",
);
assert(
  cash.assumptions.find((a) => a.id === "collectDelay")?.engineBound === true,
  "collection delay is first-class",
);
assert(
  cash.assumptions.find((a) => a.id === "revGrowthPct")?.engineBound === true,
  "weekly growth is first-class",
);
assert(
  cash.assumptions.find((a) => a.id === "spendTrendDays")?.engineBound === false,
  "lookback is a labeled default",
);
assert(
  cash.assumptions.find((a) => a.id === "applySeasonality")?.engineBound === false,
  "seasonality scale is a labeled default",
);
assert(
  cash.questions.some((q) => /bank statements/i.test(q.prompt)),
  "cash asks for bank statements when none uploaded",
);

const withBanks = buildDeliverableInputDefinition("cash", {
  hasBankDraft: true,
  bankAccounts: [{ id: "cheque", label: "Cheque — FNB" }],
  financials: { revenue: "1200000", receivables: "150000", payables: "40000", cogs: "480000" },
});
assert(
  withBanks.sources.some((s) => s.id === "bank:cheque" && s.label === "Cheque — FNB"),
  "per-account source from the bank pack",
);
assert(
  !withBanks.questions.some((q) => /bank statements/i.test(q.prompt)),
  "bank question drops once a pack exists",
);

assert(
  computedDaysAr({ revenue: "365000", receivables: "10000", periodMonths: "12" }) === 10,
  "DSO",
);
assert(computedDaysAp({ cogs: "365000", payables: "20000", periodMonths: "12" }) === 20, "DPO");
assert(defaultDaysAr({}) === 30, "days AR default");
assert(defaultDaysAp({}) === DEFAULT_DAYS_AP, "days AP default");
assert(DEFAULT_SPEND_TREND_DAYS === 90, "lookback default");

const merged = mergeDeliverableInputState(cash, {
  checkedSources: { pl: false },
  assumptionValues: { collectDelay: 2, spendTrendDays: 60 },
});
assert(merged.checkedSources.pl === false, "unchecked P&L sticks");
assert(merged.checkedSources.bank_accounts === true, "other sources default on");
assert(merged.assumptionValues.collectDelay === 2, "stored collection delay");
assert(merged.assumptionValues.spendTrendDays === 60, "stored lookback");

const live = liveAssumptionOverlay(cash, { collectDelay: 4, revGrowthPct: 1.5 });
assert(live.collectDelay === 4 && live.revGrowthPct === 1.5, "live engine overlay");

const overlaid = mergeDeliverableInputState(
  cash,
  { checkedSources: {}, assumptionValues: { collectDelay: 1 } },
  { collectDelay: 5 },
);
assert(overlaid.assumptionValues.collectDelay === 5, "live collectDelay wins");

const fp1 = deliverableInputFingerprint(merged);
const flipped = {
  ...merged,
  checkedSources: { ...merged.checkedSources, pl: true },
};
assert(deliverableInputFingerprint(flipped) !== fp1, "unchecking a source changes fingerprint");
const applied = markConfigApplied(merged);
assert(!configNeedsRefresh(applied), "freshly applied is not stale");
assert(
  configNeedsRefresh({ ...applied, checkedSources: flipped.checkedSources }),
  "source flip is stale",
);

const afterLive = mergeDeliverableInputState(cash, applied, { collectDelay: 3 });
assert(
  onlyLiveEngineValuesChanged(applied, afterLive, cash),
  "scenario-studio collectDelay is an engine-only change",
);
assert(
  !onlyLiveEngineValuesChanged(applied, flipped, cash),
  "source checkbox is not an engine-only change",
);

const counts = countCheckedSources(cash, merged);
assert(counts.total === cash.sources.length, "source total");
assert(counts.checked === counts.total - 1, "one source unchecked");

const budget = buildDeliverableInputDefinition("budget", {
  budgetWc: { debtorDays: 45, creditorDays: 21, inventoryDays: 14 },
});
assert(
  budget.assumptions.find((a) => a.id === "daysAr")?.engineBound === true,
  "budget AR is first-class",
);
assert(
  budget.assumptions.find((a) => a.id === "daysAp")?.engineBound === true,
  "budget AP is first-class",
);
const budgetMerged = mergeDeliverableInputState(budget, null, {
  budgetWc: { debtorDays: 45, creditorDays: 21, inventoryDays: 14 },
});
assert(budgetMerged.assumptionValues.daysAr === 45, "budget seeds AR from WC");
assert(budgetMerged.assumptionValues.daysAp === 21, "budget seeds AP from WC");

for (const id of DELIVERABLE_INPUT_IDS) {
  const def = buildDeliverableInputDefinition(id, {});
  assert(def.id === id, `${id} catalog exists`);
  for (const s of def.sources) {
    assert(catalogCopyIsClientFacing(s.label), `${id} source label is client-facing`);
    if (s.hint) assert(catalogCopyIsClientFacing(s.hint), `${id} source hint is client-facing`);
  }
  for (const q of def.questions) {
    assert(catalogCopyIsClientFacing(q.prompt), `${id} question is client-facing`);
  }
  for (const a of def.assumptions) {
    assert(catalogCopyIsClientFacing(a.label), `${id} assumption is client-facing`);
    if (a.defaultLabel)
      assert(catalogCopyIsClientFacing(a.defaultLabel), `${id} default label is client-facing`);
  }
}

const parsed = parseDeliverableInputState({
  checkedSources: { pl: false, junk: "no" },
  assumptionValues: { daysAr: 40, skip: { x: 1 } },
  appliedFingerprint: "abc",
});
assert(
  parsed?.checkedSources.pl === false && parsed.checkedSources.junk == null,
  "coerce booleans",
);
assert(
  parsed?.assumptionValues.daysAr === 40 && parsed.assumptionValues.skip == null,
  "coerce values",
);
assert(
  parseStoredDeliverableInputs({ cash: parsed, nope: {} }).cash?.assumptionValues.daysAr === 40,
  "map parse",
);
assert(
  DELIVERABLE_INPUT_STORAGE_PREFIX.startsWith("milon.deliverableInputConfig"),
  "storage key prefix",
);

const accts = bankAccountsFromDraft({
  extract: { accounts: [{ account_label: "Cheque — FNB" }, { account_label: "Cheque — FNB" }] },
});
assert(accts.length === 1 && accts[0]!.label === "Cheque — FNB", "dedupe bank accounts");

assert(
  deliverableInputContextKey("cash", { collectDelay: 1 }) !==
    deliverableInputContextKey("cash", { collectDelay: 2 }),
  "context key tracks collection delay",
);

assert(CASH_RUNWAY_THRESHOLD_RAND === 50_000, "runway default matches engine");

const ui = read("src/components/deliverable-input-config.tsx");
assert(ui.includes("Configure inputs"), "collapsed title");
assert(ui.includes("Inputs used"), "sources heading");
assert(ui.includes("Open questions"), "questions heading");
assert(ui.includes("Assumptions"), "assumptions heading");
assert(!/claude|seeding ai|\bbots?\b/i.test(ui), "component copy stays accountant-facing");

const cashSrc = read("src/components/cash-forecast.tsx");
assert(cashSrc.includes("DeliverableInputConfig"), "cash panel hosts configure inputs");
assert(cashSrc.includes('deliverableId="cash"'), "cash id");
assert(cashSrc.includes("onEngineBoundChange"), "cash wires engine fields");
assert(cashSrc.includes("setCollectDelay"), "collection delay writes into the forecast");

const budgetSrc = read("src/components/budget/budget-panel.tsx");
assert(budgetSrc.includes("DeliverableInputConfig"), "budget panel hosts configure inputs");
assert(budgetSrc.includes("wc.debtorDays"), "budget AR writes into WC");

const studio = read("src/routes/_authenticated/clients.$clientId.tsx");
for (const id of ["ratios", "profit", "plan", "reports", "advisory", "summary"] as const) {
  assert(studio.includes(`deliverableId="${id}"`), `accountant ${id} tab is wired`);
}
assert(!studio.includes('deliverableId="ask"'), "Ask / bot tab is not a configure-inputs surface");
assert(!studio.includes('deliverableId="cash"'), "cash is not double-wired in the studio shell");
assert(
  !studio.includes('deliverableId="budget"'),
  "budget is not double-wired in the studio shell",
);

console.log("deliverable-input-config-test: all assertions passed");
