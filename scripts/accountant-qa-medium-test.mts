/**
 * Accountant QA medium fixes: attention count, empty-state loading,
 * plan/trial copy, trial-balance period, confirm label, firm market default,
 * and team roster paint.
 * Run: pnpm test:accountant-qa-medium
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  attentionFootnote,
  buildAttentionItems,
  derivePriority,
  firmOpenQueriesClient,
  practiceNeedsAttention,
  summarizePortfolioAttention,
  type PortfolioClientSignals,
} from "../src/lib/portfolio-dashboard";
import { clientMarketDraftFromFirm } from "../src/lib/market";
import { detectImportPeriod, importPeriodFromParts } from "../src/lib/import-period";
import { formatFirmPlanStatus, trialDaysRemaining } from "../src/lib/firm-client-cap";
import { FIRM_BAND_CATALOG, FIRM_TRIAL_CLIENT_LIMIT } from "../src/lib/stripe-plans";
import type { OverallHealth } from "../src/lib/health-score";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function health(displayStatus: OverallHealth["displayStatus"], overall = 80): OverallHealth {
  return {
    overall,
    status: displayStatus,
    displayStatus,
    displayLabel: displayStatus,
    pillars: [],
    weakestPillar: null,
    hasCriticalPillar: displayStatus === "critical",
  };
}

function row(partial: Partial<PortfolioClientSignals> & { displayStatus?: OverallHealth["displayStatus"] }): PortfolioClientSignals {
  const displayStatus = partial.displayStatus ?? "healthy";
  return {
    score: partial.score ?? 80,
    health: partial.health ?? health(displayStatus),
    trendDelta: partial.trendDelta ?? 0,
    runwayWeeks: partial.runwayWeeks ?? 20,
    openQueries: partial.openQueries ?? 0,
    openActions: partial.openActions ?? 0,
    overdueActions: partial.overdueActions ?? 0,
    revenue: partial.revenue ?? 1000,
  };
}

const healthy = row({});
const reviewFromOverdue = row({ overdueActions: 1 });
const reviewFromRunway = row({ runwayWeeks: 3 });
const watching = row({ displayStatus: "at_risk", score: 40 });

assert(derivePriority(healthy).label === "—", "healthy client badge is clear");
assert(derivePriority(reviewFromOverdue).label === "Review now", "overdue work is Review now");
assert(derivePriority(reviewFromRunway).label === "Review now", "short runway is Review now");

const mixed = summarizePortfolioAttention([healthy, reviewFromOverdue, reviewFromRunway, watching]);
assert(mixed.reviewNow === 2, "summary counts both Review now rows");
assert(mixed.watching === 1, "at-risk row is watching");
assert(mixed.needAttention === 3, "tile count is review now plus watching");
assert(attentionFootnote(mixed) === "2 review now · 1 watching", "footnote names both groups");
assert(!attentionFootnote(mixed).includes("All clear"), "mixed book is not all clear");

const clear = summarizePortfolioAttention([healthy, healthy]);
assert(clear.needAttention === 0, "clear book counts zero");
assert(attentionFootnote(clear) === "All clear", "all clear only when every badge is clear");

function named(
  id: string,
  name: string,
  partial: Partial<PortfolioClientSignals> & { displayStatus?: OverallHealth["displayStatus"] },
) {
  return { id, name, ...row(partial) };
}

const yankees = named("yankees", "Yankees", { displayStatus: "at_risk", score: 40 });
const qaTest = named("qa-test", "QA Test Co", { displayStatus: "at_risk", score: 48 });
const qaUs = named("qa-us", "QA US", {});
const healthAlerts = buildAttentionItems([yankees, qaTest, qaUs], 3);
assert(healthAlerts.length === 2, "a clear client is not a health alert");
assert(
  summarizePortfolioAttention([yankees, qaTest, qaUs]).needAttention === 2,
  "priority badges alone miss a pack-only client",
);
const shared = practiceNeedsAttention(healthAlerts, [
  {
    clientId: "qa-us",
    name: "QA US",
    exceptions: [{ severity: 1, label: "Pack v1 waiting for your sign-off", tab: "advisory" }],
  },
]);
assert(
  shared.items.map((item) => item.name).join(",") === "QA US,QA Test Co,Yankees",
  "the queue lists the pack and both watching clients",
);
assert(shared.summary.needAttention === shared.items.length, "the tile count is the list length");
assert(shared.summary.needAttention === 3, "Yankees, QA Test Co, and QA US are one count");
assert(
  shared.summary.reviewNow + shared.summary.watching === shared.summary.needAttention,
  "review now and watching cover every listed client",
);
assert(attentionFootnote(shared.summary) === "1 review now · 2 watching", "footnote matches the queue");
const doubled = practiceNeedsAttention(healthAlerts, [
  {
    clientId: "yankees",
    name: "Yankees",
    exceptions: [{ severity: 1, label: "Pack v1 waiting for your sign-off", tab: "advisory" }],
  },
  {
    clientId: "qa-us",
    name: "QA US",
    exceptions: [{ severity: 2, label: "1 overdue action", tab: "plan" }],
  },
]);
assert(doubled.items.length === 3, "a client in health and portfolio is one row");
assert(doubled.summary.needAttention === 3, "the shared count does not double-count");

assert(firmOpenQueriesClient([]) === null, "an empty book has no queries destination");
assert(
  firmOpenQueriesClient([
    { id: "a", name: "Yankees", openQueries: 0 },
    { id: "b", name: "QA US", openQueries: 0 },
  ]) === null,
  "zero open queries is not a click target",
);
assert(
  firmOpenQueriesClient([{ id: "only", name: "Yankees", openQueries: 2 }]) === "only",
  "one client with queries is the destination",
);
assert(
  firmOpenQueriesClient([
    { id: "a", name: "Yankees", openQueries: 1 },
    { id: "b", name: "QA US", openQueries: 4 },
    { id: "c", name: "QA Test Co", openQueries: 4 },
  ]) === "c",
  "the busiest client wins, then the name",
);

const za = clientMarketDraftFromFirm({ country: "ZA", regionCode: null });
assert(za.country === "ZA" && za.regionCode == null, "ZA firm drafts rand");
const unknown = clientMarketDraftFromFirm(null);
assert(unknown.country === "ZA", "missing firm market defaults to South Africa");
assert(unknown.country !== "US", "missing firm market is not the visitor US default");
const us = clientMarketDraftFromFirm({ country: "US", regionCode: "CA" });
assert(us.country === "US" && us.regionCode === "CA", "US firm with a state keeps that market");

assert(detectImportPeriod(null) == null, "missing period is not detected");
assert(detectImportPeriod("Unknown") == null, "unknown text is not detected");
assert(detectImportPeriod("2026-13-01") == null, "invalid month is not detected");
const detected = detectImportPeriod("2026-02-28");
assert(detected?.year === 2026 && detected.month === 2, "ISO period end prefills month and year");
assert(importPeriodFromParts("", "") == null, "blank picker does not invent a period");
const feb = importPeriodFromParts(2026, 2);
assert(feb?.periodEnd === "2026-02-28" && feb.periodLabel === "Feb 2026", "Feb 2026 ends on the 28th");
const leap = importPeriodFromParts(2024, 2);
assert(leap?.periodEnd === "2024-02-29", "leap February ends on the 29th");

const now = new Date("2026-10-05T12:00:00.000Z");
assert(trialDaysRemaining("2026-10-14T12:00:00.000Z", now) === 9, "nine days left");
assert(trialDaysRemaining("2026-10-04T12:00:00.000Z", now) === 0, "past trial end is zero days");
const soloLimit = FIRM_BAND_CATALOG.solo.clientLimit;
assert(FIRM_TRIAL_CLIENT_LIMIT === 3, "enforced trial cap is 3 clients");
assert(soloLimit === 15, "paid Solo cap is 15, not the trial cap");
const trial = formatFirmPlanStatus({
  phase: "trialing",
  band: "solo",
  trialEndIso: "2026-10-14T12:00:00.000Z",
  now,
});
assert(trial.headline === "Trial — 9 days left", "trial headline counts days");
assert(trial.detail === "Up to 3 clients · Solo after the trial", "trial detail uses the trial cap");
assert(!trial.detail?.includes(String(soloLimit)), "trial copy does not advertise the paid cap");
const active = formatFirmPlanStatus({ phase: "active", band: "solo", now });
assert(active.headline === "Solo", "active plan shows the band name");
assert(active.detail === "Up to 15 active clients", "active plan shows the paid client limit");
const ended = formatFirmPlanStatus({
  phase: "trialing",
  band: "solo",
  trialEndIso: "2026-10-04T12:00:00.000Z",
  now,
});
assert(ended.headline === "Trial — ends today", "elapsed trial says it ends today");

const dash = readFileSync(resolve("src/routes/_authenticated/dashboard.tsx"), "utf8");
assert(dash.includes("practiceNeedsAttention"), "dashboard tile and list share one attention queue");
assert(dash.includes("queue={attentionBook.items}"), "the strip renders that same queue");
assert(dash.includes("needAttention: attention.needAttention"), "greeting uses the shared count");
assert(dash.includes("attentionFootnote"), "dashboard footnote uses the same summary");
assert(!dash.includes("summarizePortfolioAttention"), "the tile does not count priority badges on their own");
assert(dash.includes("firmOpenQueriesClient"), "open queries uses the destination helper");
assert(
  dash.includes("queriesClientId ? () => openClientQueries(queriesClientId) : undefined"),
  "open queries is not clickable when no client has queries",
);
assert(!dash.includes("scrollIntoView"), "open queries does not scroll into a dead end");
assert(dash.includes("bookLoading"), "dashboard waits on the client list");
assert(dash.includes("Loading your clients…"), "greeting stays in a loading state");
assert(dash.includes("clientMarketDraftFromFirm"), "add-client starts from the firm market");

const upload = readFileSync(resolve("src/components/upload-financials.tsx"), "utf8");
assert(upload.includes('id="import-period-month"'), "confirm step asks for a month");
assert(upload.includes('id="import-period-year"'), "confirm step asks for a year");
assert(upload.includes("Extracted period: Unknown"), "undetected period is shown as unknown");
assert(upload.includes('inputId="confirm-import-figures"'), "confirm checkbox has an id");
assert(upload.includes("confirm they should be imported for"), "checkbox label names the import");
assert(!upload.includes("toLocaleString"), "upload does not label the period from today");
assert(!/new Date\(\)/.test(upload), "upload does not default the period to today");

const disclaimer = readFileSync(resolve("src/components/upload-quality-disclaimer.tsx"), "utf8");
assert(disclaimer.includes("htmlFor={inputId}"), "checkbox label is wired to the input");
assert(disclaimer.includes("aria-label={label}"), "checkbox has an accessible name");

const clientPage = readFileSync(resolve("src/routes/_authenticated/clients.$clientId.tsx"), "utf8");
assert(
  clientPage.includes("handleConfirmFinancials(result, prefs, period)"),
  "confirm passes the chosen period",
);
assert(
  clientPage.includes("Choose the statement period before importing."),
  "save refuses a missing period",
);

const settings = readFileSync(resolve("src/routes/_authenticated/settings.index.tsx"), "utf8");
assert(settings.includes("getFirmPlanDisplay"), "settings reads the existing plan display");
assert(settings.includes("Loading plan…"), "plan line has a loading state");
assert(settings.includes("plan?.headline"), "settings shows the plan headline");

const team = readFileSync(resolve("src/routes/_authenticated/settings.team.tsx"), "utf8");
assert(team.includes("getPracticeTeamRoster"), "team page loads the roster on its own");
assert(team.includes("Loading client access…"), "client assignments wait without hiding members");
assert(team.includes("view.members.map"), "member list renders from the first board that arrives");

const access = readFileSync(resolve("src/lib/practice-access.functions.ts"), "utf8");
assert(access.includes("export const getPracticeTeamRoster"), "roster server function exists");
assert(access.includes('.in("id", ids)'), "member profiles load in one query");
assert(access.includes("Promise.all([clientQuery, assignQuery, inviteQuery])"), "secondary reads run together");

console.log("accountant-qa-medium-test: ok");
